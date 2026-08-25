import type { CompletionStatus } from "../../api";
import { remoteStateLabel } from "../review/review-formatters";

export function normalizeAddress(value: string): string {
  return value.replace(/\/\?.*$/, "");
}

export function compressionLabel(value?: string): string {
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

export function aggregateDeviceCompletion(completionMap?: Record<string, CompletionStatus>): {
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

export function aggregateSyncStatusLabel(summary: { total: number; needItems: number; remoteState?: string }): string {
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

export function yesNo(value?: boolean): string {
  return value ? "是" : "否";
}

