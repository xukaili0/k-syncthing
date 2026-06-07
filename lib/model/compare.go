// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"bytes"
	"cmp"
	"slices"
	"time"

	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/protocol"
)

const (
	CompareViewAll        = "all"
	CompareViewDifferent  = "different"
	CompareViewSame       = "same"
	CompareViewDelete     = "delete"
	CompareViewModified   = "modified"
	CompareViewConflict   = "conflict"
	CompareViewOnlyLocal  = "only-local"
	CompareViewOnlyRemote = "only-remote"
	CompareViewRename     = "rename"
)

type CompareOptions struct {
	Page          int
	PerPage       int
	Prefix        string
	View          string
	IgnoreModTime bool
}

type CompareEntry struct {
	Path            string
	Status          string
	Local           *protocol.FileInfo
	Remote          *protocol.FileInfo
	RenameCandidate string
	CanPrioritize   bool
}

type CompareResult struct {
	Entries         []CompareEntry
	Page            int
	PerPage         int
	Total           int
	RemoteConnected bool
	FolderHasPuller bool
	ManualSync      bool
	RemoteDeviceID  protocol.DeviceID
	RequestedView   string
	RequestedPrefix string
}

func (m *model) CompareFolderFiles(folder string, device protocol.DeviceID, opts CompareOptions) (CompareResult, error) {
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !ok {
		return CompareResult{}, ErrFolderMissing
	}
	if !folderSharedWithDevice(cfg, device) {
		return CompareResult{}, errDeviceUnknown
	}

	opts = normalizeCompareOptions(opts)

	localFiles, err := m.collectCompareFiles(folder, protocol.LocalDeviceID, opts.Prefix)
	if err != nil {
		return CompareResult{}, err
	}
	remoteFiles, err := m.collectCompareFiles(folder, device, opts.Prefix)
	if err != nil {
		return CompareResult{}, err
	}

	entries := buildCompareEntries(localFiles, remoteFiles, cfg.ModTimeWindow(), opts.IgnoreModTime)
	entries = filterCompareEntries(entries, opts.View)
	total := len(entries)

	start := (opts.Page - 1) * opts.PerPage
	if start > total {
		start = total
	}
	end := start + opts.PerPage
	if end > total {
		end = total
	}

	pageEntries := make([]CompareEntry, end-start)
	copy(pageEntries, entries[start:end])
	for i := range pageEntries {
		pageEntries[i].CanPrioritize = m.compareEntryCanPrioritize(folder, cfg, pageEntries[i])
	}

	return CompareResult{
		Entries:         pageEntries,
		Page:            opts.Page,
		PerPage:         opts.PerPage,
		Total:           total,
		RemoteConnected: m.ConnectedTo(device),
		FolderHasPuller: cfg.Type != config.FolderTypeSendOnly,
		ManualSync:      cfg.ManualSync,
		RemoteDeviceID:  device,
		RequestedView:   opts.View,
		RequestedPrefix: opts.Prefix,
	}, nil
}

func normalizeCompareOptions(opts CompareOptions) CompareOptions {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 {
		opts.PerPage = 1 << 16
	}
	if opts.View == "" {
		opts.View = CompareViewDifferent
	}
	return opts
}

func folderSharedWithDevice(cfg config.FolderConfiguration, device protocol.DeviceID) bool {
	for _, shared := range cfg.Devices {
		if shared.DeviceID == device {
			return true
		}
	}
	return false
}

func (m *model) collectCompareFiles(folder string, device protocol.DeviceID, prefix string) (map[string]protocol.FileInfo, error) {
	files := make(map[string]protocol.FileInfo)

	var it func(func(protocol.FileInfo) bool)
	var errFn func() error
	if prefix == "" {
		it, errFn = m.sdb.AllLocalFiles(folder, device)
	} else {
		it, errFn = m.sdb.AllLocalFilesWithPrefix(folder, device, prefix)
	}

	for f := range it {
		if f.IsIgnored() {
			continue
		}
		files[f.Name] = f
	}

	return files, errFn()
}

