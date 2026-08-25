import { useLayoutEffect, useRef, useState } from "react";
import type { CompletionStatus, ConnectionsResponse, DeviceConfig, FolderConfig, FolderStatus } from "../../api";
import { beginColumnResize, type ColumnDef } from "../../components/review/ResizableTable";
import { canPublish, canReceive, connectionBadgeLabel, connectionBadgeTone, deviceName, folderLabel, folderStateTone, folderTypeLabel, formatBinary, isPausedFolder, publishModeLabel, receiveModeLabel } from "../../components/review/review-formatters";

function StatusCard(props: { title: string; value: string; subtitle: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className={`status-card${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="status-title">{props.title}</div>
      <div className="status-value">{props.value}</div>
      <div className="status-subtitle">{props.subtitle}</div>
    </div>
  );
}

export default function OverviewPanel(props: {
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
  const [ovColumns, setOvColumns] = useState<ColumnDef[]>([
    { key: "name", label: "文件夹", width: 160, minWidth: 80 },
    { key: "type", label: "类型", width: 80, minWidth: 50 },
    { key: "status", label: "状态", width: 70, minWidth: 50 },
    { key: "receive", label: "接收", width: 70, minWidth: 50 },
    { key: "publish", label: "发布", width: 70, minWidth: 50 },
    { key: "local", label: "本地", width: 100, minWidth: 70 },
    { key: "global", label: "全局", width: 100, minWidth: 70 },
    { key: "need", label: "待同步", width: 60, minWidth: 40 },
    { key: "error", label: "错误", width: 50, minWidth: 35 },
    { key: "devices", label: "远端设备", width: 100, minWidth: 60 },
    { key: "actions", label: "操作", width: 340, minWidth: 260 },
  ]);

  const overviewTableRef = useRef<HTMLDivElement>(null);

  // Auto-fit column widths to content. Only grows columns when content
  // is actually overflowing (scrollWidth > clientWidth), and only by the
  // amount needed to eliminate overflow. Never shrinks below minWidth.
  useLayoutEffect(() => {
    const wrapper = overviewTableRef.current;
    if (!wrapper) return;

    const measured: Record<string, number> = {};
    // Measure cells — only when content is actually overflowing
    const cells = wrapper.querySelectorAll<HTMLElement>('[data-col-key]');
    cells.forEach((cell) => {
      const key = cell.dataset.colKey;
      if (!key) return;
      // Only act when content overflows the current column width.
      // scrollWidth > clientWidth means the natural content is wider
      // than the visible area, so the column needs to grow.
      if (cell.scrollWidth > cell.clientWidth + 1) {
        measured[key] = Math.max(measured[key] ?? 0, cell.scrollWidth);
      }
    });

    // Also measure header labels for overflow
    const headerCells = wrapper.querySelectorAll<HTMLElement>('.overview-table-header-cell');
    headerCells.forEach((cell) => {
      const label = cell.firstChild?.textContent?.trim();
      if (!label) return;
      const col = ovColumns.find((c) => c.label === label);
      if (!col) return;
      const handle = cell.querySelector<HTMLElement>('.ov-resize-handle');
      const handleW = handle?.offsetWidth ?? 0;
      // Only grow if header text is overflowing
      if (cell.scrollWidth > cell.clientWidth + 1) {
        const textW = cell.scrollWidth - handleW;
        measured[col.key] = Math.max(measured[col.key] ?? 0, textW);
      }
    });

    setOvColumns((prev) => {
      let changed = false;
      const next = prev.map((col) => {
        const m = measured[col.key];
        if (m !== undefined && m > col.width) {
          changed = true;
          return { ...col, width: Math.max(m, col.minWidth ?? 40) };
        }
        return col;
      });
      // Only update if something actually grew
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.folders, props.folderStatuses]);

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

      <div className="overview-table-wrapper" ref={overviewTableRef}>
        <div className="overview-table" style={{ gridTemplateColumns: gridTemplate }}>
          {ovColumns.map((col) => (
            <div key={col.key} className="overview-table-header-cell" data-col-key={col.key}>
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
            .filter((device): device is DeviceConfig => device !== undefined && device.deviceID !== props.localDeviceId);
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
                <div className="ov-cell ov-cell-name" data-col-key="name">
                  <button className="ov-name-button" onClick={() => props.onSelectFolder(folder.id)}>
                    {folderLabel(folder)}
                  </button>
                </div>
                <div className="ov-cell" data-col-key="type">
                  <span className="badge badge-sm tone-info">{folderTypeLabel(folder.type)}</span>
                </div>
                <div className="ov-cell" data-col-key="status">
                  <span className={`badge badge-sm tone-${folderStateTone(status)}`}>{status?.state ?? "未知"}</span>
                </div>
                <div className="ov-cell" data-col-key="receive">
                  <span className={`badge badge-sm ${folder.manualSync ? "tone-warning" : "tone-success"}`}>
                    {folder.manualSync ? "手动" : "自动"}
                  </span>
                </div>
                <div className="ov-cell" data-col-key="publish">
                  <span className={`badge badge-sm ${folder.manualPublish ? "tone-warning" : "tone-success"}`}>
                    {folder.manualPublish ? "手动" : "自动"}
                  </span>
                </div>
                <div className="ov-cell ov-cell-num" data-col-key="local">
                  {status?.localFiles ?? 0} / {formatBinary(status?.localBytes)}
                </div>
                <div className="ov-cell ov-cell-num" data-col-key="global">
                  {status?.globalFiles ?? 0} / {formatBinary(status?.globalBytes)}
                </div>
                <div className={`ov-cell ov-cell-num${(status?.needTotalItems ?? 0) > 0 ? " has-need" : ""}`} data-col-key="need">
                  {status?.needTotalItems ?? 0}
                </div>
                <div className={`ov-cell ov-cell-num${(status?.errors ?? 0) > 0 ? " has-error" : ""}`} data-col-key="error">
                  {status?.errors ?? 0}
                </div>
                <div className="ov-cell ov-cell-devices" data-col-key="devices">
                  {devices.length === 0 ? (
                    <span className="muted">无</span>
                  ) : (
                    <span title={devices.map((d) => deviceName(d)).join(", ")}>
                      {remoteDeviceNames}{extraCount > 0 ? ` +${extraCount}` : ""}
                    </span>
                  )}
                </div>
                <div className="ov-cell ov-cell-actions" data-col-key="actions">
                  <button className="mini-button" onClick={() => props.onRescan(folder)} disabled={paused} title={paused ? "暂停中的文件夹不可刷新" : "刷新状态"}>↻</button>
                  <button className="mini-button" onClick={() => props.onEditFolder(folder)} title="编辑设置">✎</button>
                  <button
                    className={`mini-button ${folder.paused ? "secondary" : ""}`}
                    onClick={() => props.onTogglePaused(folder)}
                    title={folder.paused ? "恢复文件夹" : "暂停文件夹"}
                  >
                    {folder.paused ? "恢复" : "暂停"}
                  </button>
                  <button className="mini-button secondary" onClick={() => props.onOpenBiDiff(folder)} disabled={paused} title={paused ? "请先恢复文件夹" : "双向接发"}>
                    接发
                  </button>
                  <button className="mini-button secondary" onClick={() => props.onOpenPeerDiff(folder)} disabled={paused} title={paused ? "请先恢复文件夹" : "直传工作台"}>
                    直传
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

