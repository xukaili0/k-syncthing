// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"testing"

	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/protocol"
)

func TestPendingPublishFolderFilesShowsModifiedEntry(t *testing.T) {
	w, fcfg := newDefaultCfgWrapper(t)
	_, _ = w.Modify(func(cfg *config.Configuration) {
		folder, _, ok := cfg.Folder(fcfg.ID)
		if !ok {
			t.Fatal("folder missing")
		}
		folder.ManualPublish = true
		cfg.SetFolder(folder)
	})

	m := setupModel(t, w)

	base := protocol.FileInfo{
		Name:       "report.pdf",
		Type:       protocol.FileInfoTypeFile,
		Size:       10,
		ModifiedS:  1,
		ModifiedBy: myID.Short(),
		BlocksHash: []byte("base-hash"),
		Version:    protocol.Vector{}.Update(myID.Short()),
	}
	must(t, m.sdb.Update(fcfg.ID, protocol.LocalDeviceID, []protocol.FileInfo{base}))

	changed := base
	changed.Size = 25
	changed.BlocksHash = []byte("changed-hash")
	changed.PreviousBlocksHash = []byte("base-hash")
	changed.Version = changed.Version.Update(myID.Short())
	changed.LocalFlags = protocol.FlagLocalManualPublish
	must(t, m.sdb.Update(fcfg.ID, protocol.LocalDeviceID, []protocol.FileInfo{changed}))

	result, err := m.PendingPublishFolderFiles(fcfg.ID, PendingPublishOptions{})
	must(t, err)

	if len(result.Entries) != 1 {
		t.Fatalf("expected 1 pending publish entry, got %d", len(result.Entries))
	}
	if result.Entries[0].Action != PendingPublishViewModified {
		t.Fatalf("expected modified action, got %q", result.Entries[0].Action)
	}
	if result.Entries[0].Global != nil {
		t.Fatalf("expected pending entry to hide unpublished global candidate, got %#v", result.Entries[0].Global)
	}
	if result.Entries[0].Local == nil || result.Entries[0].Local.Size != 25 {
		t.Fatalf("expected local pending size 25, got %#v", result.Entries[0].Local)
	}
}

func TestPublishFolderSelectedClearsPendingFlagAndPromotesGlobal(t *testing.T) {
	w, fcfg := newDefaultCfgWrapper(t)
	_, _ = w.Modify(func(cfg *config.Configuration) {
		folder, _, ok := cfg.Folder(fcfg.ID)
		if !ok {
			t.Fatal("folder missing")
		}
		folder.ManualPublish = true
		cfg.SetFolder(folder)
	})

	m := setupModel(t, w)

	base := protocol.FileInfo{
		Name:       "image.png",
		Type:       protocol.FileInfoTypeFile,
		Size:       12,
		ModifiedS:  1,
		ModifiedBy: myID.Short(),
		BlocksHash: []byte("base-image-hash"),
		Version:    protocol.Vector{}.Update(myID.Short()),
	}
	must(t, m.sdb.Update(fcfg.ID, protocol.LocalDeviceID, []protocol.FileInfo{base}))

	changed := base
	changed.Size = 42
	changed.BlocksHash = []byte("changed-image-hash")
	changed.PreviousBlocksHash = []byte("base-image-hash")
	changed.Version = changed.Version.Update(myID.Short())
	changed.LocalFlags = protocol.FlagLocalManualPublish
	must(t, m.sdb.Update(fcfg.ID, protocol.LocalDeviceID, []protocol.FileInfo{changed}))

	must(t, m.PublishFolderSelected(fcfg.ID, []string{"image.png"}))

	fi, ok, err := m.CurrentFolderFile(fcfg.ID, "image.png")
	must(t, err)
	if !ok {
		t.Fatal("expected published file to exist locally")
	}
	if fi.IsManualPublishPending() {
		t.Fatal("expected manual publish flag to be cleared after publish")
	}

	counts, err := m.ManualPublishPendingSize(fcfg.ID)
	must(t, err)
	if counts.TotalItems() != 0 {
		t.Fatalf("expected no remaining pending publish items, got %d", counts.TotalItems())
	}

	global, ok, err := m.CurrentGlobalFile(fcfg.ID, "image.png")
	must(t, err)
	if !ok {
		t.Fatal("expected published file to become global")
	}
	if global.Size != 42 {
		t.Fatalf("expected global size 42 after publish, got %d", global.Size)
	}
}