func buildCompareEntries(localFiles, remoteFiles map[string]protocol.FileInfo, modTimeWindow time.Duration, ignoreModTime bool) []CompareEntry {
	names := make([]string, 0, len(localFiles)+len(remoteFiles))
	seen := make(map[string]struct{}, len(localFiles)+len(remoteFiles))

	for name := range localFiles {
		seen[name] = struct{}{}
		names = append(names, name)
	}
	for name := range remoteFiles {
		if _, ok := seen[name]; ok {
			continue
		}
		names = append(names, name)
	}

	slices.Sort(names)

	entries := make([]CompareEntry, 0, len(names))
	for _, name := range names {
		local, localOK := localFiles[name]
		remote, remoteOK := remoteFiles[name]

		entry := CompareEntry{
			Path:   name,
			Status: compareEntryStatus(localOK, remoteOK, local, remote, modTimeWindow, ignoreModTime),
		}
		if localOK {
			entry.Local = cloneFileInfo(local)
		}
		if remoteOK {
			entry.Remote = cloneFileInfo(remote)
		}
		entries = append(entries, entry)
	}

	markRenameCandidates(entries)
	sortCompareEntries(entries)
	return entries
}

func compareEntryHasLiveFile(fi *protocol.FileInfo) bool {
	return fi != nil && !fi.IsDeleted()
}

