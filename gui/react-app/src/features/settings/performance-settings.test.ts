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

  it("applies the HDD 500 KB preset with a small pull queue and single hasher", () => {
    const next = applyPerformancePreset(configFixture(), performancePresets.hddSmall500k);

    expect(next.options.maxFolderConcurrency).toBe(1);
    expect(next.options.setLowPriority).toBe(true);
    expect(next.folders.every((folder) => folder.hashers === 1 && folder.copiers === 1)).toBe(true);
    expect(next.folders.every((folder) => folder.maxConcurrentWrites === 4)).toBe(true);
    expect(next.folders.every((folder) => folder.pullerMaxPendingKiB === 8192)).toBe(true);
    expect(next.folders.every((folder) => folder.scanProgressIntervalS === 0)).toBe(true);
    expect(next.folders.every((folder) => folder.disableFsync === false)).toBe(true);
    expect(next.devices.every((device) => device.numConnections === 3)).toBe(true);
  });

  it("applies the HDD 10 MB preset with a medium pull queue", () => {
    const next = applyPerformancePreset(configFixture(), performancePresets.hddMedium10m);

    expect(next.folders.every((folder) => folder.hashers === 1 && folder.copiers === 2)).toBe(true);
    expect(next.folders.every((folder) => folder.maxConcurrentWrites === 4)).toBe(true);
    expect(next.folders.every((folder) => folder.pullerMaxPendingKiB === 16384)).toBe(true);
    expect(next.devices.every((device) => device.numConnections === 3)).toBe(true);
  });

  it("applies the HDD 200 MB preset with sequential-friendly writes", () => {
    const next = applyPerformancePreset(configFixture(), performancePresets.hddLarge200m);

    expect(next.folders.every((folder) => folder.hashers === 1 && folder.copiers === 2)).toBe(true);
    expect(next.folders.every((folder) => folder.maxConcurrentWrites === 2)).toBe(true);
    expect(next.folders.every((folder) => folder.pullerMaxPendingKiB === 32768)).toBe(true);
    expect(next.defaults.folder.scanProgressIntervalS).toBe(0);
    expect(next.devices.every((device) => device.numConnections === 3)).toBe(true);
  });

  it("restores auto/default sentinel values without making writes unlimited", () => {
    const next = applyPerformancePreset(configFixture(), performancePresets.syncthingAuto);

    expect(next.folders.every((folder) => folder.hashers === 0 && folder.copiers === 0)).toBe(true);
    expect(next.folders.every((folder) => folder.maxConcurrentWrites === 16)).toBe(true);
    expect(next.devices.every((device) => device.numConnections === 0)).toBe(true);
    expect(next.options.maxFolderConcurrency).toBe(0);
  });
});
