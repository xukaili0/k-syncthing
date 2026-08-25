import type { BiDiffEntry } from "../../api";
import type { ColumnDef } from "../../components/review/ResizableTable";

export function bidiffStatusLabel(entry: BiDiffEntry): string {
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

export function bidiffRenameRole(entry: BiDiffEntry): "old" | "new" | "" {
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

export function bidiffKind(entry: BiDiffEntry): string {
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

export function bidiffSideTone(entry: BiDiffEntry, side: "left" | "right"): "success" | "warning" | "danger" | "muted" | "info" {
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

export function bidiffHasLiveFile(file?: BiDiffEntry["left"] | BiDiffEntry["right"]): boolean {
  return Boolean(file && !file.deleted);
}

export function bidiffFilesLookEquivalent(left?: BiDiffEntry["left"], right?: BiDiffEntry["right"]): boolean {
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

export function isGuiInertBiDiffEntry(entry: BiDiffEntry): boolean {
  if (bidiffHasLiveFile(entry.left) && bidiffHasLiveFile(entry.right) && bidiffFilesLookEquivalent(entry.left, entry.right)) {
    return true;
  }
  if (!bidiffHasLiveFile(entry.left) && !bidiffHasLiveFile(entry.right)) {
    return true;
  }
  return false;
}

export function bidiffPresenceSummary(entry: BiDiffEntry): { label: string; className: string } {
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

export function bidiffRelationIndicator(entry: BiDiffEntry): { symbol: string; className: string; title: string } {
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

export function bidiffActionabilityLabel(entry: BiDiffEntry): { label: string; className: string; title: string } {
  if (entry.canApplyLeftToRight && entry.canApplyRightToLeft) {
    return { label: "⇄", className: "action-both", title: "可双向接发" };
  }
  if (entry.canApplyLeftToRight) {
    return { label: "←", className: "action-left", title: "当前仅可采用左侧" };
  }
  if (entry.canApplyRightToLeft) {
    return { label: "→", className: "action-right", title: "当前仅可采用右侧" };
  }
  return { label: "⛔", className: "action-blocked", title: "当前不可接发" };
}

export function bidiffRenameInlineText(entry: BiDiffEntry, baseLabel: string): string {
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

export type BiDiffTaskStatus = "queued" | "submitted" | "processing" | "completed" | "failed";

export type BiDiffTask = {
  key: string;
  folderId: string;
  deviceId: string;
  path: string;
  direction: "left-to-right" | "right-to-left";
  status: BiDiffTaskStatus;
  error?: string;
  updatedAt: number;
};

export type BiDiffTreeNode = {
  key: string;
  name: string;
  fullPath: string;
  type: "dir" | "file";
  entry?: BiDiffEntry;
  children: BiDiffTreeNode[];
};

export type BiDiffTreeRow =
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

export function bidiffTaskKey(folderId: string, deviceId: string, direction: "left-to-right" | "right-to-left", path: string): string {
  return `${folderId}::${deviceId}::${direction}::${path}`;
}

function splitTreePath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function buildBiDiffTree(entries: BiDiffEntry[]): BiDiffTreeNode[] {
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

export function collectBiDiffLeafEntries(node: BiDiffTreeNode): BiDiffEntry[] {
  if (node.type === "file" && node.entry) {
    return [node.entry];
  }
  const result: BiDiffEntry[] = [];
  for (const child of node.children) {
    result.push(...collectBiDiffLeafEntries(child));
  }
  return result;
}

export function hasExpandedDirDescendant(node: BiDiffTreeNode, expanded: Record<string, boolean>): boolean {
  for (const child of node.children) {
    if (child.type === "dir") {
      if (expanded[child.key] === true || hasExpandedDirDescendant(child, expanded)) {
        return true;
      }
    }
  }
  return false;
}

export function flattenBiDiffTree(nodes: BiDiffTreeNode[], expanded: Record<string, boolean>, depth = 0, guides: boolean[] = []): BiDiffTreeRow[] {
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
      if (expanded[node.key] === true) {
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

export function bidiffTaskLabel(status: BiDiffTaskStatus): string {
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

export function bidiffTaskTone(status: BiDiffTaskStatus): "success" | "warning" | "danger" | "muted" | "info" {
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

export function bidiffTaskPercent(status: BiDiffTaskStatus): number {
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

export type BiDiffDensity = "relaxed" | "normal" | "compact" | "tight";

export function biDiffColumnsForDensity(density: BiDiffDensity, actionVisible = false): ColumnDef[] {
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
    { key: "action", label: "接发", width: preset.action, minWidth: 48, visible: actionVisible },
    { key: "summary", label: "名称 / 路径", width: preset.summary, minWidth: 180 },
    { key: "rightTime", label: "右侧时间", width: preset.rightTime, minWidth: 76 },
    { key: "rightSize", label: "右侧大小", width: preset.rightSize, minWidth: 64 },
  ];
}

