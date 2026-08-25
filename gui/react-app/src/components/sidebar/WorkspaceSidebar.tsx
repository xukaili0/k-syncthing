import type { Dispatch, SetStateAction } from "react";
import type { CompletionStatus, ConnectionsResponse, DeviceConfig, DeviceStatistics, DiscoveryCacheResponse, FolderConfig, FolderStatus, PendingDevicesResponse, SystemStatus, VersionResponse } from "../../api";
import NearbyDevicesPanel from "../../features/devices/NearbyDevicesPanel";
import { connectionBadgeLabel, connectionBadgeTone, deviceName, folderLabel, folderStateTone, formatBinary, formatLastSeen, formatRate, remoteStateLabel } from "../review/review-formatters";
import { aggregateDeviceCompletion, aggregateSyncStatusLabel, compressionLabel, normalizeAddress, yesNo } from "./sidebar-utils";

type WorkspaceSidebarProps = {
  uiMode: "desktop" | "mobile";
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  version: VersionResponse | null;
  system: SystemStatus | null;
  allDevices: DeviceConfig[];
  connections: ConnectionsResponse | null;
  connectionRates: Record<string, { inbps: number; outbps: number }>;
  completions: Record<string, Record<string, CompletionStatus>>;
  deviceStats: Record<string, DeviceStatistics>;
  folders: FolderConfig[];
  folderStatuses: Record<string, FolderStatus>;
  selectedFolderId: string;
  setSelectedFolderId: Dispatch<SetStateAction<string>>;
  expandedFolders: Record<string, boolean>;
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
  mainRefreshSeconds: number;
  panelRefreshSeconds: number;
  applyRefreshSettings: (main: number, panel: number) => void;
  loadBootstrap: () => Promise<void>;
  bootBusy: boolean;
  openDeviceEditor: (device: DeviceConfig) => void;
  discoveryCache: DiscoveryCacheResponse;
  pendingDevices: PendingDevicesResponse;
  existingDeviceIds: Set<string>;
  onQuickAddDevice: (deviceID: string, name?: string) => void;
  onRefreshNearbyDevices: () => void;
  nearbyBusy?: boolean;
  nearbyRefreshBusy?: boolean;
  nearbyMessage?: string;
};

const refreshChoices = [2, 3, 5, 10, 15, 30];

export default function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const {
    uiMode,
    setSidebarOpen,
    version,
    system,
    allDevices,
    connections,
    connectionRates,
    completions,
    deviceStats,
    folders,
    folderStatuses,
    selectedFolderId,
    setSelectedFolderId,
    expandedFolders,
    setExpandedFolders,
    mainRefreshSeconds,
    panelRefreshSeconds,
    applyRefreshSettings,
    loadBootstrap,
    bootBusy,
    openDeviceEditor,
    discoveryCache,
    pendingDevices,
    existingDeviceIds,
    onQuickAddDevice,
    onRefreshNearbyDevices,
    nearbyBusy,
    nearbyRefreshBusy,
    nearbyMessage,
  } = props;
  const localDeviceId = system?.myID;
  const remoteDevices = allDevices.filter((device) => device.deviceID !== localDeviceId);
  const localDeviceExpanded = Boolean(expandedFolders["device-local"]);

  return (
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

      <NearbyDevicesPanel
        compact
        discoveryCache={discoveryCache}
        pendingDevices={pendingDevices}
        existingDeviceIds={existingDeviceIds}
        localDeviceId={localDeviceId}
        onAdd={onQuickAddDevice}
        onRefresh={onRefreshNearbyDevices}
        busy={nearbyBusy}
        refreshBusy={nearbyRefreshBusy}
        message={nearbyMessage}
      />

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
  );
}
