// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"bytes"
	"path"
	"slices"

	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/events"
	"github.com/syncthing/syncthing/lib/protocol"
)

const (
	PendingPublishViewAll      = "all"
	PendingPublishViewAdded    = "added"
	PendingPublishViewModified = "modified"
	PendingPublishViewDelete   = "delete"
)

type PendingPublishOptions struct {
	Page    int
	PerPage int
	Prefix  string
	View    string
}

type PendingPublishEntry struct {
	Path            string
	Action          string
	Local           *protocol.FileInfo
	Global          *protocol.FileInfo
	RenameCandidate string
	CanPublish      bool
}

type PendingPublishResult struct {
	Entries          []PendingPublishEntry
	Page             int
	PerPage          int
	Total            int
	ManualPublish    bool
	FolderCanPublish bool
	RequestedView    string
	RequestedPrefix  string
}

func (m *model) PendingPublishFolderFiles(folder string, opts PendingPublishOptions) (PendingPublishResult, error) {
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !ok {
		return PendingPublishResult{}, ErrFolderMissing
	}

	opts = normalizePendingPublishOptions(opts)

	localFiles, err := m.collectCompareFiles(folder, protocol.LocalDeviceID, opts.Prefix)
	if err != nil {
		return PendingPublishResult{}, err
	}

	entries := buildPendingPublishEntries(m, folder, localFiles)
	entries = filterPendingPublishEntries(entries, opts.View)
	total := len(entries)

	start := (opts.Page - 1) * opts.PerPage
	if start > total {
		start = total
	}
	end := start + opts.PerPage
	if end > total {
		end = total
	}

	pageEntries := make([]PendingPublishEntry, end-start)
	copy(pageEntries, entries[start:end])

	return PendingPublishResult{
		Entries:          pageEntries,
		Page:             opts.Page,
		PerPage:          opts.PerPage,
		Total:            total,
		ManualPublish:    cfg.ManualPublish,
		FolderCanPublish: folderTypeCanPublish(cfg.Type),
		RequestedView:    opts.View,
		RequestedPrefix:  opts.Prefix,
	}, nil
}

func normalizePendingPublishOptions(opts PendingPublishOptions) PendingPublishOptions {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 {
		opts.PerPage = 1 << 16
	}
	if opts.View == "" {
		opts.View = PendingPublishViewAll
	}
	return opts
}

func buildPendingPublishEntries(m *model, folder string, localFiles map[string]protocol.FileInfo) []PendingPublishEntry {
	names := make([]string, 0, len(localFiles))
	for name, fi := range localFiles {
		if fi.IsIgnored() || !fi.IsManualPublishPending() {
			continue
		}
		names = append(names, name)
	}
	slices.Sort(names)

	entries := make([]PendingPublishEntry, 0, len(names))
	for _, name := range names {
		local := localFiles[name]
		global, ok, err := m.sdb.GetGlobalFile(folder, name)
		if err != nil {
			continue
		}

		entry := PendingPublishEntry{
			Path:       name,
			Local:      &local,
			CanPublish: true,
		}

		if ok && !global.IsManualPublishPending() {
			entry.Global = &global
		}
		entry.Action = pendingPublishAction(entry)
		entries = append(entries, entry)
	}

	markPendingPublishRenameCandidates(entries)
	sortPendingPublishEntries(entries)
	return entries
}

func pendingPublishAction(entry PendingPublishEntry) string {
	switch {
	case entry.Local == nil:
		return PendingPublishViewModified
	case entry.Local.IsDeleted():
		return PendingPublishViewDelete
	case len(entry.Local.PreviousBlocksHash) > 0:
		return PendingPublishViewModified
	case entry.Global == nil || entry.Global.IsDeleted():
		return PendingPublishViewAdded
	case entry.Local.FileType() != entry.Global.FileType():
		return PendingPublishViewModified
	case entry.Local.IsDirectory():
		if entry.Local.FileModifiedBy() != entry.Global.FileModifiedBy() || !entry.Local.ModTime().Equal(entry.Global.ModTime()) {
			return PendingPublishViewModified
		}
		return PendingPublishViewModified
	default:
		if entry.Local.FileSize() != entry.Global.FileSize() || !bytes.Equal(entry.Local.BlocksHash, entry.Global.BlocksHash) {
			return PendingPublishViewModified
		}
		return PendingPublishViewModified
	}
}

