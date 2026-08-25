import type { CompareEntry, CompletionStatus, DeviceConfig, FolderConfig, FolderStatus, PendingPublishEntry } from "../../api";

export function formatBinary(bytes: number | undefined): string {
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

export function formatDate(value?: string, mode: "full" | "compact" = "full"): string {
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

export function formatLastSeen(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return "从未";
  }
  return formatDate(value, "full");
}

export function folderLabel(folder: FolderConfig): string {
  return folder.label && folder.label.trim().length > 0 ? folder.label : folder.id;
}

export function deviceName(device: DeviceConfig | undefined): string {
  if (!device) {
    return "未知设备";
  }
  return device.name && device.name.trim().length > 0 ? device.name : device.deviceID.slice(0, 7);
}

export function folderTypeLabel(type: string): string {
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

export function canReceive(folder: FolderConfig): boolean {
  return folder.type !== "sendonly";
}

export function canPublish(folder: FolderConfig): boolean {
  return folder.type !== "receiveonly" && folder.type !== "receiveencrypted";
}

export function isPausedFolder(folder: FolderConfig | null | undefined): boolean {
  return Boolean(folder?.paused);
}

export function receiveModeLabel(folder: FolderConfig): string {
  if (!canReceive(folder)) {
    return "不接收";
  }
  return folder.manualSync ? "手动审核接收" : "自动接收";
}

export function publishModeLabel(folder: FolderConfig): string {
  if (!canPublish(folder)) {
    return "不发布";
  }
  return folder.manualPublish ? "手动审核发布" : "自动发布";
}

export function folderStateTone(status?: FolderStatus): "success" | "warning" | "danger" | "muted" {
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

export function compareStatusLabel(entry: CompareEntry): string {
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

export function compareRenameRole(entry: CompareEntry): "old" | "new" | "" {
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

export function pendingPublishLabel(entry: PendingPublishEntry): string {
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

export function pendingRenameRole(entry: PendingPublishEntry): "old" | "new" | "" {
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

export function remoteStateLabel(value?: string): string {
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

export function fileTypeLabel(value?: string): string {
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

export function statusTone(status: string): string {
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

export function compareSideTone(entry: CompareEntry, side: "local" | "remote"): "success" | "warning" | "danger" | "muted" | "info" {
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

export function pendingPublishSideTone(
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

export function compareKind(entry: CompareEntry): string {
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

export function filterReceiveEntriesForView(entries: CompareEntry[], view: string): CompareEntry[] {
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

export function compareRequestView(view: string): string {
  return view === "incoming" ? "different" : view;
}

export function bidiffRequestView(view: string): string {
  return view === "all-with-same" ? "all" : view;
}

export function completionPercent(value?: CompletionStatus): number {
  if (!value) {
    return 0;
  }
  const percent = Number(value.completion ?? 0);
  if (Number.isNaN(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, percent));
}

export function connectionBadgeLabel(connected: boolean, remoteState?: string): string {
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

export function connectionBadgeTone(connected: boolean, remoteState?: string): "success" | "warning" | "muted" {
  if (!connected) {
    return "muted";
  }
  if (remoteState === "syncing" || remoteState === "scanning") {
    return "warning";
  }
  return "success";
}

export function formatRate(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return "0 B/s";
  }
  return `${formatBinary(bytesPerSecond)}/s`;
}

