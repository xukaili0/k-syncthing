// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package config

import (
	"bytes"
	"strings"
	"testing"
)

func TestYAMLRoundTripPreservesFolderPathAndID(t *testing.T) {
	original := New(device1)
	original.Folders = []FolderConfiguration{
		{
			ID:   "server-special",
			Path: `E:\myserver\Server_special`,
		},
	}
	if err := original.prepare(device1); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := original.WriteYAML(&buf); err != nil {
		t.Fatal(err)
	}
	text := buf.String()
	if !strings.HasPrefix(text, "# Syncthing configuration") {
		t.Fatalf("missing YAML header comment:\n%s", text[:min(len(text), 120)])
	}
	if !strings.Contains(text, "server-special") {
		t.Fatalf("folder id missing from YAML:\n%s", text)
	}
	if strings.Contains(text, "version: 53.0") {
		t.Fatalf("integer version encoded as float:\n%s", text)
	}
	if !strings.Contains(text, "version: 53") {
		t.Fatalf("integer version missing:\n%s", text)
	}

	got, originalVersion, err := ReadYAML(bytes.NewReader(buf.Bytes()), device1)
	if err != nil {
		t.Fatal(err)
	}
	if originalVersion != CurrentVersion {
		t.Fatalf("version %d, want %d", originalVersion, CurrentVersion)
	}
	folder, _, ok := got.Folder("server-special")
	if !ok {
		t.Fatal("folder missing after YAML round trip")
	}
	if folder.Path != `E:\myserver\Server_special` {
		t.Fatalf("path %q", folder.Path)
	}
}

func TestReadYAMLAllowsComments(t *testing.T) {
	src := "# hand-written comment\nversion: 53\nfolders: []\ndevices: []\noptions:\n  autoUpgradeIntervalH: 0\n"
	cfg, originalVersion, err := ReadYAML(strings.NewReader(src), device1)
	if err != nil {
		t.Fatal(err)
	}
	if originalVersion != 53 {
		t.Fatalf("version %d", originalVersion)
	}
	if cfg.Options.AutoUpgradeIntervalH != 0 {
		t.Fatalf("auto upgrade %d", cfg.Options.AutoUpgradeIntervalH)
	}
}

func TestIsYAMLPath(t *testing.T) {
	if !IsYAMLPath(`C:\Users\a\config.yaml`) || IsYAMLPath(`C:\Users\a\config.xml`) {
		t.Fatal("extension detection failed")
	}
}
