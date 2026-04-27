// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"bytes"
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
	Path       string
	Action     string
	Local      *protocol.FileInfo
	Global     *protocol.FileInfo
	CanPublish bool
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
