import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BiDiffEntry,
  BiDiffResult,
  CompareEntry,
  CompareResult,
  CompletionStatus,
  ConfigResponse,
  ConnectionsResponse,
  DeviceConnection,
  DeviceConfig,
  DeviceStatistics,
  DownloadProgressData,
  FolderConfig,
  FolderStatus,
  IgnoreResponse,
  ItemFinishedData,
  OptionsConfig,
  PendingFoldersResponse,
  PendingPublishEntry,
  PendingPublishResult,
  SyncthingEvent,
  SystemStatus,
  VersionResponse,
  deleteJSON,
  getJSON,
  login,
  logout,
  putJSON,
  postJSON,
  triggerFolderScan,
  triggerSystemAction,
} from "./api";

type ViewMode = "overview" | "receive" | "publish";
type UiMode = "desktop" | "mobile";

const MAIN_REFRESH_KEY = "reactGuiMainRefreshSeconds";
const PANEL_REFRESH_KEY = "reactGuiPanelRefreshSeconds";
const BIDIFF_SIDEBAR_WIDTH_KEY = "reactGuiBidiffSidebarWidth";
const BIDIFF_TIME_MODE_KEY = "reactGuiBidiffTimeMode";
const BIDIFF_FONT_SCALE_KEY = "reactGuiBidiffFontScale";
const BIDIFF_DENSITY_KEY = "reactGuiBidiffDensity";

const compareViewOptions = [
  { value: "different", label: "仅看差异" },
  { value: "all", label: "显示全部" },
  { value: "incoming", label: "仅远端影响" },
  { value: "delete", label: "仅看删除" },
  { value: "modified", label: "仅看修改" },
  { value: "conflict", label: "仅看冲突" },
  { value: "only-local", label: "仅本地存在" },
  { value: "only-remote", label: "仅远端存在" },
  { value: "rename", label: "疑似移动/重命名" },
] as const;

const bidiffViewOptions = [
  { value: "different", label: "仅看待裁决差异" },
  { value: "all", label: "显示全部有效条目" },
  { value: "all-with-same", label: "显示全部（含相同）" },
  { value: "delete", label: "仅看删除 / 缺失" },
  { value: "modified", label: "仅看内容变化" },
  { value: "conflict", label: "仅看冲突" },
  { value: "only-local", label: "仅左侧存在" },
  { value: "only-remote", label: "仅右侧存在" },
  { value: "rename", label: "疑似移动 / 重命名" },
] as const;

const publishViewOptions = [
  { value: "all", label: "全部待发布项" },
  { value: "added", label: "仅看新增" },
  { value: "modified", label: "仅看修改" },
  { value: "delete", label: "仅看删除" },
] as const;

const refreshChoices = [2, 3, 5, 10, 15, 30];

function readStoredSeconds(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 2) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function storeSeconds(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
}

function readStoredPixels(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  } catch {
    return fallback;
  }
}

function storePixels(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
}

function readStoredChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function detectInitialUiMode(): UiMode {
  try {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("view");
    if (explicit === "mobile" || explicit === "desktop") {
      return explicit;
    }
  } catch {
    // Ignore URL parse issues.
  }

  const ua = window.navigator.userAgent || "";
  const isMobileUA = /Android|iPhone|iPad|Mobile/i.test(ua);
  const isNarrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 980px)").matches;
  return isMobileUA || isNarrow ? "mobile" : "desktop";
}

function updateUiModeInUrl(mode: UiMode) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("view", mode);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Ignore URL update failures.
  }
}

function formatBinary(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

function formatDate(value?: string, mode: "full" | "compact" = "full"): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (mode === "compact") {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    return `${yy}/${mm}/${dd} ${hh}`;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLastSeen(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return "从未";
  }
  return formatDate(value, "full");
}

function folderLabel(folder: FolderConfig): string {
  return folder.label && folder.label.trim().length > 0 ? folder.label : folder.id;
}

function deviceName(device: DeviceConfig | undefined): string {
  if (!device) {
    return "未知设备";
  }
  return device.name && device.name.trim().length > 0 ? device.name : device.deviceID.slice(0, 7);
}

function normalizeAddress(value: string): string {
  return value.replace(/\/\?.*$/, "");
}

function compressionLabel(value?: string): string {
  switch (value) {
    case "metadata":
      return "仅元数据";
    case "always":
      return "全部数据";
    case "never":
      return "关闭";
    default:
      return value || "-";
  }
}

function aggregateDeviceCompletion(completionMap?: Record<string, CompletionStatus>): {
  total: number;
  needBytes: number;
  needItems: number;
  remoteState?: string;
} {
  if (!completionMap) {
    return { total: 0, needBytes: 0, needItems: 0, remoteState: undefined };
  }

  let totalBytes = 0;
  let neededBytes = 0;
  let items = 0;
  let deletes = 0;
  let remoteState: string | undefined;

  for (const completion of Object.values(completionMap)) {
    totalBytes += completion.globalBytes ?? 0;
    neededBytes += completion.needBytes ?? 0;
    items += completion.needItems ?? 0;
    deletes += completion.needDeletes ?? 0;
    if (!remoteState || remoteState === "idle") {
      remoteState = completion.remoteState;
    } else if (completion.remoteState === "syncing" || completion.remoteState === "scanning") {
      remoteState = completion.remoteState;
    }
  }

  let total = 100;
  if (totalBytes > 0) {
    total = Math.floor(100 * (1 - neededBytes / totalBytes));
  }
  if (neededBytes === 0 && items + deletes > 0) {
    total = 95;
  }

  return {
    total,
    needBytes: neededBytes,
    needItems: items + deletes,
    remoteState,
  };
}

function folderTypeLabel(type: string): string {
  switch (type) {
    case "sendreceive":
      return "双向同步";
    case "sendonly":
      return "仅发送";
    case "receiveonly":
      return "仅接收";
    case "receiveencrypted":
      return "加密接收";
    default:
      return type;
  }
}

function canReceive(folder: FolderConfig): boolean {
  return folder.type !== "sendonly";
}

function canPublish(folder: FolderConfig): boolean {
  return folder.type !== "receiveonly" && folder.type !== "receiveencrypted";
}

function isPausedFolder(folder: FolderConfig | null | undefined): boolean {
  return Boolean(folder?.paused);
}

function pausedFolderStatus(): FolderStatus {
  return {
    state: "paused",
    localFiles: 0,
    localDirectories: 0,
    localBytes: 0,
    globalFiles: 0,
    globalDirectories: 0,
    globalBytes: 0,
    needTotalItems: 0,
    needBytes: 0,
    errors: 0,
    receiveOnlyTotalItems: 0,
  };
}

function pausedCompletionStatus(): CompletionStatus {
  return {
    completion: 100,
    globalBytes: 0,
    needBytes: 0,
    needItems: 0,
    needDeletes: 0,
    remoteState: "paused",
  };
}

function isFolderPausedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("folder is paused");
}

function receiveModeLabel(folder: FolderConfig): string {
  if (!canReceive(folder)) {
    return "不接收";
  }
  return folder.manualSync ? "手动审核接收" : "自动接收";
}

function publishModeLabel(folder: FolderConfig): string {
  if (!canPublish(folder)) {
    return "不发布";
  }
  return folder.manualPublish ? "手动审核发布" : "自动发布";
}

function createDefaultGuiVersioning() {
  return {
    selector: "none" as FolderVersioningSelector,
    trashcanClean: 0,
    cleanupIntervalS: 3600,
    simpleKeep: 5,
    staggeredMaxAge: 365,
    externalCommand: "",
  };
}

function createGuiVersioningFromFolder(folder: FolderConfig) {
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

function prepareFolderDraft(folder: FolderConfig): FolderConfig {
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

function buildFolderPayload(folder: FolderConfig): FolderConfig {
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

function normalizeIgnoreText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function completionRemoteStateLabel(remoteState?: string): string {
  switch (remoteState) {
    case "paused":
      return "远端已暂停";
    case "notSharing":
      return "远端尚未接受共享";
    case "idle":
      return "远端空闲";
    case "syncing":
      return "远端同步中";
    case "scanning":
      return "远端扫描中";
    default:
      return "";
  }
}

function pendingFolderOfferDevices(pending: PendingFoldersResponse[string], devicesById: Map<string, DeviceConfig>) {
  return Object.entries(pending.offeredBy).map(([deviceID, observed]) => ({
    deviceID,
    observed,
    device: devicesById.get(deviceID),
  }));
}

function folderStateTone(status?: FolderStatus): "success" | "warning" | "danger" | "muted" {
  if (!status) {
    return "muted";
  }
  if (status.errors) {
    return "danger";
  }
  if (status.needTotalItems || status.needBytes || status.receiveOnlyTotalItems) {
    return "warning";
  }
  if (status.state === "idle") {
    return "success";
  }
  return "muted";
}

function compareStatusLabel(entry: CompareEntry): string {
  if (entry.renameCandidate) {
    switch (compareRenameRole(entry)) {
      case "old":
        return "疑似移动/重命名（旧路径）";
      case "new":
        return "疑似移动/重命名（新路径）";
      default:
        return "疑似移动/重命名";
    }
  }

  switch (entry.status) {
    case "same":
      return "相同";
    case "only-local":
      return "仅本地存在";
    case "only-remote":
      return "仅远端存在";
    case "deleted-local":
      return "本地路径已删除";
    case "deleted-remote":
      return "远端路径已删除";
    case "modified":
      return "已修改";
    case "conflict":
      return "冲突";
    case "type-changed":
      return "类型变化";
    default:
      return entry.status;
  }
}

function compareRenameRole(entry: CompareEntry): "old" | "new" | "" {
  if (!entry.renameCandidate) {
    return "";
  }
  switch (entry.status) {
    case "deleted-remote":
    case "only-local":
      return "old";
    case "deleted-local":
    case "only-remote":
      return "new";
    default:
      return "";
  }
}

function pendingPublishLabel(entry: PendingPublishEntry): string {
  if (entry.settled) {
    return "已收敛待清理";
  }
  if (entry.renameCandidate) {
    switch (pendingRenameRole(entry)) {
      case "old":
        return "疑似移动/重命名（旧路径）";
      case "new":
        return "疑似移动/重命名（新路径）";
      default:
        return "疑似移动/重命名";
    }
  }
  switch (entry.action) {
    case "added":
      return "待发布新增";
    case "delete":
      return "待发布删除";
    default:
      return "待发布修改";
  }
}

function pendingRenameRole(entry: PendingPublishEntry): "old" | "new" | "" {
  if (!entry.renameCandidate) {
    return "";
  }
  switch (entry.action) {
    case "delete":
      return "old";
    case "added":
      return "new";
    default:
      return "";
  }
}

function remoteStateLabel(value?: string): string {
  switch (value) {
    case "idle":
      return "空闲";
    case "syncing":
      return "同步中";
    case "scanning":
      return "扫描中";
    case "paused":
      return "已暂停";
    case "notSharing":
      return "未共享";
    case "cleaning":
      return "清理中";
    default:
      return value || "未知";
  }
}

function aggregateSyncStatusLabel(summary: { total: number; needItems: number; remoteState?: string }): string {
  if (summary.remoteState === "syncing") {
    return `同步中 (${summary.total}%)`;
  }
  if (summary.remoteState === "scanning") {
    return `扫描中 (${summary.total}%)`;
  }
  if (summary.needItems > 0) {
    return `未同步 (${summary.total}%)`;
  }
  if (summary.total >= 100) {
    return "已同步";
  }
  return `${remoteStateLabel(summary.remoteState)} (${summary.total}%)`;
}

function yesNo(value?: boolean): string {
  return value ? "是" : "否";
}

function fileTypeLabel(value?: string): string {
  switch (value) {
    case "FILE_INFO_TYPE_FILE":
      return "文件";
    case "FILE_INFO_TYPE_DIRECTORY":
      return "目录";
    case "FILE_INFO_TYPE_SYMLINK":
      return "符号链接";
    case "FILE_INFO_TYPE_SYMLINK_FILE":
      return "文件链接";
    case "FILE_INFO_TYPE_SYMLINK_DIRECTORY":
      return "目录链接";
    default:
      return value || "-";
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "same":
      return "success";
    case "modified":
    case "type-changed":
      return "warning";
    case "conflict":
      return "danger";
    case "deleted-local":
    case "deleted-remote":
      return "muted";
    default:
      return "info";
  }
}

function compareSideTone(entry: CompareEntry, side: "local" | "remote"): "success" | "warning" | "danger" | "muted" | "info" {
  if (entry.renameCandidate) {
    return "info";
  }
  switch (entry.status) {
    case "only-remote":
      return side === "remote" ? "success" : "muted";
    case "only-local":
      return side === "local" ? "success" : "muted";
    case "deleted-remote":
      return side === "remote" ? "danger" : "muted";
    case "deleted-local":
      return side === "local" ? "danger" : "muted";
    case "modified":
    case "type-changed":
      return "warning";
    case "conflict":
      return "danger";
    case "same":
      return "success";
    default:
      return "info";
  }
}

function pendingPublishSideTone(
  entry: PendingPublishEntry,
  side: "local" | "global",
): "success" | "warning" | "danger" | "muted" | "info" {
  if (entry.settled) {
    return "muted";
  }
  if (entry.renameCandidate) {
    const role = pendingRenameRole(entry);
    if (role === "old") {
      return side === "local" ? "danger" : "muted";
    }
    if (role === "new") {
      return side === "local" ? "success" : "muted";
    }
    return "info";
  }
  switch (entry.action) {
    case "added":
      return side === "local" ? "success" : "muted";
    case "delete":
      return side === "local" ? "danger" : "muted";
    default:
      return "warning";
  }
}

function compareKind(entry: CompareEntry): string {
  if (entry.renameCandidate) {
    return compareRenameRole(entry) === "old" ? "rename-old" : compareRenameRole(entry) === "new" ? "rename-new" : "rename";
  }
  switch (entry.status) {
    case "only-remote":
      return "remote-add";
    case "only-local":
      return "local-add";
    case "deleted-remote":
      return "remote-delete";
    case "deleted-local":
      return "local-delete";
    case "modified":
    case "type-changed":
      return "modified";
    case "conflict":
      return "conflict";
    case "same":
      return "same";
    default:
      return "neutral";
  }
}

function filterReceiveEntriesForView(entries: CompareEntry[], view: string): CompareEntry[] {
  if (view !== "incoming") {
    return entries;
  }
  return entries.filter(
    (entry) =>
      entry.status !== "same" &&
      entry.status !== "only-local" &&
      entry.status !== "deleted-local",
  );
}

function compareRequestView(view: string): string {
  return view === "incoming" ? "different" : view;
}

function bidiffRequestView(view: string): string {
  return view === "all-with-same" ? "all" : view;
}

function bidiffStatusLabel(entry: BiDiffEntry): string {
  if (entry.renameCandidate) {
    return "疑似移动/重命名";
  }

  switch (entry.status) {
    case "same":
      return "相同";
    case "only-local":
      return "仅左侧存在";
    case "only-remote":
      return "仅右侧存在";
    case "deleted-local":
      return "左侧路径已删除";
    case "deleted-remote":
      return "右侧路径已删除";
    case "modified":
      return "已修改";
    case "conflict":
      return "冲突";
    case "type-changed":
      return "类型变化";
    default:
      return entry.status;
  }
}

function bidiffRenameRole(entry: BiDiffEntry): "old" | "new" | "" {
  if (!entry.renameCandidate) {
    return "";
  }
  switch (entry.status) {
    case "deleted-remote":
    case "only-local":
      return "new";
    case "deleted-local":
    case "only-remote":
      return "old";
    default:
      return "";
  }
}

function bidiffKind(entry: BiDiffEntry): string {
  if (entry.renameCandidate) {
    return bidiffRenameRole(entry) === "old" ? "rename-old" : bidiffRenameRole(entry) === "new" ? "rename-new" : "rename";
  }
  switch (entry.status) {
    case "only-remote":
      return "remote-add";
    case "only-local":
      return "local-add";
    case "deleted-remote":
      return "remote-delete";
    case "deleted-local":
      return "local-delete";
    case "modified":
    case "type-changed":
      return "modified";
    case "conflict":
      return "conflict";
    case "same":
      return "same";
    default:
      return "neutral";
  }
}

function bidiffSideTone(entry: BiDiffEntry, side: "left" | "right"): "success" | "warning" | "danger" | "muted" | "info" {
  if (entry.renameCandidate) {
    if (bidiffRenameRole(entry) === "old") {
      return side === "left" ? "warning" : "muted";
    }
    if (bidiffRenameRole(entry) === "new") {
      return side === "right" ? "success" : "muted";
    }
    return "info";
  }
  switch (entry.status) {
    case "only-remote":
      return side === "right" ? "success" : "muted";
    case "only-local":
      return side === "left" ? "success" : "muted";
    case "deleted-remote":
      return side === "right" ? "danger" : "muted";
    case "deleted-local":
      return side === "left" ? "danger" : "muted";
    case "modified":
    case "type-changed":
      return "warning";
    case "conflict":
      return "danger";
    case "same":
      return "success";
    default:
      return "info";
  }
}

function bidiffHasLiveFile(file?: BiDiffEntry["left"] | BiDiffEntry["right"]): boolean {
  return Boolean(file && !file.deleted);
}

function bidiffFilesLookEquivalent(left?: BiDiffEntry["left"], right?: BiDiffEntry["right"]): boolean {
  if (!left || !right) {
    return false;
  }
  return (
    left.deleted === right.deleted &&
    left.type === right.type &&
    left.size === right.size &&
    left.modified === right.modified
  );
}

function isGuiInertBiDiffEntry(entry: BiDiffEntry): boolean {
  if (bidiffHasLiveFile(entry.left) && bidiffHasLiveFile(entry.right) && bidiffFilesLookEquivalent(entry.left, entry.right)) {
    return true;
  }
  if (!bidiffHasLiveFile(entry.left) && !bidiffHasLiveFile(entry.right)) {
    return true;
  }
  return false;
}

function bidiffPresenceSummary(entry: BiDiffEntry): { label: string; className: string } {
  const leftLive = bidiffHasLiveFile(entry.left);
  const rightLive = bidiffHasLiveFile(entry.right);
  if (leftLive && !rightLive) {
    return { label: "左有 / 右无", className: "presence-left-only" };
  }
  if (!leftLive && rightLive) {
    return { label: "左无 / 右有", className: "presence-right-only" };
  }
  if (leftLive && rightLive) {
    return { label: "左右都有", className: "presence-both" };
  }
  return { label: "左右都无", className: "presence-none" };
}

function bidiffRelationIndicator(entry: BiDiffEntry): { symbol: string; className: string; title: string } {
  const renameRole = bidiffRenameRole(entry);
  if (entry.renameCandidate) {
    if (renameRole === "old") {
      return { symbol: "↷ 旧", className: "relation-rename-old", title: "疑似移动/重命名组中的旧路径" };
    }
    if (renameRole === "new") {
      return { symbol: "↷ 新", className: "relation-rename-new", title: "疑似移动/重命名组中的新路径" };
    }
    return { symbol: "↷", className: "relation-rename", title: "疑似移动/重命名" };
  }

  const presence = bidiffPresenceSummary(entry);
  switch (presence.className) {
    case "presence-left-only":
      return { symbol: "● | ○", className: "relation-left-only", title: "左侧存在，右侧不存在" };
    case "presence-right-only":
      return { symbol: "○ | ●", className: "relation-right-only", title: "左侧不存在，右侧存在" };
    case "presence-both":
      return { symbol: "● | ●", className: "relation-both", title: "左右两侧都存在" };
    default:
      return { symbol: "○ | ○", className: "relation-none", title: "左右两侧都不存在" };
  }
}

function bidiffActionabilityLabel(entry: BiDiffEntry): { label: string; className: string; title: string } {
  if (entry.canApplyLeftToRight && entry.canApplyRightToLeft) {
    return { label: "⇄", className: "action-both", title: "可双向裁决" };
  }
  if (entry.canApplyLeftToRight) {
    return { label: "←", className: "action-left", title: "当前仅可采用左侧" };
  }
  if (entry.canApplyRightToLeft) {
    return { label: "→", className: "action-right", title: "当前仅可采用右侧" };
  }
  return { label: "⛔", className: "action-blocked", title: "当前不可裁决" };
}

function bidiffRenameInlineText(entry: BiDiffEntry, baseLabel: string): string {
  if (!entry.renameCandidate) {
    return baseLabel;
  }
  const role = bidiffRenameRole(entry);
  if (role === "new") {
    return `${baseLabel}（旧：${entry.renameCandidate}）`;
  }
  if (role === "old") {
    return `${baseLabel}（新：${entry.renameCandidate}）`;
  }
  return `${baseLabel}（${entry.renameCandidate}）`;
}

type BiDiffTaskStatus = "queued" | "submitted" | "processing" | "completed" | "failed";

type BiDiffTask = {
  key: string;
  folderId: string;
  deviceId: string;
  path: string;
  direction: "left-to-right" | "right-to-left";
  status: BiDiffTaskStatus;
  error?: string;
  updatedAt: number;
};

type BiDiffTreeNode = {
  key: string;
  name: string;
  fullPath: string;
  type: "dir" | "file";
  entry?: BiDiffEntry;
  children: BiDiffTreeNode[];
};

type BiDiffTreeRow =
  | {
      type: "dir";
      key: string;
      node: BiDiffTreeNode;
      depth: number;
      guides: boolean[];
      isLast: boolean;
      entries: BiDiffEntry[];
    }
  | {
      type: "file";
      key: string;
      node: BiDiffTreeNode;
      depth: number;
      guides: boolean[];
      isLast: boolean;
      entry: BiDiffEntry;
    };

type ReviewTreeNode<T extends { path: string }> = {
  key: string;
  name: string;
  fullPath: string;
  type: "dir" | "file";
  entry?: T;
  children: ReviewTreeNode<T>[];
};

type ReviewTreeRow<T extends { path: string }> =
  | {
      type: "dir";
      key: string;
      node: ReviewTreeNode<T>;
      depth: number;
      guides: boolean[];
      isLast: boolean;
      entries: T[];
    }
  | {
      type: "file";
      key: string;
      node: ReviewTreeNode<T>;
      depth: number;
      guides: boolean[];
      isLast: boolean;
      entry: T;
    };

function bidiffTaskKey(folderId: string, deviceId: string, direction: "left-to-right" | "right-to-left", path: string): string {
  return `${folderId}::${deviceId}::${direction}::${path}`;
}

function splitTreePath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function buildBiDiffTree(entries: BiDiffEntry[]): BiDiffTreeNode[] {
  const roots: BiDiffTreeNode[] = [];
  const directories = new Map<string, BiDiffTreeNode>();

  for (const entry of entries) {
    const parts = splitTreePath(entry.path);
    if (parts.length === 0) {
      continue;
    }
    let parentChildren = roots;
    let currentPath = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        parentChildren.push({
          key: `file:${entry.path}`,
          name: part,
          fullPath: entry.path,
          type: "file",
          entry,
          children: [],
        });
        continue;
      }
      let dir = directories.get(currentPath);
      if (!dir) {
        dir = {
          key: `dir:${currentPath}`,
          name: part,
          fullPath: currentPath,
          type: "dir",
          children: [],
        };
        directories.set(currentPath, dir);
        parentChildren.push(dir);
      }
      parentChildren = dir.children;
    }
  }

  const sortNodes = (nodes: BiDiffTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "zh-CN");
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(roots);
  return roots;
}

function collectBiDiffLeafEntries(node: BiDiffTreeNode): BiDiffEntry[] {
  if (node.type === "file" && node.entry) {
    return [node.entry];
  }
  const result: BiDiffEntry[] = [];
  for (const child of node.children) {
    result.push(...collectBiDiffLeafEntries(child));
  }
  return result;
}

function hasExpandedDirDescendant(node: BiDiffTreeNode, expanded: Record<string, boolean>): boolean {
  for (const child of node.children) {
    if (child.type === "dir") {
      if (expanded[child.key] !== false || hasExpandedDirDescendant(child, expanded)) {
        return true;
      }
    }
  }
  return false;
}

function flattenBiDiffTree(nodes: BiDiffTreeNode[], expanded: Record<string, boolean>, depth = 0, guides: boolean[] = []): BiDiffTreeRow[] {
  const rows: BiDiffTreeRow[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const isLast = index === nodes.length - 1;
    if (node.type === "dir") {
      rows.push({
        type: "dir",
        key: node.key,
        node,
        depth,
        guides,
        isLast,
        entries: collectBiDiffLeafEntries(node),
      });
      if (expanded[node.key] !== false) {
        rows.push(...flattenBiDiffTree(node.children, expanded, depth + 1, [...guides, !isLast]));
      }
    } else if (node.entry) {
      rows.push({
        type: "file",
        key: node.key,
        node,
        depth,
        guides,
        isLast,
        entry: node.entry,
      });
    }
  }
  return rows;
}

function buildReviewTree<T extends { path: string }>(entries: T[]): ReviewTreeNode<T>[] {
  const roots: ReviewTreeNode<T>[] = [];
  const directories = new Map<string, ReviewTreeNode<T>>();

  for (const entry of entries) {
    const parts = splitTreePath(entry.path);
    if (parts.length === 0) {
      continue;
    }
    let parentChildren = roots;
    let currentPath = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        parentChildren.push({
          key: `file:${entry.path}`,
          name: part,
          fullPath: entry.path,
          type: "file",
          entry,
          children: [],
        });
        continue;
      }
      let dir = directories.get(currentPath);
      if (!dir) {
        dir = {
          key: `dir:${currentPath}`,
          name: part,
          fullPath: currentPath,
          type: "dir",
          children: [],
        };
        directories.set(currentPath, dir);
        parentChildren.push(dir);
      }
      parentChildren = dir.children;
    }
  }

  const sortNodes = (nodes: ReviewTreeNode<T>[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "zh-CN");
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(roots);
  return roots;
}

function collectReviewLeafEntries<T extends { path: string }>(node: ReviewTreeNode<T>): T[] {
  if (node.type === "file" && node.entry) {
    return [node.entry];
  }
  const result: T[] = [];
  for (const child of node.children) {
    result.push(...collectReviewLeafEntries(child));
  }
  return result;
}

function hasExpandedReviewDirDescendant<T extends { path: string }>(node: ReviewTreeNode<T>, expanded: Record<string, boolean>): boolean {
  for (const child of node.children) {
    if (child.type === "dir") {
      if (expanded[child.key] !== false || hasExpandedReviewDirDescendant(child, expanded)) {
        return true;
      }
    }
  }
  return false;
}

function flattenReviewTree<T extends { path: string }>(
  nodes: ReviewTreeNode<T>[],
  expanded: Record<string, boolean>,
  depth = 0,
  guides: boolean[] = [],
): ReviewTreeRow<T>[] {
  const rows: ReviewTreeRow<T>[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const isLast = index === nodes.length - 1;
    if (node.type === "dir") {
      rows.push({
        type: "dir",
        key: node.key,
        node,
        depth,
        guides,
        isLast,
        entries: collectReviewLeafEntries(node),
      });
      if (expanded[node.key] !== false) {
        rows.push(...flattenReviewTree(node.children, expanded, depth + 1, [...guides, !isLast]));
      }
    } else if (node.entry) {
      rows.push({
        type: "file",
        key: node.key,
        node,
        depth,
        guides,
        isLast,
        entry: node.entry,
      });
    }
  }
  return rows;
}

