// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"path"
	"slices"
	"strings"
	"time"

	"github.com/syncthing/syncthing/internal/db"
	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/events"
	stfs "github.com/syncthing/syncthing/lib/fs"
	"github.com/syncthing/syncthing/lib/protocol"
)

const (
	BiDiffDirectionLeftToRight = "left-to-right"
	BiDiffDirectionRightToLeft = "right-to-left"
)

type BiDiffOptions struct {
	Page          int
	PerPage       int
	Prefix        string
	View          string
	IgnoreModTime bool
}

type BiDiffEntry struct {
	Path                string
	Status              string
	Left                *protocol.FileInfo
	Right               *protocol.FileInfo
	RenameCandidate     string
	CanApplyLeftToRight bool
	CanApplyRightToLeft bool
	LeftToRightReason   string
	RightToLeftReason   string
}

type BiDiffResult struct {
	Entries                []BiDiffEntry
	Page                   int
	PerPage                int
	Total                  int
	RightConnected         bool
	FolderCanReceive       bool
	FolderCanPublish       bool
	ManualSync             bool
	ManualPublish          bool
	LocalPendingItems      int
	PreviewMode            string
	LocalSequence          int64
	RightSequence          int64
	RemotePreviewAvailable bool
	RemotePreviewSequence  int64
	RemotePreviewUpdated   time.Time
	PeerApplyResults       []PeerApplyResultEntry
	RightDeviceID          protocol.DeviceID
	RequestedView          string
	RequestedPrefix        string
}

type preparedRemoteApplyEntry struct {
	path     string
	status   string
	local    protocol.FileInfo
	localOK  bool
	remote   protocol.FileInfo
	remoteOK bool
}

func (m *model) BiDiffFolderFiles(folder string, device protocol.DeviceID, opts BiDiffOptions) (BiDiffResult, error) {
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !ok {
		return BiDiffResult{}, ErrFolderMissing
	}
	if !folderSharedWithDevice(cfg, device) {
		return BiDiffResult{}, errDeviceUnknown
	}

	opts = BiDiffOptions(normalizeCompareOptions(CompareOptions(opts)))

	leftFiles, err := m.collectCompareFiles(folder, protocol.LocalDeviceID, opts.Prefix)
	if err != nil {
		return BiDiffResult{}, err
	}
	rightFiles, err := m.collectCompareFiles(folder, device, opts.Prefix)
	if err != nil {
		return BiDiffResult{}, err
	}

	compareEntries := buildCompareEntries(leftFiles, rightFiles, cfg.ModTimeWindow(), opts.IgnoreModTime)
	compareEntries = filterCompareEntries(compareEntries, opts.View)
	total := len(compareEntries)

	start := (opts.Page - 1) * opts.PerPage
	if start > total {
		start = total
	}
	end := start + opts.PerPage
	if end > total {
		end = total
	}

	pageEntries := make([]BiDiffEntry, 0, end-start)
	for _, entry := range compareEntries[start:end] {
		pageEntries = append(pageEntries, m.toBiDiffEntry(folder, cfg, entry))
	}

	localSeq, _ := m.Sequence(folder, protocol.LocalDeviceID)
	rightSeq, _ := m.Sequence(folder, device)
	applyResults := m.peerApplyResultsFor(folder, device)

	return BiDiffResult{
		Entries:          pageEntries,
		Page:             opts.Page,
		PerPage:          opts.PerPage,
		Total:            total,
		RightConnected:   m.ConnectedTo(device),
		FolderCanReceive: folderTypeCanReceive(cfg.Type),
		FolderCanPublish: folderTypeCanPublish(cfg.Type),
		ManualSync:       cfg.ManualSync,
		ManualPublish:    cfg.ManualPublish,
		PreviewMode:      "announced-index",
		LocalSequence:    localSeq,
		RightSequence:    rightSeq,
		PeerApplyResults: applyResults,
		RightDeviceID:    device,
		RequestedView:    opts.View,
		RequestedPrefix:  opts.Prefix,
	}, nil
}

