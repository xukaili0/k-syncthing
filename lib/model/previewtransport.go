// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/syncthing/syncthing/lib/events"
	"github.com/syncthing/syncthing/lib/protocol"
)

const previewFolderPrefix = ".stpreview/"

type previewIndexSnapshot struct {
	Files    map[string]protocol.FileInfo
	Sequence int64
	Updated  time.Time
}

func previewFolderID(folder string) string {
	return previewFolderPrefix + folder
}

func parsePreviewFolderID(folder string) (string, bool) {
	if !strings.HasPrefix(folder, previewFolderPrefix) {
		return "", false
	}
	return strings.TrimPrefix(folder, previewFolderPrefix), true
}

func (m *model) servePreviewIndexes(ctx context.Context) error {
	sub := m.evLogger.Subscribe(events.LocalIndexUpdated | events.DeviceConnected)
	defer sub.Unsubscribe()

	for {
		select {
		case ev, ok := <-sub.C():
			if !ok {
				<-ctx.Done()
				return ctx.Err()
			}
			switch ev.Type {
			case events.LocalIndexUpdated:
				data, ok := ev.Data.(map[string]interface{})
				if !ok {
					continue
				}
				folder, _ := data["folder"].(string)
				if folder == "" {
					continue
				}
				go m.broadcastPreviewIndex(folder)
			case events.DeviceConnected:
				data, ok := ev.Data.(map[string]string)
				if !ok {
					continue
				}
				deviceID, err := protocol.DeviceIDFromString(data["id"])
				if err != nil {
					continue
				}
				go m.sendPreviewIndexesToDevice(deviceID)
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (m *model) broadcastPreviewIndex(folder string) {
	m.mut.RLock()
	cfg, ok := m.folderCfgs[folder]
	m.mut.RUnlock()
	if !ok {
		return
	}
	for _, deviceID := range cfg.DeviceIDs() {
		if deviceID == m.id {
			continue
		}
		m.sendPreviewIndex(folder, deviceID)
	}
}

func (m *model) sendPreviewIndexesToDevice(deviceID protocol.DeviceID) {
	m.mut.RLock()
	folders := make([]string, 0, len(m.folderCfgs))
	for folder, cfg := range m.folderCfgs {
		if cfg.SharedWith(deviceID) {
			folders = append(folders, folder)
		}
	}
	m.mut.RUnlock()

	for _, folder := range folders {
		m.sendPreviewIndex(folder, deviceID)
	}
}

func (m *model) sendPreviewIndex(folder string, deviceID protocol.DeviceID) {
	m.mut.RLock()
	connIDs, ok := m.deviceConnIDs[deviceID]
	if !ok || len(connIDs) == 0 {
		m.mut.RUnlock()
		return
	}
	conn := m.connections[connIDs[0]]
	m.mut.RUnlock()

	result, err := m.PreviewIndexFolderFiles(folder, deviceID, PreviewIndexOptions{
		Page:    1,
		PerPage: 1 << 16,
	})
	if err != nil {
		return
	}

	files := make([]protocol.FileInfo, 0, len(result.Entries))
	for _, entry := range result.Entries {
		if entry.File == nil {
			continue
		}
		files = append(files, *entry.File)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if len(files) == 0 {
		_ = conn.Index(ctx, &protocol.Index{
			Folder:       previewFolderID(folder),
			Files:        nil,
			LastSequence: result.Sequence,
		})
		return
	}

	initial := true
	batch := NewFileInfoBatch(func(fs []protocol.FileInfo) error {
		lastSequence := result.Sequence
		if len(fs) > 0 && fs[len(fs)-1].SequenceNo() > 0 {
			lastSequence = fs[len(fs)-1].SequenceNo()
		}
		if initial {
			initial = false
			return conn.Index(ctx, &protocol.Index{
				Folder:       previewFolderID(folder),
				Files:        fs,
				LastSequence: lastSequence,
			})
		}
		return conn.IndexUpdate(ctx, &protocol.IndexUpdate{
			Folder:       previewFolderID(folder),
			Files:        fs,
			PrevSequence: result.Sequence,
			LastSequence: lastSequence,
		})
	})

	for _, fi := range files {
		batch.Append(fi)
		if err := batch.FlushIfFull(); err != nil {
			return
		}
	}
	_ = batch.Flush()
}

func (m *model) handlePreviewIndex(conn protocol.Connection, folder string, fs []protocol.FileInfo, update bool, _ int64, lastSequence int64) error {
	realFolder, ok := parsePreviewFolderID(folder)
	if !ok {
		return fmt.Errorf("invalid preview folder id %q", folder)
	}

	deviceID := conn.DeviceID()

	m.mut.Lock()
	defer m.mut.Unlock()

	if _, ok := m.previewIndexes[deviceID]; !ok {
		m.previewIndexes[deviceID] = make(map[string]previewIndexSnapshot)
	}

	snapshot := m.previewIndexes[deviceID][realFolder]
	if !update || snapshot.Files == nil {
		snapshot = previewIndexSnapshot{
			Files: make(map[string]protocol.FileInfo, len(fs)),
		}
	}

	for _, fi := range fs {
		snapshot.Files[fi.Name] = fi
	}
	snapshot.Sequence = lastSequence
	snapshot.Updated = time.Now()
	m.previewIndexes[deviceID][realFolder] = snapshot
	return nil
}

func (m *model) previewSnapshot(folder string, device protocol.DeviceID) (previewIndexSnapshot, bool) {
	m.mut.RLock()
	defer m.mut.RUnlock()
	folders, ok := m.previewIndexes[device]
	if !ok {
		return previewIndexSnapshot{}, false
	}
	snapshot, ok := folders[folder]
	return snapshot, ok
}
