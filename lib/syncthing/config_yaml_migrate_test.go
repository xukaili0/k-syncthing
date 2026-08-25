// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package syncthing

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/events"
	"github.com/syncthing/syncthing/lib/protocol"
)

func TestMigrateConfigToYAML(t *testing.T) {
	myID, err := protocol.DeviceIDFromString("AIR6LPZ7K4PTTUXQSMUUCPQ5YWOEDFIIQJUG7772YQXXR5YD6AWQ")
	if err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	xmlPath := filepath.Join(dir, "config.xml")
	wrapper := config.Wrap(xmlPath, config.New(myID), myID, events.NoopLogger)
	if err := wrapper.Save(); err != nil {
		t.Fatal(err)
	}

	migrated, err := migrateConfigToYAML(wrapper, myID, events.NoopLogger)
	if err != nil {
		t.Fatal(err)
	}

	yamlPath := filepath.Join(dir, "config.yaml")
	if migrated.ConfigPath() != yamlPath {
		t.Fatalf("config path %q, want %q", migrated.ConfigPath(), yamlPath)
	}
	if _, err := os.Stat(yamlPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(xmlPath + ".bak"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(xmlPath); !os.IsNotExist(err) {
		t.Fatalf("XML config should have been renamed away, err=%v", err)
	}
}

func TestMigrateConfigToYAMLSkipsExistingYAML(t *testing.T) {
	myID, err := protocol.DeviceIDFromString("AIR6LPZ7K4PTTUXQSMUUCPQ5YWOEDFIIQJUG7772YQXXR5YD6AWQ")
	if err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "config.yaml")
	wrapper := config.Wrap(yamlPath, config.New(myID), myID, events.NoopLogger)
	if err := wrapper.Save(); err != nil {
		t.Fatal(err)
	}

	migrated, err := migrateConfigToYAML(wrapper, myID, events.NoopLogger)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.ConfigPath() != yamlPath {
		t.Fatalf("config path %q, want %q", migrated.ConfigPath(), yamlPath)
	}
}