func (m *model) PeerDiffFolderFiles(folder string, device protocol.DeviceID, opts BiDiffOptions) (BiDiffResult, error) {
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !ok {
		return BiDiffResult{}, ErrFolderMissing
	}
	if !folderSharedWithDevice(cfg, device) {
		return BiDiffResult{}, errDeviceUnknown
	}

	opts = BiDiffOptions(normalizeCompareOptions(CompareOptions(opts)))

	leftFiles, err := m.collectCompareFiles(folder, protocol.LocalDeviceID, opts.Prefix)
	if err != nil {
		return BiDiffResult{}, err
	}
	rightFiles, err := m.collectCompareFiles(folder, device, opts.Prefix)
	if err != nil {
		return BiDiffResult{}, err
	}
	previewMode := "announced-index-plus-local"
	if snapshot, ok := m.previewSnapshot(folder, device); ok {
		for path, fi := range snapshot.Files {
			if opts.Prefix != "" && !strings.HasPrefix(path, opts.Prefix) {
				continue
			}
			rightFiles[path] = fi
		}
		previewMode = "remote-preview-index-plus-local"
	}

	compareEntries := buildCompareEntries(leftFiles, rightFiles, cfg.ModTimeWindow(), opts.IgnoreModTime)
	compareEntries = filterCompareEntries(compareEntries, opts.View)
	total := len(compareEntries)

	start := (opts.Page - 1) * opts.PerPage
	if start > total {
		start = total
	}
	end := start + opts.PerPage
	if end > total {
		end = total
	}

	pageEntries := make([]BiDiffEntry, 0, end-start)
	for _, entry := range compareEntries[start:end] {
		pageEntries = append(pageEntries, m.toPeerDiffEntry(folder, cfg, entry))
	}

	pendingCounts, err := m.ManualPublishPendingSize(folder)
	if err != nil {
		pendingCounts = db.Counts{}
	}
	localSeq, _ := m.Sequence(folder, protocol.LocalDeviceID)
	rightSeq, _ := m.Sequence(folder, device)
	previewSnapshot, hasPreview := m.previewSnapshot(folder, device)
	applyResults := m.peerApplyResultsFor(folder, device)

	return BiDiffResult{
		Entries:                pageEntries,
		Page:                   opts.Page,
		PerPage:                opts.PerPage,
		Total:                  total,
		RightConnected:         m.ConnectedTo(device),
		FolderCanReceive:       folderTypeCanReceive(cfg.Type),
		FolderCanPublish:       folderTypeCanPublish(cfg.Type),
		ManualSync:             cfg.ManualSync,
		ManualPublish:          cfg.ManualPublish,
		LocalPendingItems:      pendingCounts.TotalItems(),
		PreviewMode:            previewMode,
		LocalSequence:          localSeq,
		RightSequence:          rightSeq,
		RemotePreviewAvailable: hasPreview,
		RemotePreviewSequence:  previewSnapshot.Sequence,
		RemotePreviewUpdated:   previewSnapshot.Updated,
		PeerApplyResults:       applyResults,
		RightDeviceID:          device,
		RequestedView:          opts.View,
		RequestedPrefix:        opts.Prefix,
	}, nil
}

func (m *model) toBiDiffEntry(folder string, cfg config.FolderConfiguration, entry CompareEntry) BiDiffEntry {
	canLeftToRight, leftReason := bidiffEntryCanApplyLeftToRight(cfg, entry)
	canRightToLeft, rightReason := m.bidiffEntryCanApplyRightToLeft(folder, cfg, entry)

	return BiDiffEntry{
		Path:                entry.Path,
		Status:              entry.Status,
		Left:                entry.Local,
		Right:               entry.Remote,
		RenameCandidate:     entry.RenameCandidate,
		CanApplyLeftToRight: canLeftToRight,
		CanApplyRightToLeft: canRightToLeft,
		LeftToRightReason:   leftReason,
		RightToLeftReason:   rightReason,
	}
}

func (m *model) toPeerDiffEntry(folder string, cfg config.FolderConfiguration, entry CompareEntry) BiDiffEntry {
	canLeftToRight, leftReason := peerdiffEntryCanApplyLeftToRight(cfg, entry)
	canRightToLeft, rightReason := m.peerdiffEntryCanApplyRightToLeft(folder, cfg, entry)

	return BiDiffEntry{
		Path:                entry.Path,
		Status:              entry.Status,
		Left:                entry.Local,
		Right:               entry.Remote,
		RenameCandidate:     entry.RenameCandidate,
		CanApplyLeftToRight: canLeftToRight,
		CanApplyRightToLeft: canRightToLeft,
		LeftToRightReason:   leftReason,
		RightToLeftReason:   rightReason,
	}
}

