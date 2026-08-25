import { describe, expect, it } from "vitest";
import {
  comparableFolderPath,
  folderPathChanged,
  folderPathMoveConfirmText,
  normalizeFolderPath,
} from "./folder-editor-utils";

describe("folder path migration helpers", () => {
  it("trims and strips trailing slashes except short roots", () => {
    expect(normalizeFolderPath("  E:\\myserver\\Server_special\\  ")).toBe("E:\\myserver\\Server_special");
    expect(normalizeFolderPath("/home/user/data/")).toBe("/home/user/data");
    expect(normalizeFolderPath("C:\\")).toBe("C:\\");
  });

  it("treats Windows paths as case-insensitive", () => {
    expect(folderPathChanged("E:\\Music\\Server", "e:\\music\\server")).toBe(false);
    expect(comparableFolderPath("E:\\Music\\Server")).toBe("e:\\music\\server");
  });

  it("detects a real folder move", () => {
    expect(folderPathChanged("E:\\myserver\\Server_special", "D:\\data\\Server_special")).toBe(true);
  });

  it("explains that the folder ID and index are kept", () => {
    const text = folderPathMoveConfirmText("E:\\old", "D:\\new");
    expect(text).toContain("E:\\old");
    expect(text).toContain("D:\\new");
    expect(text).toContain("文件夹 ID 和索引会保留");
  });
});
