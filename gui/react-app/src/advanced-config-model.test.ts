import { describe, expect, it } from "vitest";
import type { ConfigResponse } from "./api";
import {
  decodeSimpleList,
  editableEntries,
  encodeSimpleList,
  fieldMetaFor,
  generateAPIKey,
  inputKindFor,
  setConfigValue,
  validateAdvancedConfig,
} from "./advanced-config-model";

function sampleConfig(): ConfigResponse {
  return {
    version: 42,
    folders: [
      {
        id: "docs",
        path: "/srv/docs",
        type: "sendreceive",
        devices: [],
        minDiskFree: { value: 1, unit: "%" },
      },
    ],
    devices: [],
    gui: {
      enabled: true,
      authMode: "static",
      password: "$2a$10$existingHash",
      apiKey: "existing-api-key",
    },
    ldap: {
      address: "",
      bindDN: "",
      transport: "plain",
      searchBaseDN: "",
      searchFilter: "",
    },
    options: {
      listenAddresses: ["default"],
      minHomeDiskFree: { value: 1, unit: "%" },
      futureNestedValue: { keep: true },
    },
    defaults: {
      folder: {
        id: "",
        path: "~",
        type: "sendreceive",
        devices: [],
      },
      device: {
        deviceID: "",
      },
      ignores: {
        lines: ["// comment", "", "*.tmp"],
      },
    },
    remoteIgnoredDevices: [],
  };
}

describe("advanced configuration model", () => {
  it("classifies the supported old-GUI field types", () => {
    expect(inputKindFor(true)).toBe("boolean");
    expect(inputKindFor(2)).toBe("number");
    expect(inputKindFor("value")).toBe("text");
    expect(inputKindFor(["a", "b"])).toBe("list");
    expect(inputKindFor({ value: 1, unit: "%" })).toBe("size");
    expect(inputKindFor([{ id: "nested" }])).toBe("unsupported");
  });

  it("keeps complex values out of the generated primitive editor", () => {
    expect(editableEntries({ simple: "yes", nested: { keep: true }, _temporary: "skip" })).toEqual([["simple", "yes"]]);
  });

  it("updates a path immutably without dropping hidden or sensitive values", () => {
    const original = sampleConfig();
    const updated = setConfigValue(original, ["options", "listenAddresses"], ["tcp://0.0.0.0:22000"]);

    expect(updated).not.toBe(original);
    expect(updated.options.listenAddresses).toEqual(["tcp://0.0.0.0:22000"]);
    expect(updated.options.futureNestedValue).toEqual({ keep: true });
    expect(updated.gui.password).toBe("$2a$10$existingHash");
    expect(original.options.listenAddresses).toEqual(["default"]);
  });

  it("round-trips string and numeric lists", () => {
    expect(encodeSimpleList(["one", "two"])).toBe("one\ntwo");
    expect(decodeSimpleList("one\n two \n", [""])).toEqual(["one", "two"]);
    expect(decodeSimpleList("1\n2", [0])).toEqual([1, 2]);
  });

  it("validates the LDAP paired search fields and LDAP address", () => {
    const config = sampleConfig();
    config.gui.authMode = "ldap";
    config.ldap.searchBaseDN = "ou=people,dc=example,dc=com";

    expect(validateAdvancedConfig(config)).toEqual([
      "LDAP 搜索基础 DN 与搜索过滤器必须同时填写或同时留空。",
      "启用 LDAP 认证时必须填写 LDAP 服务器地址。",
    ]);
  });

  it("provides Chinese metadata, official docs and safe field hints", () => {
    const password = fieldMetaFor("gui", "password", "$2a$10$hash");
    const future = fieldMetaFor("options", "futureOption", 1);

    expect(password.label).toBe("管理密码");
    expect(password.sensitive).toBe("password");
    expect(password.docsURL).toContain("config-option-gui.password");
    expect(future.label).toBe("Future Option");
    expect(future.description).toContain("futureOption");
  });

  it("generates 32-character API keys", () => {
    const first = generateAPIKey();
    const second = generateAPIKey();
    expect(first).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(second).not.toBe(first);
  });
});