func filterPendingPublishEntries(entries []PendingPublishEntry, view string) []PendingPublishEntry {
	if view == "" || view == PendingPublishViewAll {
		return entries
	}

	filtered := make([]PendingPublishEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Action == view {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func markPendingPublishRenameCandidates(entries []PendingPublishEntry) {
	type entryRef struct {
		index int
		path  string
	}

	deletesByHash := make(map[string][]entryRef)
	addsByHash := make(map[string][]entryRef)

	for i, entry := range entries {
		hash, ok := pendingPublishComparableHash(entry)
		if !ok {
			continue
		}

		switch entry.Action {
		case PendingPublishViewDelete:
			deletesByHash[string(hash)] = append(deletesByHash[string(hash)], entryRef{index: i, path: entry.Path})
		case PendingPublishViewAdded:
			addsByHash[string(hash)] = append(addsByHash[string(hash)], entryRef{index: i, path: entry.Path})
		}
	}

	for hash, deletes := range deletesByHash {
		adds, ok := addsByHash[hash]
		if !ok {
			continue
		}

		slices.SortFunc(deletes, func(a, b entryRef) int {
			return bytes.Compare([]byte(a.path), []byte(b.path))
		})
		slices.SortFunc(adds, func(a, b entryRef) int {
			return bytes.Compare([]byte(a.path), []byte(b.path))
		})

		limit := min(len(deletes), len(adds))
		for i := 0; i < limit; i++ {
			deleteRef := deletes[i]
			addRef := adds[i]
			if !pendingPublishComparableSizesMatch(entries[deleteRef.index], entries[addRef.index]) {
				continue
			}
			entries[deleteRef.index].RenameCandidate = addRef.path
			entries[addRef.index].RenameCandidate = deleteRef.path
		}
	}

	matchPendingPublishRenameFallback(entries)
}

func pendingPublishComparableHash(entry PendingPublishEntry) ([]byte, bool) {
	if entry.Local == nil {
		return nil, false
	}

	switch entry.Action {
	case PendingPublishViewDelete:
		if len(entry.Local.PreviousBlocksHash) > 0 {
			return entry.Local.PreviousBlocksHash, true
		}
		if entry.Global != nil && len(entry.Global.BlocksHash) > 0 {
			return entry.Global.BlocksHash, true
		}
	case PendingPublishViewAdded:
		if !entry.Local.IsDeleted() && len(entry.Local.BlocksHash) > 0 {
			return entry.Local.BlocksHash, true
		}
	}

	return nil, false
}

func pendingPublishComparableSize(entry PendingPublishEntry) int64 {
	if entry.Local == nil {
		return 0
	}

	switch entry.Action {
	case PendingPublishViewDelete:
		if entry.Global != nil {
			return entry.Global.FileSize()
		}
		return 0
	case PendingPublishViewAdded:
		return entry.Local.FileSize()
	default:
		return 0
	}
}

func pendingPublishComparableSizesMatch(oldEntry, newEntry PendingPublishEntry) bool {
	oldSize := pendingPublishComparableSize(oldEntry)
	newSize := pendingPublishComparableSize(newEntry)
	if oldSize == 0 || newSize == 0 {
		return true
	}
	return oldSize == newSize
}

func matchPendingPublishRenameFallback(entries []PendingPublishEntry) {
	type entryRef struct {
		index int
		path  string
	}

	deletesByBase := make(map[string][]entryRef)
	addsByBase := make(map[string][]entryRef)

	for i, entry := range entries {
		if entry.RenameCandidate != "" {
			continue
		}

		base := path.Base(entry.Path)
		switch entry.Action {
		case PendingPublishViewDelete:
			deletesByBase[base] = append(deletesByBase[base], entryRef{index: i, path: entry.Path})
		case PendingPublishViewAdded:
			addsByBase[base] = append(addsByBase[base], entryRef{index: i, path: entry.Path})
		}
	}

	for base, deletes := range deletesByBase {
		adds, ok := addsByBase[base]
		if !ok {
			continue
		}

		slices.SortFunc(deletes, func(a, b entryRef) int {
			return bytes.Compare([]byte(a.path), []byte(b.path))
		})
		slices.SortFunc(adds, func(a, b entryRef) int {
			return bytes.Compare([]byte(a.path), []byte(b.path))
		})

		limit := min(len(deletes), len(adds))
		for i := 0; i < limit; i++ {
			deleteRef := deletes[i]
			addRef := adds[i]
			if !pendingPublishComparableSizesMatch(entries[deleteRef.index], entries[addRef.index]) {
				continue
			}
			entries[deleteRef.index].RenameCandidate = addRef.path
			entries[addRef.index].RenameCandidate = deleteRef.path
		}
	}
}

func sortPendingPublishEntries(entries []PendingPublishEntry) {
	slices.SortStableFunc(entries, func(a, b PendingPublishEntry) int {
		groupA := pendingPublishGroupKey(a)
		groupB := pendingPublishGroupKey(b)
		if c := bytes.Compare([]byte(groupA), []byte(groupB)); c != 0 {
			return c
		}

		if c := cmpPendingPublishGroupRank(a) - cmpPendingPublishGroupRank(b); c != 0 {
			return c
		}

		return bytes.Compare([]byte(a.Path), []byte(b.Path))
	})
}

func pendingPublishGroupKey(entry PendingPublishEntry) string {
	if entry.RenameCandidate == "" {
		return entry.Path
	}
	if entry.Path < entry.RenameCandidate {
		return entry.Path
	}
	return entry.RenameCandidate
}

func cmpPendingPublishGroupRank(entry PendingPublishEntry) int {
	if entry.RenameCandidate == "" {
		return 0
	}
	switch entry.Action {
	case PendingPublishViewDelete:
		return 0
	case PendingPublishViewAdded:
		return 1
	default:
		return 2
	}
}

func folderTypeCanPublish(t config.FolderType) bool {
	return t == config.FolderTypeSendReceive || t == config.FolderTypeSendOnly
}

func (m *model) PublishFolderSelected(folder string, files []string) error {
	m.mut.RLock()
	cfg, cfgOK := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !cfgOK {
		return ErrFolderMissing
	}
	if cfg.Paused {
		return ErrFolderPaused
	}
	if !folderTypeCanPublish(cfg.Type) {
		return ErrFolderNotRunning
	}

	updates := make([]protocol.FileInfo, 0, len(files))
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		if _, ok := seen[file]; ok {
			continue
		}
		seen[file] = struct{}{}

		fi, ok, err := m.sdb.GetDeviceFile(folder, protocol.LocalDeviceID, file)
		if err != nil {
			return err
		}
		if !ok || !fi.IsManualPublishPending() {
			continue
		}
		fi.LocalFlags &^= protocol.FlagLocalManualPublish
		updates = append(updates, fi)
	}

	if len(updates) == 0 {
		return nil
	}

	if err := m.sdb.Update(folder, protocol.LocalDeviceID, updates); err != nil {
		return err
	}

	seq, err := m.sdb.GetDeviceSequence(folder, protocol.LocalDeviceID)
	if err != nil {
		return err
	}
	names := make([]string, len(updates))
	for i, file := range updates {
		names[i] = file.Name
	}
	m.evLogger.Log(events.LocalIndexUpdated, map[string]interface{}{
		"folder":    folder,
		"items":     len(updates),
		"filenames": names,
		"sequence":  seq,
		"version":   seq,
	})
	return nil
}

func (m *model) normalizeManualPublishState(folder string, cfg config.FolderConfiguration) error {
	if cfg.ManualPublish || !folderTypeCanPublish(cfg.Type) {
		return nil
	}

	it, errFn := m.sdb.AllLocalFiles(folder, protocol.LocalDeviceID)
	updates := make([]protocol.FileInfo, 0)
	for fi := range it {
		if !fi.IsManualPublishPending() {
			continue
		}
		fi.LocalFlags &^= protocol.FlagLocalManualPublish
		updates = append(updates, fi)
	}
	if err := errFn(); err != nil {
		return err
	}
	if len(updates) == 0 {
		return nil
	}

	if err := m.sdb.Update(folder, protocol.LocalDeviceID, updates); err != nil {
		return err
	}

	seq, err := m.sdb.GetDeviceSequence(folder, protocol.LocalDeviceID)
	if err != nil {
		return err
	}
	names := make([]string, len(updates))
	for i, file := range updates {
		names[i] = file.Name
	}
	m.evLogger.Log(events.LocalIndexUpdated, map[string]interface{}{
		"folder":    folder,
		"items":     len(updates),
		"filenames": names,
		"sequence":  seq,
		"version":   seq,
	})
	return nil
}
