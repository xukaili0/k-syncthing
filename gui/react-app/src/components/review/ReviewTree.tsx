import { useEffect, useRef } from "react";

function splitTreePath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export type ReviewTreeNode<T extends { path: string }> = {
  key: string;
  name: string;
  fullPath: string;
  type: "dir" | "file";
  entry?: T;
  children: ReviewTreeNode<T>[];
};

export type ReviewTreeRow<T extends { path: string }> =
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

export function buildReviewTree<T extends { path: string }>(entries: T[]): ReviewTreeNode<T>[] {
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

export function collectReviewLeafEntries<T extends { path: string }>(node: ReviewTreeNode<T>): T[] {
  if (node.type === "file" && node.entry) {
    return [node.entry];
  }
  const result: T[] = [];
  for (const child of node.children) {
    result.push(...collectReviewLeafEntries(child));
  }
  return result;
}

export function hasExpandedReviewDirDescendant<T extends { path: string }>(node: ReviewTreeNode<T>, expanded: Record<string, boolean>): boolean {
  for (const child of node.children) {
    if (child.type === "dir") {
      if (expanded[child.key] === true || hasExpandedReviewDirDescendant(child, expanded)) {
        return true;
      }
    }
  }
  return false;
}

export function flattenReviewTree<T extends { path: string }>(
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
      if (expanded[node.key] === true) {
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

export function TreeCheckbox(props: {
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

export function shouldIgnoreRowSelectionToggle(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("button, input, select, a, .resize-handle"));
}

export function TreePrefix(props: { depth: number; guides: boolean[]; isLast: boolean }) {
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