func bidiffEntryCanApplyLeftToRight(cfg config.FolderConfiguration, entry CompareEntry) (bool, string) {
	if !folderTypeCanPublish(cfg.Type) {
		return false, "当前文件夹不能向右侧发布"
	}
	if !cfg.ManualPublish {
		return false, "要保证只裁决所选文件，请先开启手动审核发布"
	}
	if entry.Status == "same" {
		return false, "两侧已经一致"
	}
	return true, ""
}

func peerdiffEntryCanApplyLeftToRight(cfg config.FolderConfiguration, entry CompareEntry) (bool, string) {
	if !folderTypeCanPublish(cfg.Type) {
		return false, "当前文件夹不能向右侧应用左侧状态"
	}
	if entry.Status == "same" {
		return false, "两侧已经一致"
	}
	return true, ""
}

func (m *model) bidiffEntryCanApplyRightToLeft(folder string, cfg config.FolderConfiguration, entry CompareEntry) (bool, string) {
	if !folderTypeCanReceive(cfg.Type) {
		return false, "当前文件夹不接收右侧变化"
	}
	if !cfg.ManualSync {
		return false, "要保证只裁决所选文件，请先开启手动审核接收"
	}
	if entry.Status == "same" {
		return false, "两侧已经一致"
	}
	if m.compareEntryCanPrioritize(folder, cfg, entry) {
		return true, ""
	}

	switch entry.Status {
	case "only-remote":
		return true, ""
	case "deleted-local":
		return true, ""
	case "deleted-remote":
		return true, ""
	case "modified", "type-changed", "conflict":
		return true, ""
	case "only-local":
		return true, ""
	default:
		return false, "当前差异还不能直接执行右侧到左侧"
	}
}

func (m *model) peerdiffEntryCanApplyRightToLeft(folder string, cfg config.FolderConfiguration, entry CompareEntry) (bool, string) {
	if !folderTypeCanReceive(cfg.Type) {
		return false, "当前文件夹不能把右侧状态应用到左侧"
	}
	if entry.Status == "same" {
		return false, "两侧已经一致"
	}
	if m.compareEntryCanPrioritize(folder, cfg, entry) {
		return true, ""
	}

	switch entry.Status {
	case "only-remote":
		return true, ""
	case "deleted-local":
		return true, ""
	case "deleted-remote":
		return true, ""
	case "modified", "type-changed", "conflict":
		return true, ""
	case "only-local":
		return true, ""
	default:
		return false, "当前差异还不能直接执行右侧到左侧"
	}
}

func (m *model) ApplyBiDiffSelection(folder string, device protocol.DeviceID, direction string, files []string) error {
	files, err := m.expandBiDiffSelectionWithRename(folder, device, files, false)
	if err != nil {
		return err
	}
	switch direction {
	case BiDiffDirectionLeftToRight:
		return m.PromoteFolderSelected(folder, device, files)
	case BiDiffDirectionRightToLeft:
		return m.applyRemoteSideSelected(folder, device, files)
	default:
		return errGeneric{"invalid bidiff direction"}
	}
}

func (m *model) ApplyPeerDiffSelection(folder string, device protocol.DeviceID, direction string, files []string) error {
	files, err := m.expandBiDiffSelectionWithRename(folder, device, files, true)
	if err != nil {
		return err
	}
	m.clearPeerApplyResults(device, folder, direction, files)
	switch direction {
	case BiDiffDirectionLeftToRight:
		return m.sendPeerApply(folder, device, files)
	case BiDiffDirectionRightToLeft:
		err := m.applyPeerRemoteSideSelected(folder, device, files)
		results := make([]PeerApplyResultEntry, 0, len(files))
		now := time.Now()
		for _, path := range files {
			status := "success"
			message := ""
			if err != nil {
				status = "failed"
				message = err.Error()
			}
			results = append(results, PeerApplyResultEntry{
				Path:      path,
				Direction: BiDiffDirectionRightToLeft,
				Status:    status,
				Message:   message,
				Updated:   now,
			})
		}
		m.recordPeerApplyResults(device, folder, results)
		return err
	default:
		return errGeneric{"invalid peerdiff direction"}
	}
}

func uniquePaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	return out
}

