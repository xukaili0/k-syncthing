// Copyright (C) 2026 The Syncthing Authors.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

package config

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"path/filepath"
	"strings"

	"github.com/syncthing/syncthing/lib/protocol"
	"gopkg.in/yaml.v3"
)

const yamlConfigHeader = `# Syncthing configuration (YAML)
# You can add comments with #.
# Saving from the GUI rewrites this file and drops hand-written comments.
# 可以用 # 写注释；从图形界面保存会重写本文件，手写注释会被丢掉。
#
`

func IsYAMLPath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".yaml", ".yml":
		return true
	default:
		return false
	}
}

func ReadYAML(r io.Reader, myID protocol.DeviceID) (Configuration, int, error) {
	jsonBytes, err := yamlToJSON(r)
	if err != nil {
		return Configuration{}, 0, err
	}

	var peek struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(jsonBytes, &peek); err != nil {
		return Configuration{}, 0, err
	}

	cfg, err := ReadJSON(bytes.NewReader(jsonBytes), myID)
	if err != nil {
		return Configuration{}, peek.Version, err
	}
	return cfg, peek.Version, nil
}

func (cfg *Configuration) WriteYAML(w io.Writer) error {
	jsonBytes, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	var body any
	if err := json.Unmarshal(jsonBytes, &body); err != nil {
		return err
	}
	body = normalizeYAMLNumbers(body)
	if _, err := io.WriteString(w, yamlConfigHeader); err != nil {
		return err
	}
	enc := yaml.NewEncoder(w)
	enc.SetIndent(2)
	if err := enc.Encode(body); err != nil {
		_ = enc.Close()
		return err
	}
	return enc.Close()
}

func yamlToJSON(r io.Reader) ([]byte, error) {
	dec := yaml.NewDecoder(r)
	var body any
	if err := dec.Decode(&body); err != nil {
		return nil, err
	}
	return json.Marshal(body)
}

func normalizeYAMLNumbers(v any) any {
	switch t := v.(type) {
	case float64:
		if t == math.Trunc(t) && t >= math.MinInt64 && t <= math.MaxInt64 {
			return int64(t)
		}
		return t
	case map[string]any:
		for key, val := range t {
			t[key] = normalizeYAMLNumbers(val)
		}
		return t
	case []any:
		for i, val := range t {
			t[i] = normalizeYAMLNumbers(val)
		}
		return t
	default:
		return v
	}
}
