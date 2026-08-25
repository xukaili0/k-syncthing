import type { FolderConfig } from "../../api";
import { canPublish, canReceive } from "../../components/review/review-formatters";

type FolderVersioningSelector = "none" | "trashcan" | "simple" | "staggered" | "external";

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDefaultGuiVersioning() {
  return {
    selector: "none" as FolderVersioningSelector,
    trashcanClean: 0,
    cleanupIntervalS: 3600,
    simpleKeep: 5,
    staggeredMaxAge: 365,
    externalCommand: "",
  };
}

export function createGuiVersioningFromFolder(folder: FolderConfig) {
  const defaults = createDefaultGuiVersioning();
  const versioning = folder.versioning;
  if (!versioning?.type || versioning.type === "none") {
    return defaults;
  }

  const next = {
    ...defaults,
    selector: versioning.type as FolderVersioningSelector,
    cleanupIntervalS: Number(versioning.cleanupIntervalS ?? defaults.cleanupIntervalS) || defaults.cleanupIntervalS,
  };

  switch (versioning.type) {
    case "trashcan":
      next.trashcanClean = Number(versioning.params?.cleanoutDays ?? defaults.trashcanClean) || 0;
      break;
    case "simple":
      next.simpleKeep = Number(versioning.params?.keep ?? defaults.simpleKeep) || defaults.simpleKeep;
      next.trashcanClean = Number(versioning.params?.cleanoutDays ?? defaults.trashcanClean) || 0;
      break;
    case "staggered":
      next.staggeredMaxAge = Math.floor(Number(versioning.params?.maxAge ?? defaults.staggeredMaxAge * 86400) / 86400) || defaults.staggeredMaxAge;
      break;
    case "external":
      next.externalCommand = versioning.params?.command ?? defaults.externalCommand;
      break;
  }

  return next;
}

export function prepareFolderDraft(folder: FolderConfig): FolderConfig {
  const next = cloneJSON(folder);
  next.minDiskFree = {
    value: next.minDiskFree?.value ?? 1,
    unit: next.minDiskFree?.unit ?? "%",
  };
  next.versioning = next.versioning ?? { type: "" };
  next._guiVersioning = createGuiVersioningFromFolder(next);
  next._addIgnores = false;
  return next;
}

export function buildFolderPayload(folder: FolderConfig): FolderConfig {
  const payload = cloneJSON(folder);
  if (!canReceive(payload)) {
    payload.manualSync = false;
  }
  if (!canPublish(payload)) {
    payload.manualPublish = false;
  }

  const guiVersioning = payload._guiVersioning ?? createDefaultGuiVersioning();
  const versioning: NonNullable<FolderConfig["versioning"]> = {
    type: guiVersioning.selector === "none" ? "" : guiVersioning.selector,
    cleanupIntervalS: guiVersioning.cleanupIntervalS,
    fsPath: payload.versioning?.fsPath ?? "",
    params: {},
  };

  switch (guiVersioning.selector) {
    case "trashcan":
      versioning.params = { cleanoutDays: String(guiVersioning.trashcanClean) };
      break;
    case "simple":
      versioning.params = {
        keep: String(guiVersioning.simpleKeep),
        cleanoutDays: String(guiVersioning.trashcanClean),
      };
      break;
    case "staggered":
      versioning.params = { maxAge: String(guiVersioning.staggeredMaxAge * 86400) };
      break;
    case "external":
      versioning.params = { command: guiVersioning.externalCommand };
      break;
    default:
      versioning.cleanupIntervalS = undefined;
      versioning.fsPath = "";
      versioning.params = {};
  }

  payload.versioning = versioning;
  delete payload._guiVersioning;
  delete payload._addIgnores;
  return payload;
}

export function normalizeIgnoreText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