func expandSelectionWithCompareRename(entries []CompareEntry, files []string) []string {
	selected := make(map[string]struct{}, len(files))
	for _, file := range files {
		selected[file] = struct{}{}
	}
	for _, entry := range entries {
		if entry.RenameCandidate == "" {
			continue
		}
		if _, ok := selected[entry.Path]; ok {
			selected[entry.RenameCandidate] = struct{}{}
		}
	}
	out := make([]string, 0, len(selected))
	for path := range selected {
		out = append(out, path)
	}
	slices.Sort(out)
	return out
}

func (m *model) expandBiDiffSelectionWithRename(folder string, device protocol.DeviceID, files []string, usePreview bool) ([]string, error) {
	files = uniquePaths(files)
	if len(files) == 0 {
		return files, nil
	}

	leftFiles, err := m.collectCompareFiles(folder, protocol.LocalDeviceID, "")
	if err != nil {
		return nil, err
	}
	rightFiles, err := m.collectCompareFiles(folder, device, "")
	if err != nil {
		return nil, err
	}
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()
	if !ok {
		return nil, ErrFolderMissing
	}
	if usePreview {
		if snapshot, ok := m.previewSnapshot(folder, device); ok {
			for path, fi := range snapshot.Files {
				rightFiles[path] = fi
			}
		}
	}
	entries := buildCompareEntries(leftFiles, rightFiles, cfg.ModTimeWindow(), false)
	return expandSelectionWithCompareRename(entries, files), nil
}

func (m *model) applyRemoteSideSelected(folder string, device protocol.DeviceID, files []string) error {
	return m.applyRemoteSideSelectedWithPolicy(folder, device, files, m.bidiffEntryCanApplyRightToLeft, false)
}

func (m *model) applyPeerRemoteSideSelected(folder string, device protocol.DeviceID, files []string) error {
	return m.applyRemoteSideSelectedWithPolicy(folder, device, files, m.peerdiffEntryCanApplyRightToLeft, true)
}

