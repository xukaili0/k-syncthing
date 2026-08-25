import { useEffect, useMemo, useState } from "react";
import type { CompareEntry, CompareResult, CompletionStatus, DeviceConfig, FolderConfig } from "../../api";
import { BiDiffSizeCell, BiDiffTimeCell, ProgressBar } from "../../components/review/ReviewCells";
import { ResizableTable, renderResizableHeaders, type ColumnDef } from "../../components/review/ResizableTable";
import { buildReviewTree, flattenReviewTree, hasExpandedReviewDirDescendant, TreePrefix } from "../../components/review/ReviewTree";
import { compareKind, compareRenameRole, compareStatusLabel, completionPercent, deviceName, filterReceiveEntriesForView, remoteStateLabel, statusTone } from "../../components/review/review-formatters";
import FileDetailCompare from "./FileDetailCompare";

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

export default function ReceiveReviewPanel(props: {
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
  compareIgnoreModTime: boolean;
  onCompareIgnoreModTimeChange: (value: boolean) => void;
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
  const [detailEntry, setDetailEntry] = useState<CompareEntry | null>(null);
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
          next[node.key] = false;
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
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={props.compareIgnoreModTime}
              onChange={(event) => props.onCompareIgnoreModTimeChange(event.target.checked)}
            />
            <span>忽略时间差异</span>
          </label>
        </div>

        <div className="review-stats">
          <span className={`badge tone-${props.compare?.remoteConnected ? "success" : "warning"}`}>{props.compare?.remoteConnected ? "已连接" : "离线"}</span>
          <span>目标设备：{deviceName(props.selectedDevice ?? undefined)}</span>
          <span>远端状态：{remoteStateLabel(props.remoteCompletion?.remoteState)}</span>
          <span>共 {entries.length} 项</span>
          <span>可操作 {entries.filter((entry) => entry.canPrioritize).length} 项</span>
          <span>已选 {selectedCount} 项</span>
        </div>
        <div className="review-mobile-hint">手机建议横屏查看；表格可左右滑动，按住列头分隔线可调整列宽。若 Android 内置 WebGUI 操作不顺，建议改用"在浏览器中打开"后再查看。</div>

        {props.compareMessage && <div className="inline-message info">{props.compareMessage}</div>}
        {props.compareError && <div className="inline-message danger">{props.compareError}</div>}
        {props.compareBusy && entries.length === 0 && <div className="compare-empty">正在加载接收审核数据...</div>}

        {detailEntry && (
          <FileDetailCompare entry={detailEntry} folder={props.folder.id} onClose={() => setDetailEntry(null)} />
        )}

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
                const open = expandedDirs[row.node.key] === true;
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
                        <span
                          className="compare-tree-name compare-tree-file-name"
                          style={{ cursor: "pointer", textDecoration: "underline", color: "#0891b2" }}
                          title="点击查看详细对比"
                          onClick={() => setDetailEntry(entry)}
                        >{row.node.name}</span>
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

