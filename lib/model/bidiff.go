// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
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
	Page    int
	PerPage int
	Prefix  string
	View    string
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

	compareEntries := buildCompareEntries(leftFiles, rightFiles, cfg.ModTimeWindow())
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

	compareEntries := buildCompareEntries(leftFiles, rightFiles, cfg.ModTimeWindow())
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
			Status: compareEntryStatus(localOK, remoteOK, local, remote, cfg.ModTimeWindow()),
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
		if (entry.Status == "only-local" || entry.Status == "deleted-remote") && localOK && !local.IsDeleted() {
			if err := deleteLocalForRemoteAbsence(filesystem, local); err != nil && !stfs.IsNotExist(err) {
				return err
			}
			rescanPaths = append(rescanPaths, file)
			continue
		}
		if localOK && shouldForceRemoteAdoption(entry.Status) {
			local.LocalFlags &^= (protocol.FlagLocalReceiveOnly | protocol.FlagLocalManualPublish)
			local.Version = protocol.Vector{}
			local.Sequence = 0
			updates = append(updates, local)
			updatedNames = append(updatedNames, local.Name)
		}
		selected = append(selected, file)
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