function bidiffTaskLabel(status: BiDiffTaskStatus): string {
  switch (status) {
    case "queued":
      return "已选中";
    case "submitted":
      return "已提交";
    case "processing":
      return "处理中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function bidiffTaskTone(status: BiDiffTaskStatus): "success" | "warning" | "danger" | "muted" | "info" {
  switch (status) {
    case "queued":
      return "info";
    case "submitted":
    case "processing":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    default:
      return "muted";
  }
}

function bidiffTaskPercent(status: BiDiffTaskStatus): number {
  switch (status) {
    case "queued":
      return 18;
    case "submitted":
      return 42;
    case "processing":
      return 72;
    case "completed":
    case "failed":
      return 100;
    default:
      return 0;
  }
}

function completionPercent(value?: CompletionStatus): number {
  if (!value) {
    return 0;
  }
  const percent = Number(value.completion ?? 0);
  if (Number.isNaN(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, percent));
}

function connectionBadgeLabel(connected: boolean, remoteState?: string): string {
  if (!connected) {
    return "离线";
  }
  if (remoteState === "syncing") {
    return "同步中";
  }
  if (remoteState === "scanning") {
    return "扫描中";
  }
  if (remoteState === "paused") {
    return "已暂停";
  }
  return "已连接";
}

function connectionBadgeTone(connected: boolean, remoteState?: string): "success" | "warning" | "muted" {
  if (!connected) {
    return "muted";
  }
  if (remoteState === "syncing" || remoteState === "scanning") {
    return "warning";
  }
  return "success";
}

function formatRate(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return "0 B/s";
  }
  return `${formatBinary(bytesPerSecond)}/s`;
}

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type ColumnDef = {
  key: string;
  label: string;
  width: number;
  minWidth?: number;
  visible?: boolean;
};

type BiDiffDensity = "relaxed" | "normal" | "compact" | "tight";

type DeviceShareDraft = {
  selected: Record<string, boolean>;
  encryptionPasswords: Record<string, string>;
};

type FolderEditorTab = "general" | "sharing" | "versioning" | "ignores" | "advanced";
type DeviceEditorTab = "general" | "sharing" | "advanced";

type FolderVersioningSelector = "none" | "trashcan" | "simple" | "staggered" | "external";

function biDiffColumnsForDensity(density: BiDiffDensity, actionVisible = false): ColumnDef[] {
  const presets: Record<BiDiffDensity, Record<string, number>> = {
    relaxed: { checkbox: 52, leftSize: 104, leftTime: 118, action: 72, summary: 376, rightTime: 118, rightSize: 104 },
    normal: { checkbox: 48, leftSize: 90, leftTime: 100, action: 62, summary: 324, rightTime: 100, rightSize: 90 },
    compact: { checkbox: 44, leftSize: 82, leftTime: 92, action: 56, summary: 288, rightTime: 92, rightSize: 82 },
    tight: { checkbox: 42, leftSize: 74, leftTime: 84, action: 52, summary: 252, rightTime: 84, rightSize: 74 },
  };
  const preset = presets[density];
  return [
    { key: "checkbox", label: "", width: preset.checkbox, minWidth: 36 },
    { key: "leftSize", label: "左侧大小", width: preset.leftSize, minWidth: 64 },
    { key: "leftTime", label: "左侧时间", width: preset.leftTime, minWidth: 76 },
    { key: "action", label: "裁决", width: preset.action, minWidth: 48, visible: actionVisible },
    { key: "summary", label: "名称 / 路径", width: preset.summary, minWidth: 180 },
    { key: "rightTime", label: "右侧时间", width: preset.rightTime, minWidth: 76 },
    { key: "rightSize", label: "右侧大小", width: preset.rightSize, minWidth: 64 },
  ];
}

