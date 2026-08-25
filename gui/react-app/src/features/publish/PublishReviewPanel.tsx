import { useEffect, useMemo, useState } from "react";
import type { CompletionStatus, ConnectionsResponse, DeviceConfig, FolderConfig, PendingPublishResult } from "../../api";
import { BiDiffSizeCell, BiDiffTimeCell, ProgressBar } from "../../components/review/ReviewCells";
import { ResizableTable, renderResizableHeaders, type ColumnDef } from "../../components/review/ResizableTable";
import { buildReviewTree, flattenReviewTree, hasExpandedReviewDirDescendant, TreePrefix } from "../../components/review/ReviewTree";
import { canPublish, completionPercent, deviceName, pendingPublishLabel, pendingRenameRole, remoteStateLabel } from "../../components/review/review-formatters";

const publishViewOptions = [
  { value: "all", label: "全部待发布项" },
  { value: "added", label: "仅看新增" },
  { value: "modified", label: "仅看修改" },
  { value: "delete", label: "仅看删除" },
] as const;

export default function PublishReviewPanel(props: {
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
          next[node.key] = false;
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
        <div className="review-mobile-hint">手机建议横屏查看；表格可左右滑动，按住列头分隔线可调整列宽。若 Android 内置 WebGUI 操作不顺，建议改用"在浏览器中打开"后再查看。</div>

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

