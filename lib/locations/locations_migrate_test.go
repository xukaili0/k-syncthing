// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package locations

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyHomeDirMovesCombinedHome(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "Syncthing")
	next := filepath.Join(root, "SyncthingDev")
	mustWriteFile(t, filepath.Join(legacy, "config.xml"), "<configuration/>")
	mustWriteFile(t, filepath.Join(legacy, "index-v2", "db"), "data")

	from, to, err := migrateLegacyHomeDir(next, next, legacy, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if from != legacy || to != next {
		t.Fatalf("got from=%q to=%q", from, to)
	}
	if !fileExists(filepath.Join(next, "config.xml")) {
		t.Fatal("config was not moved to the new home")
	}
	if !fileExists(filepath.Join(next, "index-v2", "db")) {
		t.Fatal("database was not moved to the new home")
	}
	if fileExists(legacy) {
		t.Fatal("legacy home should be removed after a successful move")
	}
}

func TestMigrateLegacyHomeDirSkipsWhenNewConfigExists(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "Syncthing")
	next := filepath.Join(root, "SyncthingDev")
	mustWriteFile(t, filepath.Join(legacy, "config.xml"), "old")
	mustWriteFile(t, filepath.Join(next, "config.xml"), "new")

	from, to, err := migrateLegacyHomeDir(next, next, legacy, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if from != "" || to != "" {
		t.Fatalf("expected no migration, got from=%q to=%q", from, to)
	}
	got, err := os.ReadFile(filepath.Join(next, "config.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Fatalf("existing new config was overwritten: %s", got)
	}
}

func TestMigrateLegacyHomeDirSkipsWhenNewYAMLExists(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "Syncthing")
	next := filepath.Join(root, "SyncthingDev")
	mustWriteFile(t, filepath.Join(legacy, "config.xml"), "old")
	mustWriteFile(t, filepath.Join(next, "config.yaml"), "new")

	from, to, err := migrateLegacyHomeDir(next, next, legacy, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if from != "" || to != "" {
		t.Fatalf("expected no migration, got from=%q to=%q", from, to)
	}
	got, err := os.ReadFile(filepath.Join(next, "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Fatalf("existing YAML config was overwritten: %s", got)
	}
}

func TestUnixOfficialConfigDirPrefersExistingOfficialHome(t *testing.T) {
	userHome := "/home/user"
	expected := filepath.Join(userHome, ".local", "state", "syncthing")
	got := unixOfficialConfigDir(userHome, "", "", func(path string) bool {
		return path == filepath.Join(expected, "config.xml")
	})
	if got != expected {
		t.Fatalf("got %q", got)
	}
}

func mustWriteFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}