function beginColumnResize(
  clientX: number,
  columnIndex: number,
  columns: ColumnDef[],
  onColumnsChange: (columns: ColumnDef[]) => void,
) {
  const column = columns[columnIndex];
  if (!column) {
    return;
  }
  const startWidth = column.width;
  const handlePointerMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - clientX;
    const newWidth = Math.max(20, startWidth + delta);
    const newColumns = [...columns];
    newColumns[columnIndex] = { ...newColumns[columnIndex], width: newWidth };
    onColumnsChange(newColumns);
  };
  const handlePointerUp = () => {
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function ResizableTable(props: {
  columns: ColumnDef[];
  onColumnsChange: (columns: ColumnDef[]) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  wrapperRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const visibleColumns = props.columns.filter((col) => col.visible !== false);
  return (
    <div ref={props.wrapperRef} className={`compare-table-wrapper${props.className ? ` ${props.className}` : ""}`} style={props.style}>
      <table className="compare-table">
        <colgroup>
          {visibleColumns.map((col) => (
            <col key={col.key} style={{ width: col.width, minWidth: 0 }} />
          ))}
        </colgroup>
        {props.children}
      </table>
    </div>
  );
}

function renderResizableHeaders(
  columns: ColumnDef[],
  onColumnsChange: (columns: ColumnDef[]) => void,
  customLabels?: Partial<Record<string, ReactNode>>,
) {
  const visibleColumns = columns.filter((col) => col.visible !== false);
  return visibleColumns.map((col) => (
    <th key={col.key}>
      {customLabels?.[col.key] ?? col.label}
      {col.key !== "checkbox" && (
        <div
          className="resize-handle"
          onPointerDown={(e) => {
            e.preventDefault();
            const colIndex = columns.findIndex((c) => c.key === col.key);
            if (colIndex < 0) {
              return;
            }
            beginColumnResize(e.clientX, colIndex, columns, onColumnsChange);
          }}
        />
      )}
    </th>
  ));
}

function FileVersionCell(props: {
  file?:
    | CompareEntry["local"]
    | CompareEntry["remote"]
    | PendingPublishEntry["local"]
    | PendingPublishEntry["global"]
    | BiDiffEntry["left"]
    | BiDiffEntry["right"];
  missingLabel: string;
  tone?: "success" | "warning" | "danger" | "muted" | "info";
  dateMode?: "full" | "compact";
}) {
  if (!props.file) {
    return (
      <div className={`compare-side compare-side-missing${props.tone ? ` tone-${props.tone}` : ""}`}>
        <div className="compare-side-empty">{props.missingLabel}</div>
      </div>
    );
  }

  return (
    <div className={`compare-side${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="compare-side-primary">
        <span>{formatBinary(props.file.size)}</span>
        <span>{fileTypeLabel(props.file.type)}</span>
      </div>
      <div className="compare-side-secondary">
        <span>{formatDate(props.file.modified, props.dateMode ?? "full")}</span>
        <span>{props.file.deleted ? "路径已删除" : "存在"}</span>
      </div>
    </div>
  );
}

function BiDiffSizeCell(props: {
  file?:
    | CompareEntry["local"]
    | CompareEntry["remote"]
    | PendingPublishEntry["local"]
    | PendingPublishEntry["global"]
    | BiDiffEntry["left"]
    | BiDiffEntry["right"];
  missingLabel: string;
}) {
  if (!props.file) {
    return (
      <div className="compare-side-cell compare-side-cell-missing tone-muted">
        <span className="compare-side-cell-empty">{props.missingLabel}</span>
      </div>
    );
  }
  const tone = props.file.deleted ? "danger" : "success";
  return (
    <div className={`compare-side-cell tone-${tone}`}>
      <span className="compare-side-cell-value">{formatBinary(props.file.size)}</span>
    </div>
  );
}

function BiDiffTimeCell(props: {
  file?:
    | CompareEntry["local"]
    | CompareEntry["remote"]
    | PendingPublishEntry["local"]
    | PendingPublishEntry["global"]
    | BiDiffEntry["left"]
    | BiDiffEntry["right"];
  missingLabel: string;
  dateMode?: "full" | "compact";
}) {
  if (!props.file) {
    return (
      <div className="compare-side-cell compare-side-cell-missing tone-muted">
        <span className="compare-side-cell-empty">{props.missingLabel}</span>
      </div>
    );
  }
  const tone = props.file.deleted ? "danger" : "success";
  return (
    <div className={`compare-side-cell tone-${tone}`}>
      <span className="compare-side-cell-value">{formatDate(props.file.modified, props.dateMode ?? "compact")}</span>
    </div>
  );
}

function BiDiffPresenceCell(props: {
  file?: BiDiffEntry["left"] | BiDiffEntry["right"];
  missingLabel?: string;
  tone?: "success" | "warning" | "danger" | "muted" | "info";
}) {
  const state = !props.file ? "missing" : props.file.deleted ? "deleted" : "live";
  const label = !props.file ? props.missingLabel ?? "不存在" : props.file.deleted ? "路径已删除" : "存在";
  const symbol = state === "live" ? "●" : state === "deleted" ? "⊘" : "∅";
  return (
    <div
      className={`compare-side compare-side-state compare-side-state-${state}${props.tone ? ` tone-${props.tone}` : ""}`}
      title={label}
      aria-label={label}
    >
      <span className={`compare-side-state-symbol state-${state}`} aria-hidden="true">
        {symbol}
      </span>
    </div>
  );
}

function ProgressBar(props: { percent: number; tone?: "success" | "warning" | "danger" | "muted" | "info"; label?: string }) {
  const percent = Math.max(0, Math.min(100, props.percent));
  return (
    <div className="progress-block">
      {props.label && <div className="progress-label">{props.label}</div>}
      <div className="progress-track">
        <div className={`progress-fill${props.tone ? ` tone-${props.tone}` : ""}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-value">{percent.toFixed(0)}%</div>
    </div>
  );
}

function TreeCheckbox(props: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(props.indeterminate && !props.checked);
    }
  }, [props.checked, props.indeterminate]);

  return (
    <label
      className={`compare-checkbox-wrap${props.disabled ? " disabled" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        className="compare-checkbox compare-checkbox-native"
        checked={props.checked}
        disabled={props.disabled}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onChange={(event) => {
          event.stopPropagation();
          props.onChange(event.target.checked);
        }}
        title={props.disabled ? "当前条目不可选" : props.checked ? "取消选择" : "选择条目"}
      />
      <span className="compare-checkbox-hit" aria-hidden="true" />
    </label>
  );
}

function shouldIgnoreRowSelectionToggle(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("button, input, select, a, .resize-handle"));
}

function TreePrefix(props: { depth: number; guides: boolean[]; isLast: boolean }) {
  if (props.depth === 0) {
    return null;
  }
  return (
    <span className="tree-prefix" aria-hidden="true">
      {props.guides.map((hasGuide, index) => {
        const isBranch = index === props.guides.length - 1;
        return (
          <span
            key={`${index}-${hasGuide ? "1" : "0"}`}
            className={`tree-prefix-segment${hasGuide ? " has-guide" : ""}${isBranch ? " branch" : ""}${isBranch && props.isLast ? " is-last" : ""}`}
          />
        );
      })}
    </span>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(window.metadata?.authenticated));
  const [loginState, setLoginState] = useState({ username: "", password: "", error: "", busy: false });

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [version, setVersion] = useState<VersionResponse | null>(null);
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [connectionRates, setConnectionRates] = useState<Record<string, { inbps: number; outbps: number }>>({});
  const prevConnectionsRef = useRef<{ data: ConnectionsResponse; time: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressData>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, Record<string, number>>>({});
  const [completedUploads, setCompletedUploads] = useState<Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }>>([]);
  const [completedDownloads, setCompletedDownloads] = useState<Array<{ folder: string; item: string; action: string; size: number; at: number }>>([]);
  const downloadFileSizeCacheRef = useRef<Record<string, number>>({}); // folder/file -> bytesTotal
  const [uploadFileInfo, setUploadFileInfo] = useState<Record<string, { totalBlocks: number; size: number }>>({});
  const uploadFileInfoRef = useRef(uploadFileInfo);
  uploadFileInfoRef.current = uploadFileInfo;
  const downloadProgressRef = useRef(downloadProgress);
  downloadProgressRef.current = downloadProgress;
  const uploadProgressRef = useRef(uploadProgress);
  uploadProgressRef.current = uploadProgress;
  const prevUploadRef = useRef<Record<string, Record<string, number>>>({});
  const lastUploadSeenRef = useRef<Record<string, Record<string, number>>>({});
  const [folderStatuses, setFolderStatuses] = useState<Record<string, FolderStatus>>({});
  const [completions, setCompletions] = useState<Record<string, Record<string, CompletionStatus>>>({});
  const [deviceStats, setDeviceStats] = useState<Record<string, DeviceStatistics>>({});
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [uiMode, setUiMode] = useState<UiMode>(() => detectInitialUiMode());
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const mode = detectInitialUiMode();
    return mode === "desktop";
  });
  const [mainRefreshSeconds, setMainRefreshSeconds] = useState(readStoredSeconds(MAIN_REFRESH_KEY, 5));
  const [panelRefreshSeconds, setPanelRefreshSeconds] = useState(readStoredSeconds(PANEL_REFRESH_KEY, 3));
  const [bootBusy, setBootBusy] = useState(false);
  const [bootError, setBootError] = useState("");
  const [overviewMessage, setOverviewMessage] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [compareView, setCompareView] = useState("different");
  const [comparePrefix, setComparePrefix] = useState("");
  const [compareSelection, setCompareSelection] = useState<Record<string, boolean>>({});
  const [compareMessage, setCompareMessage] = useState("");

  const [bidiff, setBiDiff] = useState<BiDiffResult | null>(null);
  const [bidiffBusy, setBiDiffBusy] = useState(false);
  const [bidiffError, setBiDiffError] = useState("");
  const [bidiffView, setBiDiffView] = useState("different");
  const [bidiffPrefix, setBiDiffPrefix] = useState("");
  const [bidiffSelection, setBiDiffSelection] = useState<Record<string, boolean>>({});
  const [bidiffMessage, setBiDiffMessage] = useState("");
  const [bidiffTasks, setBiDiffTasks] = useState<Record<string, BiDiffTask>>({});
  const [bidiffAutoRefreshPaused, setBidiffAutoRefreshPaused] = useState(false);
  const [bidiffWorkbenchView, setBidiffWorkbenchView] = useState<"diff" | "transfer">("diff");

  const [peerDiff, setPeerDiff] = useState<BiDiffResult | null>(null);
  const [peerDiffBusy, setPeerDiffBusy] = useState(false);
  const [peerDiffError, setPeerDiffError] = useState("");
  const [peerDiffView, setPeerDiffView] = useState("different");
  const [peerDiffPrefix, setPeerDiffPrefix] = useState("");
  const [peerDiffSelection, setPeerDiffSelection] = useState<Record<string, boolean>>({});
  const [peerDiffMessage, setPeerDiffMessage] = useState("");
  const [peerDiffTasks, setPeerDiffTasks] = useState<Record<string, BiDiffTask>>({});
  const [peerDiffAutoRefreshPaused, setPeerDiffAutoRefreshPaused] = useState(false);
  const [peerWorkbenchView, setPeerWorkbenchView] = useState<"diff" | "transfer">("diff");

  const [publish, setPublish] = useState<PendingPublishResult | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishView, setPublishView] = useState("all");
  const [publishPrefix, setPublishPrefix] = useState("");
  const [publishSelection, setPublishSelection] = useState<Record<string, boolean>>({});
  const [publishMessage, setPublishMessage] = useState("");
  const [panelScanBusy, setPanelScanBusy] = useState<"" | "compare" | "bidiff" | "peerdiff" | "publish">("");

  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState<FolderConfig | null>(null);
  const [folderIgnoreText, setFolderIgnoreText] = useState("");
  const [folderIgnoreError, setFolderIgnoreError] = useState("");
  const [folderIgnoreBusy, setFolderIgnoreBusy] = useState(false);
  const [folderAddIgnores, setFolderAddIgnores] = useState(false);
  const [folderSaveBusy, setFolderSaveBusy] = useState(false);
  const [folderSaveMessage, setFolderSaveMessage] = useState("");
  const [newFolderBusy, setNewFolderBusy] = useState(false);

  const [deviceEditorId, setDeviceEditorId] = useState("");
  const [deviceDraft, setDeviceDraft] = useState<DeviceConfig | null>(null);
  const [deviceShareDraft, setDeviceShareDraft] = useState<DeviceShareDraft>({ selected: {}, encryptionPasswords: {} });
  const [deviceSaveBusy, setDeviceSaveBusy] = useState(false);
  const [deviceSaveMessage, setDeviceSaveMessage] = useState("");
  const [newDeviceBusy, setNewDeviceBusy] = useState(false);

  const [options, setOptions] = useState<OptionsConfig | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<OptionsConfig | null>(null);
  const [pendingFolders, setPendingFolders] = useState<PendingFoldersResponse>({});
  const [optionsSaveBusy, setOptionsSaveBusy] = useState(false);
  const [optionsSaveMessage, setOptionsSaveMessage] = useState("");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [bidiffModalOpen, setBiDiffModalOpen] = useState(false);
  const [peerDiffModalOpen, setPeerDiffModalOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [titleBarStats, setTitleBarStats] = useState<{ total: number; selected: number; leftToRight: number; rightToLeft: number; pending?: number; previewReady?: boolean } | null>(null);
  const [systemActionBusy, setSystemActionBusy] = useState<"" | "restart" | "shutdown">("");
  const [systemActionMessage, setSystemActionMessage] = useState("");

  const folders = config?.folders ?? [];
  const devicesById = useMemo(() => {
    const map = new Map<string, DeviceConfig>();
    for (const device of config?.devices ?? []) {
      map.set(device.deviceID, device);
    }
    return map;
  }, [config]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  const selectedFolderDevices = useMemo(() => {
    if (!selectedFolder) {
      return [];
    }
    return selectedFolder.devices
      .map((folderDevice) => devicesById.get(folderDevice.deviceID))
      .filter((device): device is DeviceConfig => Boolean(device) && device.deviceID !== system?.myID);
  }, [selectedFolder, devicesById, system?.myID]);

  const selectedDevice = useMemo(
    () => selectedFolderDevices.find((device) => device.deviceID === selectedDeviceId) ?? null,
    [selectedFolderDevices, selectedDeviceId],
  );

  const allDevices = config?.devices ?? [];
  const editingDevice = useMemo(
    () => allDevices.find((device) => device.deviceID === deviceEditorId) ?? null,
    [allDevices, deviceEditorId],
  );
  const editingExistingDevice = Boolean(editingDevice);
  const editingNewDevice = Boolean(deviceDraft && deviceEditorId === "__new__");
  const editingExistingFolder = Boolean(selectedFolder && folderDraft && folderDraft.id === selectedFolder.id);
  const editingNewFolder = Boolean(folderDraft && (!selectedFolder || folderDraft.id !== selectedFolder.id));

  const buildDeviceShareDraft = useCallback(
    (deviceID: string): DeviceShareDraft => {
      const selected: Record<string, boolean> = {};
      const encryptionPasswords: Record<string, string> = {};
      for (const folder of folders) {
        const folderDevice = (folder.devices ?? []).find((item) => item.deviceID === deviceID);
        if (folderDevice) {
          selected[folder.id] = true;
          encryptionPasswords[folder.id] = folderDevice.encryptionPassword ?? "";
        }
      }
      return { selected, encryptionPasswords };
    },
    [folders],
  );

  const syncDeviceFolderSharing = useCallback(
    async (deviceID: string, sharingDraft: DeviceShareDraft, untrusted: boolean) => {
      for (const folder of folders) {
        const current = cloneJSON(folder);
        const existingIndex = (current.devices ?? []).findIndex((item) => item.deviceID === deviceID);
        const shouldShare = Boolean(sharingDraft.selected[folder.id]);
        let changed = false;

        if (shouldShare) {
          const nextFolderDevice = {
            deviceID,
            ...(untrusted && sharingDraft.encryptionPasswords[folder.id]
              ? { encryptionPassword: sharingDraft.encryptionPasswords[folder.id] }
              : {}),
          };
          if (existingIndex === -1) {
            current.devices = [...(current.devices ?? []), nextFolderDevice];
            changed = true;
          } else {
            const existing = current.devices[existingIndex];
            const nextPassword = nextFolderDevice.encryptionPassword ?? "";
            const oldPassword = existing.encryptionPassword ?? "";
            if (oldPassword !== nextPassword) {
              current.devices = current.devices.map((item, index) =>
                index === existingIndex ? { ...item, encryptionPassword: nextPassword || undefined } : item,
              );
              changed = true;
            }
          }
        } else if (existingIndex !== -1) {
          current.devices = current.devices.filter((item) => item.deviceID !== deviceID);
          changed = true;
        }

        if (changed) {
          await putJSON(`/rest/config/folders/${encodeURIComponent(folder.id)}`, current);
        }
      }
    },
    [folders],
  );

  const loadBootstrap = useCallback(async () => {
    if (!authenticated) {
      return;
    }
    setBootBusy(true);
    setBootError("");
    try {
      const [nextConfig, nextSystem, nextVersion, nextConnections, nextDeviceStats, nextPendingFolders] = await Promise.all([
        getJSON<ConfigResponse>("/rest/config"),
        getJSON<SystemStatus>("/rest/system/status"),
        getJSON<VersionResponse>("/rest/system/version"),
        getJSON<ConnectionsResponse>("/rest/system/connections"),
        getJSON<Record<string, DeviceStatistics>>("/rest/stats/device"),
        getJSON<PendingFoldersResponse>("/rest/cluster/pending/folders"),
      ]);

      const statusEntries = await Promise.all(
        nextConfig.folders.map(async (folder) => {
          if (folder.paused) {
            return [folder.id, pausedFolderStatus()] as const;
          }
          try {
            const status = await getJSON<FolderStatus>(`/rest/db/status?folder=${encodeURIComponent(folder.id)}`);
            return [folder.id, status] as const;
          } catch (error) {
            if (isFolderPausedError(error)) {
              return [folder.id, pausedFolderStatus()] as const;
            }
            throw error;
          }
        }),
      );

      const completionPairs = await Promise.all(
        nextConfig.folders.flatMap((folder) =>
          folder.devices.map(async (folderDevice) => {
            if (folder.paused) {
              return [folderDevice.deviceID, folder.id, pausedCompletionStatus()] as const;
            }
            try {
              const completion = await getJSON<CompletionStatus>(
                `/rest/db/completion?device=${encodeURIComponent(folderDevice.deviceID)}&folder=${encodeURIComponent(folder.id)}`,
              );
              return [folderDevice.deviceID, folder.id, completion] as const;
            } catch (error) {
              if (isFolderPausedError(error)) {
                return [folderDevice.deviceID, folder.id, pausedCompletionStatus()] as const;
              }
              throw error;
            }
          }),
        ),
      );

      const nextStatuses = Object.fromEntries(statusEntries);
      const nextCompletions: Record<string, Record<string, CompletionStatus>> = {};
      for (const [deviceId, folderId, completion] of completionPairs) {
        if (!nextCompletions[deviceId]) {
          nextCompletions[deviceId] = {};
        }
        nextCompletions[deviceId][folderId] = completion;
      }

      setConfig(nextConfig);
      setSystem(nextSystem);
      setVersion(nextVersion);

      // Compute transfer rates from snapshot diff
      const now = Date.now();
      const prev = prevConnectionsRef.current;
      if (prev) {
        const td = (now - prev.time) / 1000;
        if (td > 0) {
          const rates: Record<string, { inbps: number; outbps: number }> = {};
          for (const [id, conn] of Object.entries(nextConnections.connections)) {
            const old = prev.data.connections[id];
            if (old && conn.connected && old.connected) {
              rates[id] = {
                inbps: Math.max(0, (conn.inBytesTotal - old.inBytesTotal) / td),
                outbps: Math.max(0, (conn.outBytesTotal - old.outBytesTotal) / td),
              };
            } else {
              rates[id] = { inbps: 0, outbps: 0 };
            }
          }
          setConnectionRates(rates);
        }
      }
      prevConnectionsRef.current = { data: nextConnections, time: now };

      setConnections(nextConnections);
      setDeviceStats(nextDeviceStats);
      setPendingFolders(nextPendingFolders);
      setFolderStatuses(nextStatuses);
      setCompletions(nextCompletions);

      const nextOptions = await getJSON<OptionsConfig>("/rest/config/options");
      setOptions(nextOptions);
      setOptionsDraft((previous) => previous ?? cloneJSON(nextOptions));

      if (!selectedFolderId && nextConfig.folders.length > 0) {
        setSelectedFolderId(nextConfig.folders[0].id);
      }
      if (selectedFolderId && !nextConfig.folders.some((folder) => folder.id === selectedFolderId)) {
        setSelectedFolderId(nextConfig.folders[0]?.id ?? "");
      }
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "加载主界面数据失败");
    } finally {
      setBootBusy(false);
    }
  }, [authenticated, selectedFolderId]);

  const loadCompare = useCallback(async () => {
    if (!selectedFolder || !selectedDeviceId) {
      setCompare(null);
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setCompare(null);
      setCompareError("当前文件夹已暂停，请先恢复后再进行接收审核。");
      return;
    }

    setCompareBusy(true);
    setCompareError("");
    try {
      const requestView = compareRequestView(compareView);
      const data = await getJSON<CompareResult>(
        `/rest/db/compare?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(requestView)}&prefix=${encodeURIComponent(comparePrefix)}&page=1&perpage=500`,
      );
      setCompare(data);
      setCompareSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path] && entry.canPrioritize) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "加载接收审核失败");
    } finally {
      setCompareBusy(false);
    }
  }, [comparePrefix, compareView, selectedDeviceId, selectedFolder]);

  const refreshCompare = useCallback(async (rescanLocal: boolean) => {
    if (!selectedFolder) {
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setCompare(null);
      setCompareError("当前文件夹已暂停，请先恢复后再进行接收审核。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("compare");
      try {
        await triggerFolderScan(selectedFolder.id);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadCompare();
  }, [loadCompare, selectedFolder]);

  const loadBiDiff = useCallback(async () => {
    if (!selectedFolder || !selectedDeviceId) {
      setBiDiff(null);
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setBiDiff(null);
      setBiDiffError("当前文件夹已暂停，请先恢复后再进行双向裁决。");
      return;
    }

    setBiDiffBusy(true);
    setBiDiffError("");
    try {
      const requestView = bidiffRequestView(bidiffView);
      const data = await getJSON<BiDiffResult>(
        `/rest/db/bidiff?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(requestView)}&prefix=${encodeURIComponent(bidiffPrefix)}&page=1&perpage=500`,
      );
      setBiDiff(data);
      setBiDiffSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path]) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setBiDiffError(error instanceof Error ? error.message : "加载双向差异裁决失败");
    } finally {
      setBiDiffBusy(false);
    }
  }, [bidiffPrefix, bidiffView, selectedDeviceId, selectedFolder]);

  const refreshBiDiff = useCallback(async (rescanLocal: boolean) => {
    if (!selectedFolder) {
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setBiDiff(null);
      setBiDiffError("当前文件夹已暂停，请先恢复后再进行双向裁决。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("bidiff");
      try {
        await triggerFolderScan(selectedFolder.id);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadBiDiff();
  }, [loadBiDiff, selectedFolder]);

  const loadPeerDiff = useCallback(async () => {
    if (!selectedFolder || !selectedDeviceId) {
      setPeerDiff(null);
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setPeerDiff(null);
      setPeerDiffError("当前文件夹已暂停，请先恢复后再查看对等差异。");
      return;
    }

    setPeerDiffBusy(true);
    setPeerDiffError("");
    try {
      const requestView = bidiffRequestView(peerDiffView);
      const data = await getJSON<BiDiffResult>(
        `/rest/db/peerdiff?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(requestView)}&prefix=${encodeURIComponent(peerDiffPrefix)}&page=1&perpage=500`,
      );
      setPeerDiff(data);
      setPeerDiffSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path]) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setPeerDiffError(error instanceof Error ? error.message : "加载对等差异工作台失败");
    } finally {
      setPeerDiffBusy(false);
    }
  }, [peerDiffPrefix, peerDiffView, selectedDeviceId, selectedFolder]);

  const refreshPeerDiff = useCallback(async (rescanLocal: boolean) => {
    if (!selectedFolder) {
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setPeerDiff(null);
      setPeerDiffError("当前文件夹已暂停，请先恢复后再查看对等差异。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("peerdiff");
      try {
        await triggerFolderScan(selectedFolder.id);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadPeerDiff();
  }, [loadPeerDiff, selectedFolder]);

  const loadPublish = useCallback(async () => {
    if (!selectedFolder) {
      setPublish(null);
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setPublish(null);
      setPublishError("当前文件夹已暂停，请先恢复后再进行发布审核。");
      return;
    }

    setPublishBusy(true);
    setPublishError("");
    try {
      const data = await getJSON<PendingPublishResult>(
        `/rest/db/pendingpublish?folder=${encodeURIComponent(selectedFolder.id)}&view=${encodeURIComponent(publishView)}&prefix=${encodeURIComponent(publishPrefix)}&page=1&perpage=500`,
      );
      setPublish(data);
      setPublishSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path] && (entry.canPublish || entry.canClear)) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "加载发布审核失败");
    } finally {
      setPublishBusy(false);
    }
  }, [publishPrefix, publishView, selectedFolder]);

  const refreshPublish = useCallback(async (rescanLocal: boolean) => {
    if (!selectedFolder) {
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setPublish(null);
      setPublishError("当前文件夹已暂停，请先恢复后再进行发布审核。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("publish");
      try {
        await triggerFolderScan(selectedFolder.id);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadPublish();
  }, [loadPublish, selectedFolder]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  // Poll for DownloadProgress and ItemFinished events
  const lastEventIdRef = useRef(0);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const since = lastEventIdRef.current;
        const url = `/rest/events?since=${since}&limit=50&timeout=0&events=DownloadProgress,RemoteDownloadProgress,ItemFinished`;
        const events = await getJSON<SyncthingEvent[]>(url);
        if (cancelled || !events || events.length === 0) return;
        let maxId = since;
        let progressChanged = false;
        let uploadChanged = false;
        let newProgress = downloadProgressRef.current;
        let newUpload = { ...uploadProgressRef.current };
        const prevUpload = prevUploadRef.current;
        const newLastSeen = { ...lastUploadSeenRef.current };
        const newCompletedDownloads: Array<{ folder: string; item: string; action: string; size: number; at: number }> = [];
        const newCompletedUploads: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }> = [];
        for (const ev of events) {
          if (ev.id > maxId) maxId = ev.id;
          if (ev.type === "DownloadProgress") {
            const data = ev.data as unknown as DownloadProgressData;
            newProgress = data;
            progressChanged = true;
            for (const [folder, files] of Object.entries(data)) {
              for (const [file, info] of Object.entries(files)) {
                if (info.bytesTotal > 0) {
                  downloadFileSizeCacheRef.current[`${folder}/${file}`] = info.bytesTotal;
                }
              }
            }
          } else if (ev.type === "RemoteDownloadProgress") {
            const data = ev.data as { device: string; folder: string; state: Record<string, number> };
            if (!newUpload[data.folder]) newUpload[data.folder] = {};
            if (!newLastSeen[data.folder]) newLastSeen[data.folder] = {};
            newLastSeen[data.folder][data.device] = Date.now();
            const folderState = newUpload[data.folder];
            const devicePrefix = `${data.device}/`;
            const prevEntries: Record<string, number> = {};
            for (const key of Object.keys(folderState)) {
              if (key.startsWith(devicePrefix)) {
                prevEntries[key] = folderState[key];
                delete folderState[key];
              }
            }
            for (const [file, blockCount] of Object.entries(data.state)) {
              const key = `${data.device}/${file}`;
              folderState[key] = blockCount;
              delete prevEntries[key];
            }
            for (const [key, blocks] of Object.entries(prevEntries)) {
              const slashIdx = key.indexOf("/");
              const file = slashIdx > 0 ? key.slice(slashIdx + 1) : key;
              newCompletedUploads.push({ folder: data.folder, device: data.device, file, blocks, size: 0, at: Date.now() });
            }
            uploadChanged = true;
          } else if (ev.type === "ItemFinished") {
            const data = ev.data as unknown as ItemFinishedData;
            if (!data.error) {
              const cacheKey = `${data.folder}/${data.item}`;
              const size = downloadFileSizeCacheRef.current[cacheKey] ?? 0;
              delete downloadFileSizeCacheRef.current[cacheKey];
              newCompletedDownloads.push({ folder: data.folder, item: data.item, action: data.action, size, at: new Date(ev.time).getTime() });
            }
          }
        }
        lastEventIdRef.current = maxId;
        if (progressChanged) {
          setDownloadProgress(newProgress);
        }
        if (uploadChanged) {
          prevUploadRef.current = newUpload;
          lastUploadSeenRef.current = newLastSeen;
          setUploadProgress(newUpload);
        }
        if (newCompletedUploads.length > 0) {
          setCompletedUploads((prev) => [...newCompletedUploads, ...prev].slice(0, 100));
        }
        if (newCompletedDownloads.length > 0) {
          setCompletedDownloads((prev) => [...newCompletedDownloads, ...prev].slice(0, 200));
        }
      } catch {
        // ignore polling errors
      }
    };
    const handle = window.setInterval(poll, 2000);
    poll();
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [authenticated]);

  // Detect stale uploads per device per folder (events stopped coming)
  useEffect(() => {
    if (!authenticated) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const current = uploadProgressRef.current;
      const lastSeen = lastUploadSeenRef.current;
      const prev = prevUploadRef.current;
      const newCompleted: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }> = [];
      for (const [folder, files] of Object.entries(current)) {
        for (const [key, blocks] of Object.entries(files)) {
          const slashIdx = key.indexOf("/");
          const device = slashIdx > 0 ? key.slice(0, slashIdx) : "";
          const file = slashIdx > 0 ? key.slice(slashIdx + 1) : key;
          const lastDeviceSeen = lastSeen[folder]?.[device] ?? 0;
          if (now - lastDeviceSeen > 10000) {
            newCompleted.push({ folder, device, file, blocks, size: 0, at: now });
            delete current[folder][key];
          }
        }
        if (current[folder] && Object.keys(current[folder]).length === 0) {
          delete current[folder];
        }
      }
      if (newCompleted.length > 0) {
        prevUploadRef.current = { ...current };
        lastUploadSeenRef.current = { ...lastSeen };
        setUploadProgress({ ...current });
        setCompletedUploads((prev) => [...newCompleted, ...prev].slice(0, 100));
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [authenticated]);

  // Poll file info (total blocks, size) for currently uploading files
  useEffect(() => {
    if (!authenticated) return;
    const up = uploadProgress;
    const entries: Array<{ folder: string; file: string; key: string }> = [];
    for (const [folder, files] of Object.entries(up)) {
      for (const key of Object.keys(files)) {
        if (!uploadFileInfoRef.current[key]) {
          const slashIdx = key.indexOf("/");
          const file = slashIdx > 0 ? key.slice(slashIdx + 1) : key;
          entries.push({ folder, file, key });
        }
      }
    }
    if (entries.length === 0) return;
    let cancelled = false;
    (async () => {
      const newInfo: Record<string, { totalBlocks: number; size: number }> = {};
      for (const { folder, file, key } of entries) {
        if (cancelled) return;
        try {
          const info = await getJSON<{ global?: { size: number; numBlocks?: number }; local?: { size: number; numBlocks?: number } }>(`/rest/db/file?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`);
          if (cancelled) return;
          const fi = info?.global ?? info?.local;
          if (fi && typeof fi.size === "number") {
            newInfo[key] = { totalBlocks: fi.numBlocks ?? 0, size: fi.size };
          }
        } catch {
          // ignore
        }
      }
      if (!cancelled && Object.keys(newInfo).length > 0) {
        setUploadFileInfo((prev) => ({ ...prev, ...newInfo }));
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, uploadProgress]);

  useEffect(() => {
    if (!config || selectedFolderId) {
      return;
    }
    if (config.folders.length > 0) {
      setSelectedFolderId(config.folders[0].id);
    }
  }, [config, selectedFolderId]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }
    if (selectedFolderDevices.length === 0) {
      setSelectedDeviceId("");
      return;
    }
    const stillValid = selectedFolderDevices.some((device) => device.deviceID === selectedDeviceId);
    if (!stillValid) {
      setSelectedDeviceId(selectedFolderDevices[0].deviceID);
    }
  }, [selectedDeviceId, selectedFolder, selectedFolderDevices]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }
    if (viewMode === "receive" && !canReceive(selectedFolder)) {
      setViewMode(canPublish(selectedFolder) ? "publish" : "overview");
      return;
    }
    if (viewMode === "publish" && !canPublish(selectedFolder)) {
      setViewMode(canReceive(selectedFolder) ? "receive" : "overview");
    }
  }, [selectedFolder, viewMode]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    const handle = window.setInterval(() => {
      void loadBootstrap();
    }, mainRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [authenticated, loadBootstrap, mainRefreshSeconds]);

  useEffect(() => {
    if (!receiveModalOpen || !selectedFolder || !selectedDeviceId) {
      return;
    }
    void refreshCompare(true);
    const handle = window.setInterval(() => {
      void refreshCompare(!selectedFolder.fsWatcherEnabled);
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [panelRefreshSeconds, receiveModalOpen, refreshCompare, selectedDeviceId, selectedFolder]);

  useEffect(() => {
    if (!bidiffModalOpen || !selectedFolder || !selectedDeviceId) {
      return;
    }
    void refreshBiDiff(true);
    if (bidiffAutoRefreshPaused) {
      return;
    }
    const handle = window.setInterval(() => {
      void refreshBiDiff(!selectedFolder.fsWatcherEnabled);
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [bidiffAutoRefreshPaused, bidiffModalOpen, panelRefreshSeconds, refreshBiDiff, selectedDeviceId, selectedFolder]);

  useEffect(() => {
    if (!peerDiffModalOpen || !selectedFolder || !selectedDeviceId) {
      return;
    }
    void refreshPeerDiff(true);
    if (peerDiffAutoRefreshPaused) {
      return;
    }
    const handle = window.setInterval(() => {
      void refreshPeerDiff(!selectedFolder.fsWatcherEnabled);
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [panelRefreshSeconds, peerDiffAutoRefreshPaused, peerDiffModalOpen, refreshPeerDiff, selectedDeviceId, selectedFolder]);

  useEffect(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    setBiDiffTasks((previous) => {
      const next = { ...previous };
      const entryMap = new Map((bidiff?.entries ?? []).map((entry) => [entry.path, entry]));
      let changed = false;
      for (const [key, task] of Object.entries(previous)) {
        if (task.folderId !== selectedFolder.id || task.deviceId !== selectedDeviceId) {
          continue;
        }
        if (task.status === "failed" || task.status === "completed") {
          continue;
        }
        const entry = entryMap.get(task.path);
        const stillActionable =
          task.direction === "left-to-right" ? entry?.canApplyLeftToRight : entry?.canApplyRightToLeft;
        let nextStatus = task.status;
        if (!entry || !stillActionable) {
          nextStatus = "completed";
        } else if (
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "syncing" ||
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "scanning" ||
          bidiffBusy
        ) {
          nextStatus = "processing";
        } else if (task.status === "queued") {
          nextStatus = "submitted";
        }
        if (nextStatus !== task.status) {
          next[key] = { ...task, status: nextStatus, updatedAt: Date.now() };
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [bidiff, bidiffBusy, completions, selectedDeviceId, selectedFolder]);

  useEffect(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    setPeerDiffTasks((previous) => {
      const next = { ...previous };
      const entryMap = new Map((peerDiff?.entries ?? []).map((entry) => [entry.path, entry]));
      const resultMap = new Map(
        (peerDiff?.peerApplyResults ?? []).map((result) => [`${result.direction}::${result.path}`, result]),
      );
      let changed = false;
      for (const [key, task] of Object.entries(previous)) {
        if (task.folderId !== selectedFolder.id || task.deviceId !== selectedDeviceId) {
          continue;
        }
        if (task.status === "failed" || task.status === "completed") {
          continue;
        }
        const result = resultMap.get(`${task.direction}::${task.path}`);
        if (result) {
          const nextStatus = result.status === "failed" ? "failed" : "completed";
          next[key] = {
            ...task,
            status: nextStatus,
            error: result.status === "failed" ? result.message || "远端显式应用失败" : undefined,
            updatedAt: Date.now(),
          };
          changed = true;
          continue;
        }
        const entry = entryMap.get(task.path);
        const stillActionable =
          task.direction === "left-to-right" ? entry?.canApplyLeftToRight : entry?.canApplyRightToLeft;
        let nextStatus = task.status;
        if (!entry || !stillActionable) {
          nextStatus = "completed";
        } else if (
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "syncing" ||
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "scanning" ||
          peerDiffBusy
        ) {
          nextStatus = "processing";
        } else if (task.status === "queued") {
          nextStatus = "submitted";
        }
        if (nextStatus !== task.status) {
          next[key] = { ...task, status: nextStatus, updatedAt: Date.now() };
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [completions, peerDiff, peerDiffBusy, selectedDeviceId, selectedFolder]);

  useEffect(() => {
    if (!publishModalOpen || !selectedFolder) {
      return;
    }
    void refreshPublish(true);
    const handle = window.setInterval(() => {
      void refreshPublish(!selectedFolder.fsWatcherEnabled);
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [panelRefreshSeconds, publishModalOpen, refreshPublish, selectedFolder]);

  const discoverySummary = useMemo(() => {
    const discovery = system?.discoveryStatus ?? {};
    const entries = Object.entries(discovery);
    const failed = entries.filter(([, value]) => value?.error).length;
    return {
      total: entries.length,
      failed,
      running: entries.length - failed,
    };
  }, [system]);

  const listenerSummary = useMemo(() => {
    const listeners = system?.connectionServiceStatus ?? {};
    const entries = Object.entries(listeners);
    const failed = entries.filter(([, value]) => value?.error).length;
    return {
      total: entries.length,
      failed,
      running: entries.length - failed,
    };
  }, [system]);

  const compareVisibleEntries = useMemo(
    () => (compare?.entries ?? []).filter((entry) => entry.canPrioritize),
    [compare],
  );

  const bidiffVisibleLeftToRightEntries = useMemo(
    () => (bidiff?.entries ?? []).filter((entry) => entry.canApplyLeftToRight),
    [bidiff],
  );

  const bidiffVisibleRightToLeftEntries = useMemo(
    () => (bidiff?.entries ?? []).filter((entry) => entry.canApplyRightToLeft),
    [bidiff],
  );

  const activeBiDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(bidiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .filter((task) => task.status !== "completed")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bidiffTasks, selectedDeviceId, selectedFolder]);

  const allBiDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(bidiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bidiffTasks, selectedDeviceId, selectedFolder]);

  const activePeerDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(peerDiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .filter((task) => task.status !== "completed")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [peerDiffTasks, selectedDeviceId, selectedFolder]);

  const allPeerDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(peerDiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [peerDiffTasks, selectedDeviceId, selectedFolder]);

  const publishVisibleEntries = useMemo(
    () => (publish?.entries ?? []).filter((entry) => entry.canPublish),
    [publish],
  );
  const publishClearableEntries = useMemo(
    () => (publish?.entries ?? []).filter((entry) => entry.canClear),
    [publish],
  );

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginState((previous) => ({ ...previous, busy: true, error: "" }));
    try {
      await login(loginState.username, loginState.password);
      window.location.reload();
    } catch (error) {
      setLoginState((previous) => ({
        ...previous,
        busy: false,
        error: error instanceof Error ? error.message : "登录失败",
      }));
    }
  };

  const handleLogout = async () => {
    if (!window.confirm("这只会登出 Web GUI，不会停止 Syncthing 后台同步服务。")) {
      return;
    }
    await logout();
    setAuthenticated(false);
    setConfig(null);
    window.location.reload();
  };

  const applyRefreshSettings = (nextMain: number, nextPanel: number) => {
    setMainRefreshSeconds(nextMain);
    setPanelRefreshSeconds(nextPanel);
    storeSeconds(MAIN_REFRESH_KEY, nextMain);
    storeSeconds(PANEL_REFRESH_KEY, nextPanel);
  };

  const syncEntries = async (entries: CompareEntry[]) => {
    if (!selectedFolder || !compare) {
      return;
    }
    setCompareMessage(compare.manualSync ? "正在提交同步请求..." : "正在提交优先处理请求...");
    try {
      await Promise.all(
        entries.map((entry) =>
          postJSON(`/rest/db/prio?folder=${encodeURIComponent(selectedFolder.id)}&file=${encodeURIComponent(entry.path)}`),
        ),
      );
      if (compare.manualSync) {
        await postJSON(`/rest/db/pullselected?folder=${encodeURIComponent(selectedFolder.id)}`, {
          files: entries.map((entry) => entry.path),
        });
      }
      setCompareMessage(compare.manualSync ? "已提交同步请求。" : "已提交优先处理请求。");
      await Promise.all([refreshCompare(true), loadBootstrap()]);
    } catch (error) {
      setCompareMessage(error instanceof Error ? error.message : "提交请求失败");
    }
  };

  const applyBiDiffEntries = async (direction: "left-to-right" | "right-to-left", entries: BiDiffEntry[]) => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    if (entries.length === 0) {
      setBiDiffMessage("当前没有可执行的已选条目。");
      return;
    }
    const directionLabel = direction === "left-to-right" ? "采用左侧到右侧" : "采用右侧到左侧";
    const summary = entries.length === 1 ? `\n\n${entries[0].path}` : `\n\n共 ${entries.length} 项`;
    if (!window.confirm(`确认执行“${directionLabel}”？${summary}`)) {
      return;
    }
    const now = Date.now();
    setBiDiffTasks((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
        next[key] = {
          key,
          folderId: selectedFolder.id,
          deviceId: selectedDeviceId,
          path: entry.path,
          direction,
          status: "submitted",
          updatedAt: now,
        };
      }
      return next;
    });
    setBiDiffMessage(direction === "left-to-right" ? "正在采用左侧状态..." : "正在采用右侧状态...");
    try {
      await postJSON(
        `/rest/db/bidiffapply?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}`,
        {
          direction,
          files: entries.map((entry) => entry.path),
        },
      );
      setBiDiffMessage(direction === "left-to-right" ? "已提交左侧到右侧的裁决动作。" : "已提交右侧到左侧的裁决动作。");
      setBiDiffSelection({});
      await Promise.all([refreshBiDiff(true), loadBootstrap(), refreshCompare(true), refreshPublish(true)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "双向裁决提交失败";
      setBiDiffTasks((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
          const current = next[key];
          if (!current) {
            continue;
          }
          next[key] = { ...current, status: "failed", error: message, updatedAt: Date.now() };
        }
        return next;
      });
      setBiDiffMessage(message);
    }
  };

  const applyPeerDiffEntries = async (direction: "left-to-right" | "right-to-left", entries: BiDiffEntry[]) => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    if (entries.length === 0) {
      setPeerDiffMessage("当前没有可执行的已选条目。");
      return;
    }
    const directionLabel = direction === "left-to-right" ? "采用左侧到右侧" : "采用右侧到左侧";
    const summary = entries.length === 1 ? `\n\n${entries[0].path}` : `\n\n共 ${entries.length} 项`;
    if (!window.confirm(`确认执行“${directionLabel}”？${summary}`)) {
      return;
    }
    const now = Date.now();
    setPeerDiffTasks((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
        next[key] = {
          key,
          folderId: selectedFolder.id,
          deviceId: selectedDeviceId,
          path: entry.path,
          direction,
          status: "submitted",
          updatedAt: now,
        };
      }
      return next;
    });
    setPeerDiffMessage(direction === "left-to-right" ? "正在将左侧状态应用到右侧..." : "正在将右侧状态应用到左侧...");
    try {
      await postJSON(
        `/rest/db/peerdiffapply?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}`,
        {
          direction,
          files: entries.map((entry) => entry.path),
        },
      );
      setPeerDiffMessage(direction === "left-to-right" ? "已提交左侧到右侧的对等裁决动作。" : "已提交右侧到左侧的对等裁决动作。");
      setPeerDiffSelection({});
      await Promise.all([refreshPeerDiff(true), loadBootstrap(), refreshCompare(true), refreshPublish(true)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "对等差异裁决提交失败";
      setPeerDiffTasks((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
          const current = next[key];
          if (!current) {
            continue;
          }
          next[key] = { ...current, status: "failed", error: message, updatedAt: Date.now() };
        }
        return next;
      });
      setPeerDiffMessage(message);
    }
  };

  const publishEntries = async (entries: PendingPublishEntry[]) => {
    if (!selectedFolder) {
      return;
    }
    setPublishMessage("正在提交发布请求...");
    try {
      await postJSON(`/rest/db/publishselected?folder=${encodeURIComponent(selectedFolder.id)}`, {
        files: entries.map((entry) => entry.path),
      });
      setPublishMessage("已提交发布请求。远端会按自己的接收策略处理。");
      await Promise.all([refreshPublish(true), loadBootstrap()]);
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "发布请求失败");
    }
  };

  const clearSettledPublishEntries = async (entries: PendingPublishEntry[]) => {
    if (!selectedFolder) {
      return;
    }
    if (entries.length === 0) {
      setPublishMessage("当前没有可清理的已收敛待发布项。");
      return;
    }
    setPublishMessage("正在清理已收敛待发布标记...");
    try {
      await postJSON(`/rest/db/clearpendingpublish?folder=${encodeURIComponent(selectedFolder.id)}`, {
        files: entries.map((entry) => entry.path),
      });
      setPublishMessage(`已清理 ${entries.length} 项已收敛待发布标记。`);
      setPublishSelection((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          delete next[entry.path];
        }
        return next;
      });
      await Promise.all([refreshPublish(true), loadBootstrap()]);
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "清理已收敛待发布标记失败");
    }
  };

  const loadFolderIgnores = async (folderId: string) => {
    setFolderIgnoreBusy(true);
    setFolderIgnoreError("");
    try {
      const response = await getJSON<IgnoreResponse>(`/rest/db/ignores?folder=${encodeURIComponent(folderId)}`);
      setFolderIgnoreText((response.ignore ?? []).join("\n"));
      setFolderIgnoreError(response.error ?? "");
    } catch (error) {
      setFolderIgnoreText("");
      setFolderIgnoreError(error instanceof Error ? error.message : "加载忽略模式失败");
    } finally {
      setFolderIgnoreBusy(false);
    }
  };

  const openFolderEditor = () => {
    if (!selectedFolder) {
      return;
    }
    setFolderDraft(prepareFolderDraft(selectedFolder));
    setFolderIgnoreText("");
    setFolderAddIgnores(false);
    void loadFolderIgnores(selectedFolder.id);
    setFolderSaveMessage("");
    setFolderEditorOpen(true);
  };

  const closeFolderEditor = () => {
    setFolderEditorOpen(false);
    setFolderDraft(null);
    setFolderIgnoreText("");
    setFolderIgnoreError("");
    setFolderIgnoreBusy(false);
    setFolderAddIgnores(false);
    setFolderSaveMessage("");
  };

  const openDeviceEditor = (device: DeviceConfig) => {
    setDeviceEditorId(device.deviceID);
    setDeviceDraft(cloneJSON(device));
    setDeviceShareDraft(buildDeviceShareDraft(device.deviceID));
    setDeviceSaveMessage("");
  };

  const closeDeviceEditor = () => {
    setDeviceEditorId("");
    setDeviceDraft(null);
    setDeviceShareDraft({ selected: {}, encryptionPasswords: {} });
    setDeviceSaveMessage("");
  };

  const toggleFolderPaused = async (folder: FolderConfig) => {
    const next = prepareFolderDraft(folder);
    next.paused = !folder.paused;
    try {
      await putJSON(`/rest/config/folders/${encodeURIComponent(folder.id)}`, buildFolderPayload(next));
      setOverviewMessage(next.paused ? `已暂停文件夹“${folderLabel(folder)}”。` : `已恢复文件夹“${folderLabel(folder)}”。`);
      await loadBootstrap();
    } catch (error) {
      setOverviewMessage(error instanceof Error ? error.message : "切换文件夹暂停状态失败");
    }
  };

  const saveFolderDraft = async () => {
    if (!selectedFolder || !folderDraft) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      const payload = buildFolderPayload(folderDraft);
      await putJSON(`/rest/config/folders/${encodeURIComponent(selectedFolder.id)}`, payload);
      await postJSON(`/rest/db/ignores?folder=${encodeURIComponent(selectedFolder.id)}`, {
        ignore: normalizeIgnoreText(folderIgnoreText).split("\n"),
      });
      setFolderSaveMessage("文件夹设置已保存。");
      await loadBootstrap();
      closeFolderEditor();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "保存文件夹设置失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const deleteCurrentFolder = async () => {
    if (!selectedFolder || !window.confirm(`确认删除文件夹“${folderLabel(selectedFolder)}”的配置吗？`)) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      await deleteJSON(`/rest/config/folders/${encodeURIComponent(selectedFolder.id)}`);
      closeFolderEditor();
      await loadBootstrap();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "删除文件夹配置失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const saveDeviceDraft = async () => {
    if (!editingDevice || !deviceDraft) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      const payload = cloneJSON(deviceDraft);
      payload.addresses = (payload.addresses ?? []).filter((value) => value.trim().length > 0);
      payload.allowedNetworks = (payload.allowedNetworks ?? []).filter((value) => value.trim().length > 0);
      await putJSON(`/rest/config/devices/${encodeURIComponent(editingDevice.deviceID)}`, payload);
      await syncDeviceFolderSharing(editingDevice.deviceID, deviceShareDraft, Boolean(payload.untrusted));
      setDeviceSaveMessage("设备设置已保存。");
      await loadBootstrap();
      closeDeviceEditor();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "保存设备设置失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const deleteCurrentDevice = async () => {
    if (!editingDevice || !window.confirm(`确认删除设备“${deviceName(editingDevice)}”的配置吗？`)) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      await deleteJSON(`/rest/config/devices/${encodeURIComponent(editingDevice.deviceID)}`);
      closeDeviceEditor();
      await loadBootstrap();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "删除设备配置失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const createFolder = async () => {
    setNewFolderBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<FolderConfig>("/rest/config/defaults/folder");
      const nextFolder: FolderConfig = prepareFolderDraft({
        ...cloneJSON(defaults),
        id: `folder-${Date.now()}`,
        label: "新文件夹",
        path: "",
        devices: [],
        type: "sendreceive",
      });
      setFolderDraft(nextFolder);
      setFolderIgnoreText("");
      setFolderIgnoreError("");
      setFolderAddIgnores(false);
      setFolderEditorOpen(true);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开新文件夹表单失败");
    } finally {
      setNewFolderBusy(false);
    }
  };

  const createDevice = async () => {
    setNewDeviceBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<DeviceConfig>("/rest/config/defaults/device");
      const nextDevice: DeviceConfig = {
        ...cloneJSON(defaults),
        deviceID: "",
        name: "新设备",
        addresses: defaults.addresses?.length ? defaults.addresses : ["dynamic"],
      };
      setDeviceEditorId("__new__");
      setDeviceDraft(nextDevice);
      setDeviceShareDraft({ selected: {}, encryptionPasswords: {} });
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开新设备表单失败");
    } finally {
      setNewDeviceBusy(false);
    }
  };

  const saveNewFolder = async () => {
    if (!folderDraft) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      const payload = buildFolderPayload(folderDraft);
      await postJSON("/rest/config/folders", payload);
      if (folderAddIgnores && normalizeIgnoreText(folderIgnoreText).trim().length > 0) {
        await postJSON(`/rest/db/ignores?folder=${encodeURIComponent(payload.id)}`, {
          ignore: normalizeIgnoreText(folderIgnoreText).split("\n"),
        });
      }
      await loadBootstrap();
      setSelectedFolderId(payload.id);
      closeFolderEditor();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "创建文件夹失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const saveNewDevice = async () => {
    if (!deviceDraft) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      const payload = cloneJSON(deviceDraft);
      payload.addresses = (payload.addresses ?? []).filter((value) => value.trim().length > 0);
      payload.allowedNetworks = (payload.allowedNetworks ?? []).filter((value) => value.trim().length > 0);
      await postJSON("/rest/config/devices", payload);
      await syncDeviceFolderSharing(payload.deviceID, deviceShareDraft, Boolean(payload.untrusted));
      await loadBootstrap();
      closeDeviceEditor();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "创建设备失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const acceptPendingFolder = async (folderId: string, deviceId: string) => {
    setNewFolderBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<FolderConfig>("/rest/config/defaults/folder");
      const pending = pendingFolders[folderId];
      const offeredBy = pending?.offeredBy?.[deviceId];
      const nextFolder = prepareFolderDraft({
        ...cloneJSON(defaults),
        id: folderId,
        label: offeredBy?.label || folderId,
        path: "",
        devices: [{ deviceID: deviceId }],
        type: offeredBy?.receiveEncrypted ? "receiveencrypted" : "sendreceive",
      });
      setFolderDraft(nextFolder);
      setFolderIgnoreText("");
      setFolderIgnoreError("");
      setFolderAddIgnores(false);
      setFolderSaveMessage("");
      setFolderEditorOpen(true);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开待接受文件夹表单失败");
    } finally {
      setNewFolderBusy(false);
    }
  };

  const dismissPendingFolder = async (folderId: string, deviceId?: string) => {
    try {
      const query = new URLSearchParams({ folder: folderId });
      if (deviceId) {
        query.set("device", deviceId);
      }
      await deleteJSON(`/rest/cluster/pending/folders?${query.toString()}`);
      await loadBootstrap();
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "忽略待接受文件夹失败");
    }
  };

  const saveOptionsDraft = async () => {
    if (!optionsDraft) {
      return;
    }
    setOptionsSaveBusy(true);
    setOptionsSaveMessage("");
    try {
      const payload = cloneJSON(optionsDraft);
      payload.alwaysLocalNets = (payload.alwaysLocalNets ?? []).filter((value) => value.trim().length > 0);
      await putJSON("/rest/config/options", payload);
      setOptions(payload);
      setOptionsSaveMessage("全局设置已保存。");
      await loadBootstrap();
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "保存全局设置失败");
    } finally {
      setOptionsSaveBusy(false);
    }
  };

  const rescanFolder = async (folder: FolderConfig) => {
    setOverviewMessage(`正在请求重新扫描“${folderLabel(folder)}”...`);
    try {
      await postJSON(`/rest/db/scan?folder=${encodeURIComponent(folder.id)}`);
      setOverviewMessage(`已提交“${folderLabel(folder)}”的重新扫描请求。`);
      await loadBootstrap();
    } catch (error) {
      setOverviewMessage(error instanceof Error ? error.message : "提交重新扫描失败");
    }
  };

  const restartSyncthing = async () => {
    if (!window.confirm("确认重启 Syncthing 后端进程吗？当前同步会短暂中断。")) {
      return;
    }
    setSystemActionBusy("restart");
    setSystemActionMessage("");
    try {
      await triggerSystemAction("restart");
      setSystemActionMessage("已提交重启请求，Syncthing 正在重启。页面稍后会失去连接。");
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "提交重启请求失败");
    } finally {
      setSystemActionBusy("");
    }
  };

  const shutdownSyncthing = async () => {
    if (!window.confirm("确认完全关闭 Syncthing 后端程序吗？关闭后同步会停止，直到你重新启动程序。")) {
      return;
    }
    setSystemActionBusy("shutdown");
    setSystemActionMessage("");
    try {
      await triggerSystemAction("shutdown");
      setSystemActionMessage("已提交关闭请求，Syncthing 后端正在退出。页面很快会失去连接。");
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "提交关闭请求失败");
    } finally {
      setSystemActionBusy("");
    }
  };

  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">Syncthing Compare</div>
          <h1>登录 Web GUI</h1>
          <p>新的 React 工作台已接管核心审核流程。登录后可直接进入文件夹对比、接收审核和发布审核。</p>
          <form onSubmit={handleLogin} className="login-form">
            <label>
              <span>用户名</span>
              <input
                value={loginState.username}
                onChange={(event) => setLoginState((previous) => ({ ...previous, username: event.target.value }))}
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={loginState.password}
                onChange={(event) => setLoginState((previous) => ({ ...previous, password: event.target.value }))}
              />
            </label>
            {loginState.error && <div className="inline-message danger">{loginState.error}</div>}
            <button type="submit" className="primary-button" disabled={loginState.busy}>
              {loginState.busy ? "正在登录..." : "登录"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const localDeviceId = system?.myID;
  const remoteDevices = allDevices.filter((device) => device.deviceID !== localDeviceId);

  const localDeviceExpanded = Boolean(expandedFolders["device-local"]);

  useEffect(() => {
    updateUiModeInUrl(uiMode);
  }, [uiMode]);

  useEffect(() => {
    if (uiMode === "desktop") {
      setSidebarOpen(true);
    } else {
      setSidebarOpen(false);
    }
  }, [uiMode]);

  return (
    <div className={`workspace-shell ui-mode-${uiMode}${uiMode === "mobile" && sidebarOpen ? " sidebar-open" : ""}`}>
      {uiMode === "mobile" && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`workspace-sidebar ${uiMode === "mobile" ? "drawer" : ""}`}>
        {uiMode === "mobile" && (
          <button className="drawer-close-btn" onClick={() => setSidebarOpen(false)} title="关闭侧栏">✕</button>
        )}
        <div className="brand-block">
          <div className="eyebrow">Syncthing Compare</div>
          <h1>{window.metadata?.deviceIDShort ?? "设备"}</h1>
        </div>

        <section className="local-device-section">
          <div className="section-title">本机设备</div>
          <div className="device-card local">
            <div className="device-card-main">
              <button
                className="device-card-info"
                onClick={() => setExpandedFolders((prev) => ({ ...prev, "device-local": !prev["device-local"] }))}
              >
                <strong>{window.metadata?.deviceIDShort ?? "本机"}</strong>
                <span className="badge tone-success">在线</span>
              </button>
              <div className="device-card-actions">
                <button
                  className="mini-button"
                  onClick={() => setExpandedFolders((prev) => ({ ...prev, "device-local": !prev["device-local"] }))}
                  title="展开详情"
                >
                  {localDeviceExpanded ? "▾" : "▸"}
                </button>
              </div>
            </div>
            {!localDeviceExpanded && (
              <div className="device-meta">
                版本：{version?.version ?? "-"}
              </div>
            )}
            {localDeviceExpanded && (
              <div className="device-detail">
                <div className="device-detail-row">
                  <span className="detail-label">设备 ID</span>
                  <span className="detail-value">{localDeviceId?.slice(0, 20) ?? "-"}...</span>
                </div>
                <div className="device-detail-row">
                  <span className="detail-label">版本</span>
                  <span className="detail-value">{version?.version ?? "-"}</span>
                </div>
                <div className="device-detail-row">
                  <span className="detail-label">GUI 地址</span>
                  <span className="detail-value">{system?.guiAddressUsed ?? "-"}</span>
                </div>
                <div className="device-detail-row">
                  <span className="detail-label">运行时间</span>
                  <span className="detail-value">{system?.uptime ? `${Math.floor(system.uptime / 3600)}h ${Math.floor((system.uptime % 3600) / 60)}m` : "-"}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="device-list">
          <div className="section-title">远端设备</div>
          {remoteDevices.length === 0 ? (
            <div className="empty-mini">当前还没有已配置的远端设备。</div>
          ) : (
            remoteDevices.map((device) => {
              const connection = connections?.connections[device.deviceID];
              const aggregateCompletion = aggregateDeviceCompletion(completions[device.deviceID]);
              const badgeTone = connectionBadgeTone(Boolean(connection?.connected), aggregateCompletion.remoteState);
              const badgeLabel = connectionBadgeLabel(Boolean(connection?.connected), aggregateCompletion.remoteState);
              const visibleAddresses = Array.from(
                new Set([
                  ...(device.addresses ?? []).map(normalizeAddress),
                  ...(connection?.address ? [normalizeAddress(connection.address)] : []),
                ].filter(Boolean)),
              );
              const sharedFolders = folders.filter((folder) =>
                (folder.devices ?? []).some((item) => item.deviceID === device.deviceID),
              );
              const expanded = Boolean(expandedFolders[`device-${device.deviceID}`]);
              return (
                <div key={device.deviceID} className="device-card">
                  <div className="device-card-main">
                    <button
                      className="device-card-info"
                      onClick={() => setExpandedFolders((prev) => ({ ...prev, [`device-${device.deviceID}`]: !prev[`device-${device.deviceID}`] }))}
                    >
                      <strong>{deviceName(device)}</strong>
                      <span className={`badge tone-${badgeTone}`}>{badgeLabel}</span>
                    </button>
                    <div className="device-card-actions">
                      <button className="mini-button" onClick={() => openDeviceEditor(device)} title="设备设置">✎</button>
                      <button
                        className="mini-button"
                        onClick={() => setExpandedFolders((prev) => ({ ...prev, [`device-${device.deviceID}`]: !prev[`device-${device.deviceID}`] }))}
                        title="展开详情"
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                    </div>
                  </div>
                  {!expanded && (
                    <div className="device-meta">
                      同步状态：{aggregateSyncStatusLabel(aggregateCompletion)} · 未同步：{aggregateCompletion.needItems} 项
                    </div>
                  )}
                  {expanded && (
                    <div className="device-detail">
                      <div className="device-detail-row">
                        <span className="detail-label">最后可见</span>
                        <span className="detail-value">{formatLastSeen(deviceStats[device.deviceID]?.lastSeen)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">同步状态</span>
                        <span className="detail-value">{aggregateSyncStatusLabel(aggregateCompletion)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">未同步的项目</span>
                        <span className="detail-value">
                          {aggregateCompletion.needItems} 条目, ~{formatBinary(aggregateCompletion.needBytes)}
                        </span>
                      </div>
                      <div className="device-detail-row device-detail-row-stack">
                        <span className="detail-label">地址</span>
                        <div className="detail-value detail-list-value">
                          {visibleAddresses.length === 0 ? <span>未知</span> : visibleAddresses.map((address) => <span key={address}>{address}</span>)}
                        </div>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">压缩</span>
                        <span className="detail-value">{compressionLabel(device.compression)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">自动接受</span>
                        <span className="detail-value">{yesNo(device.autoAcceptFolders)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">标识</span>
                        <span className="detail-value">{device.deviceID.slice(0, 7)}</span>
                      </div>
                      <div className="device-detail-row device-detail-row-stack">
                        <span className="detail-label">文件夹</span>
                        <div className="detail-value detail-list-value">
                          {sharedFolders.length === 0 ? <span>-</span> : sharedFolders.map((folder) => <span key={folder.id}>{folderLabel(folder)}</span>)}
                        </div>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">设备 ID</span>
                        <span className="detail-value">{device.deviceID.slice(0, 20)}...</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">连接类型</span>
                        <span className="detail-value">{connection?.type || "未连接"}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">下行速率</span>
                        <span className="detail-value">{formatRate(connectionRates[device.deviceID]?.inbps ?? connection?.inbps)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">上行速率</span>
                        <span className="detail-value">{formatRate(connectionRates[device.deviceID]?.outbps ?? connection?.outbps)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">远端状态</span>
                        <span className="detail-value">{remoteStateLabel(aggregateCompletion.remoteState)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">完成度</span>
                        <span className="detail-value">{aggregateCompletion.total}%</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <section className="folder-list">
          <div className="section-title">文件夹</div>
          <div className="folder-table">
            <div className="folder-table-header">
              <span className="folder-col-name">名称</span>
              <span className="folder-col-status">状态</span>
              <span className="folder-col-sync">待同步</span>
              <span className="folder-col-error">错误</span>
            </div>
            {folders.map((folder) => {
              const status = folderStatuses[folder.id];
              const active = folder.id === selectedFolderId;
              return (
                <button
                  key={folder.id}
                  className={`folder-table-row${active ? " active" : ""}`}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <span className="folder-col-name">{folderLabel(folder)}</span>
                  <span className={`folder-col-status badge tone-${folderStateTone(status)}`}>
                    {status?.state ?? folder.type}
                  </span>
                  <span className="folder-col-sync">{status?.needTotalItems ?? 0}</span>
                  <span className={`folder-col-error${(status?.errors ?? 0) > 0 ? " has-error" : ""}`}>
                    {status?.errors ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-row">
            <span>页面刷新</span>
            <select value={mainRefreshSeconds} onChange={(event) => applyRefreshSettings(Number(event.target.value), panelRefreshSeconds)}>
              {refreshChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} 秒
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span>审核刷新</span>
            <select value={panelRefreshSeconds} onChange={(event) => applyRefreshSettings(mainRefreshSeconds, Number(event.target.value))}>
              {refreshChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} 秒
                </option>
              ))}
            </select>
          </div>
          <button className="ghost-button" onClick={() => void loadBootstrap()} disabled={bootBusy} style={{ width: "100%" }}>
            {bootBusy ? "正在刷新..." : "立即刷新"}
          </button>
        </section>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          {uiMode === "mobile" && !sidebarOpen && (
            <button className="menu-toggle-btn" onClick={() => setSidebarOpen(true)} title="打开侧栏">☰</button>
          )}
          <div>
            <div className="eyebrow">当前设备</div>
            <h2>{window.metadata?.deviceIDShort ?? "Compare"}</h2>
          </div>
          <div className="topbar-actions">
            <button className={`tab-button${uiMode === "desktop" ? " active" : ""}`} onClick={() => setUiMode("desktop")}>
              桌面版
            </button>
            <button className={`tab-button${uiMode === "mobile" ? " active" : ""}`} onClick={() => setUiMode("mobile")}>
              手机版
            </button>
            <button className={`tab-button${viewMode === "overview" ? " active" : ""}`} onClick={() => setViewMode("overview")}>
              概览
            </button>
            <button
              className="tab-button"
              onClick={() => setReceiveModalOpen(true)}
              disabled={!selectedFolder || isPausedFolder(selectedFolder) || !canReceive(selectedFolder)}
            >
              接收审核
            </button>
            <button
              className="tab-button"
              onClick={() => setPublishModalOpen(true)}
              disabled={!selectedFolder || isPausedFolder(selectedFolder) || !canPublish(selectedFolder)}
            >
              发布审核
            </button>
            <button className="ghost-button" onClick={() => setSettingsModalOpen(true)}>
              设置
            </button>
            <button className="ghost-button" onClick={() => void handleLogout()}>
              登出
            </button>
          </div>
        </header>

        {bootError && <div className="inline-message danger">{bootError}</div>}

        {bootBusy && !config ? (
          <section className="panel surface">
            <h3>正在加载工作台</h3>
            <p>正在读取当前设备的文件夹、远端设备和同步状态。</p>
          </section>
        ) : bootError && !config ? (
          <section className="panel surface">
            <h3>工作台加载失败</h3>
            <p>当前不是“没有文件夹”，而是前端还没拿到配置或状态数据。你可以先点刷新再试一次。</p>
            <div className="inline-message danger">{bootError}</div>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => void loadBootstrap()} disabled={bootBusy}>
                {bootBusy ? "正在刷新..." : "重新加载"}
              </button>
            </div>
          </section>
        ) : !selectedFolder ? (
          <section className="panel surface">
            <h3>没有可用文件夹</h3>
            <p>当前配置里没有共享文件夹。React 工作台目前围绕文件夹差异、接收审核和发布审核展开，所以需要至少一个已配置文件夹。</p>
          </section>
        ) : (
          <>
            {Object.keys(pendingFolders).length > 0 && (
              <section className="panel surface pending-offers-panel">
                <div className="panel-header">
                  <div>
                    <div className="eyebrow">待接受共享文件夹</div>
                    <h3>来自远端设备的新文件夹邀请</h3>
                  </div>
                </div>
                <div className="help-block">
                  如果你希望某台远端设备以后共享的新文件夹自动落到当前设备，可在“编辑设备 &gt; 共享”中开启“自动接受”。
                </div>
                <div className="share-list">
                  {Object.entries(pendingFolders).map(([folderId, pending]) => {
                    const offers = pendingFolderOfferDevices(pending, devicesById);
                    return (
                      <div key={folderId} className="share-folder-row selected">
                        <div className="folder-offer-head">
                          <strong>{folderId}</strong>
                          <span className="help-inline">{offers.map((offer) => deviceName(offer.device)).join("，")}</span>
                        </div>
                        {offers.map((offer) => (
                          <div key={offer.deviceID} className="folder-offer-device">
                            <div className="help-block">
                              来自设备：{deviceName(offer.device)}。标签：{offer.observed.label || folderId}
                              {offer.observed.receiveEncrypted ? "。对端建议使用 Receive Encrypted。" : ""}
                            </div>
                            <div className="panel-actions">
                              <button className="primary-button" onClick={() => void acceptPendingFolder(folderId, offer.deviceID)}>
                                接受
                              </button>
                              <button className="ghost-button" onClick={() => void dismissPendingFolder(folderId, offer.deviceID)}>
                                忽略
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {viewMode === "overview" && (
              <OverviewPanel
                folders={folders}
                selectedFolderId={selectedFolderId}
                folderStatuses={folderStatuses}
                devicesById={devicesById}
                completions={completions}
                connections={connections}
                overviewMessage={overviewMessage}
                expandedFolders={expandedFolders}
                onToggleExpand={(folderId) =>
                  setExpandedFolders((previous) => ({
                    ...previous,
                    [folderId]: !previous[folderId],
                  }))
                }
                onSelectFolder={setSelectedFolderId}
                onOpenReceive={(folder) => {
                  setSelectedFolderId(folder.id);
                  setReceiveModalOpen(true);
                }}
                onOpenBiDiff={(folder) => {
                  setSelectedFolderId(folder.id);
                  setBiDiffModalOpen(true);
                }}
                onOpenPeerDiff={(folder) => {
                  setSelectedFolderId(folder.id);
                  setPeerDiffModalOpen(true);
                }}
                onOpenPublish={(folder) => {
                  setSelectedFolderId(folder.id);
                  setPublishModalOpen(true);
                }}
                onEditFolder={(folder) => {
                  setSelectedFolderId(folder.id);
                  setFolderDraft(prepareFolderDraft(folder));
                  setFolderIgnoreText("");
                  setFolderIgnoreError("");
                  setFolderAddIgnores(false);
                  void loadFolderIgnores(folder.id);
                  setFolderSaveMessage("");
                  setFolderEditorOpen(true);
                }}
                onEditDevice={openDeviceEditor}
                onRescan={(folder) => void rescanFolder(folder)}
                onTogglePaused={(folder) => void toggleFolderPaused(folder)}
                localDeviceId={system?.myID}
              />
            )}
          </>
        )}

      </main>

      {settingsModalOpen && (
        <ModalShell title="设置" onClose={() => setSettingsModalOpen(false)}>
          <SettingsHubPanel
            optionsDraft={optionsDraft}
            onOptionsChange={setOptionsDraft}
            onSaveOptions={() => void saveOptionsDraft()}
            optionsBusy={optionsSaveBusy}
            optionsMessage={optionsSaveMessage}
            onCreateFolder={() => void createFolder()}
            onCreateDevice={() => void createDevice()}
            newFolderBusy={newFolderBusy}
            newDeviceBusy={newDeviceBusy}
            devices={allDevices}
            folders={folders}
            onEditDevice={openDeviceEditor}
            onEditFolder={(folder) => {
              setSelectedFolderId(folder.id);
              setFolderDraft(prepareFolderDraft(folder));
              setFolderIgnoreText("");
              setFolderIgnoreError("");
              setFolderAddIgnores(false);
              void loadFolderIgnores(folder.id);
              setFolderSaveMessage("");
              setFolderEditorOpen(true);
              setSettingsModalOpen(false);
            }}
            onRestart={() => void restartSyncthing()}
            onShutdown={() => void shutdownSyncthing()}
            systemActionBusy={systemActionBusy}
            systemActionMessage={systemActionMessage}
          />
        </ModalShell>
      )}

      {folderEditorOpen && folderDraft && (
        <ModalShell title={editingNewFolder ? "新建文件夹" : "编辑文件夹"} onClose={closeFolderEditor}>
          <FolderSettingsPanel
            draft={folderDraft}
            allDevices={allDevices}
            completions={completions}
            ignoreText={folderIgnoreText}
            onIgnoreTextChange={setFolderIgnoreText}
            ignoreError={folderIgnoreError}
            ignoreBusy={folderIgnoreBusy}
            addIgnores={folderAddIgnores}
            onAddIgnoresChange={setFolderAddIgnores}
            onChange={setFolderDraft}
            onClose={closeFolderEditor}
            onSave={() => void (editingExistingFolder ? saveFolderDraft() : saveNewFolder())}
            busy={folderSaveBusy}
            message={folderSaveMessage}
            isNew={editingNewFolder}
            onDelete={editingExistingFolder ? () => void deleteCurrentFolder() : undefined}
          />
        </ModalShell>
      )}

      {deviceDraft && (editingExistingDevice || editingNewDevice) && (
        <ModalShell
          title={editingNewDevice ? `新建设备 (${deviceName(deviceDraft)})` : `编辑设备 (${deviceName(deviceDraft)})`}
          onClose={closeDeviceEditor}
        >
          <DeviceSettingsPanel
            draft={deviceDraft}
            onChange={setDeviceDraft}
            shareDraft={deviceShareDraft}
            onShareDraftChange={setDeviceShareDraft}
            allFolders={folders}
            allDevices={allDevices.filter((device) => device.deviceID !== system?.myID)}
            completions={completions}
            onClose={closeDeviceEditor}
            onSave={() => void (editingExistingDevice ? saveDeviceDraft() : saveNewDevice())}
            busy={deviceSaveBusy}
            message={deviceSaveMessage}
            isNew={editingNewDevice}
            onDelete={editingExistingDevice ? () => void deleteCurrentDevice() : undefined}
          />
        </ModalShell>
      )}

      {receiveModalOpen && selectedFolder && (
        <ModalShell title={`接收审核 - ${folderLabel(selectedFolder)}`} onClose={() => setReceiveModalOpen(false)}>
          <ReceiveReviewPanel
            folder={selectedFolder}
            devices={selectedFolderDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            selectedDevice={selectedDevice}
            compare={compare}
            compareBusy={compareBusy}
            compareError={compareError}
            compareView={compareView}
            onCompareViewChange={setCompareView}
            comparePrefix={comparePrefix}
            onComparePrefixChange={setComparePrefix}
            compareSelection={compareSelection}
            onCompareSelectionChange={setCompareSelection}
            compareMessage={compareMessage}
            onRefresh={() => void refreshCompare(true)}
            onSyncSelected={() =>
              void syncEntries((compare?.entries ?? []).filter((entry) => compareSelection[entry.path] && entry.canPrioritize))
            }
            onSyncVisible={() => void syncEntries(compareVisibleEntries)}
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
          />
        </ModalShell>
      )}

      {bidiffModalOpen && selectedFolder && (
        <ModalShell
          title={
            <WorkbenchTitle
              label={`裁决 · ${folderLabel(selectedFolder)}`}
              device={selectedDevice}
              connection={selectedDeviceId ? connections?.connections[selectedDeviceId] : undefined}
              rates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
              stats={titleBarStats}
            />
          }
          titleExtra={
            <>
              <button className={bidiffWorkbenchView === "diff" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setBidiffWorkbenchView("diff")}>差异</button>
              <button className={bidiffWorkbenchView === "transfer" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setBidiffWorkbenchView("transfer")}>
                传输
                {(Object.keys(downloadProgress).length > 0 || Object.keys(uploadProgress).length > 0) && (
                  <span className="badge tone-info" style={{ marginLeft: 6, fontSize: "0.7rem" }}>
                    {Object.values(downloadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0) + Object.values(uploadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0)}
                  </span>
                )}
              </button>
            </>
          }
          onClose={() => {
            setBiDiffModalOpen(false);
            setTitleBarStats(null);
          }}
        >
          <BiDiffPanel
            mode="bidiff"
            folder={selectedFolder}
            devices={selectedFolderDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            selectedDevice={selectedDevice}
            bidiff={bidiff}
            bidiffBusy={bidiffBusy}
            bidiffError={bidiffError}
            bidiffView={bidiffView}
            onBidiffViewChange={setBiDiffView}
            bidiffPrefix={bidiffPrefix}
            onBidiffPrefixChange={setBiDiffPrefix}
            bidiffSelection={bidiffSelection}
            onBidiffSelectionChange={setBiDiffSelection}
            bidiffMessage={bidiffMessage}
            onRefresh={() => void refreshBiDiff(true)}
            onApplyLeftToRight={() =>
              void applyBiDiffEntries(
                "left-to-right",
                (bidiff?.entries ?? []).filter((entry) => bidiffSelection[entry.path] && entry.canApplyLeftToRight),
              )
            }
            onApplyRightToLeft={() =>
              void applyBiDiffEntries(
                "right-to-left",
                (bidiff?.entries ?? []).filter((entry) => bidiffSelection[entry.path] && entry.canApplyRightToLeft),
              )
            }
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
            scanBusy={panelScanBusy === "bidiff"}
            activeTasks={activeBiDiffTasks}
            allTasks={allBiDiffTasks}
            uiMode={uiMode}
            autoRefreshPaused={bidiffAutoRefreshPaused}
            onToggleAutoRefreshPaused={() => setBidiffAutoRefreshPaused((previous) => !previous)}
            titleStats={setTitleBarStats}
            downloadProgress={downloadProgress}
            uploadProgress={uploadProgress}
            completedUploads={completedUploads}
            uploadFileInfo={uploadFileInfo}
            completedDownloads={completedDownloads}
            connectionRates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
            workbenchView={bidiffWorkbenchView}
            onWorkbenchViewChange={setBidiffWorkbenchView}
          />
        </ModalShell>
      )}

      {peerDiffModalOpen && selectedFolder && (
        <ModalShell
          title={
            <WorkbenchTitle
              label={`对等 · ${folderLabel(selectedFolder)}`}
              device={selectedDevice}
              connection={selectedDeviceId ? connections?.connections[selectedDeviceId] : undefined}
              rates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
              stats={titleBarStats}
              isPeer
            />
          }
          titleExtra={
            <>
              <button className={peerWorkbenchView === "diff" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setPeerWorkbenchView("diff")}>差异</button>
              <button className={peerWorkbenchView === "transfer" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setPeerWorkbenchView("transfer")}>
                传输
                {(Object.keys(downloadProgress).length > 0 || Object.keys(uploadProgress).length > 0) && (
                  <span className="badge tone-info" style={{ marginLeft: 6, fontSize: "0.7rem" }}>
                    {Object.values(downloadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0) + Object.values(uploadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0)}
                  </span>
                )}
              </button>
            </>
          }
          onClose={() => {
            setPeerDiffModalOpen(false);
            setTitleBarStats(null);
          }}
        >
          <BiDiffPanel
            mode="peer"
            folder={selectedFolder}
            devices={selectedFolderDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            selectedDevice={selectedDevice}
            bidiff={peerDiff}
            bidiffBusy={peerDiffBusy}
            bidiffError={peerDiffError}
            bidiffView={peerDiffView}
            onBidiffViewChange={setPeerDiffView}
            bidiffPrefix={peerDiffPrefix}
            onBidiffPrefixChange={setPeerDiffPrefix}
            bidiffSelection={peerDiffSelection}
            onBidiffSelectionChange={setPeerDiffSelection}
            bidiffMessage={peerDiffMessage}
            onRefresh={() => void refreshPeerDiff(true)}
            onApplyLeftToRight={() =>
              void applyPeerDiffEntries(
                "left-to-right",
                (peerDiff?.entries ?? []).filter((entry) => peerDiffSelection[entry.path] && entry.canApplyLeftToRight),
              )
            }
            onApplyRightToLeft={() =>
              void applyPeerDiffEntries(
                "right-to-left",
                (peerDiff?.entries ?? []).filter((entry) => peerDiffSelection[entry.path] && entry.canApplyRightToLeft),
              )
            }
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
            scanBusy={panelScanBusy === "peerdiff"}
            activeTasks={activePeerDiffTasks}
            allTasks={allPeerDiffTasks}
            uiMode={uiMode}
            autoRefreshPaused={peerDiffAutoRefreshPaused}
            onToggleAutoRefreshPaused={() => setPeerDiffAutoRefreshPaused((previous) => !previous)}
            titleStats={setTitleBarStats}
            downloadProgress={downloadProgress}
            uploadProgress={uploadProgress}
            completedUploads={completedUploads}
            uploadFileInfo={uploadFileInfo}
            completedDownloads={completedDownloads}
            connectionRates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
            workbenchView={peerWorkbenchView}
            onWorkbenchViewChange={setPeerWorkbenchView}
          />
        </ModalShell>
      )}

      {publishModalOpen && selectedFolder && (
        <ModalShell title={`发布审核 - ${folderLabel(selectedFolder)}`} onClose={() => setPublishModalOpen(false)}>
          <PublishReviewPanel
            folder={selectedFolder}
            publish={publish}
            publishBusy={publishBusy}
            publishError={publishError}
            publishView={publishView}
            onPublishViewChange={setPublishView}
            publishPrefix={publishPrefix}
            onPublishPrefixChange={setPublishPrefix}
            publishSelection={publishSelection}
            onPublishSelectionChange={setPublishSelection}
            publishMessage={publishMessage}
            onRefresh={() => void refreshPublish(true)}
            onPublishSelected={() =>
              void publishEntries((publish?.entries ?? []).filter((entry) => publishSelection[entry.path] && entry.canPublish))
            }
            onPublishVisible={() => void publishEntries(publishVisibleEntries)}
            onClearSettledSelected={() =>
              void clearSettledPublishEntries((publish?.entries ?? []).filter((entry) => publishSelection[entry.path] && entry.canClear))
            }
            onClearSettledVisible={() => void clearSettledPublishEntries(publishClearableEntries)}
            devices={selectedFolderDevices}
            devicesById={devicesById}
            completions={completions}
            connections={connections}
          />
        </ModalShell>
      )}
    </div>
  );
}

function StatusCard(props: { title: string; value: string; subtitle: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className={`status-card${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="status-title">{props.title}</div>
      <div className="status-value">{props.value}</div>
      <div className="status-subtitle">{props.subtitle}</div>
    </div>
  );
}

