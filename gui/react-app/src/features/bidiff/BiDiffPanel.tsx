import { useEffect, useMemo, useRef, useState } from "react";
import type { CompareEntry } from "../../api";
import { BiDiffSizeCell, BiDiffTimeCell, ProgressBar } from "../../components/review/ReviewCells";
import { ResizableTable, renderResizableHeaders, type ColumnDef } from "../../components/review/ResizableTable";
import { shouldIgnoreRowSelectionToggle, TreeCheckbox, TreePrefix } from "../../components/review/ReviewTree";
import { completionPercent, deviceName, formatBinary, formatDate, remoteStateLabel, statusTone } from "../../components/review/review-formatters";
import FileDetailCompare from "../receive/FileDetailCompare";
import TransferPanel from "./TransferPanel";
import {
  type BiDiffDensity,
  type BiDiffTask,
  type BiDiffTreeNode,
  bidiffActionabilityLabel,
  bidiffHasLiveFile,
  bidiffKind,
  bidiffRenameInlineText,
  bidiffRenameRole,
  bidiffStatusLabel,
  bidiffTaskLabel,
  bidiffTaskPercent,
  bidiffTaskTone,
  biDiffColumnsForDensity,
  buildBiDiffTree,
  flattenBiDiffTree,
  hasExpandedDirDescendant,
  isGuiInertBiDiffEntry,
} from "./bidiff-model";
import type { BiDiffPanelProps } from "./bidiff-panel-types";
import {
  BIDIFF_DENSITY_KEY,
  BIDIFF_FONT_SCALE_KEY,
  BIDIFF_SIDEBAR_WIDTH_KEY,
  BIDIFF_TIME_MODE_KEY,
  bidiffViewOptions,
  readStoredChoice,
  readStoredPixels,
  storePixels,
} from "./bidiff-preferences";

