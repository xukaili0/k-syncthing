import type { DeviceConfig, DiscoveryCacheResponse, FolderConfig, OptionsConfig, PendingDevicesResponse } from "../../api";
import NearbyDevicesPanel from "../devices/NearbyDevicesPanel";

function folderLabel(folder: FolderConfig): string {
  return folder.label && folder.label.trim().length > 0 ? folder.label : folder.id;
}

function deviceName(device: DeviceConfig | undefined): string {
  if (!device) {
    return "未知设备";
  }
  return device.name && device.name.trim().length > 0 ? device.name : device.deviceID.slice(0, 7);
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

export default function SettingsHubPanel(props: {
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
  onOpenAdvanced: () => void;
  discoveryCache?: DiscoveryCacheResponse;
  pendingDevices?: PendingDevicesResponse;
  existingDeviceIds?: Set<string>;
  localDeviceId?: string;
  onQuickAddDevice?: (deviceID: string, name?: string) => void;
  onRefreshNearbyDevices?: () => void;
  nearbyBusy?: boolean;
  nearbyRefreshBusy?: boolean;
  nearbyMessage?: string;
}) {
  const options = props.optionsDraft;
  const update = (patch: Partial<OptionsConfig>) => props.onOptionsChange({ ...(options ?? {}), ...patch });

  return (
    <section className="settings-modal-stack">
      <div className="panel surface">
        <div className="panel-header">
          <div>
            <div className="eyebrow">专家设置</div>
            <h3>完整高级配置</h3>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={props.onOpenAdvanced}>
              打开高级配置
            </button>
          </div>
        </div>
        <div className="device-meta">包含 GUI、全局选项、LDAP、全部文件夹与设备，以及新建项目使用的默认值。</div>
      </div>

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
                <span>自动升级间隔（小时，0 表示关闭）</span>
                <input
                  type="number"
                  min={0}
                  value={options.autoUpgradeIntervalH ?? 0}
                  onChange={(event) => update({ autoUpgradeIntervalH: Number(event.target.value) || 0, upgradeToPreReleases: Number(event.target.value) > 0 ? options.upgradeToPreReleases : false })}
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
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={(options.autoUpgradeIntervalH ?? 0) > 0}
                  onChange={(event) =>
                    update({
                      autoUpgradeIntervalH: event.target.checked ? 12 : 0,
                      upgradeToPreReleases: event.target.checked ? Boolean(options.upgradeToPreReleases) : false,
                    })
                  }
                />
                <span>自动升级到官方 Syncthing</span>
              </label>
            </div>
            <div className="device-meta">
              自动升级默认关闭。开启后会按上面的间隔下载官方发布包，并可能覆盖当前定制版本。
            </div>
          </>
        ) : (
          <div className="empty-mini">正在读取全局设置。</div>
        )}
      </div>

      {props.onQuickAddDevice && (
        <NearbyDevicesPanel
          discoveryCache={props.discoveryCache ?? {}}
          pendingDevices={props.pendingDevices ?? {}}
          existingDeviceIds={props.existingDeviceIds ?? new Set()}
          localDeviceId={props.localDeviceId}
          onAdd={props.onQuickAddDevice}
          onRefresh={props.onRefreshNearbyDevices}
          busy={props.nearbyBusy}
          refreshBusy={props.nearbyRefreshBusy}
          message={props.nearbyMessage}
        />
      )}

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
        <div className="device-meta">"登出"只会退出 Web GUI；这里的"完全关闭 Syncthing"会退出后端程序并停止同步。</div>
        {props.systemActionMessage && <div className="inline-message info">{props.systemActionMessage}</div>}
      </div>
    </section>
  );
}