function OverviewPanel(props: {
  folders: FolderConfig[];
  selectedFolderId: string;
  folderStatuses: Record<string, FolderStatus>;
  devicesById: Map<string, DeviceConfig>;
  completions: Record<string, Record<string, CompletionStatus>>;
  connections: ConnectionsResponse | null;
  overviewMessage: string;
  expandedFolders: Record<string, boolean>;
  localDeviceId?: string;
  onToggleExpand: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onOpenReceive: (folder: FolderConfig) => void;
  onOpenBiDiff: (folder: FolderConfig) => void;
  onOpenPeerDiff: (folder: FolderConfig) => void;
  onOpenPublish: (folder: FolderConfig) => void;
  onEditFolder: (folder: FolderConfig) => void;
  onEditDevice: (device: DeviceConfig) => void;
  onRescan: (folder: FolderConfig) => void;
  onTogglePaused: (folder: FolderConfig) => void;
}) {
  const [ovColumns, setOvColumns] = useState([
    { key: "name", label: "文件夹", width: 140, minWidth: 80 },
    { key: "type", label: "类型", width: 70, minWidth: 50 },
    { key: "status", label: "状态", width: 60, minWidth: 50 },
    { key: "receive", label: "接收", width: 70, minWidth: 50 },
    { key: "publish", label: "发布", width: 70, minWidth: 50 },
    { key: "local", label: "本地", width: 100, minWidth: 70 },
    { key: "global", label: "全局", width: 100, minWidth: 70 },
    { key: "need", label: "待同步", width: 55, minWidth: 40 },
    { key: "error", label: "错误", width: 45, minWidth: 35 },
    { key: "devices", label: "远端设备", width: 90, minWidth: 60 },
    { key: "actions", label: "操作", width: 286, minWidth: 240 },
  ]);

  const handleOvResize = (colIndex: number, clientX: number) => {
    beginColumnResize(clientX, colIndex, ovColumns, setOvColumns);
  };

  const gridTemplate = ovColumns.map((col) => `${col.width}px`).join(" ");

  return (
    <section className="panel surface compact-overview-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">文件夹概览</div>
          <h3>文件夹工作台</h3>
        </div>
      </div>
      {props.overviewMessage && <div className="inline-message info">{props.overviewMessage}</div>}

      <div className="overview-table-wrapper">
        <div className="overview-table" style={{ gridTemplateColumns: gridTemplate }}>
          {ovColumns.map((col) => (
            <div key={col.key} className="overview-table-header-cell">
              {col.label}
              <div
                className="ov-resize-handle"
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleOvResize(ovColumns.findIndex((c) => c.key === col.key), e.clientX);
                }}
              />
            </div>
          ))}
        </div>

        {props.folders.map((folder) => {
          const status = props.folderStatuses[folder.id];
          const devices = folder.devices
            .map((folderDevice) => props.devicesById.get(folderDevice.deviceID))
            .filter((device): device is DeviceConfig => Boolean(device) && device.deviceID !== props.localDeviceId);
          const expanded = Boolean(props.expandedFolders[folder.id]);
          const active = props.selectedFolderId === folder.id;
          const receiveCapable = canReceive(folder);
          const publishCapable = canPublish(folder);
          const paused = isPausedFolder(folder);
          const remoteDeviceNames = devices.slice(0, 2).map((d) => deviceName(d)).join(", ");
          const extraCount = devices.length - 2;

          return (
            <div key={folder.id} className="overview-table-group">
              <div
                className={`overview-table-row${active ? " active" : ""}`}
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="ov-cell ov-cell-name">
                  <button className="ov-name-button" onClick={() => props.onSelectFolder(folder.id)}>
                    {folderLabel(folder)}
                  </button>
                </div>
                <div className="ov-cell">
                  <span className="badge badge-sm tone-info">{folderTypeLabel(folder.type)}</span>
                </div>
                <div className="ov-cell">
                  <span className={`badge badge-sm tone-${folderStateTone(status)}`}>{status?.state ?? "未知"}</span>
                </div>
                <div className="ov-cell">
                  <span className={`badge badge-sm ${folder.manualSync ? "tone-warning" : "tone-success"}`}>
                    {folder.manualSync ? "手动" : "自动"}
                  </span>
                </div>
                <div className="ov-cell">
                  <span className={`badge badge-sm ${folder.manualPublish ? "tone-warning" : "tone-success"}`}>
                    {folder.manualPublish ? "手动" : "自动"}
                  </span>
                </div>
                <div className="ov-cell ov-cell-num">
                  {status?.localFiles ?? 0} / {formatBinary(status?.localBytes)}
                </div>
                <div className="ov-cell ov-cell-num">
                  {status?.globalFiles ?? 0} / {formatBinary(status?.globalBytes)}
                </div>
                <div className={`ov-cell ov-cell-num${(status?.needTotalItems ?? 0) > 0 ? " has-need" : ""}`}>
                  {status?.needTotalItems ?? 0}
                </div>
                <div className={`ov-cell ov-cell-num${(status?.errors ?? 0) > 0 ? " has-error" : ""}`}>
                  {status?.errors ?? 0}
                </div>
                <div className="ov-cell ov-cell-devices">
                  {devices.length === 0 ? (
                    <span className="muted">无</span>
                  ) : (
                    <span title={devices.map((d) => deviceName(d)).join(", ")}>
                      {remoteDeviceNames}{extraCount > 0 ? ` +${extraCount}` : ""}
                    </span>
                  )}
                </div>
                <div className="ov-cell ov-cell-actions">
                  <button className="mini-button" onClick={() => props.onRescan(folder)} disabled={paused} title={paused ? "暂停中的文件夹不可刷新" : "刷新状态"}>↻</button>
                  <button className="mini-button" onClick={() => props.onEditFolder(folder)} title="编辑设置">✎</button>
                  <button
                    className={`mini-button ${folder.paused ? "secondary" : ""}`}
                    onClick={() => props.onTogglePaused(folder)}
                    title={folder.paused ? "恢复文件夹" : "暂停文件夹"}
                  >
                    {folder.paused ? "恢复" : "暂停"}
                  </button>
                  <button className="mini-button secondary" onClick={() => props.onOpenBiDiff(folder)} disabled={paused} title={paused ? "请先恢复文件夹" : "双向裁决"}>
                    裁决
                  </button>
                  <button className="mini-button secondary" onClick={() => props.onOpenPeerDiff(folder)} disabled={paused} title={paused ? "请先恢复文件夹" : "对等差异工作台"}>
                    对等
                  </button>
                  <button
                    className="mini-button primary"
                    onClick={() => props.onOpenReceive(folder)}
                    disabled={paused || !receiveCapable}
                    title={paused ? "请先恢复文件夹" : "接收审核"}
                  >
                    接收
                  </button>
                  <button
                    className="mini-button"
                    onClick={() => props.onOpenPublish(folder)}
                    disabled={paused || !publishCapable}
                    title={paused ? "请先恢复文件夹" : "发布审核"}
                  >
                    发布
                  </button>
                  <button className="mini-button" onClick={() => props.onToggleExpand(folder.id)} title="展开详情">
                    {expanded ? "▾" : "▸"}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="overview-detail">
                  <div className="overview-detail-grid">
                    <div className="overview-detail-row">
                      <span className="detail-label">路径</span>
                      <span className="detail-value">{folder.path}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">接收模式</span>
                      <span className="detail-value">{receiveModeLabel(folder)}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">发布模式</span>
                      <span className="detail-value">{publishModeLabel(folder)}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">重扫间隔</span>
                      <span className="detail-value">{folder.rescanIntervalS ? `${folder.rescanIntervalS} 秒` : "未设置"}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">本地文件/目录</span>
                      <span className="detail-value">{status?.localFiles ?? 0} / {status?.localDirectories ?? 0}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">全局文件/目录</span>
                      <span className="detail-value">{status?.globalFiles ?? 0} / {status?.globalDirectories ?? 0}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">未同步体积</span>
                      <span className="detail-value">{formatBinary(status?.needBytes)}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">共享设备</span>
                      <span className="detail-value">{devices.length} 台</span>
                    </div>
                  </div>

                  {devices.length > 0 && (
                    <div className="overview-device-list">
                      <div className="detail-label" style={{ marginBottom: 4 }}>共享设备详情</div>
                      <table className="device-status-table">
                        <thead>
                          <tr>
                            <th>设备</th>
                            <th>状态</th>
                            <th>完成度</th>
                            <th>待同步</th>
                            <th>连接</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devices.map((device) => {
                            const connection = props.connections?.connections[device.deviceID];
                            const completion = props.completions[device.deviceID]?.[folder.id];
                            const badgeTone = connectionBadgeTone(Boolean(connection?.connected), completion?.remoteState);
                            const badgeLabel = connectionBadgeLabel(Boolean(connection?.connected), completion?.remoteState);
                            return (
                              <tr key={device.deviceID}>
                                <td>
                                  <button className="link-button" onClick={() => props.onEditDevice(device)}>
                                    {deviceName(device)}
                                  </button>
                                </td>
                                <td><span className={`badge badge-sm tone-${badgeTone}`}>{badgeLabel}</span></td>
                                <td>{completion?.completion ?? 0}%</td>
                                <td>{completion?.needItems ?? 0} 项</td>
                                <td>{connection?.type || "-"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReceiveReviewPanel(props: {
  folder: FolderConfig;
  devices: DeviceConfig[];
  selectedDeviceId: string;
  onSelectDevice: (value: string) => void;
  selectedDevice: DeviceConfig | null;
  compare: CompareResult | null;
  compareBusy: boolean;
  compareError: string;
  compareView: string;
  onCompareViewChange: (value: string) => void;
  comparePrefix: string;
  onComparePrefixChange: (value: string) => void;
  compareSelection: Record<string, boolean>;
  onCompareSelectionChange: (value: Record<string, boolean>) => void;
  compareMessage: string;
  onRefresh: () => void;
  onSyncSelected: () => void;
  onSyncVisible: () => void;
  remoteCompletion?: CompletionStatus;
}) {
  const rawEntries = props.compare?.entries ?? [];
  const entries = useMemo(() => filterReceiveEntriesForView(rawEntries, props.compareView), [rawEntries, props.compareView]);
  const selectedCount = entries.filter((entry) => props.compareSelection[entry.path] && entry.canPrioritize).length;
  const emptyText =
    props.compareView === "incoming"
      ? "当前没有来自远端、会影响当前设备的差异。"
      : "当前筛选条件下没有差异项。";
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [columns, setColumns] = useState<ColumnDef[]>([
    { key: "checkbox", label: "", width: 40, minWidth: 40 },
    { key: "leftSize", label: "本地大小", width: 90, minWidth: 64 },
    { key: "leftTime", label: "本地时间", width: 100, minWidth: 76 },
    { key: "status", label: "状态", width: 132, minWidth: 108 },
    { key: "summary", label: "名称 / 路径", width: 320, minWidth: 220 },
    { key: "rightTime", label: "远端时间", width: 100, minWidth: 76 },
    { key: "rightSize", label: "远端大小", width: 90, minWidth: 64 },
  ]);
  const treeNodes = useMemo(() => buildReviewTree(entries), [entries]);
  const treeRows = useMemo(() => flattenReviewTree(treeNodes, expandedDirs), [treeNodes, expandedDirs]);

  useEffect(() => {
    setExpandedDirs((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const node of treeNodes) {
        if (!(node.key in next)) {
          next[node.key] = true;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [treeNodes]);

  if (props.devices.length === 0) {
    return (
      <div className="review-modal-layout">
        <div className="review-modal-main">
          <div className="empty-mini">这个文件夹当前没有共享设备，所以没有可对比的远端索引。</div>
        </div>
      </div>
    );
  }
  return (
    <div className="review-modal-layout">
      <div className="review-modal-main">
        <div className="review-toolbar">
          <label>
            <span>查看范围</span>
            <select value={props.compareView} onChange={(event) => props.onCompareViewChange(event.target.value)}>
              {compareViewOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-grow">
            <span>路径前缀</span>
            <input value={props.comparePrefix} onChange={(event) => props.onComparePrefixChange(event.target.value)} placeholder="目录 / 子目录" />
          </label>
          <button className="ghost-button compact-button" onClick={() => setExpandedDirs((previous) => Object.keys(previous).reduce<Record<string, boolean>>((acc, key) => ({ ...acc, [key]: true }), {}))}>
            全部展开
          </button>
          <button className="ghost-button compact-button" onClick={() => setExpandedDirs((previous) => Object.keys(previous).reduce<Record<string, boolean>>((acc, key) => ({ ...acc, [key]: false }), {}))}>
            全部折叠
          </button>
        </div>

        <div className="review-stats">
          <span className={`badge tone-${props.compare?.remoteConnected ? "success" : "warning"}`}>{props.compare?.remoteConnected ? "已连接" : "离线"}</span>
          <span>目标设备：{deviceName(props.selectedDevice ?? undefined)}</span>
          <span>远端状态：{remoteStateLabel(props.remoteCompletion?.remoteState)}</span>
          <span>共 {entries.length} 项</span>
          <span>可操作 {entries.filter((entry) => entry.canPrioritize).length} 项</span>
          <span>已选 {selectedCount} 项</span>
        </div>
        <div className="review-mobile-hint">手机建议横屏查看；表格可左右滑动，按住列头分隔线可调整列宽。若 Android 内置 WebGUI 操作不顺，建议改用“在浏览器中打开”后再查看。</div>

        {props.compareMessage && <div className="inline-message info">{props.compareMessage}</div>}
        {props.compareError && <div className="inline-message danger">{props.compareError}</div>}
        {props.compareBusy && entries.length === 0 && <div className="compare-empty">正在加载接收审核数据...</div>}

        <ResizableTable
          columns={columns}
          onColumnsChange={setColumns}
          className="compare-table bidiff-table bidiff-font-normal bidiff-density-normal"
        >
          <thead>
            <tr>{renderResizableHeaders(columns, setColumns)}</tr>
          </thead>
          <tbody>
            {treeRows.map((row) => {
              if (row.type === "dir") {
                const selectableEntries = row.entries.filter((entry) => entry.canPrioritize);
                const selectedChildren = selectableEntries.filter((entry) => props.compareSelection[entry.path]).length;
                const open = expandedDirs[row.node.key] !== false;
                const branchActive = hasExpandedReviewDirDescendant(row.node, expandedDirs);
                return (
                  <tr
                    key={row.key}
                    className={`compare-tree-row compare-tree-dir-row${selectedChildren > 0 ? " contains-selected" : ""}${open ? " is-open" : ""}${branchActive ? " branch-active" : ""}`}
                  >
                    <td className="compare-checkbox-cell">
                      {selectableEntries.length > 0 ? (
                        <input
                          type="checkbox"
                          className="compare-checkbox"
                          checked={selectedChildren > 0 && selectedChildren === selectableEntries.length}
                          onChange={(event) => {
                            const next = { ...props.compareSelection };
                            for (const entry of selectableEntries) {
                              if (event.target.checked) {
                                next[entry.path] = true;
                              } else {
                                delete next[entry.path];
                              }
                            }
                            props.onCompareSelectionChange(next);
                          }}
                        />
                      ) : null}
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">{row.entries.filter((entry) => entry.local && !entry.local.deleted).length}</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-placeholder">—</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side compare-dir-side-center">
                        <span className="compare-dir-placeholder">目录</span>
                      </div>
                    </td>
                    <td className="compare-tree-name-cell">
                      <div className="compare-tree-summary">
                        <TreePrefix depth={row.depth} guides={row.guides} isLast={row.isLast} />
                        <button className="tree-toggle" onClick={() => setExpandedDirs((previous) => ({ ...previous, [row.node.key]: !open }))}>
                          {open ? "▾" : "▸"}
                        </button>
                        <span className="tree-folder-chip tree-folder-icon" aria-hidden="true">📁</span>
                        <span className="compare-tree-name compare-tree-dir-name">{row.node.name}</span>
                        <span className="compare-tree-dir-summary">
                          {row.entries.length} 项差异{selectedChildren > 0 ? ` / 已选 ${selectedChildren}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-placeholder">—</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">{row.entries.filter((entry) => entry.remote && !entry.remote.deleted).length}</span>
                      </div>
                    </td>
                  </tr>
                );
              }

              const entry = row.entry;
              const selected = Boolean(props.compareSelection[entry.path]);
              const kind = compareKind(entry);
              const renameRole = compareRenameRole(entry);
              return (
                <tr
                  key={entry.path}
                  className={`compare-tree-file-row tone-${statusTone(entry.status)} kind-${kind}${selected ? " selected" : ""}`}
                >
                  <td className="compare-checkbox-cell">
                    <input
                      type="checkbox"
                      className="compare-checkbox"
                      checked={selected}
                      disabled={!entry.canPrioritize}
                      onChange={(event) =>
                        props.onCompareSelectionChange({
                          ...props.compareSelection,
                          [entry.path]: event.target.checked,
                        })
                      }
                    />
                  </td>
                  <td>
                    <BiDiffSizeCell file={entry.local} missingLabel="不存在" />
                  </td>
                  <td>
                    <BiDiffTimeCell file={entry.local} missingLabel="不存在" dateMode="compact" />
                  </td>
                  <td>
                    <div className="compare-cell-center compare-status-column">
                      <div className="compare-status-badges">
                        <span className={`badge compare-status-badge tone-${statusTone(entry.status)} kind-${kind}`}>
                          {compareStatusLabel(entry)}
                        </span>
                        {renameRole && (
                          <span className={`badge compare-role-badge role-${renameRole}`}>
                            {renameRole === "old" ? "旧路径" : "新路径"}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="compare-status-cell compare-status-stack">
                      <div className="compare-tree-fileline" title={entry.path}>
                        <TreePrefix depth={row.depth} guides={row.guides} isLast={row.isLast} />
                        <span className="tree-file-dot" aria-hidden="true" />
                        <span className="compare-tree-name compare-tree-file-name">{row.node.name}</span>
                      </div>
                      {entry.renameCandidate ? (
                        <div className={`helper-line compare-pair-line role-${renameRole || "pair"}`}>
                          {renameRole === "new"
                            ? `新路径；旧路径：${entry.renameCandidate}`
                            : `旧路径；新路径：${entry.renameCandidate}`}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <BiDiffTimeCell file={entry.remote} missingLabel="不存在" dateMode="compact" />
                  </td>
                  <td>
                    <BiDiffSizeCell file={entry.remote} missingLabel="不存在" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResizableTable>

        {entries.length === 0 && !props.compareBusy && <div className="compare-empty">{emptyText}</div>}
      </div>

      <div className="review-modal-sidebar">
        <div className="review-sidebar-card">
          <div className="section-title">目标设备</div>
          <select value={props.selectedDeviceId} onChange={(event) => props.onSelectDevice(event.target.value)} style={{ width: "100%", marginTop: 6 }}>
            {props.devices.map((device) => (
              <option key={device.deviceID} value={device.deviceID}>
                {deviceName(device)}
              </option>
            ))}
          </select>
          <div className="review-target-status">
            <span className={`badge tone-${props.compare?.remoteConnected ? "success" : "warning"}`}>
              {props.compare?.remoteConnected ? "已连接" : "离线"}
            </span>
            <span className={`badge tone-${props.remoteCompletion?.remoteState === "syncing" ? "warning" : "muted"}`}>
              {remoteStateLabel(props.remoteCompletion?.remoteState)}
            </span>
            <span className="helper-line">完成度 {props.remoteCompletion?.completion ?? 0}% · 待同步 {props.remoteCompletion?.needItems ?? 0} 项</span>
            <ProgressBar
              percent={completionPercent(props.remoteCompletion)}
              tone={props.compare?.remoteConnected ? "success" : "muted"}
              label="接收进度"
            />
          </div>
        </div>

        <div className="review-sidebar-card">
          <div className="section-title">同步模式</div>
          <span className="badge tone-info" style={{ marginTop: 6 }}>{props.compare?.manualSync ? "手动审核接收" : "自动接收"}</span>
        </div>

        <div className="review-sidebar-card">
          <div className="section-title">索引状态</div>
          <span className="badge tone-muted" style={{ marginTop: 6 }}>{props.compare?.remoteConnected ? "实时" : "最近已知"}</span>
        </div>

        <div className="review-actions">
          <button className="ghost-button" onClick={props.onRefresh} disabled={props.compareBusy} style={{ width: "100%" }}>
            {props.compareBusy ? "刷新中..." : "刷新"}
          </button>
          <button
            className="ghost-button"
            onClick={props.onSyncVisible}
            disabled={!entries.some((entry) => entry.canPrioritize)}
            style={{ width: "100%" }}
          >
            {props.compare?.manualSync ? "同步当前结果" : "优先处理当前结果"}
          </button>
          <button
            className="primary-button"
            onClick={props.onSyncSelected}
            disabled={selectedCount === 0}
            style={{ width: "100%" }}
          >
            {props.compare?.manualSync ? "同步已选条目" : "优先处理已选条目"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferPanel(props: {
  folderId: string;
  downloadProgress?: Record<string, Record<string, { total: number; reused: number; copiedFromOrigin: number; copiedFromElsewhere: number; pulled: number; pulling: number; bytesDone: number; bytesTotal: number }>>;
  uploadProgress?: Record<string, Record<string, number>>;
  uploadFileInfo?: Record<string, { totalBlocks: number; size: number }>;
  completedUploads?: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }>;
  completedDownloads?: Array<{ folder: string; item: string; action: string; size: number; at: number }>;
  connectionRates?: { inbps: number; outbps: number };
}) {
  const folderDownload = props.downloadProgress?.[props.folderId] ?? {};
  const folderUpload = props.uploadProgress?.[props.folderId] ?? {};
  const downloadingFiles = Object.entries(folderDownload).map(([path, p]) => ({
    path,
    ...p,
    percent: p.bytesTotal > 0 ? Math.round((100 * p.bytesDone) / p.bytesTotal) : 0,
  }));
  const uploadingFiles = Object.entries(folderUpload).map(([key, blockCount]) => {
    const info = props.uploadFileInfo?.[key];
    const totalBlocks = info?.totalBlocks ?? 0;
    const size = info?.size ?? 0;
    return {
      path: key.includes("/") ? key.slice(key.indexOf("/") + 1) : key,
      blocksDownloaded: blockCount,
      totalBlocks,
      size,
      percent: totalBlocks > 0 ? Math.round((100 * blockCount) / totalBlocks) : -1,
    };
  });
  const dlBytesDone = downloadingFiles.reduce((s, f) => s + f.bytesDone, 0);
  const dlBytesTotal = downloadingFiles.reduce((s, f) => s + f.bytesTotal, 0);
  const dlPulled = downloadingFiles.reduce((s, f) => s + f.pulled, 0);
  const dlBlocks = downloadingFiles.reduce((s, f) => s + f.total, 0);
  const ulBlocks = uploadingFiles.reduce((s, f) => s + f.blocksDownloaded, 0);
  const ulTotalBlocks = uploadingFiles.reduce((s, f) => s + f.totalBlocks, 0);
  const completedDownloadsForFolder = (props.completedDownloads ?? []).filter((d) => d.folder === props.folderId).slice(0, 30);
  const completedUploadsForFolder = (props.completedUploads ?? []).filter((u) => u.folder === props.folderId).slice(0, 30);
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };
  const formatElapsed = (ts: number) => {
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}秒前`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
    return `${Math.floor(sec / 3600)}小时前`;
  };
  return (
    <div className="transfer-panel">
      <div className="panel-subsection">
        <div className="section-title">传输概览</div>
        <div className="transfer-stats-grid">
          <div className="transfer-stat">
            <span className="transfer-stat-label">正在下载</span>
            <span className="transfer-stat-value">{downloadingFiles.length} 个文件</span>
          </div>
          <div className="transfer-stat">
            <span className="transfer-stat-label">正在上传</span>
            <span className="transfer-stat-value">{uploadingFiles.length} 个文件</span>
          </div>
          {downloadingFiles.length > 0 && (
            <div className="transfer-stat">
              <span className="transfer-stat-label">下载进度</span>
              <span className="transfer-stat-value">{formatSize(dlBytesDone)} / {formatSize(dlBytesTotal)}</span>
            </div>
          )}
          {downloadingFiles.length > 0 && (
            <div className="transfer-stat">
              <span className="transfer-stat-label">下载块</span>
              <span className="transfer-stat-value">{dlPulled} / {dlBlocks}</span>
            </div>
          )}
          {uploadingFiles.length > 0 && (
            <div className="transfer-stat">
              <span className="transfer-stat-label">上传块</span>
              <span className="transfer-stat-value">{ulBlocks} / {ulTotalBlocks > 0 ? ulTotalBlocks : "?"}{ulTotalBlocks > 0 ? ` (${Math.round((100 * ulBlocks) / ulTotalBlocks)}%)` : ""}</span>
            </div>
          )}
          <div className="transfer-stat">
            <span className="transfer-stat-label">下行速率</span>
            <span className="transfer-stat-value">{formatRate(props.connectionRates?.inbps)}</span>
          </div>
          <div className="transfer-stat">
            <span className="transfer-stat-label">上行速率</span>
            <span className="transfer-stat-value">{formatRate(props.connectionRates?.outbps)}</span>
          </div>
        </div>
      </div>

      {downloadingFiles.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">正在下载 ({downloadingFiles.length})</div>
          <div className="transfer-file-list">
            {downloadingFiles.map((file) => (
              <div key={file.path} className="transfer-file-item">
                <div className="transfer-file-header">
                  <span className="transfer-file-path" title={file.path}>{file.path}</span>
                  <span className="transfer-file-percent">{file.percent}%</span>
                </div>
                <div className="transfer-progress-bar">
                  <div className="transfer-progress-fill" style={{ width: `${file.percent}%` }} />
                </div>
                <div className="transfer-file-detail">
                  {formatSize(file.bytesDone)} / {formatSize(file.bytesTotal)}
                  {" · 块"} {file.pulled} / {file.total}
                  {file.pulling > 0 && ` · 传输中 ${file.pulling}`}
                  {file.reused > 0 && ` · 复用 ${file.reused}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadingFiles.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">正在上传 ({uploadingFiles.length})</div>
          <div className="transfer-file-list">
            {uploadingFiles.map((file) => (
              <div key={file.path} className="transfer-file-item">
                <div className="transfer-file-header">
                  <span className="transfer-active-dot" />
                  <span className="transfer-file-path" title={file.path}>{file.path}</span>
                  {file.percent >= 0 && <span className="transfer-file-percent">{file.percent}%</span>}
                </div>
                {file.percent >= 0 ? (
                  <div className="transfer-progress-bar">
                    <div className="transfer-progress-fill" style={{ width: `${file.percent}%` }} />
                  </div>
                ) : (
                  <div className="transfer-progress-bar transfer-progress-indeterminate">
                    <div className="transfer-progress-fill" />
                  </div>
                )}
                <div className="transfer-file-detail">
                  {file.size > 0 && `${formatSize(file.size)} · `}
                  {file.blocksDownloaded} / {file.totalBlocks > 0 ? file.totalBlocks : "?"} 块
                  {file.totalBlocks > 0 && ` · ${file.percent}%`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {downloadingFiles.length === 0 && uploadingFiles.length === 0 && (
        <div className="panel-subsection">
          <div className="empty-mini">当前没有正在传输的文件。</div>
        </div>
      )}

      {completedUploadsForFolder.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">上传完成 ({completedUploadsForFolder.length})</div>
          <div className="transfer-file-list">
            {completedUploadsForFolder.map((item, i) => (
              <div key={`${item.file}-${i}`} className="transfer-file-item finished">
                <div className="transfer-file-header">
                  <span className="transfer-file-path" title={item.file}>{item.file}</span>
                  <span className="transfer-file-time">{formatElapsed(item.at)}</span>
                </div>
                <div className="transfer-file-detail">
                  {item.size > 0 && `${formatSize(item.size)} · `}
                  已传 {item.blocks} 个块 · {formatTime(item.at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedDownloadsForFolder.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">下载完成 ({completedDownloadsForFolder.length})</div>
          <div className="transfer-file-list">
            {completedDownloadsForFolder.map((item, i) => (
              <div key={`${item.item}-${i}`} className="transfer-file-item finished">
                <div className="transfer-file-header">
                  <span className="transfer-file-path" title={item.item}>{item.item}</span>
                  <span className="transfer-file-time">{formatElapsed(item.at)}</span>
                </div>
                <div className="transfer-file-detail">
                  {item.size > 0 && `${formatSize(item.size)} · `}
                  {item.action === "update" ? "更新" : item.action === "delete" ? "删除" : item.action === "create" ? "创建" : item.action}
                  {" · "}{formatTime(item.at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BiDiffPanel(props: {
  mode: "bidiff" | "peer";
  folder: FolderConfig;
  devices: DeviceConfig[];
  selectedDeviceId: string;
  onSelectDevice: (value: string) => void;
  selectedDevice: DeviceConfig | null;
  bidiff: BiDiffResult | null;
  bidiffBusy: boolean;
  bidiffError: string;
  bidiffView: string;
  onBidiffViewChange: (value: string) => void;
  bidiffPrefix: string;
  onBidiffPrefixChange: (value: string) => void;
  bidiffSelection: Record<string, boolean>;
  onBidiffSelectionChange: (value: Record<string, boolean>) => void;
  bidiffMessage: string;
  onRefresh: () => void;
  onApplyLeftToRight: () => void;
  onApplyRightToLeft: () => void;
  remoteCompletion?: CompletionStatus;
  scanBusy: boolean;
  activeTasks: BiDiffTask[];
  allTasks: BiDiffTask[];
  uiMode: UiMode;
  autoRefreshPaused: boolean;
  onToggleAutoRefreshPaused: () => void;
  titleStats?: (stats: { total: number; selected: number; leftToRight: number; rightToLeft: number; pending?: number; previewReady?: boolean }) => void;
  downloadProgress?: Record<string, Record<string, { total: number; reused: number; copiedFromOrigin: number; copiedFromElsewhere: number; pulled: number; pulling: number; bytesDone: number; bytesTotal: number }>>;
  uploadProgress?: Record<string, Record<string, number>>;
  uploadFileInfo?: Record<string, { totalBlocks: number; size: number }>;
  completedUploads?: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }>;
  completedDownloads?: Array<{ folder: string; item: string; action: string; size: number; at: number }>;
  connectionRates?: { inbps: number; outbps: number };
  workbenchView: "diff" | "transfer";
  onWorkbenchViewChange: (view: "diff" | "transfer") => void;
}) {
  const entries = useMemo(() => {
    const base = props.bidiff?.entries ?? [];
    if (props.bidiffView === "all-with-same") {
      return base;
    }
    return base.filter((entry) => !isGuiInertBiDiffEntry(entry));
  }, [props.bidiff?.entries, props.bidiffView]);
  const selectedTotal = entries.filter((entry) => props.bidiffSelection[entry.path]).length;
  const selectedLeftToRight = entries.filter((entry) => props.bidiffSelection[entry.path] && entry.canApplyLeftToRight).length;
  const selectedRightToLeft = entries.filter((entry) => props.bidiffSelection[entry.path] && entry.canApplyRightToLeft).length;
  const hasSelection = selectedTotal > 0;
  const selectedBlocked = Math.max(0, selectedTotal - Math.max(selectedLeftToRight, selectedRightToLeft));

  useEffect(() => {
    props.titleStats?.({
      total: props.bidiff?.total ?? 0,
      selected: selectedTotal,
      leftToRight: entries.filter((e) => e.canApplyLeftToRight).length,
      rightToLeft: entries.filter((e) => e.canApplyRightToLeft).length,
      pending: props.bidiff?.localPendingItems ?? 0,
      previewReady: props.bidiff?.remotePreviewAvailable,
    });
  }, [props.bidiff?.total, selectedTotal, entries, props.bidiff?.localPendingItems, props.bidiff?.remotePreviewAvailable]);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredPixels(BIDIFF_SIDEBAR_WIDTH_KEY, 280, 160, 420));
  const [timeMode, setTimeMode] = useState<"compact" | "full">(() => {
    try {
      const raw = window.localStorage.getItem(BIDIFF_TIME_MODE_KEY);
      return raw === "full" ? "full" : "compact";
    } catch {
      return "compact";
    }
  });
  const [fontScale, setFontScale] = useState<"xsmall" | "small" | "compact" | "normal" | "medium" | "large" | "xlarge">(() =>
    readStoredChoice(BIDIFF_FONT_SCALE_KEY, "normal", ["xsmall", "small", "compact", "normal", "medium", "large", "xlarge"] as const)
  );
  const [density, setDensity] = useState<BiDiffDensity>(() =>
    readStoredChoice(BIDIFF_DENSITY_KEY, "normal", ["relaxed", "normal", "compact", "tight"] as const)
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [treeMode, setTreeMode] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [columns, setColumns] = useState<ColumnDef[]>(() => biDiffColumnsForDensity(density, false));
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const treeNodes = useMemo(() => buildBiDiffTree(entries), [entries]);
  const treeRows = useMemo(() => flattenBiDiffTree(treeNodes, expandedDirs), [treeNodes, expandedDirs]);
  const mobileRows = treeMode ? treeRows : entries.map((entry) => ({ type: "file" as const, key: `file:${entry.path}`, node: { key: `file:${entry.path}`, name: entry.path, fullPath: entry.path, type: "file" as const, entry, children: [] }, depth: 0, guides: [], isLast: true, entry }));
  const rowTaskMap = useMemo(() => {
    const map = new Map<string, BiDiffTask>();
    for (const task of props.allTasks) {
      const current = map.get(task.path);
      if (!current || current.updatedAt < task.updatedAt) {
        map.set(task.path, task);
      }
    }
    return map;
  }, [props.allTasks]);
  const allSelectable = entries.length > 0 && entries.every((entry) => props.bidiffSelection[entry.path]);
  const someSelected = entries.some((entry) => props.bidiffSelection[entry.path]);

  useEffect(() => {
    setExpandedDirs((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const node of treeNodes) {
        if (!(node.key in next)) {
          next[node.key] = true;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [treeNodes]);

  useEffect(() => {
    if (!tableScrollRef.current) {
      return;
    }
    tableScrollRef.current.scrollLeft = 0;
  }, [sidebarCollapsed, props.selectedDeviceId, props.bidiffView, treeMode, density, fontScale]);

  useEffect(() => {
    if (!mainScrollRef.current) {
      return;
    }
    mainScrollRef.current.scrollLeft = 0;
  }, [sidebarCollapsed, props.selectedDeviceId, props.bidiffView, treeMode, density, fontScale]);

  if (props.devices.length === 0) {
    return (
      <div className="review-modal-layout">
        <div className="review-modal-main">
          <div className="empty-mini">这个文件夹当前没有共享设备，所以没有可裁决的右侧索引。</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`review-modal-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) ${sidebarCollapsed ? 56 : sidebarWidth}px` }}
    >
      <div ref={mainScrollRef} className="review-modal-main">
        {props.workbenchView === "transfer" ? (
          <TransferPanel
            folderId={props.folder.id}
            downloadProgress={props.downloadProgress}
            uploadProgress={props.uploadProgress}
            uploadFileInfo={props.uploadFileInfo}
            completedUploads={props.completedUploads}
            completedDownloads={props.completedDownloads}
            connectionRates={props.connectionRates}
          />
        ) : (
        <>
        <div className="review-toolbar review-toolbar-bidiff">
          <label>
            <span>裁决列</span>
            <button
              className="mini-button"
              onClick={() => {
                setColumns((prev) =>
                  prev.map((col) => (col.key === "action" ? { ...col, visible: col.visible === false ? true : false } : col))
                );
              }}
              title={columns.find((c) => c.key === "action")?.visible !== false ? "隐藏裁决列" : "显示裁决列"}
            >
              {columns.find((c) => c.key === "action")?.visible !== false ? "隐藏" : "显示"}
            </button>
          </label>
          <label>
            <span>紧凑模式</span>
            <select
              value={density}
              onChange={(event) => {
                const chosen = event.target.value as BiDiffDensity;
                const mode: BiDiffDensity = ["relaxed", "normal", "compact", "tight"].includes(chosen) ? chosen : "normal";
                setDensity(mode);
                setColumns((previous) => {
                  const actionVisible = previous.find((col) => col.key === "action")?.visible !== false;
                  return biDiffColumnsForDensity(mode, actionVisible);
                });
                try {
                  window.localStorage.setItem(BIDIFF_DENSITY_KEY, mode);
                } catch {
                  // Ignore storage failures.
                }
              }}
            >
              <option value="relaxed">宽松</option>
              <option value="normal">标准</option>
              <option value="compact">紧凑</option>
              <option value="tight">极紧凑</option>
            </select>
          </label>
          <label>
            <span>查看范围</span>
            <select value={props.bidiffView} onChange={(event) => props.onBidiffViewChange(event.target.value)}>
              {bidiffViewOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-grow">
            <span>路径前缀</span>
            <input value={props.bidiffPrefix} onChange={(event) => props.onBidiffPrefixChange(event.target.value)} placeholder="目录 / 子目录" />
          </label>
          <label>
            <span>显示方式</span>
            <select value={treeMode ? "tree" : "flat"} onChange={(event) => setTreeMode(event.target.value === "tree")}>
              <option value="tree">树状目录</option>
              <option value="flat">平铺文件</option>
            </select>
          </label>
          <label>
            <span>时间显示</span>
            <select
              value={timeMode}
              onChange={(event) => {
                const next = event.target.value === "full" ? "full" : "compact";
                setTimeMode(next);
                try {
                  window.localStorage.setItem(BIDIFF_TIME_MODE_KEY, next);
                } catch {
                  // Ignore storage failures.
                }
              }}
            >
              <option value="compact">简略</option>
              <option value="full">详细</option>
            </select>
          </label>
          <label>
            <span>列表字体</span>
            <select
              value={fontScale}
              onChange={(event) => {
                const next =
                  event.target.value === "xsmall" ||
                  event.target.value === "small" ||
                  event.target.value === "compact" ||
                  event.target.value === "medium" ||
                  event.target.value === "large" ||
                  event.target.value === "xlarge"
                    ? event.target.value
                    : "normal";
                setFontScale(next);
                try {
                  window.localStorage.setItem(BIDIFF_FONT_SCALE_KEY, next);
                } catch {
                  // Ignore storage failures.
                }
              }}
            >
              <option value="xsmall">极小</option>
              <option value="small">很小</option>
              <option value="compact">紧凑</option>
              <option value="normal">标准</option>
              <option value="medium">稍大</option>
              <option value="large">偏大</option>
              <option value="xlarge">大号</option>
            </select>
          </label>
        </div>
        <div className="review-stats">
          <span className="badge tone-info">{props.mode === "peer" ? "对等差异工作台" : "中立差异裁决"}</span>
          <span className={`badge tone-${props.bidiff?.rightConnected ? "success" : "warning"}`}>{props.bidiff?.rightConnected ? "右侧已连接" : "右侧离线"}</span>
          {(selectedLeftToRight > 0 || selectedRightToLeft > 0 || selectedBlocked > 0) && (
            <span>
              当前已选：左→右 {selectedLeftToRight} / 右→左 {selectedRightToLeft}
              {selectedBlocked > 0 ? ` / 仅选中未执行 ${selectedBlocked}` : ""}
            </span>
          )}
          <label className="review-inline-select">
            <span>侧栏宽度</span>
            <select
              value={sidebarWidth}
              onChange={(event) => {
                const next = Number(event.target.value) || 280;
                setSidebarWidth(next);
                storePixels(BIDIFF_SIDEBAR_WIDTH_KEY, next);
              }}
            >
              <option value={160}>极窄</option>
              <option value={180}>很窄</option>
              <option value={200}>较窄</option>
              <option value={220}>微窄</option>
              <option value={240}>偏窄</option>
              <option value={280}>标准</option>
              <option value={320}>稍宽</option>
              <option value={360}>宽</option>
              <option value={400}>更宽</option>
            </select>
          </label>
          <button
            className="ghost-button compact-button"
            onClick={() => setSidebarCollapsed((previous) => !previous)}
            title={sidebarCollapsed ? "展开右侧面板" : "收起右侧面板"}
          >
            {sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          </button>
          {treeMode && (
            <>
              <button
                className="ghost-button compact-button"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  const walk = (nodes: BiDiffTreeNode[]) => {
                    for (const node of nodes) {
                      if (node.type === "dir") {
                        next[node.key] = true;
                        walk(node.children);
                      }
                    }
                  };
                  walk(treeNodes);
                  setExpandedDirs(next);
                }}
              >
                全部展开
              </button>
              <button
                className="ghost-button compact-button"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  const walk = (nodes: BiDiffTreeNode[]) => {
                    for (const node of nodes) {
                      if (node.type === "dir") {
                        next[node.key] = false;
                        walk(node.children);
                      }
                    }
                  };
                  walk(treeNodes);
                  setExpandedDirs(next);
                }}
              >
                全部折叠
              </button>
            </>
          )}
        </div>
        {props.mode === "bidiff" && (!props.bidiff?.manualSync || !props.bidiff?.manualPublish) && (
          <div className="inline-message warning">
            当前文件夹还在自动同步模式。为了保证“只按你选中的文件裁决”，双向裁决建议与手动模式配合使用：
            {!props.bidiff?.manualSync && " 先开启手动审核接收；"}
            {!props.bidiff?.manualPublish && " 先开启手动审核发布；"}
          </div>
        )}
        {props.bidiffMessage && <div className="inline-message info">{props.bidiffMessage}</div>}
        {props.bidiffError && <div className="inline-message danger">{props.bidiffError}</div>}
        {hasSelection && selectedLeftToRight === 0 && selectedRightToLeft === 0 && (
          <div className="inline-message warning">
            当前已选 {selectedTotal} 项，但这些条目暂时都不可执行，所以“采用左侧 / 采用右侧”仍然是 0。
          </div>
        )}

        {props.uiMode === "mobile" ? (
          <div className={`bidiff-mobile-list bidiff-font-${fontScale} bidiff-density-${density}`}>
            {mobileRows.map((row) => {
              if (row.type === "dir") {
                const selectableEntries = row.entries;
                const selectedCount = selectableEntries.filter((entry) => props.bidiffSelection[entry.path]).length;
                const open = expandedDirs[row.node.key] !== false;
                return (
                  <div key={row.key} className={`bidiff-mobile-dir${selectedCount > 0 ? " contains-selected" : ""}${open ? " is-open" : ""}`}>
                    <div className="bidiff-mobile-dir-head">
                      <TreeCheckbox
                        checked={selectableEntries.length > 0 && selectedCount === selectableEntries.length}
                        indeterminate={selectedCount > 0 && selectedCount < selectableEntries.length}
                        onChange={(checked) => {
                          const next = { ...props.bidiffSelection };
                          for (const entry of selectableEntries) {
                            next[entry.path] = checked;
                          }
                          props.onBidiffSelectionChange(next);
                        }}
                      />
                      <button
                        className="tree-toggle"
                        onClick={() => setExpandedDirs((previous) => ({ ...previous, [row.node.key]: !open }))}
                        title={open ? "收起目录" : "展开目录"}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                      <span className="tree-folder-chip" aria-hidden="true">▣</span>
                      <div className="bidiff-mobile-dir-meta">
                        <strong>{row.node.name}</strong>
                        <span>{row.entries.length} 项差异{selectedCount > 0 ? ` / 已选 ${selectedCount}` : ""}</span>
                      </div>
                    </div>
                  </div>
                );
              }
              const entry = row.entry;
              const selected = Boolean(props.bidiffSelection[entry.path]);
              const currentTask = props.activeTasks.find((task) => task.path === entry.path && task.status !== "completed");
              const actionability = bidiffActionabilityLabel(entry);
              const renameRole = bidiffRenameRole(entry);
              return (
                <div
                  key={entry.path}
                  className={`compare-card tone-${statusTone(entry.status)}${selected ? " selected" : ""}`}
                >
                  <div className="compare-card-select">
                    <TreeCheckbox
                      checked={selected}
                      onChange={(checked) =>
                        props.onBidiffSelectionChange({
                          ...props.bidiffSelection,
                          [entry.path]: checked,
                        })
                      }
                    />
                  </div>
                  <div className="compare-card-main bidiff-mobile-card-main">
                    <div className={`file-side tone-${statusTone(entry.status)}`}>
                      <div className="compare-card-side-title">左侧</div>
                      <div className="compare-card-side-metrics">
                        <span>{entry.left ? formatBinary(entry.left.size) : "不存在"}</span>
                        <span>{entry.left ? formatDate(entry.left.modified, timeMode) : "-"}</span>
                      </div>
                    </div>
                    <div className="compare-card-center bidiff-mobile-card-center">
                      <div className="compare-status-badges">
                        <span className={`badge compare-status-badge kind-${bidiffKind(entry)}`}>{bidiffStatusLabel(entry)}</span>
                        <span className={`badge compare-action-badge ${actionability.className}`} title={actionability.title}>{actionability.label}</span>
                      </div>
                      <div className="path-line" title={bidiffRenameInlineText(entry, entry.path)}>
                        <span className={`compare-tree-file-combined ${renameRole === "new" ? "rename-new-path" : renameRole === "old" ? "rename-old-path" : ""}`}>
                          {bidiffRenameInlineText(entry, entry.path)}
                        </span>
                      </div>
                      {currentTask && (
                        <div className="compare-inline-progress">
                          <span className={`badge tone-${bidiffTaskTone(currentTask.status)}`}>{bidiffTaskLabel(currentTask.status)}</span>
                          <ProgressBar percent={bidiffTaskPercent(currentTask.status)} tone={bidiffTaskTone(currentTask.status)} />
                        </div>
                      )}
                    </div>
                    <div className={`file-side tone-${statusTone(entry.status)}`}>
                      <div className="compare-card-side-title">右侧</div>
                      <div className="compare-card-side-metrics">
                        <span>{entry.right ? formatBinary(entry.right.size) : "不存在"}</span>
                        <span>{entry.right ? formatDate(entry.right.modified, timeMode) : "-"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {entries.length === 0 && !props.bidiffBusy && <div className="compare-empty">当前筛选条件下没有差异项。</div>}
          </div>
        ) : (
          <>
            <ResizableTable
              columns={columns}
              onColumnsChange={setColumns}
              className={`bidiff-table bidiff-font-${fontScale} bidiff-density-${density}`}
              wrapperRef={tableScrollRef}
            >
              <thead>
                <tr>
                  {renderResizableHeaders(columns, setColumns, {
                    checkbox: (
                      <TreeCheckbox
                        checked={allSelectable}
                        indeterminate={someSelected && !allSelectable}
                        onChange={(checked) => {
                          const next: Record<string, boolean> = {};
                          if (checked) {
                            for (const entry of entries) {
                              next[entry.path] = true;
                            }
                          }
                          props.onBidiffSelectionChange(next);
                        }}
                      />
                    ),
                  })}
                </tr>
              </thead>
              <tbody>
                {(treeMode ? treeRows : entries.map((entry) => ({ type: "file" as const, key: `file:${entry.path}`, node: { key: `file:${entry.path}`, name: entry.path, fullPath: entry.path, type: "file" as const, entry, children: [] }, depth: 0, entry }))).map((row) => {
              if (row.type === "dir") {
                const selectableEntries = row.entries;
                const selectedCount = selectableEntries.filter((entry) => props.bidiffSelection[entry.path]).length;
                const allSelected = selectableEntries.length > 0 && selectedCount === selectableEntries.length;
                const hasSelectedDescendants = selectedCount > 0;
                const leftLiveCount = row.entries.filter((entry) => bidiffHasLiveFile(entry.left)).length;
                const rightLiveCount = row.entries.filter((entry) => bidiffHasLiveFile(entry.right)).length;
                const open = expandedDirs[row.node.key] !== false;
                const branchActive = open || hasExpandedDirDescendant(row.node, expandedDirs);
                return (
                  <tr
                    key={row.key}
                    className={`compare-tree-row compare-tree-dir-row${hasSelectedDescendants ? " contains-selected" : ""}${open ? " is-open" : ""}${branchActive ? " branch-active" : ""}`}
                  >
                    <td className="compare-checkbox-cell">
                      <TreeCheckbox
                        checked={allSelected}
                        indeterminate={selectedCount > 0 && !allSelected}
                        onChange={(checked) => {
                          const next = { ...props.bidiffSelection };
                          for (const entry of selectableEntries) {
                            next[entry.path] = checked;
                          }
                          props.onBidiffSelectionChange(next);
                        }}
                      />
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">{leftLiveCount}</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">-</span>
                      </div>
                    </td>
                    {columns.find((c) => c.key === "action")?.visible !== false && (
                      <td>
                        <div className="compare-cell-center">
                          <span className="badge compare-action-badge action-both" title="目录包含可裁决子项">
                            ≡
                          </span>
                        </div>
                      </td>
                    )}
                    <td className="compare-tree-name-cell">
                      <div className="compare-tree-summary">
                        <TreePrefix depth={row.depth} guides={row.guides} isLast={row.isLast} />
                        <button
                          className="tree-toggle"
                          onClick={() => setExpandedDirs((previous) => ({ ...previous, [row.node.key]: !open }))}
                          title={open ? "收起目录" : "展开目录"}
                        >
                          {open ? "▾" : "▸"}
                        </button>
                        <span className="tree-folder-chip" aria-hidden="true">▣</span>
                        <span className="compare-tree-name compare-tree-dir-name">{row.node.name}</span>
                        <span className="compare-tree-dir-summary">
                          {row.entries.length} 项差异
                          {hasSelectedDescendants ? ` / 已选 ${selectedCount}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">-</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">{rightLiveCount}</span>
                      </div>
                    </td>
                  </tr>
                );
              }
              const entry = row.entry;
              const selected = Boolean(props.bidiffSelection[entry.path]);
              const kind = bidiffKind(entry);
              const renameRole = bidiffRenameRole(entry);
              const canSelect = entry.canApplyLeftToRight || entry.canApplyRightToLeft;
              const actionability = bidiffActionabilityLabel(entry);
              const currentTask = rowTaskMap.get(entry.path);
              const showAction = columns.find((c) => c.key === "action")?.visible !== false;
              return (
                <tr
                  key={entry.path}
                  className={`compare-tree-file-row tone-${statusTone(entry.status)} kind-${kind}${selected ? " selected" : ""}${currentTask ? ` task-${currentTask.status}` : ""}`}
                >
                  <td className="compare-checkbox-cell">
                    <TreeCheckbox
                      checked={selected}
                      onChange={(checked) =>
                        props.onBidiffSelectionChange({
                          ...props.bidiffSelection,
                          [entry.path]: checked,
                        })
                      }
                    />
                  </td>
                  <td>
                    <BiDiffSizeCell file={entry.left} missingLabel="不存在" />
                  </td>
                  <td>
                    <BiDiffTimeCell file={entry.left} missingLabel="不存在" dateMode={timeMode} />
                  </td>
                  {showAction && (
                    <td>
                      <div className="compare-cell-center compare-action-column">
                        <span className={`badge compare-action-badge ${actionability.className}`} title={actionability.title}>
                          {actionability.label}
                        </span>
                      </div>
                    </td>
                  )}
                  <td>
                    <div className="compare-status-cell compare-status-stack">
                      {treeMode ? (
                        <div className="compare-tree-fileline" title={bidiffRenameInlineText(entry, entry.path)}>
                          <TreePrefix depth={row.depth} guides={row.guides} isLast={row.isLast} />
                          <span className="tree-file-dot" aria-hidden="true" />
                          <span className={`compare-tree-name compare-tree-file-name compare-tree-file-combined${renameRole === "new" ? " rename-new-path" : renameRole === "old" ? " rename-old-path" : ""}`}>
                            {bidiffRenameInlineText(entry, row.node.name)}
                          </span>
                        </div>
                      ) : (
                        <div className="compare-path compare-main-path compare-main-path-combined" title={bidiffRenameInlineText(entry, entry.path)}>
                          <span className={`compare-tree-file-combined ${renameRole === "new" ? "rename-new-path" : renameRole === "old" ? "rename-old-path" : ""}`}>
                            {bidiffRenameInlineText(entry, entry.path)}
                          </span>
                        </div>
                      )}
                      {currentTask && (
                        <div className="compare-inline-progress">
                          <ProgressBar percent={bidiffTaskPercent(currentTask.status)} tone={bidiffTaskTone(currentTask.status)} />
                        </div>
                      )}
                      {!entry.canApplyLeftToRight && entry.leftToRightReason && (
                        <div className="helper-line">采用左侧受限：{entry.leftToRightReason}</div>
                      )}
                      {!entry.canApplyRightToLeft && entry.rightToLeftReason && (
                        <div className="helper-line">采用右侧受限：{entry.rightToLeftReason}</div>
                      )}
                    </div>
                  </td>
                  <td>
                    <BiDiffTimeCell file={entry.right} missingLabel="不存在" dateMode={timeMode} />
                  </td>
                  <td>
                    <BiDiffSizeCell file={entry.right} missingLabel="不存在" />
                  </td>
                </tr>
              );
                })}
              </tbody>
            </ResizableTable>
            {entries.length === 0 && !props.bidiffBusy && <div className="compare-empty">当前筛选条件下没有差异项。</div>}
          </>
        )}
        </>
        )}
      </div>

      <div className="review-modal-sidebar">
        <button
          className={`review-sidebar-edge-toggle${sidebarCollapsed ? " is-collapsed" : ""}`}
          onClick={() => setSidebarCollapsed((previous) => !previous)}
          title={sidebarCollapsed ? "展开右侧面板" : "收起右侧面板"}
          aria-label={sidebarCollapsed ? "展开右侧面板" : "收起右侧面板"}
        >
          {sidebarCollapsed ? "◂" : "▸"}
        </button>
        {sidebarCollapsed ? (
          <div className="review-sidebar-collapsed">
            <span className={`badge tone-${props.bidiff?.rightConnected ? "success" : "warning"}`} title={deviceName(props.selectedDevice ?? undefined)}>
              {props.bidiff?.rightConnected ? "连" : "离"}
            </span>
          </div>
        ) : (
          <>
        <div className="review-sidebar-card">
          <div className="section-title">目标设备</div>
          <select value={props.selectedDeviceId} onChange={(event) => props.onSelectDevice(event.target.value)} style={{ width: "100%", marginTop: 6 }}>
            {props.devices.map((device) => (
              <option key={device.deviceID} value={device.deviceID}>
                {deviceName(device)}
              </option>
            ))}
          </select>
          <div className="review-target-status">
            <span className={`badge tone-${props.bidiff?.rightConnected ? "success" : "warning"}`}>{props.bidiff?.rightConnected ? "已连接" : "离线"}</span>
            <span className={`badge tone-${props.remoteCompletion?.remoteState === "syncing" ? "warning" : "muted"}`}>{remoteStateLabel(props.remoteCompletion?.remoteState)}</span>
            <span className="helper-line">右侧完成度 {props.remoteCompletion?.completion ?? 0}% · 待同步 {props.remoteCompletion?.needItems ?? 0} 项</span>
            <ProgressBar percent={completionPercent(props.remoteCompletion)} tone={props.bidiff?.rightConnected ? "success" : "muted"} label="右侧进度" />
          </div>
        </div>

        <div className="review-actions">
          <button className="ghost-button" onClick={props.onRefresh} disabled={props.bidiffBusy} style={{ width: "100%" }}>
            {props.bidiffBusy ? "刷新中..." : props.scanBusy ? "扫描本地并刷新..." : "刷新全部差异"}
          </button>
          <button className="ghost-button" onClick={props.onToggleAutoRefreshPaused} style={{ width: "100%" }}>
            {props.autoRefreshPaused ? "恢复自动刷新" : "暂停自动刷新"}
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              const next: Record<string, boolean> = {};
              for (const entry of entries) {
                next[entry.path] = true;
              }
              props.onBidiffSelectionChange(next);
            }}
            disabled={entries.length === 0}
            style={{ width: "100%" }}
          >
            选中当前筛选结果
          </button>
          <button
            className="ghost-button"
            onClick={() => props.onBidiffSelectionChange({})}
            disabled={!hasSelection}
            style={{ width: "100%" }}
          >
            清空选择
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (
                props.mode === "bidiff" &&
                !window.confirm("采用左侧会把当前设备状态推向右侧。最好确保远端自动接收，或后续在远端继续处理。是否继续？")
              ) {
                return;
              }
              props.onApplyLeftToRight();
            }}
            disabled={selectedLeftToRight === 0}
            style={{ width: "100%" }}
            title={props.mode === "bidiff" ? "把当前设备状态推到右侧。最好确保远端自动接收。" : "把当前设备状态推到右侧"}
          >
            采用左侧（可执行 {selectedLeftToRight} / 已选 {selectedTotal}）
          </button>
          <button
            className="primary-button secondary-fill"
            onClick={props.onApplyRightToLeft}
            disabled={selectedRightToLeft === 0}
            style={{ width: "100%" }}
            title="把右侧状态应用到当前设备"
          >
            采用右侧（可执行 {selectedRightToLeft} / 已选 {selectedTotal}）
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function PublishReviewPanel(props: {
  folder: FolderConfig;
  publish: PendingPublishResult | null;
  publishBusy: boolean;
  publishError: string;
  publishView: string;
  onPublishViewChange: (value: string) => void;
  publishPrefix: string;
  onPublishPrefixChange: (value: string) => void;
  publishSelection: Record<string, boolean>;
  onPublishSelectionChange: (value: Record<string, boolean>) => void;
  publishMessage: string;
  onRefresh: () => void;
  onPublishSelected: () => void;
  onPublishVisible: () => void;
  onClearSettledSelected: () => void;
  onClearSettledVisible: () => void;
  devices: DeviceConfig[];
  devicesById: Map<string, DeviceConfig>;
  completions: Record<string, Record<string, CompletionStatus>>;
  connections: ConnectionsResponse | null;
}) {
  const entries = props.publish?.entries ?? [];
  const selectedCount = entries.filter((entry) => props.publishSelection[entry.path] && entry.canPublish).length;
  const selectedClearCount = entries.filter((entry) => props.publishSelection[entry.path] && entry.canClear).length;
  const clearableCount = entries.filter((entry) => entry.canClear).length;
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const publishEmptyText = !canPublish(props.folder)
    ? "当前文件夹没有发布能力，所以这里不会出现待发布项。"
    : props.publishBusy && !props.publish
      ? "正在加载发布审核数据..."
      : "当前筛选条件下没有待发布项。";
  const [columns, setColumns] = useState<ColumnDef[]>([
    { key: "checkbox", label: "", width: 40, minWidth: 40 },
    { key: "leftSize", label: "待发布大小", width: 90, minWidth: 64 },
    { key: "leftTime", label: "待发布时间", width: 100, minWidth: 76 },
    { key: "status", label: "状态", width: 132, minWidth: 108 },
    { key: "summary", label: "名称 / 路径", width: 320, minWidth: 220 },
    { key: "rightTime", label: "可见时间", width: 100, minWidth: 76 },
    { key: "rightSize", label: "可见大小", width: 90, minWidth: 64 },
  ]);
  const treeNodes = useMemo(() => buildReviewTree(entries), [entries]);
  const treeRows = useMemo(() => flattenReviewTree(treeNodes, expandedDirs), [treeNodes, expandedDirs]);

  useEffect(() => {
    setExpandedDirs((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const node of treeNodes) {
        if (!(node.key in next)) {
          next[node.key] = true;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [treeNodes]);
  return (
    <div className="review-modal-layout">
      <div className="review-modal-main">
        <div className="review-toolbar">
          <label>
            <span>查看范围</span>
            <select value={props.publishView} onChange={(event) => props.onPublishViewChange(event.target.value)}>
              {publishViewOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-grow">
            <span>路径前缀</span>
            <input value={props.publishPrefix} onChange={(event) => props.onPublishPrefixChange(event.target.value)} placeholder="目录 / 子目录" />
          </label>
          <button className="ghost-button compact-button" onClick={() => setExpandedDirs((previous) => Object.keys(previous).reduce<Record<string, boolean>>((acc, key) => ({ ...acc, [key]: true }), {}))}>
            全部展开
          </button>
          <button className="ghost-button compact-button" onClick={() => setExpandedDirs((previous) => Object.keys(previous).reduce<Record<string, boolean>>((acc, key) => ({ ...acc, [key]: false }), {}))}>
            全部折叠
          </button>
        </div>

        <div className="review-stats">
          <span className="badge tone-info">{props.publish?.manualPublish ? "手动审核发布" : "自动发布"}</span>
          <span>共享设备：{props.devices.length}</span>
          <span>共 {props.publish?.total ?? 0} 项</span>
          <span>可发布 {entries.filter((entry) => entry.canPublish).length} 项</span>
          <span>可清理 {clearableCount} 项</span>
          <span>已选 {selectedCount} 项</span>
        </div>
        <div className="review-mobile-hint">手机建议横屏查看；表格可左右滑动，按住列头分隔线可调整列宽。若 Android 内置 WebGUI 操作不顺，建议改用“在浏览器中打开”后再查看。</div>

        {props.publishMessage && <div className="inline-message info">{props.publishMessage}</div>}
        {props.publishError && <div className="inline-message danger">{props.publishError}</div>}
        {props.publishBusy && entries.length === 0 && <div className="compare-empty">正在加载发布审核数据...</div>}

        <ResizableTable columns={columns} onColumnsChange={setColumns} className="compare-table bidiff-table bidiff-font-normal bidiff-density-normal">
          <thead>
            <tr>{renderResizableHeaders(columns, setColumns)}</tr>
          </thead>
          <tbody>
            {treeRows.map((row) => {
              if (row.type === "dir") {
                const selectableEntries = row.entries.filter((entry) => entry.canPublish || entry.canClear);
                const selectedChildren = selectableEntries.filter((entry) => props.publishSelection[entry.path]).length;
                const open = expandedDirs[row.node.key] !== false;
                const branchActive = hasExpandedReviewDirDescendant(row.node, expandedDirs);
                return (
                  <tr
                    key={row.key}
                    className={`compare-tree-row compare-tree-dir-row${selectedChildren > 0 ? " contains-selected" : ""}${open ? " is-open" : ""}${branchActive ? " branch-active" : ""}`}
                  >
                    <td className="compare-checkbox-cell">
                      {selectableEntries.length > 0 ? (
                        <input
                          type="checkbox"
                          className="compare-checkbox"
                          checked={selectedChildren > 0 && selectedChildren === selectableEntries.length}
                          onChange={(event) => {
                            const next = { ...props.publishSelection };
                            for (const entry of selectableEntries) {
                              if (event.target.checked) {
                                next[entry.path] = true;
                              } else {
                                delete next[entry.path];
                              }
                            }
                            props.onPublishSelectionChange(next);
                          }}
                        />
                      ) : null}
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">{row.entries.filter((entry) => entry.local && !entry.local.deleted).length}</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-placeholder">—</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side compare-dir-side-center">
                        <span className="compare-dir-placeholder">目录</span>
                      </div>
                    </td>
                    <td className="compare-tree-name-cell">
                      <div className="compare-tree-summary">
                        <TreePrefix depth={row.depth} guides={row.guides} isLast={row.isLast} />
                        <button className="tree-toggle" onClick={() => setExpandedDirs((previous) => ({ ...previous, [row.node.key]: !open }))}>
                          {open ? "▾" : "▸"}
                        </button>
                        <span className="tree-folder-chip tree-folder-icon" aria-hidden="true">📁</span>
                        <span className="compare-tree-name compare-tree-dir-name">{row.node.name}</span>
                        <span className="compare-tree-dir-summary">
                          {row.entries.length} 项差异{selectedChildren > 0 ? ` / 已选 ${selectedChildren}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-placeholder">—</span>
                      </div>
                    </td>
                    <td>
                      <div className="compare-dir-side">
                        <span className="compare-dir-metric">{row.entries.filter((entry) => entry.global && !entry.global.deleted).length}</span>
                      </div>
                    </td>
                  </tr>
                );
              }

              const entry = row.entry;
              const selected = Boolean(props.publishSelection[entry.path]);
              const tone = entry.settled ? "muted" : entry.renameCandidate ? "info" : entry.action === "delete" ? "danger" : entry.action === "added" ? "success" : "warning";
              const renameRole = pendingRenameRole(entry);
              return (
                <tr
                  key={entry.path}
                  className={`compare-tree-file-row tone-${tone}${selected ? " selected" : ""}`}
                >
                  <td className="compare-checkbox-cell">
                    <input
                      type="checkbox"
                      className="compare-checkbox"
                      checked={selected}
                      disabled={!(entry.canPublish || entry.canClear)}
                      onChange={(event) =>
                        props.onPublishSelectionChange({
                          ...props.publishSelection,
                          [entry.path]: event.target.checked,
                        })
                      }
                    />
                  </td>
                  <td>
                    <BiDiffSizeCell file={entry.local} missingLabel="不存在" />
                  </td>
                  <td>
                    <BiDiffTimeCell file={entry.local} missingLabel="不存在" dateMode="compact" />
                  </td>
                  <td>
                    <div className="compare-cell-center compare-status-column">
                      <div className="compare-status-badges">
                        <span className={`badge compare-status-badge tone-${tone}`}>{pendingPublishLabel(entry)}</span>
                        {renameRole && (
                          <span className={`badge compare-role-badge role-${renameRole}`}>
                            {renameRole === "old" ? "旧路径" : "新路径"}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="compare-status-cell compare-status-stack">
                      <div className="compare-tree-fileline" title={entry.path}>
                        <TreePrefix depth={row.depth} guides={row.guides} isLast={row.isLast} />
                        <span className="tree-file-dot" aria-hidden="true" />
                        <span className="compare-tree-name compare-tree-file-name">{row.node.name}</span>
                      </div>
                      {entry.renameCandidate ? (
                        <div className={`helper-line compare-pair-line role-${renameRole || "pair"}`}>
                          {renameRole === "new"
                            ? `新路径；旧路径：${entry.renameCandidate}`
                            : `旧路径；新路径：${entry.renameCandidate}`}
                        </div>
                      ) : null}
                      {entry.settled && <div className="helper-line">已与当前全局状态一致，可直接清理待发布标记。</div>}
                    </div>
                  </td>
                  <td>
                    <BiDiffTimeCell file={entry.global} missingLabel="尚未对外可见" dateMode="compact" />
                  </td>
                  <td>
                    <BiDiffSizeCell file={entry.global} missingLabel="尚未对外可见" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResizableTable>

        {entries.length === 0 && !props.publishBusy && (
          <div className="compare-empty">{publishEmptyText}</div>
        )}
      </div>

      <div className="review-modal-sidebar">
        <div>
          <div className="section-title">共享设备</div>
          <div className="device-stack" style={{ marginTop: 6, gap: 8 }}>
            {props.devices.map((device) => {
              const completion = props.completions[device.deviceID]?.[props.folder.id];
              const connected = Boolean(props.connections?.connections[device.deviceID]?.connected);
              return (
                <div key={device.deviceID} className="device-mini-card">
                  <div className="device-card-top">
                    <strong>{deviceName(props.devicesById.get(device.deviceID))}</strong>
                    <span className={`badge tone-${connected ? "success" : "muted"}`}>{connected ? "已连接" : "离线"}</span>
                  </div>
                  <div className="device-meta">
                    状态：{remoteStateLabel(completion?.remoteState)} · {completion?.completion ?? 0}%
                  </div>
                  <ProgressBar percent={completionPercent(completion)} tone={connected ? "success" : "muted"} />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="section-title">发布模式</div>
          <span className="badge tone-info" style={{ marginTop: 6 }}>
            {props.publish?.manualPublish ? "手动审核发布" : "自动发布"}
          </span>
        </div>

        <div className="review-actions">
          <button className="ghost-button" onClick={props.onRefresh} disabled={props.publishBusy} style={{ width: "100%" }}>
            {props.publishBusy ? "刷新中..." : "刷新"}
          </button>
          <button
            className="ghost-button"
            onClick={props.onPublishVisible}
            disabled={!entries.some((entry) => entry.canPublish)}
            style={{ width: "100%" }}
          >
            发布当前结果
          </button>
          <button
            className="ghost-button"
            onClick={() =>
              props.onPublishSelectionChange(
                entries.reduce<Record<string, boolean>>((acc, entry) => {
                  if (entry.canClear) {
                    acc[entry.path] = true;
                  }
                  return acc;
                }, {}),
              )
            }
            disabled={clearableCount === 0}
            style={{ width: "100%" }}
          >
            选中已收敛项
          </button>
          <button
            className="primary-button"
            onClick={props.onPublishSelected}
            disabled={selectedCount === 0}
            style={{ width: "100%" }}
          >
            发布已选条目
          </button>
          <button
            className="primary-button secondary-fill"
            onClick={props.onClearSettledVisible}
            disabled={clearableCount === 0}
            style={{ width: "100%" }}
          >
            清理全部已收敛项
          </button>
          <button
            className="ghost-button"
            onClick={props.onClearSettledSelected}
            disabled={selectedClearCount === 0}
            style={{ width: "100%" }}
          >
            清理已选收敛项
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalShell(props: { title: ReactNode; titleExtra?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section className="modal-shell surface" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">工作台</div>
            <h3>{props.title}</h3>
          </div>
          {props.titleExtra && <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>{props.titleExtra}</div>}
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <div className="modal-content">{props.children}</div>
      </section>
    </div>
  );
}

function WorkbenchTitle(props: {
  label: string;
  device?: DeviceConfig | null;
  connection?: DeviceConnection;
  rates?: { inbps: number; outbps: number };
  stats?: { total: number; selected: number; leftToRight: number; rightToLeft: number; pending?: number; previewReady?: boolean } | null;
  isPeer?: boolean;
}) {
  const device = props.device ? deviceName(props.device) : "未选择设备";
  const down = formatRate(props.rates?.inbps ?? props.connection?.inbps);
  const up = formatRate(props.rates?.outbps ?? props.connection?.outbps);
  const s = props.stats;
  return (
    <span className="workbench-title-inline">
      <span>{props.label}</span>
      <span className="workbench-title-meta">
        · {device} · ↓ {down} · ↑ {up}
        {s && (
          <>
            {" · 共"} {s.total} 项 · 已选 {s.selected} · 左→右 {s.leftToRight} · 右→左 {s.rightToLeft}
            {props.isPeer && s.pending != null && ` · 未发布 ${s.pending}`}
            {props.isPeer && (s.previewReady ? " · 预览已接收" : " · 预览未接收")}
          </>
        )}
      </span>
    </span>
  );
}

function SettingsHubPanel(props: {
  optionsDraft: OptionsConfig | null;
  onOptionsChange: (value: OptionsConfig | null) => void;
  onSaveOptions: () => void;
  optionsBusy: boolean;
  optionsMessage: string;
  onCreateFolder: () => void;
  onCreateDevice: () => void;
  newFolderBusy: boolean;
  newDeviceBusy: boolean;
  devices: DeviceConfig[];
  folders: FolderConfig[];
  onEditDevice: (device: DeviceConfig) => void;
  onEditFolder: (folder: FolderConfig) => void;
  onRestart: () => void;
  onShutdown: () => void;
  systemActionBusy: "" | "restart" | "shutdown";
  systemActionMessage: string;
}) {
  const options = props.optionsDraft;
  const update = (patch: Partial<OptionsConfig>) => props.onOptionsChange({ ...(options ?? {}), ...patch });

  return (
    <section className="settings-modal-stack">
      <div className="panel surface">
        <div className="panel-header">
          <div>
            <div className="eyebrow">全局设置</div>
            <h3>连接与刷新</h3>
          </div>
          <div className="panel-actions">
            <button className="primary-button" onClick={props.onSaveOptions} disabled={props.optionsBusy || !options}>
              {props.optionsBusy ? "保存中..." : "保存全局设置"}
            </button>
          </div>
        </div>
        {props.optionsMessage && <div className="inline-message info">{props.optionsMessage}</div>}
        {options ? (
          <>
            <div className="settings-grid">
              <label>
                <span>自动升级间隔（小时）</span>
                <input
                  type="number"
                  min={0}
                  value={options.autoUpgradeIntervalH ?? 0}
                  onChange={(event) => update({ autoUpgradeIntervalH: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                <span>进度更新间隔（秒）</span>
                <input
                  type="number"
                  min={1}
                  value={options.progressUpdateIntervalS ?? 0}
                  onChange={(event) => update({ progressUpdateIntervalS: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                <span>重连间隔（秒）</span>
                <input
                  type="number"
                  min={5}
                  value={options.reconnectionIntervalS ?? 0}
                  onChange={(event) => update({ reconnectionIntervalS: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                <span>全局发送限速（KiB/s）</span>
                <input
                  type="number"
                  min={0}
                  value={options.maxSendKbps ?? 0}
                  onChange={(event) => update({ maxSendKbps: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                <span>全局接收限速（KiB/s）</span>
                <input
                  type="number"
                  min={0}
                  value={options.maxRecvKbps ?? 0}
                  onChange={(event) => update({ maxRecvKbps: Number(event.target.value) || 0 })}
                />
              </label>
              <label className="wide-field">
                <span>始终视为局域网的网段（每行一个）</span>
                <textarea
                  rows={3}
                  value={(options.alwaysLocalNets ?? []).join("\n")}
                  onChange={(event) =>
                    update({
                      alwaysLocalNets: event.target.value
                        .split(/\r?\n/)
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
            <div className="toggle-grid">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(options.globalAnnounceEnabled)}
                  onChange={(event) => update({ globalAnnounceEnabled: event.target.checked })}
                />
                <span>启用全局发现</span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(options.localAnnounceEnabled)}
                  onChange={(event) => update({ localAnnounceEnabled: event.target.checked })}
                />
                <span>启用本地发现</span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(options.relaysEnabled)}
                  onChange={(event) => update({ relaysEnabled: event.target.checked })}
                />
                <span>启用中继</span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(options.natEnabled)}
                  onChange={(event) => update({ natEnabled: event.target.checked })}
                />
                <span>启用 NAT 打洞</span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(options.limitBandwidthInLan)}
                  onChange={(event) => update({ limitBandwidthInLan: event.target.checked })}
                />
                <span>局域网内也限速</span>
              </label>
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(options.startBrowser)}
                  onChange={(event) => update({ startBrowser: event.target.checked })}
                />
                <span>启动时打开浏览器</span>
              </label>
            </div>
          </>
        ) : (
          <div className="empty-mini">正在读取全局设置。</div>
        )}
      </div>

      <div className="panel surface">
        <div className="panel-header">
          <div>
            <div className="eyebrow">管理</div>
            <h3>文件夹与设备</h3>
          </div>
          <div className="panel-actions">
            <button className="primary-button" onClick={props.onCreateFolder} disabled={props.newFolderBusy}>
              {props.newFolderBusy ? "准备中..." : "新增文件夹"}
            </button>
            <button className="ghost-button" onClick={props.onCreateDevice} disabled={props.newDeviceBusy}>
              {props.newDeviceBusy ? "准备中..." : "新增设备"}
            </button>
          </div>
        </div>

        <div className="panel-subsection">
          <div className="section-title">已有文件夹</div>
          <div className="share-grid">
            {props.folders.map((folder) => (
              <button key={folder.id} className="ghost-card" onClick={() => props.onEditFolder(folder)}>
                <strong>{folderLabel(folder)}</strong>
                <span>{folderTypeLabel(folder.type)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel-subsection">
          <div className="section-title">已有设备</div>
          <div className="share-grid">
            {props.devices.map((device) => (
              <button key={device.deviceID} className="ghost-card" onClick={() => props.onEditDevice(device)}>
                <strong>{deviceName(device)}</strong>
                <span>{device.deviceID.slice(0, 12)}...</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel surface">
        <div className="panel-header">
          <div>
            <div className="eyebrow">系统操作</div>
            <h3>后端进程控制</h3>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={props.onRestart} disabled={props.systemActionBusy !== ""}>
              {props.systemActionBusy === "restart" ? "正在提交重启..." : "重启 Syncthing"}
            </button>
            <button className="ghost-button danger-button" onClick={props.onShutdown} disabled={props.systemActionBusy !== ""}>
              {props.systemActionBusy === "shutdown" ? "正在提交关闭..." : "完全关闭 Syncthing"}
            </button>
          </div>
        </div>
        <div className="device-meta">“登出”只会退出 Web GUI；这里的“完全关闭 Syncthing”会退出后端程序并停止同步。</div>
        {props.systemActionMessage && <div className="inline-message info">{props.systemActionMessage}</div>}
      </div>
    </section>
  );
}

function FolderSettingsPanel(props: {
  draft: FolderConfig;
  allDevices: DeviceConfig[];
  completions: Record<string, Record<string, CompletionStatus>>;
  ignoreText: string;
  onIgnoreTextChange: (value: string) => void;
  ignoreError: string;
  ignoreBusy: boolean;
  addIgnores: boolean;
  onAddIgnoresChange: (value: boolean) => void;
  onChange: (value: FolderConfig) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  isNew: boolean;
  onDelete?: () => void;
}) {
  const draft = props.draft;
  const update = (patch: Partial<FolderConfig>) => props.onChange({ ...draft, ...patch });
  const [activeTab, setActiveTab] = useState<FolderEditorTab>("general");
  const selectedDeviceIds = useMemo(() => new Set((draft.devices ?? []).map((item) => item.deviceID)), [draft.devices]);
  const sharedDevices = useMemo(() => props.allDevices.filter((device) => selectedDeviceIds.has(device.deviceID)), [props.allDevices, selectedDeviceIds]);
  const unsharedDevices = useMemo(() => props.allDevices.filter((device) => !selectedDeviceIds.has(device.deviceID)), [props.allDevices, selectedDeviceIds]);
  const internalVersioningEnabled = draft._guiVersioning ? !["none", "external"].includes(draft._guiVersioning.selector) : false;

  useEffect(() => {
    setActiveTab("general");
  }, [draft.id]);

  const updateDeviceSelection = (deviceID: string, enabled: boolean) => {
    const current = draft.devices ?? [];
    if (enabled) {
      if (current.some((item) => item.deviceID === deviceID)) {
        return;
      }
      props.onChange({
        ...draft,
        devices: [...current, { deviceID }],
      });
      return;
    }
    props.onChange({
      ...draft,
      devices: current.filter((item) => item.deviceID !== deviceID),
    });
  };
  const updateDeviceEncryptionPassword = (deviceID: string, encryptionPassword: string) => {
    const current = draft.devices ?? [];
    props.onChange({
      ...draft,
      devices: current.map((item) => (item.deviceID === deviceID ? { ...item, encryptionPassword } : item)),
    });
  };
  const toggleAllDevices = (enabled: boolean, scope: "shared" | "unshared" | "all") => {
    const source = scope === "shared" ? sharedDevices : scope === "unshared" ? unsharedDevices : props.allDevices;
    const current = new Map((draft.devices ?? []).map((item) => [item.deviceID, item]));
    for (const device of source) {
      if (enabled) {
        if (!current.has(device.deviceID)) {
          current.set(device.deviceID, { deviceID: device.deviceID });
        }
      } else {
        current.delete(device.deviceID);
      }
    }
    props.onChange({ ...draft, devices: Array.from(current.values()) });
  };
  const guiVersioning = draft._guiVersioning ?? createDefaultGuiVersioning();
  const updateGuiVersioning = (patch: Partial<typeof guiVersioning>) => {
    update({ _guiVersioning: { ...guiVersioning, ...patch } });
  };
  const folderTypeLocked = !props.isNew && draft.type === "receiveencrypted";
  const remoteStateForFolder = (deviceID: string) => props.completions[deviceID]?.[draft.id]?.remoteState;

  return (
    <section className="panel surface workspace-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">文件夹设置</div>
          <h3>{folderLabel(draft)}</h3>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
          {props.onDelete && (
            <button className="ghost-button danger-button" onClick={props.onDelete} disabled={props.busy}>
              删除文件夹
            </button>
          )}
          <button className="primary-button" onClick={props.onSave} disabled={props.busy}>
            {props.busy ? "保存中..." : props.isNew ? "创建文件夹" : "保存文件夹设置"}
          </button>
        </div>
      </div>

      {props.message && <div className="inline-message info">{props.message}</div>}

      <div className="editor-tabs">
        <button className={activeTab === "general" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("general")}>
          常规
        </button>
        <button className={activeTab === "sharing" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("sharing")}>
          共享
        </button>
        <button className={activeTab === "versioning" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("versioning")}>
          文件版本控制
        </button>
        <button className={activeTab === "ignores" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("ignores")}>
          忽略模式
        </button>
        <button className={activeTab === "advanced" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("advanced")}>
          高级
        </button>
      </div>

      {activeTab === "general" && (
        <div className="settings-grid">
          <label>
            <span>文件夹名称</span>
            <input value={draft.label ?? ""} onChange={(event) => update({ label: event.target.value })} />
            <div className="help-block">可选的描述性名称。每个设备上的名称都可以不同。</div>
          </label>
          <label>
            <span>文件夹 ID</span>
            <input value={draft.id} disabled={!props.isNew} onChange={(event) => update({ id: event.target.value })} />
            <div className="help-block">文件夹的必填标识符。在所有设备上都必须完全一致，且区分大小写。</div>
          </label>
          <label className="wide-field">
            <span>文件夹路径</span>
            <input value={draft.path} disabled={!props.isNew} onChange={(event) => update({ path: event.target.value })} />
            <div className="help-block">本机上的文件夹路径。如果不存在会自动创建。1. 仅仅写【path】（无论是发送时填写，还是自动接受时的路径）在手机上都不可用，会触发 folder path missing。在电脑上是终端运行syncthing.exe执行的目录 syncthing所在的位置。，如果此文件夹是远端创建的，本机自动接受的。2 当手机上用【~/path】时 ~ 是 /storage/emulated/0/syncthing。如果自动同步到电脑上，则是[path],即少去了~。3 电脑上（~/path）是 用户目录下，比如 C:\Users\18420\path 。</div>
          </label>
        </div>
      )}

      {activeTab === "sharing" && (
        <div className="panel-subsection">
          <div className="section-title">当前共享到的设备</div>
          <div className="device-share-toolbar">
            <div className="help-inline">取消选择设备以停止共享此文件夹。</div>
            <div className="device-share-links">
              <button className="link-button" onClick={() => toggleAllDevices(true, "shared")}>
                全选
              </button>
              <button className="link-button" onClick={() => toggleAllDevices(false, "shared")}>
                取消全选
              </button>
            </div>
          </div>
          <div className="share-list">
            {sharedDevices.map((device) => (
              <div key={device.deviceID} className="share-folder-row selected">
                <label className="toggle-card share-card">
                  <input type="checkbox" checked onChange={(event) => updateDeviceSelection(device.deviceID, event.target.checked)} />
                  <span>{deviceName(device)}</span>
                </label>
                {completionRemoteStateLabel(remoteStateForFolder(device.deviceID)) && (
                  <div className="help-inline">{completionRemoteStateLabel(remoteStateForFolder(device.deviceID))}</div>
                )}
                {device.untrusted && (
                  <label className="share-password-field">
                    <span>如果不受信任，请输入加密密码</span>
                    <input
                      type="password"
                      value={(draft.devices ?? []).find((item) => item.deviceID === device.deviceID)?.encryptionPassword ?? ""}
                      onChange={(event) => updateDeviceEncryptionPassword(device.deviceID, event.target.value)}
                    />
                  </label>
                )}
              </div>
            ))}
            {sharedDevices.length === 0 && <div className="empty-mini">当前没有已共享的设备。</div>}
          </div>

          <div className="section-title">未共享的设备</div>
          <div className="device-share-toolbar">
            <div className="help-inline">
              {props.allDevices.length > 0 ? "选择额外设备以共享此文件夹。" : "当前没有可共享的远端设备。"}
            </div>
            {props.allDevices.length > 0 && (
              <div className="device-share-links">
                <button className="link-button" onClick={() => toggleAllDevices(true, "unshared")}>
                  全选
                </button>
                <button className="link-button" onClick={() => toggleAllDevices(false, "unshared")}>
                  取消全选
                </button>
              </div>
            )}
          </div>
          <div className="share-list">
            {unsharedDevices.map((device) => (
              <div key={device.deviceID} className="share-folder-row">
                <label className="toggle-card share-card">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={(event) => updateDeviceSelection(device.deviceID, event.target.checked)}
                  />
                  <span>{deviceName(device)}</span>
                </label>
                {device.untrusted && <div className="help-inline">如果不受信任，请输入加密密码</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "versioning" && (
        <div className="settings-grid">
          <label className="wide-field">
            <span>文件版本控制</span>
            <select
              value={guiVersioning.selector}
              onChange={(event) => updateGuiVersioning({ selector: event.target.value as FolderVersioningSelector })}
            >
              <option value="none">不启用文件版本控制</option>
              <option value="trashcan">回收站版本控制</option>
              <option value="simple">简单版本控制</option>
              <option value="staggered">分层版本控制</option>
              <option value="external">外部版本控制</option>
            </select>
            {guiVersioning.selector === "none" && <div className="help-block">不启用文件版本控制。</div>}
            {guiVersioning.selector === "trashcan" && <div className="help-block">文件被 Syncthing 替换或删除时，会移动到 .stversions 目录中。</div>}
            {guiVersioning.selector === "simple" && (
              <div className="help-block">文件被 Syncthing 替换或删除时，会移动到 .stversions 目录中的日期戳版本中。</div>
            )}
            {guiVersioning.selector === "staggered" && (
              <div className="help-block">
                文件被 Syncthing 替换或删除时，会移动到 .stversions 目录中的日期戳版本中。版本会根据时间分层保留，并在超过最大保留时间时清理。
              </div>
            )}
            {guiVersioning.selector === "external" && (
              <div className="help-block">由外部命令处理版本控制。该命令必须把文件从共享文件夹中移走。</div>
            )}
          </label>

          {(guiVersioning.selector === "trashcan" || guiVersioning.selector === "simple") && (
            <label>
              <span>清理周期（天）</span>
              <input
                type="number"
                min={0}
                value={guiVersioning.trashcanClean}
                onChange={(event) => updateGuiVersioning({ trashcanClean: Number(event.target.value) || 0 })}
              />
              <div className="help-block">在回收站中保留文件的天数。0 表示永久保留。</div>
            </label>
          )}

          {guiVersioning.selector === "simple" && (
            <label>
              <span>保留版本数</span>
              <input
                type="number"
                min={1}
                value={guiVersioning.simpleKeep}
                onChange={(event) => updateGuiVersioning({ simpleKeep: Number(event.target.value) || 1 })}
              />
              <div className="help-block">每个文件保留的旧版本数量。</div>
            </label>
          )}

          {guiVersioning.selector === "staggered" && (
            <label>
              <span>最大保留时间（天）</span>
              <input
                type="number"
                min={0}
                value={guiVersioning.staggeredMaxAge}
                onChange={(event) => updateGuiVersioning({ staggeredMaxAge: Number(event.target.value) || 0 })}
              />
              <div className="help-block">版本的最大保留时间。0 表示永久保留。</div>
            </label>
          )}

          {internalVersioningEnabled && (
            <>
              <label className="wide-field">
                <span>版本路径</span>
                <input
                  value={draft.versioning?.fsPath ?? ""}
                  onChange={(event) => update({ versioning: { ...(draft.versioning ?? {}), fsPath: event.target.value } })}
                />
                <div className="help-block">版本文件保存路径。留空表示使用共享文件夹内默认的 .stversions 目录。</div>
              </label>
              <label>
                <span>清理间隔（秒）</span>
                <input
                  type="number"
                  min={0}
                  value={guiVersioning.cleanupIntervalS}
                  onChange={(event) => updateGuiVersioning({ cleanupIntervalS: Number(event.target.value) || 0 })}
                />
                <div className="help-block">版本目录清理任务的运行间隔。0 表示禁用周期性清理。</div>
              </label>
            </>
          )}

          {guiVersioning.selector === "external" && (
            <label className="wide-field">
              <span>命令</span>
              <input
                value={guiVersioning.externalCommand}
                onChange={(event) => updateGuiVersioning({ externalCommand: event.target.value })}
              />
              <div className="help-block">外部命令负责处理版本控制，并且必须把文件从共享目录中移走。</div>
            </label>
          )}
        </div>
      )}

      {activeTab === "ignores" && (
        <div className="panel-subsection">
          {props.isNew ? (
            <>
              <label className="toggle-card">
                <input type="checkbox" checked={props.addIgnores} onChange={(event) => props.onAddIgnoresChange(event.target.checked)} />
                <span>添加忽略模式</span>
              </label>
              <div className="help-block">忽略模式只能在文件夹创建后真正生效。勾选后会在保存时一并写入忽略规则。</div>
              {props.addIgnores && (
                <label className="wide-field">
                  <span>每行输入一条忽略规则</span>
                  <textarea
                    rows={8}
                    value={props.ignoreText}
                    onChange={(event) => props.onIgnoreTextChange(event.target.value)}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <div className="help-inline">每行一条忽略模式。</div>
              <label className="wide-field">
                <textarea
                  rows={10}
                  value={props.ignoreBusy ? "加载中..." : props.ignoreText}
                  onChange={(event) => props.onIgnoreTextChange(event.target.value)}
                  disabled={props.ignoreBusy}
                />
              </label>
              {props.ignoreError && <div className="inline-message danger">{props.ignoreError}</div>}
              <div className="help-block">支持的模式速查：</div>
              <div className="help-block"><code>(?d)</code> 表示：如果阻止目录删除，则该文件可被删除。</div>
              <div className="help-block"><code>(?i)</code> 表示：该模式按不区分大小写匹配。</div>
              <div className="help-block"><code>!</code> 表示：反转该规则（即不要排除）。</div>
              <div className="help-block"><code>*</code> 表示：单层通配符（只匹配单个目录层级）。</div>
              <div className="help-block"><code>**</code> 表示：多层通配符（匹配多个目录层级）。</div>
              <div className="help-block"><code>//</code> 表示：行首注释。</div>
            </>
          )}
        </div>
      )}

      {activeTab === "advanced" && (
        <div className="settings-grid">
          <label className="wide-field">
            <span>扫描</span>
            <div className="settings-columns">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.fsWatcherEnabled)}
                  onChange={(event) => update({ fsWatcherEnabled: event.target.checked })}
                />
                <span>监视文件变化</span>
              </label>
              <label>
                <span>完全重扫间隔（秒）</span>
                <input
                  type="number"
                  min={0}
                  value={draft.rescanIntervalS ?? 0}
                  onChange={(event) => update({ rescanIntervalS: Number(event.target.value) || 0 })}
                />
              </label>
            </div>
            <div className="help-block">监视文件变化会通过文件系统通知发现大部分变化；完全重扫用于兜底扫描。</div>
          </label>

          <label>
            <span>文件夹类型</span>
            <select value={draft.type} disabled={folderTypeLocked} onChange={(event) => update({ type: event.target.value })}>
              <option value="sendreceive">Send &amp; Receive</option>
              <option value="sendonly">Send Only</option>
              <option value="receiveonly">Receive Only</option>
              <option value="receiveencrypted">Receive Encrypted</option>
            </select>
            {draft.type === "sendonly" && <div className="help-block">文件不会接受其他设备上的变化，但本设备上的变化会发送给其他设备。</div>}
            {draft.type === "receiveonly" && <div className="help-block">文件从集群同步到当前设备，但本地变化不会发送给其他设备。</div>}
            {draft.type === "receiveencrypted" && (
              <div className="help-block">只存储和同步加密数据。所有连接设备上的文件夹必须使用相同密码，或者也设置为 Receive Encrypted。</div>
            )}
            {folderTypeLocked && <div className="help-block">Receive Encrypted 文件夹类型在添加后不能再修改。</div>}
          </label>

          <label>
            <span>文件拉取顺序</span>
            <select value={draft.order ?? "random"} disabled={draft.type === "sendonly"} onChange={(event) => update({ order: event.target.value })}>
              <option value="random">Random</option>
              <option value="alphabetic">Alphabetic</option>
              <option value="smallestFirst">Smallest First</option>
              <option value="largestFirst">Largest First</option>
              <option value="oldestFirst">Oldest First</option>
              <option value="newestFirst">Newest First</option>
            </select>
            {draft.type === "sendonly" && <div className="help-block">当文件夹类型为 Send Only 时，此功能不可用。</div>}
          </label>

          <label>
            <span>最小可用磁盘空间</span>
            <div className="inline-field">
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.minDiskFree?.value ?? 0}
                onChange={(event) =>
                  update({
                    minDiskFree: {
                      value: Number(event.target.value) || 0,
                      unit: draft.minDiskFree?.unit ?? "%",
                    },
                  })
                }
              />
              <select
                value={draft.minDiskFree?.unit ?? "%"}
                onChange={(event) =>
                  update({
                    minDiskFree: {
                      value: draft.minDiskFree?.value ?? 0,
                      unit: event.target.value as "%" | "kB" | "MB" | "GB" | "TB",
                    },
                  })
                }
              >
                <option value="%">%</option>
                <option value="kB">kB</option>
                <option value="MB">MB</option>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
            <div className="help-block">当文件夹所在分区剩余空间低于此值时，Syncthing 将停止接收新数据。设为 0 表示不限制。百分比是相对于总磁盘容量。</div>
          </label>

            <div className="toggle-grid wide-field">
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.manualSync)}
                  disabled={!canReceive(draft)}
                  onChange={(event) => update({ manualSync: event.target.checked })}
                />
                <span>手动审核接收（以当前设备为基准）</span>
              </label>
              <div className="help-block">启用后，远端设备的变化不会自动同步到本设备，需要手动审核确认后才应用。仅控制接收方向。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.manualPublish)}
                  disabled={!canPublish(draft)}
                  onChange={(event) => update({ manualPublish: event.target.checked })}
                />
                <span>手动审核发布（以当前设备为基准）</span>
              </label>
              <div className="help-block">启用后，本设备上的变化不会自动发布给其他设备，需要手动审核确认后才公开。仅控制发送方向。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input type="checkbox" checked={Boolean(draft.paused)} onChange={(event) => update({ paused: event.target.checked })} />
                <span>暂停此文件夹</span>
              </label>
              <div className="help-block">暂停后本文件夹停止同步，但不会删除已同步的文件。恢复后自动继续。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.ignorePerms)}
                  onChange={(event) => update({ ignorePerms: event.target.checked })}
                />
                <span>忽略权限</span>
              </label>
              <div className="help-block">禁用文件权限的比较与同步。适用于不支持或自定义权限的文件系统（如 FAT、exFAT、Synology、Android）。Receive Encrypted 类型自动启用。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.ignoreDelete)}
                  onChange={(event) => update({ ignoreDelete: event.target.checked })}
                />
                <span>忽略删除</span>
              </label>
              <div className="help-block">启用后，其他设备上的删除操作不会同步到本设备。相当于本设备对所有文件只进不出（仅新增和修改会同步，删除被忽略）。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.autoNormalize)}
                  onChange={(event) => update({ autoNormalize: event.target.checked })}
                />
                <span>自动规范化文件名</span>
              </label>
              <div className="help-block">自动将文件名中不兼容当前操作系统的字符替换为等效字符。例如 Windows 不允许文件名含 <code>:</code>、<code>*</code> 等字符，开启后会自动处理。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.syncOwnership)}
                  disabled={draft.type === "sendonly" || draft.type === "receiveencrypted"}
                  onChange={(event) => update({ syncOwnership: event.target.checked })}
                />
                <span>同步所有权</span>
              </label>
              <div className="help-block">同时发送和接收文件的所有者/组信息（uid/gid）。通常需要以提升权限（root 或管理员）运行 Syncthing 才能生效。</div>
              {(draft.type === "sendonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Send Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.sendOwnership || draft.syncOwnership)}
                  disabled={draft.type === "receiveonly" || draft.type === "receiveencrypted" || Boolean(draft.syncOwnership)}
                  onChange={(event) => update({ sendOwnership: event.target.checked })}
                />
                <span>发送所有权</span>
              </label>
              <div className="help-block">仅发送文件的所有者/组信息给其他设备，但不应用接收到的所有权信息。可能对性能有显著影响。开启"同步所有权"时自动启用。</div>
              {(draft.type === "receiveonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Receive Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.syncXattrs)}
                  disabled={draft.type === "sendonly" || draft.type === "receiveencrypted"}
                  onChange={(event) => update({ syncXattrs: event.target.checked })}
                />
                <span>同步扩展属性</span>
              </label>
              <div className="help-block">同时发送和接收文件的扩展属性（xattr，如 SELinux 标签、macOS 元数据等）。可能需要以提升权限运行才能读写扩展属性。</div>
              {(draft.type === "sendonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Send Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.sendXattrs || draft.syncXattrs)}
                  disabled={draft.type === "receiveonly" || draft.type === "receiveencrypted" || Boolean(draft.syncXattrs)}
                  onChange={(event) => update({ sendXattrs: event.target.checked })}
                />
                <span>发送扩展属性</span>
              </label>
              <div className="help-block">仅发送文件的扩展属性给其他设备，但不应用接收到的扩展属性。可能对性能有显著影响。开启"同步扩展属性"时自动启用。</div>
              {(draft.type === "receiveonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Receive Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DeviceSettingsPanel(props: {
  draft: DeviceConfig;
  onChange: (value: DeviceConfig) => void;
  shareDraft: DeviceShareDraft;
  onShareDraftChange: (value: DeviceShareDraft) => void;
  allFolders: FolderConfig[];
  allDevices: DeviceConfig[];
  completions: Record<string, Record<string, CompletionStatus>>;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  isNew: boolean;
  onDelete?: () => void;
}) {
  const draft = props.draft;
  const update = (patch: Partial<DeviceConfig>) => props.onChange({ ...draft, ...patch });
  const [activeTab, setActiveTab] = useState<DeviceEditorTab>("general");
  const addresses = (draft.addresses ?? ["dynamic"]).join(", ");
  const allowedNetworks = (draft.allowedNetworks ?? []).join("\n");
  const willBeReintroducedBy = useMemo(() => {
    if (!draft.introducedBy) {
      return "";
    }
    const introducerDevice = props.allDevices.find((device) => device.deviceID === draft.introducedBy);
    return introducerDevice && introducerDevice.introducer ? deviceName(introducerDevice) : "";
  }, [draft.introducedBy, props.allDevices]);
  const sharedFolders = useMemo(
    () => props.allFolders.filter((folder) => props.shareDraft.selected[folder.id]),
    [props.allFolders, props.shareDraft.selected],
  );
  const unsharedFolders = useMemo(
    () => props.allFolders.filter((folder) => !props.shareDraft.selected[folder.id]),
    [props.allFolders, props.shareDraft.selected],
  );
  const updateShareSelection = (folderID: string, selected: boolean) => {
    props.onShareDraftChange({
      ...props.shareDraft,
      selected: {
        ...props.shareDraft.selected,
        [folderID]: selected,
      },
    });
  };
  const updateSharePassword = (folderID: string, value: string) => {
    props.onShareDraftChange({
      ...props.shareDraft,
      encryptionPasswords: {
        ...props.shareDraft.encryptionPasswords,
        [folderID]: value,
      },
    });
  };
  const selectAllSharedState = (selected: boolean) => {
    const nextSelected: Record<string, boolean> = { ...props.shareDraft.selected };
    for (const folder of props.allFolders) {
      nextSelected[folder.id] = selected;
    }
    props.onShareDraftChange({
      ...props.shareDraft,
      selected: nextSelected,
    });
  };

  return (
    <section className="panel surface workspace-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">设备设置</div>
          <h3>{deviceName(draft)}</h3>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
          {props.onDelete && (
            <button className="ghost-button danger-button" onClick={props.onDelete} disabled={props.busy}>
              删除设备
            </button>
          )}
          <button className="primary-button" onClick={props.onSave} disabled={props.busy}>
            {props.busy ? "保存中..." : props.isNew ? "创建设备" : "保存设备设置"}
          </button>
        </div>
      </div>

      {props.message && <div className="inline-message info">{props.message}</div>}

      <div className="editor-tabs">
        <button className={`tab-button${activeTab === "general" ? " active" : ""}`} onClick={() => setActiveTab("general")}>
          常规
        </button>
        <button className={`tab-button${activeTab === "sharing" ? " active" : ""}`} onClick={() => setActiveTab("sharing")}>
          共享
        </button>
        <button className={`tab-button${activeTab === "advanced" ? " active" : ""}`} onClick={() => setActiveTab("advanced")}>
          高级
        </button>
      </div>

      {activeTab === "general" && (
        <div className="settings-modal-stack">
          <div className="settings-grid">
            <label className="wide-field">
              <span>设备 ID</span>
              <input value={draft.deviceID} disabled={!props.isNew} onChange={(event) => update({ deviceID: event.target.value })} />
              {props.isNew ? (
                <div className="help-block">在另一台设备的“操作 &gt; 显示 ID”中可以找到要输入的设备 ID。添加新设备时，别忘了另一端也需要添加当前设备。</div>
              ) : null}
            </label>
            <label>
              <span>设备名称</span>
              <input value={draft.name ?? ""} onChange={(event) => update({ name: event.target.value })} />
              <div className="help-block">在集群状态中显示，用于替代设备 ID。若留空，则会使用设备自己广播的名称。</div>
            </label>
            <label>
              <span>暂停</span>
              <input type="checkbox" checked={Boolean(draft.paused)} onChange={(event) => update({ paused: event.target.checked })} />
            </label>
          </div>
        </div>
      )}

      {activeTab === "sharing" && (
        <div className="settings-modal-stack">
          <div className="settings-columns">
            <div className="panel-subsection">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.introducer)}
                  disabled={Boolean(draft.untrusted)}
                  onChange={(event) => update({ introducer: event.target.checked })}
                />
                <span>作为中介</span>
              </label>
              <div className="help-block">将中介中的设备添加到我们的设备列表中，用于相互共享的文件夹。</div>
            </div>
            <div className="panel-subsection">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.autoAcceptFolders)}
                  disabled={Boolean(draft.untrusted)}
                  onChange={(event) => update({ autoAcceptFolders: event.target.checked })}
                />
                <span>自动接受</span>
              </label>
              <div className="help-block">当此远端设备共享一个当前设备尚不存在的新文件夹时，当前设备会自动按默认路径创建并接受该文件夹；关闭后，这类邀请会出现在“待接受共享文件夹”面板中，由你手动确认。</div>
            </div>
          </div>

          {willBeReintroducedBy && <div className="inline-message info">{willBeReintroducedBy} 可能会重新引入此设备。</div>}

          <div className="panel-subsection">
            <div className="section-title">共享文件夹</div>
            <div className="device-share-toolbar">
              <span className="help-inline">取消选择文件夹以停止与此设备共享。</span>
              <span className="device-share-links">
                <button className="link-button" onClick={() => selectAllSharedState(true)}>全选</button>
                <button className="link-button" onClick={() => selectAllSharedState(false)}>取消全选</button>
              </span>
            </div>
            <div className="share-list">
              {props.allFolders.length === 0 ? (
                <div className="empty-mini">当前没有可共享的文件夹。</div>
              ) : (
                props.allFolders.map((folder) => {
                  const selected = Boolean(props.shareDraft.selected[folder.id]);
                  const completion = props.completions[draft.deviceID]?.[folder.id];
                  return (
                    <div key={folder.id} className={`share-folder-row${selected ? " selected" : ""}`}>
                      <label className="toggle-card share-card">
                        <input type="checkbox" checked={selected} onChange={(event) => updateShareSelection(folder.id, event.target.checked)} />
                        <span>{folderLabel(folder)}</span>
                      </label>
                      {draft.untrusted && selected && (
                        <label className="share-password-field">
                          <span>如果不受信任，请输入加密密码</span>
                          <input
                            type="text"
                            value={props.shareDraft.encryptionPasswords[folder.id] ?? ""}
                            onChange={(event) => updateSharePassword(folder.id, event.target.value)}
                          />
                        </label>
                      )}
                      {completion?.remoteState === "notSharing" && <div className="help-block">远端设备尚未接受共享此文件夹。</div>}
                      {completion?.remoteState === "paused" && <div className="help-block">远端设备已暂停此文件夹。</div>}
                    </div>
                  );
                })
              )}
            </div>
            {sharedFolders.length === 0 && <div className="help-block">当前没有与此设备共享的文件夹。</div>}
          </div>
        </div>
      )}

      {activeTab === "advanced" && (
        <div className="settings-modal-stack">
          <div className="settings-grid">
            <label className="wide-field">
              <span>地址</span>
              <input
                value={addresses}
                onChange={(event) =>
                  update({
                    addresses: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
              <div className="help-block">输入以半角逗号分隔的（"tcp://ip:port", "tcp://host:port"）设备地址，或者输入“dynamic”以自动发现设备地址。</div>
            </label>
            <label>
              <span>压缩</span>
              <select value={draft.compression ?? "metadata"} onChange={(event) => update({ compression: event.target.value })}>
                <option value="always">全部数据</option>
                <option value="metadata">仅元数据</option>
                <option value="never">关闭</option>
              </select>
            </label>
          </div>

          <div className="settings-columns">
            <div className="panel-subsection">
              <div className="section-title">连接管理</div>
              <label className="inline-field">
                <span>连接数</span>
                <span className="inline-help">帮助</span>
              </label>
              <input
                type="number"
                min={0}
                value={draft.numConnections ?? 0}
                onChange={(event) => update({ numConnections: Number(event.target.value) || 0 })}
              />
              <div className="help-block">当两台设备上的连接数均被设为大于 1 时，Syncthing 会尝试建立多个并行连接。如果两台设备上的设置的连接数不同，则会使用最大的连接数。设为 0 表示让 Syncthing 自行决定。</div>
            </div>

            <div className="panel-subsection">
              <div className="section-title">设备速率限制</div>
              <label>
                <span>传入速率限制（KiB/s）</span>
                <input
                  type="number"
                  min={0}
                  value={draft.maxRecvKbps ?? 0}
                  onChange={(event) => update({ maxRecvKbps: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                <span>传出速率限制（KiB/s）</span>
                <input
                  type="number"
                  min={0}
                  value={draft.maxSendKbps ?? 0}
                  onChange={(event) => update({ maxSendKbps: Number(event.target.value) || 0 })}
                />
              </label>
              <div className="help-block">速率限制适用于到此设备的所有连接的累积流量。</div>
            </div>
          </div>

          <div className="panel-subsection">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={Boolean(draft.untrusted)}
                onChange={(event) =>
                  update({
                    untrusted: event.target.checked,
                    introducer: event.target.checked ? false : draft.introducer,
                    autoAcceptFolders: event.target.checked ? false : draft.autoAcceptFolders,
                  })
                }
              />
              <span>不受信任</span>
            </label>
            <div className="help-block">与此设备共享的所有文件夹都必须有密码保护，这样所有发送的数据在没有密码的情况下是不可读的。</div>
          </div>

          <div className="panel-subsection">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={Boolean(draft.skipIntroductionRemovals)}
                onChange={(event) => update({ skipIntroductionRemovals: event.target.checked })}
              />
              <span>跳过引入移除</span>
            </label>
          </div>

          <label className="wide-field">
            <span>允许网络（每行一个）</span>
            <textarea
              rows={3}
              value={allowedNetworks}
              onChange={(event) =>
                update({
                  allowedNetworks: event.target.value
                    .split(/\r?\n/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      )}
    </section>
  );
}

function FileSide(props: { title: string; file?: CompareEntry["local"] | PendingPublishEntry["global"]; emptyLabel: string }) {
  return (
    <div className="file-side">
      <div className="file-side-title">{props.title}</div>
      {props.file ? (
        <>
          <div className="file-main-metric">{props.file.type === "directory" ? "目录" : formatBinary(props.file.size)}</div>
          <div className="file-meta">{formatDate(props.file.modified)}</div>
          <div className="file-meta muted">{props.file.deleted ? "路径已删除" : props.file.type}</div>
        </>
      ) : (
        <div className="file-main-metric muted">{props.emptyLabel}</div>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className={`metric-card${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.value}</div>
    </div>
  );
}

function InfoCell(props: { label: string; value: string }) {
  return (
    <div className="info-cell">
      <div className="info-label">{props.label}</div>
      <div className="info-value">{props.value}</div>
    </div>
  );
}

export default App;
