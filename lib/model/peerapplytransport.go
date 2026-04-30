// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package model

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/events"
	stfs "github.com/syncthing/syncthing/lib/fs"
	"github.com/syncthing/syncthing/lib/protocol"
)

const peerApplyFolderPrefix = ".stpeerapply/"
const peerApplyResultFolderPrefix = ".stpeerapplyresult/"

type PeerApplyResultEntry struct {
	Path      string
	Direction string
	Status    string
	Message   string
	Updated   time.Time
}

func peerApplyFolderID(folder string) string {
	return peerApplyFolderPrefix + folder
}

func parsePeerApplyFolderID(folder string) (string, bool) {
	if !strings.HasPrefix(folder, peerApplyFolderPrefix) {
		return "", false
	}
	return strings.TrimPrefix(folder, peerApplyFolderPrefix), true
}

func peerApplyResultFolderID(folder string) string {
	return peerApplyResultFolderPrefix + folder
}

func parsePeerApplyResultFolderID(folder string) (string, bool) {
	if !strings.HasPrefix(folder, peerApplyResultFolderPrefix) {
		return "", false
	}
	return strings.TrimPrefix(folder, peerApplyResultFolderPrefix), true
}

func (m *model) sendPeerApply(folder string, device protocol.DeviceID, files []string) error {
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

	payload, err := m.buildPeerApplyPayload(folder, device, files)
	if err != nil {
		return err
	}
	if len(payload) == 0 {
		return nil
	}

	m.mut.RLock()
	connIDs, ok := m.deviceConnIDs[device]
	if !ok || len(connIDs) == 0 {
		m.mut.RUnlock()
		return errGeneric{"目标设备当前未连接，无法直接应用到对端"}
	}
	conn := m.connections[connIDs[0]]
	m.mut.RUnlock()

	lastSequence := int64(len(payload))
	if lastSequence < 1 {
		lastSequence = 1
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return conn.Index(ctx, &protocol.Index{
		Folder:       peerApplyFolderID(folder),
		Files:        payload,
		LastSequence: lastSequence,
	})
}

func (m *model) sendPeerApplyResults(folder string, device protocol.DeviceID, entries []PeerApplyResultEntry) error {
	m.mut.RLock()
	connIDs, ok := m.deviceConnIDs[device]
	if !ok || len(connIDs) == 0 {
		m.mut.RUnlock()
		return errGeneric{"目标设备当前未连接，无法返回应用结果"}
	}
	conn := m.connections[connIDs[0]]
	m.mut.RUnlock()

	files := make([]protocol.FileInfo, 0, len(entries))
	for _, entry := range entries {
		files = append(files, protocol.FileInfo{
			Name:      entry.Path,
			Type:      protocol.FileInfoTypeDirectory,
			Deleted:   entry.Status != "success",
			Size:      boolToInt64(entry.Status == "success"),
			ModifiedS: entry.Updated.Unix(),
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return conn.Index(ctx, &protocol.Index{
		Folder:       peerApplyResultFolderID(folder),
		Files:        files,
		LastSequence: int64(len(files)),
	})
}

func (m *model) buildPeerApplyPayload(folder string, device protocol.DeviceID, files []string) ([]protocol.FileInfo, error) {
	payload := make([]protocol.FileInfo, 0, len(files))
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		if _, ok := seen[file]; ok {
			continue
		}
		seen[file] = struct{}{}

		local, localOK, err := m.sdb.GetDeviceFile(folder, protocol.LocalDeviceID, file)
		if err != nil {
			return nil, err
		}
		global, globalOK, err := m.sdb.GetGlobalFile(folder, file)
		if err != nil {
			return nil, err
		}
		remote, remoteOK, err := m.sdb.GetDeviceFile(folder, device, file)
		if err != nil {
			return nil, err
		}

		fi, ok := preparePeerApplyFileInfo(m.shortID, localOK, local, globalOK, global, remoteOK, remote)
		if !ok {
			continue
		}
		fi.LocalFlags = 0
		payload = append(payload, fi)
	}
	return payload, nil
}

func preparePeerApplyFileInfo(shortID protocol.ShortID, localOK bool, local protocol.FileInfo, globalOK bool, global protocol.FileInfo, remoteOK bool, remote protocol.FileInfo) (protocol.FileInfo, bool) {
	switch {
	case localOK && !local.IsDeleted():
		fi := local
		fi.LocalFlags = 0
		return fi, true
	case localOK:
		fi := local
		fi.LocalFlags = 0
		return fi, true
	case globalOK:
		fi := global
		fi.LocalFlags = 0
		fi.SetDeleted(shortID)
		return fi, true
	case remoteOK:
		fi := remote
		fi.LocalFlags = 0
		fi.SetDeleted(shortID)
		return fi, true
	default:
		return protocol.FileInfo{}, false
	}
}

func (m *model) handlePeerApplyIndex(conn protocol.Connection, folder string, fs []protocol.FileInfo, _ bool, _ int64, _ int64) error {
	realFolder, ok := parsePeerApplyFolderID(folder)
	if !ok {
		return fmt.Errorf("invalid peer apply folder id %q", folder)
	}

	deviceID := conn.DeviceID()

	m.mut.RLock()
	cfg, cfgOK := m.folderCfgs[realFolder]
	m.mut.RUnlock()

	if !cfgOK {
		return ErrFolderMissing
	}
	if cfg.Paused {
		return ErrFolderPaused
	}
	if !folderSharedWithDevice(cfg, deviceID) {
		return errDeviceUnknown
	}
	if !folderTypeCanReceive(cfg.Type) {
		return ErrFolderNotRunning
	}

	filesystem := cfg.Filesystem()
	updates := make([]protocol.FileInfo, 0, len(fs))
	selected := make([]string, 0, len(fs))
	updatedNames := make([]string, 0, len(fs))
	rescanPaths := make([]string, 0, len(fs))
	seen := make(map[string]struct{}, len(fs))

	for _, fi := range fs {
		if _, ok := seen[fi.Name]; ok {
			continue
		}
		seen[fi.Name] = struct{}{}

		fi.LocalFlags = 0
		updates = append(updates, fi)
		updatedNames = append(updatedNames, fi.Name)
		selected = append(selected, fi.Name)

		if fi.IsDeleted() {
			local, localOK, err := m.sdb.GetDeviceFile(realFolder, protocol.LocalDeviceID, fi.Name)
			if err != nil {
				return err
			}
			if localOK && !local.IsDeleted() {
				if err := deleteLocalForRemoteAbsence(filesystem, local); err != nil && !stfs.IsNotExist(err) {
					return err
				}
				rescanPaths = append(rescanPaths, fi.Name)
			}
		}
	}

	if len(updates) > 0 {
		if err := m.sdb.Update(realFolder, deviceID, updates); err != nil {
			return err
		}
		seq, err := m.sdb.GetDeviceSequence(realFolder, deviceID)
		if err != nil {
			return err
		}
		slices.Sort(updatedNames)
		m.evLogger.Log(events.RemoteIndexUpdated, map[string]interface{}{
			"device":   deviceID.String(),
			"folder":   realFolder,
			"items":    len(updates),
			"sequence": seq,
			"version":  seq,
		})
	}

	if len(rescanPaths) > 0 {
		if err := m.ScanFolderSubdirs(realFolder, rescanPaths); err != nil {
			return err
		}
	}

	if len(selected) == 0 {
		return nil
	}

	err := m.applyRemoteSideSelectedWithPolicy(realFolder, deviceID, selected, func(folder string, cfg config.FolderConfiguration, entry CompareEntry) (bool, string) {
		if !folderTypeCanReceive(cfg.Type) {
			return false, "当前文件夹不能接收对端显式应用"
		}
		if entry.Status == "same" {
			return false, "两侧已经一致"
		}
		return true, ""
	}, false)
	results := make([]PeerApplyResultEntry, 0, len(selected))
	now := time.Now()
	for _, path := range selected {
		status := "success"
		message := ""
		if err != nil {
			status = "failed"
			message = err.Error()
		}
		results = append(results, PeerApplyResultEntry{
			Path:      path,
			Direction: BiDiffDirectionLeftToRight,
			Status:    status,
			Message:   message,
			Updated:   now,
		})
	}
	m.recordPeerApplyResults(deviceID, realFolder, results)
	_ = m.sendPeerApplyResults(realFolder, deviceID, results)
	return err
}

func (m *model) handlePeerApplyResultIndex(conn protocol.Connection, folder string, fs []protocol.FileInfo, _ bool, _ int64, _ int64) error {
	realFolder, ok := parsePeerApplyResultFolderID(folder)
	if !ok {
		return fmt.Errorf("invalid peer apply result folder id %q", folder)
	}

	results := make([]PeerApplyResultEntry, 0, len(fs))
	for _, fi := range fs {
		status := "success"
		if fi.IsDeleted() || fi.Size == 0 {
			status = "failed"
		}
		results = append(results, PeerApplyResultEntry{
			Path:      fi.Name,
			Direction: BiDiffDirectionLeftToRight,
			Status:    status,
			Updated:   fi.ModTime(),
		})
	}
	m.recordPeerApplyResults(conn.DeviceID(), realFolder, results)
	return nil
}

func (m *model) recordPeerApplyResults(device protocol.DeviceID, folder string, results []PeerApplyResultEntry) {
	if len(results) == 0 {
		return
	}
	m.mut.Lock()
	defer m.mut.Unlock()
	if _, ok := m.peerApplyResults[device]; !ok {
		m.peerApplyResults[device] = make(map[string]map[string]PeerApplyResultEntry)
	}
	if _, ok := m.peerApplyResults[device][folder]; !ok {
		m.peerApplyResults[device][folder] = make(map[string]PeerApplyResultEntry)
	}
	for _, result := range results {
		key := result.Direction + "\x00" + result.Path
		m.peerApplyResults[device][folder][key] = result
	}
}

func (m *model) peerApplyResultsFor(folder string, device protocol.DeviceID) []PeerApplyResultEntry {
	m.mut.RLock()
	defer m.mut.RUnlock()
	folders, ok := m.peerApplyResults[device]
	if !ok {
		return nil
	}
	items, ok := folders[folder]
	if !ok {
		return nil
	}
	results := make([]PeerApplyResultEntry, 0, len(items))
	for _, result := range items {
		results = append(results, result)
	}
	slices.SortFunc(results, func(a, b PeerApplyResultEntry) int {
		if a.Updated.Equal(b.Updated) {
			if a.Direction == b.Direction {
				return strings.Compare(a.Path, b.Path)
			}
			return strings.Compare(a.Direction, b.Direction)
		}
		if a.Updated.After(b.Updated) {
			return -1
		}
		return 1
	})
	return results
}

func boolToInt64(v bool) int64 {
	if v {
		return 1
	}
	return 0
}