func (m *model) applyRemoteSideSelectedWithPolicy(folder string, device protocol.DeviceID, files []string, canApplyFn func(string, config.FolderConfiguration, CompareEntry) (bool, string), usePreview bool) error {
	m.mut.RLock()
	cfg, cfgOK := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !cfgOK {
		return ErrFolderMissing
	}
	if cfg.Paused {
		return ErrFolderPaused
	}
	if !folderSharedWithDevice(cfg, device) {
		return errDeviceUnknown
	}
	if !folderTypeCanReceive(cfg.Type) {
		return ErrFolderNotRunning
	}
	previewSnapshot, hasPreview := m.previewSnapshot(folder, device)

	selected := make([]string, 0, len(files))
	remoteUpdates := make([]protocol.FileInfo, 0, len(files))
	prepared := make([]preparedRemoteApplyEntry, 0, len(files))
	updates := make([]protocol.FileInfo, 0, len(files))
	updatedNames := make([]string, 0, len(files))
	rescanPaths := make([]string, 0, len(files))
	filesystem := cfg.Filesystem()
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		if _, ok := seen[file]; ok {
			continue
		}
		seen[file] = struct{}{}

		local, localOK, err := m.sdb.GetDeviceFile(folder, protocol.LocalDeviceID, file)
		if err != nil {
			return err
		}
		var remote protocol.FileInfo
		var remoteOK bool
		if usePreview && hasPreview {
			if previewRemote, ok := previewSnapshot.Files[file]; ok {
				remote = previewRemote
				remoteOK = true
			}
		}
		if !remoteOK {
			remote, remoteOK, err = m.sdb.GetDeviceFile(folder, device, file)
			if err != nil {
				return err
			}
		}
		entry := CompareEntry{
			Path:   file,
			Status: compareEntryStatus(localOK, remoteOK, local, remote, cfg.ModTimeWindow(), false),
		}
		if localOK {
			entry.Local = cloneFileInfo(local)
		}
		if remoteOK {
			entry.Remote = cloneFileInfo(remote)
		}
		canApply, _ := canApplyFn(folder, cfg, entry)
		if !canApply {
			continue
		}
		prepared = append(prepared, preparedRemoteApplyEntry{
			path:     file,
			status:   entry.Status,
			local:    local,
			localOK:  localOK,
			remote:   remote,
			remoteOK: remoteOK,
		})
		if usePreview && remoteOK {
			remoteCopy := remote
			remoteCopy.LocalFlags = 0
			remoteUpdates = append(remoteUpdates, remoteCopy)
		}
	}

	handledByRename, renameRescans, err := applyRemoteRenameShortcuts(filesystem, prepared)
	if err != nil {
		return err
	}
	if len(renameRescans) > 0 {
		rescanPaths = append(rescanPaths, renameRescans...)
	}

	if len(handledByRename) > 0 {
		selected = selected[:0]
	}

	for _, entry := range prepared {
		if _, ok := handledByRename[entry.path]; ok {
			continue
		}
		if (entry.status == "only-local" || entry.status == "deleted-remote") && entry.localOK && !entry.local.IsDeleted() {
			if err := deleteLocalForRemoteAbsence(filesystem, entry.local); err != nil && !stfs.IsNotExist(err) {
				return err
			}
			rescanPaths = append(rescanPaths, entry.path)
			continue
		}
		if entry.localOK && shouldForceRemoteAdoption(entry.status) {
			local := entry.local
			local.LocalFlags &^= (protocol.FlagLocalReceiveOnly | protocol.FlagLocalManualPublish)
			local.Version = protocol.Vector{}
			local.Sequence = 0
			updates = append(updates, local)
			updatedNames = append(updatedNames, local.Name)
		}
		selected = append(selected, entry.path)
	}

	if len(updates) > 0 {
		if err := m.sdb.Update(folder, protocol.LocalDeviceID, updates); err != nil {
			return err
		}

		seq, err := m.sdb.GetDeviceSequence(folder, protocol.LocalDeviceID)
		if err != nil {
			return err
		}
		slices.Sort(updatedNames)
		m.evLogger.Log(events.LocalIndexUpdated, map[string]interface{}{
			"folder":    folder,
			"items":     len(updates),
			"filenames": updatedNames,
			"sequence":  seq,
			"version":   seq,
		})
	}

	if len(remoteUpdates) > 0 {
		if err := m.sdb.Update(folder, device, remoteUpdates); err != nil {
			return err
		}
		seq, err := m.sdb.GetDeviceSequence(folder, device)
		if err != nil {
			return err
		}
		m.evLogger.Log(events.RemoteIndexUpdated, map[string]interface{}{
			"device":   device.String(),
			"folder":   folder,
			"items":    len(remoteUpdates),
			"sequence": seq,
			"version":  seq,
		})
	}

	if len(rescanPaths) > 0 {
		if err := m.ScanFolderSubdirs(folder, rescanPaths); err != nil {
			return err
		}
	}

	if len(selected) == 0 {
		return nil
	}
	return m.TriggerFolderPullSelected(folder, selected)
}

func applyRemoteRenameShortcuts(filesystem stfs.Filesystem, prepared []preparedRemoteApplyEntry) (map[string]struct{}, []string, error) {
	type ref struct {
		index int
		path  string
	}

	sourceByHash := make(map[string][]ref)
	destByHash := make(map[string][]ref)
	handled := make(map[string]struct{})
	rescan := make([]string, 0, len(prepared))

	for i, entry := range prepared {
		switch entry.status {
		case "deleted-remote", "only-local":
			if entry.localOK && !entry.local.IsDeleted() && len(entry.local.BlocksHash) > 0 {
				sourceByHash[string(entry.local.BlocksHash)] = append(sourceByHash[string(entry.local.BlocksHash)], ref{index: i, path: entry.path})
			}
		case "only-remote", "deleted-local":
			if entry.remoteOK && !entry.remote.IsDeleted() && len(entry.remote.BlocksHash) > 0 {
				destByHash[string(entry.remote.BlocksHash)] = append(destByHash[string(entry.remote.BlocksHash)], ref{index: i, path: entry.path})
			}
		}
	}

	for hash, sources := range sourceByHash {
		dests, ok := destByHash[hash]
		if !ok {
			continue
		}
		slices.SortFunc(sources, func(a, b ref) int { return strings.Compare(a.path, b.path) })
		slices.SortFunc(dests, func(a, b ref) int { return strings.Compare(a.path, b.path) })

		limit := min(len(sources), len(dests))
		for i := 0; i < limit; i++ {
			src := prepared[sources[i].index]
			dst := prepared[dests[i].index]
			if !sameSizedBlocks(&src.local, &dst.remote) {
				continue
			}
			if src.path == dst.path {
				continue
			}
			if _, ok := handled[src.path]; ok {
				continue
			}
			if _, ok := handled[dst.path]; ok {
				continue
			}
			if parent := path.Dir(dst.path); parent != "." && parent != "" {
				if err := filesystem.MkdirAll(parent, 0o755); err != nil {
					return nil, nil, err
				}
			}
			if _, err := filesystem.Lstat(dst.path); err == nil {
				continue
			} else if !stfs.IsNotExist(err) {
				return nil, nil, err
			}
			if err := filesystem.Rename(src.path, dst.path); err != nil {
				continue
			}
			handled[src.path] = struct{}{}
			handled[dst.path] = struct{}{}
			rescan = append(rescan, src.path, dst.path)
		}
	}

	return handled, rescan, nil
}