export default function BiDiffPanel(props: BiDiffPanelProps) {
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
  const [detailEntry, setDetailEntry] = useState<CompareEntry | null>(null);
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
          next[node.key] = false;
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
          <div className="empty-mini">这个文件夹当前没有共享设备，所以没有可接发的右侧索引。</div>
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
            progressUpdateIntervalS={props.progressUpdateIntervalS}
            onSaveProgressInterval={props.onSaveProgressInterval}
          />
        ) : (
        <>
        <div className="review-toolbar review-toolbar-bidiff">
          <label>
            <span>接发列</span>
            <button
              className="mini-button"
              onClick={() => {
                setColumns((prev) =>
                  prev.map((col) => (col.key === "action" ? { ...col, visible: col.visible === false ? true : false } : col))
                );
              }}
              title={columns.find((c) => c.key === "action")?.visible !== false ? "隐藏接发列" : "显示接发列"}
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
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={props.bidiffIgnoreModTime}
              onChange={(event) => props.onBidiffIgnoreModTimeChange(event.target.checked)}
            />
            <span>忽略时间</span>
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
          <span className="badge badge-sm tone-info">{props.mode === "peer" ? "直传" : "接发"}</span>
          <span className={`badge badge-sm tone-${props.bidiff?.rightConnected ? "success" : "warning"}`}>{props.bidiff?.rightConnected ? "右侧已连接" : "右侧离线"}</span>
          {(selectedLeftToRight > 0 || selectedRightToLeft > 0 || selectedBlocked > 0) && (
            <span className="review-selection-info">
              左→右 {selectedLeftToRight} / 右→左 {selectedRightToLeft}
              {selectedBlocked > 0 ? ` / 未执行 ${selectedBlocked}` : ""}
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
            当前文件夹还在自动同步模式。为了保证"只按你选中的文件接发"，双向接发建议与手动模式配合使用：
            {!props.bidiff?.manualSync && " 先开启手动审核接收；"}
            {!props.bidiff?.manualPublish && " 先开启手动审核发布；"}
          </div>
        )}
        {props.bidiffMessage && <div className="inline-message info">{props.bidiffMessage}</div>}
        {props.bidiffError && <div className="inline-message danger">{props.bidiffError}</div>}
        {detailEntry && (
          <FileDetailCompare entry={detailEntry} folder={props.folder.id} onClose={() => setDetailEntry(null)} />
        )}
        {hasSelection && selectedLeftToRight === 0 && selectedRightToLeft === 0 && (
          <div className="inline-message warning">
            当前已选 {selectedTotal} 项，但这些条目暂时都不可执行，所以"采用左侧 / 采用右侧"仍然是 0。
          </div>
        )}

        {props.uiMode === "mobile" ? (
          <div className={`bidiff-mobile-list bidiff-font-${fontScale} bidiff-density-${density}`}>
            {mobileRows.map((row) => {
              if (row.type === "dir") {
                const selectableEntries = row.entries;
                const selectedCount = selectableEntries.filter((entry) => props.bidiffSelection[entry.path]).length;
                const open = expandedDirs[row.node.key] === true;
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
                        <span
                          className={`compare-tree-file-combined ${renameRole === "new" ? "rename-new-path" : renameRole === "old" ? "rename-old-path" : ""}`}
                          style={{ cursor: "pointer", textDecoration: "underline", color: "#0891b2" }}
                          title="点击查看详细对比"
                          onClick={() => setDetailEntry({ path: entry.path, status: entry.status, local: entry.left, remote: entry.right, renameCandidate: entry.renameCandidate, canPrioritize: entry.canApplyLeftToRight || entry.canApplyRightToLeft })}
                        >
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
                {(treeMode ? treeRows : entries.map((entry) => ({ type: "file" as const, key: `file:${entry.path}`, node: { key: `file:${entry.path}`, name: entry.path, fullPath: entry.path, type: "file" as const, entry, children: [] }, depth: 0, guides: [], isLast: true, entry }))).map((row) => {
              if (row.type === "dir") {
                const selectableEntries = row.entries;
                const selectedCount = selectableEntries.filter((entry) => props.bidiffSelection[entry.path]).length;
                const allSelected = selectableEntries.length > 0 && selectedCount === selectableEntries.length;
                const hasSelectedDescendants = selectedCount > 0;
                const leftLiveCount = row.entries.filter((entry) => bidiffHasLiveFile(entry.left)).length;
                const rightLiveCount = row.entries.filter((entry) => bidiffHasLiveFile(entry.right)).length;
                const open = expandedDirs[row.node.key] === true;
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
                          <span className="badge compare-action-badge action-both" title="目录包含可接发子项">
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
                  className={`compare-tree-file-row tone-${statusTone(entry.status)} kind-${kind}${selected ? " selected" : ""}${currentTask ? ` task-${currentTask.status}` : ""}${!entry.canApplyLeftToRight && !entry.canApplyRightToLeft ? " row-both-blocked" : ""}`}
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
                          <span
                            className={`compare-tree-name compare-tree-file-name compare-tree-file-combined${renameRole === "new" ? " rename-new-path" : renameRole === "old" ? " rename-old-path" : ""}`}
                            style={{ cursor: "pointer", textDecoration: "underline", color: "#0891b2" }}
                            title="点击查看详细对比"
                            onClick={() => setDetailEntry({ path: entry.path, status: entry.status, local: entry.left, remote: entry.right, renameCandidate: entry.renameCandidate, canPrioritize: entry.canApplyLeftToRight || entry.canApplyRightToLeft })}
                          >
                            {bidiffRenameInlineText(entry, row.node.name)}
                          </span>
                        </div>
                      ) : (
                        <div className="compare-path compare-main-path compare-main-path-combined" title={bidiffRenameInlineText(entry, entry.path)}>
                          <span
                            className={`compare-tree-file-combined ${renameRole === "new" ? "rename-new-path" : renameRole === "old" ? "rename-old-path" : ""}`}
                            style={{ cursor: "pointer", textDecoration: "underline", color: "#0891b2" }}
                            title="点击查看详细对比"
                            onClick={() => setDetailEntry({ path: entry.path, status: entry.status, local: entry.left, remote: entry.right, renameCandidate: entry.renameCandidate, canPrioritize: entry.canApplyLeftToRight || entry.canApplyRightToLeft })}
                          >
                            {bidiffRenameInlineText(entry, entry.path)}
                          </span>
                        </div>
                      )}
                      {currentTask && (
                        <div className="compare-inline-progress">
                          <ProgressBar percent={bidiffTaskPercent(currentTask.status)} tone={bidiffTaskTone(currentTask.status)} />
                        </div>
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

