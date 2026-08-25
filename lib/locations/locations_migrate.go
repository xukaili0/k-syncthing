// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package locations

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/syncthing/syncthing/lib/build"
)

// MigrateLegacyHomeDir moves an existing official Syncthing home directory
// into this fork's separate directory when the latter does not yet contain a
// config. Explicit --home / --config / --data locations are handled by the
// caller and should skip this function.
func MigrateLegacyHomeDir() (from, to string, err error) {
	legacyConfig, legacyData := officialHomeDirs()
	return migrateLegacyHomeDir(GetBaseDir(ConfigBaseDir), GetBaseDir(DataBaseDir), legacyConfig, legacyData)
}

func migrateLegacyHomeDir(configDir, dataDir, legacyConfig, legacyData string) (from, to string, err error) {
	if configExistsIn(configDir, fileExists) {
		return "", "", nil
	}

	if configDir == dataDir {
		if !shouldMigrateFrom(legacyConfig, configDir) {
			return "", "", nil
		}
		if err := moveHomeDir(legacyConfig, configDir); err != nil {
			return "", "", fmt.Errorf("move %s to %s: %w", legacyConfig, configDir, err)
		}
		return legacyConfig, configDir, nil
	}

	movedFrom := ""
	if shouldMigrateFrom(legacyConfig, configDir) {
		if err := moveHomeDir(legacyConfig, configDir); err != nil {
			return "", "", fmt.Errorf("move config %s to %s: %w", legacyConfig, configDir, err)
		}
		movedFrom = legacyConfig
	}

	if legacyData != "" && legacyData != legacyConfig && hasDatabase(legacyData) && legacyData != dataDir {
		if err := moveHomeDir(legacyData, dataDir); err != nil {
			return "", "", fmt.Errorf("move data %s to %s: %w", legacyData, dataDir, err)
		}
		if movedFrom == "" {
			movedFrom = legacyData
		}
	}

	if movedFrom == "" {
		return "", "", nil
	}
	return movedFrom, configDir, nil
}

func shouldMigrateFrom(legacyDir, newDir string) bool {
	return legacyDir != "" && legacyDir != newDir && (fileExists(filepath.Join(legacyDir, xmlConfigFileName)) || fileExists(filepath.Join(legacyDir, yamlConfigFileName)))
}

func hasDatabase(dir string) bool {
	return fileExists(filepath.Join(dir, databaseName)) || fileExists(filepath.Join(dir, levelDBDir))
}

func officialHomeDirs() (configDir, dataDir string) {
	userHome := GetBaseDir(UserHomeBaseDir)
	switch {
	case build.IsWindows:
		dir := filepath.Join(windowsAppDataRoot(), legacyAppDirName)
		return dir, dir
	case build.IsDarwin, build.IsIOS:
		dir := filepath.Join(userHome, "Library/Application Support", legacyAppDirName)
		return dir, dir
	default:
		configDir = unixOfficialConfigDir(userHome, os.Getenv("XDG_CONFIG_HOME"), os.Getenv("XDG_STATE_HOME"), fileExists)
		dataDir = unixOfficialDataDir(userHome, configDir, os.Getenv("XDG_DATA_HOME"), os.Getenv("XDG_STATE_HOME"), fileExists)
		return configDir, dataDir
	}
}

func unixOfficialConfigDir(userHome, xdgConfigHome, xdgStateHome string, fileExists func(string) bool) string {
	candidates := []string{
		filepath.Join(userHome, legacyUnixStateDir),
		filepath.Join(userHome, legacyUnixConfigDir),
	}
	if xdgConfigHome != "" {
		candidates = append([]string{filepath.Join(xdgConfigHome, legacyAppDirNameUnix)}, candidates...)
	}
	if filepath.IsAbs(xdgStateHome) {
		candidates = append([]string{filepath.Join(xdgStateHome, legacyAppDirNameUnix)}, candidates...)
	}
	for _, candidate := range candidates {
		if fileExists(filepath.Join(candidate, yamlConfigFileName)) || fileExists(filepath.Join(candidate, xmlConfigFileName)) {
			return candidate
		}
	}
	return ""
}

func unixOfficialDataDir(userHome, configDir, xdgDataHome, xdgStateHome string, fileExists func(string) bool) string {
	if configDir != "" && (fileExists(filepath.Join(configDir, databaseName)) || fileExists(filepath.Join(configDir, levelDBDir))) {
		return configDir
	}
	candidates := []string{
		filepath.Join(userHome, legacyUnixStateDir),
		filepath.Join(userHome, legacyUnixConfigDir),
	}
	if xdgDataHome != "" {
		candidates = append([]string{filepath.Join(xdgDataHome, legacyAppDirNameUnix)}, candidates...)
	}
	if filepath.IsAbs(xdgStateHome) {
		candidates = append([]string{filepath.Join(xdgStateHome, legacyAppDirNameUnix)}, candidates...)
	}
	for _, candidate := range candidates {
		if fileExists(filepath.Join(candidate, databaseName)) || fileExists(filepath.Join(candidate, levelDBDir)) {
			return candidate
		}
	}
	return configDir
}

func moveHomeDir(src, dst string) error {
	if src == dst {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	if !fileExists(dst) {
		if err := os.Rename(src, dst); err == nil {
			return nil
		}
	}
	if err := os.MkdirAll(dst, 0o700); err != nil {
		return err
	}
	if err := copyDir(src, dst); err != nil {
		return err
	}
	return os.RemoveAll(src)
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if d.Type()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			_ = os.Remove(target)
			return os.Symlink(link, target)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
