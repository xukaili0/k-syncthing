import { describe, expect, it } from "vitest";
import type { ConfigResponse } from "../../api";
import { applyPerformancePreset, performancePresets } from "./PerformanceSettingsPanel";

function configFixture(): ConfigResponse {
  return {
    version: 42,
    folders: [
      { id: "one", path: "/one", type: "sendreceive", devices: [], hashers: 1 },
      { id: "two", path: "/two", type: "sendreceive", devices: [], hashers: 2 },
    ],
    devices: [
      { deviceID: "AAAA", numConnections: 1 },
      { deviceID: "BBBB", numConnections: 2 },
    ],
    gui: {},
    ldap: {},
    options: { maxFolderConcurrency: 8, setLowPriority: true },
    defaults: {
      folder: { id: "", path: "~", type: "sendreceive", devices: [], hashers: 0 },
      device: { deviceID: "", numConnections: 0 },
      ignores: { lines: [] },
    },
    remoteIgnoredDevices: [],
  };
}

describe("performance presets", () => {
  it("applies the 12600K balanced preset to existing and default configuration", () => {
    const original = configFixture();
    const next = applyPerformancePreset(original, performancePresets.balanced12600k);

    expect(next.options.maxFolderConcurrency).toBe(2);
    expect(next.options.setLowPriority).toBe(false);
    expect(next.folders.map((folder) => folder.hashers)).toEqual([6, 6]);
    expect(next.folders.map((folder) => folder.maxConcurrentWrites)).toEqual([16, 16]);
    expect(next.defaults.folder.scanProgressIntervalS).toBe(-1);
    expect(next.devices.map((device) => device.numConnections)).toEqual([4, 4]);
    expect(next.defaults.device.numConnections).toBe(4);
    expect(original.folders.map((folder) => folder.hashers)).toEqual([1, 2]);
  });

  it("restores auto/default sentinel values without making writes unlimited", () => {
    const next = applyPerformancePreset(configFixture(), performancePresets.syncthingAuto);

    expect(next.folders.every((folder) => folder.hashers === 0 && folder.copiers === 0)).toBe(true);
    expect(next.folders.every((folder) => folder.maxConcurrentWrites === 16)).toBe(true);
    expect(next.devices.every((device) => device.numConnections === 0)).toBe(true);
    expect(next.options.maxFolderConcurrency).toBe(0);
  });
});