func deleteLocalForRemoteAbsence(filesystem stfs.Filesystem, local protocol.FileInfo) error {
	switch {
	case local.IsDirectory():
		return filesystem.RemoveAll(local.Name)
	default:
		return filesystem.Remove(local.Name)
	}
}

func shouldForceRemoteAdoption(status string) bool {
	switch status {
	case "deleted-local", "deleted-remote", "modified", "type-changed", "conflict":
		return true
	default:
		return false
	}
}

func (m *model) PromoteFolderSelected(folder string, device protocol.DeviceID, files []string) error {
	m.mut.RLock()
	cfg, cfgOK := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !cfgOK {
		return ErrFolderMissing
	}
	if cfg.Paused {
		return ErrFolderPaused
	}
	if !folderSharedWithDevice(cfg, device) {
		return errDeviceUnknown
	}
	if !folderTypeCanPublish(cfg.Type) {
		return ErrFolderNotRunning
	}

	updates := make([]protocol.FileInfo, 0, len(files))
	seen := make(map[string]struct{}, len(files))
	names := make([]string, 0, len(files))
	for _, file := range files {
		if _, ok := seen[file]; ok {
			continue
		}
		seen[file] = struct{}{}

		local, localOK, err := m.sdb.GetDeviceFile(folder, protocol.LocalDeviceID, file)
		if err != nil {
			return err
		}
		global, globalOK, err := m.sdb.GetGlobalFile(folder, file)
		if err != nil {
			return err
		}
		remote, remoteOK, err := m.sdb.GetDeviceFile(folder, device, file)
		if err != nil {
			return err
		}

		fi, ok := preparePromotedLocalFileInfo(m.shortID, localOK, local, globalOK, global, remoteOK, remote)
		if !ok {
			continue
		}
		updates = append(updates, fi)
		names = append(names, fi.Name)
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
	slices.Sort(names)
	m.evLogger.Log(events.LocalIndexUpdated, map[string]interface{}{
		"folder":    folder,
		"items":     len(updates),
		"filenames": names,
		"sequence":  seq,
		"version":   seq,
	})
	return nil
}

func preparePromotedLocalFileInfo(shortID protocol.ShortID, localOK bool, local protocol.FileInfo, globalOK bool, global protocol.FileInfo, remoteOK bool, remote protocol.FileInfo) (protocol.FileInfo, bool) {
	switch {
	case localOK:
		fi := local
		fi.LocalFlags &^= protocol.FlagLocalManualPublish
		switch {
		case globalOK:
			fi.Version = fi.Version.Merge(global.Version).Update(shortID)
		case remoteOK:
			fi.Version = fi.Version.Merge(remote.Version).Update(shortID)
		default:
			fi.Version = fi.Version.Update(shortID)
		}
		fi.Sequence = 0
		return fi, true

	case globalOK:
		fi := global
		fi.SetDeleted(shortID)
		fi.LocalFlags &^= protocol.FlagLocalManualPublish
		fi.Sequence = 0
		return fi, true

	case remoteOK:
		fi := remote
		fi.SetDeleted(shortID)
		fi.LocalFlags &^= protocol.FlagLocalManualPublish
		fi.Sequence = 0
		return fi, true

	default:
		return protocol.FileInfo{}, false
	}
}

func folderTypeCanReceive(t config.FolderType) bool {
	return t == config.FolderTypeSendReceive || t == config.FolderTypeReceiveOnly || t == config.FolderTypeReceiveEncrypted
}

type errGeneric struct {
	message string
}

func (e errGeneric) Error() string {
	return e.message
}