func pruneInertCompareEntries(entries []CompareEntry) []CompareEntry {
	filtered := make([]CompareEntry, 0, len(entries))
	for _, entry := range entries {
		if !compareEntryHasLiveFile(entry.Local) && !compareEntryHasLiveFile(entry.Remote) {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered
}

func compareEntryStatus(localOK, remoteOK bool, local, remote protocol.FileInfo, modTimeWindow time.Duration, ignoreModTime bool) string {
	switch {
	case !localOK && !remoteOK:
		return CompareViewSame
	case !localOK:
		if remote.IsDeleted() {
			return "same"
		}
		return "only-remote"
	case !remoteOK:
		if local.IsDeleted() {
			return "same"
		}
		return "only-local"
	case local.IsDeleted() && remote.IsDeleted():
		return "same"
	case local.IsDeleted():
		return "deleted-local"
	case remote.IsDeleted():
		return "deleted-remote"
	case compareHasDisplayConflict(local) || compareHasDisplayConflict(remote):
		return "conflict"
	case local.Type != remote.Type:
		return "type-changed"
	case local.IsEquivalent(remote, modTimeWindow):
		return "same"
	case ignoreModTime && contentMatchesIgnoringModTime(local, remote):
		return "same"
	default:
		return "modified"
	}
}

func compareHasDisplayConflict(fi protocol.FileInfo) bool {
	flags := fi.LocalFlags &^ (protocol.FlagLocalReceiveOnly | protocol.FlagLocalManualPublish)
	return flags&protocol.LocalConflictFlags != 0
}

func markRenameCandidates(entries []CompareEntry) {
	type entryRef struct {
		index int
		path  string
	}

	localByHash := make(map[string][]entryRef)
	remoteByHash := make(map[string][]entryRef)

	for i, entry := range entries {
		switch entry.Status {
		case "only-local", "deleted-remote":
			if entry.Local != nil && !entry.Local.IsDeleted() && len(entry.Local.BlocksHash) > 0 {
				localByHash[string(entry.Local.BlocksHash)] = append(localByHash[string(entry.Local.BlocksHash)], entryRef{index: i, path: entry.Path})
			}
		case "only-remote", "deleted-local":
			if entry.Remote != nil && !entry.Remote.IsDeleted() && len(entry.Remote.BlocksHash) > 0 {
				remoteByHash[string(entry.Remote.BlocksHash)] = append(remoteByHash[string(entry.Remote.BlocksHash)], entryRef{index: i, path: entry.Path})
			}
		}
	}

	for hash, locals := range localByHash {
		remotes, ok := remoteByHash[hash]
		if !ok {
			continue
		}

		slices.SortFunc(locals, func(a, b entryRef) int {
			return cmp.Compare(a.path, b.path)
		})
		slices.SortFunc(remotes, func(a, b entryRef) int {
			return cmp.Compare(a.path, b.path)
		})

		limit := min(len(locals), len(remotes))
		for i := 0; i < limit; i++ {
			localRef := locals[i]
			remoteRef := remotes[i]
			if !sameSizedBlocks(entries[localRef.index].Local, entries[remoteRef.index].Remote) {
				continue
			}
			entries[localRef.index].RenameCandidate = remoteRef.path
			entries[remoteRef.index].RenameCandidate = localRef.path
		}
	}
}

func sameSizedBlocks(local, remote *protocol.FileInfo) bool {
	if local == nil || remote == nil {
		return false
	}
	return local.Size == remote.Size && bytes.Equal(local.BlocksHash, remote.BlocksHash)
}

// contentMatchesIgnoringModTime checks whether two FileInfo entries represent
// the same file content, regardless of modification time differences.
// This is used when the user has chosen to ignore mtime in the comparison view.
func contentMatchesIgnoringModTime(a, b protocol.FileInfo) bool {
	if a.Type != b.Type || a.Size != b.Size {
		return false
	}
	// Both sides must have block info to compare content.
	if len(a.BlocksHash) > 0 && len(b.BlocksHash) > 0 {
		return bytes.Equal(a.BlocksHash, b.BlocksHash)
	}
	// Fall back to full block list comparison if BlocksHash is not available.
	return a.BlocksEqual(b)
}

func sortCompareEntries(entries []CompareEntry) {
	slices.SortStableFunc(entries, func(a, b CompareEntry) int {
		groupA := compareEntryGroupKey(a)
		groupB := compareEntryGroupKey(b)
		if c := cmp.Compare(groupA, groupB); c != 0 {
			return c
		}

		if c := cmp.Compare(compareEntryGroupRank(a), compareEntryGroupRank(b)); c != 0 {
			return c
		}

		return cmp.Compare(a.Path, b.Path)
	})
}

func compareEntryGroupKey(entry CompareEntry) string {
	if entry.RenameCandidate == "" {
		return entry.Path
	}
	if entry.Path < entry.RenameCandidate {
		return entry.Path
	}
	return entry.RenameCandidate
}

func compareEntryGroupRank(entry CompareEntry) int {
	if entry.RenameCandidate == "" {
		return 0
	}

	switch entry.Status {
	case "deleted-remote":
		return 0
	case "deleted-local":
		return 1
	case "only-local":
		return 2
	case "only-remote":
		return 3
	default:
		return 4
	}
}

func filterCompareEntries(entries []CompareEntry, view string) []CompareEntry {
	entries = pruneInertCompareEntries(entries)

	if view == "" || view == CompareViewAll {
		return entries
	}

	filtered := make([]CompareEntry, 0, len(entries))
	for _, entry := range entries {
		if compareEntryMatchesView(entry, view) {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func compareEntryMatchesView(entry CompareEntry, view string) bool {
	switch view {
	case CompareViewDifferent:
		return entry.Status != "same"
	case CompareViewSame:
		return entry.Status == "same"
	case CompareViewDelete:
		return entry.Status == "deleted-local" || entry.Status == "deleted-remote"
	case CompareViewModified:
		return entry.Status == "modified" || entry.Status == "type-changed"
	case CompareViewConflict:
		return entry.Status == "conflict"
	case CompareViewOnlyLocal:
		return entry.Status == "only-local"
	case CompareViewOnlyRemote:
		return entry.Status == "only-remote"
	case CompareViewRename:
		return entry.RenameCandidate != ""
	default:
		return true
	}
}

func (m *model) compareEntryCanPrioritize(folder string, cfg config.FolderConfiguration, entry CompareEntry) bool {
	if cfg.Type == config.FolderTypeSendOnly || entry.Status == "same" || entry.Status == "only-local" {
		return false
	}

	if entry.Local != nil && entry.Local.LocalFlags&protocol.FlagLocalNeeded != 0 {
		return true
	}

	global, ok, err := m.sdb.GetGlobalFile(folder, entry.Path)
	if err != nil || !ok {
		return false
	}

	if global.IsDeleted() {
		return entry.Local != nil && !entry.Local.IsDeleted()
	}
	if entry.Local == nil {
		return true
	}

	return !entry.Local.IsEquivalent(global, cfg.ModTimeWindow())
}

func cloneFileInfo(f protocol.FileInfo) *protocol.FileInfo {
	cloned := f
	return &cloned
}
