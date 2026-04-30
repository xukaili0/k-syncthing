// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"slices"

	"github.com/syncthing/syncthing/lib/protocol"
)

type PreviewIndexOptions struct {
	Page    int
	PerPage int
	Prefix  string
}

type PreviewIndexEntry struct {
	Path            string
	Action          string
	File            *protocol.FileInfo
	RenameCandidate string
}

type PreviewIndexResult struct {
	Entries           []PreviewIndexEntry
	Page              int
	PerPage           int
	Total             int
	Sequence          int64
	FolderCanPublish  bool
	ManualPublish     bool
	RequestedPrefix   string
	PreviewDeviceID   protocol.DeviceID
	PreviewTransport  string
	PreviewVisibility string
}

func (m *model) PreviewIndexFolderFiles(folder string, device protocol.DeviceID, opts PreviewIndexOptions) (PreviewIndexResult, error) {
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()

	if !ok {
		return PreviewIndexResult{}, ErrFolderMissing
	}
	if device != (protocol.DeviceID{}) && !folderSharedWithDevice(cfg, device) {
		return PreviewIndexResult{}, errDeviceUnknown
	}

	opts = normalizePreviewIndexOptions(opts)

	localFiles, err := m.collectCompareFiles(folder, protocol.LocalDeviceID, opts.Prefix)
	if err != nil {
		return PreviewIndexResult{}, err
	}

	pending := buildPendingPublishEntries(m, folder, localFiles, cfg.ModTimeWindow())
	total := len(pending)

	start := (opts.Page - 1) * opts.PerPage
	if start > total {
		start = total
	}
	end := start + opts.PerPage
	if end > total {
		end = total
	}

	pageEntries := make([]PreviewIndexEntry, 0, end-start)
	for _, entry := range pending[start:end] {
		if entry.Local == nil {
			continue
		}
		pageEntries = append(pageEntries, PreviewIndexEntry{
			Path:            entry.Path,
			Action:          entry.Action,
			File:            clonePreviewFileInfo(*entry.Local),
			RenameCandidate: entry.RenameCandidate,
		})
	}

	localSeq, _ := m.Sequence(folder, protocol.LocalDeviceID)

	return PreviewIndexResult{
		Entries:           pageEntries,
		Page:              opts.Page,
		PerPage:           opts.PerPage,
		Total:             total,
		Sequence:          localSeq,
		FolderCanPublish:  folderTypeCanPublish(cfg.Type),
		ManualPublish:     cfg.ManualPublish,
		RequestedPrefix:   opts.Prefix,
		PreviewDeviceID:   device,
		PreviewTransport:  "local-snapshot-only",
		PreviewVisibility: "not-announced",
	}, nil
}

func normalizePreviewIndexOptions(opts PreviewIndexOptions) PreviewIndexOptions {
	if opts.Page < 1 {
		opts.Page = 1
	}
	if opts.PerPage < 1 {
		opts.PerPage = 1 << 16
	}
	return opts
}

func clonePreviewFileInfo(fi protocol.FileInfo) *protocol.FileInfo {
	clone := fi
	clone.LocalFlags &^= (protocol.FlagLocalReceiveOnly | protocol.FlagLocalManualPublish)
	clone.Version = clone.Version.Copy()
	clone.Blocks = slices.Clone(clone.Blocks)
	clone.BlocksHash = slices.Clone(clone.BlocksHash)
	clone.PreviousBlocksHash = slices.Clone(clone.PreviousBlocksHash)
	return &clone
}
