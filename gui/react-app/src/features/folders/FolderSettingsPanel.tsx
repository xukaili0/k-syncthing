import { useEffect, useMemo, useState } from "react";
import type { CompletionStatus, DeviceConfig, FolderConfig } from "../../api";
import { folderPathChanged, normalizeFolderPath } from "./folder-editor-utils";

type FolderEditorTab = "general" | "sharing" | "versioning" | "ignores" | "advanced";
type FolderVersioningSelector = "none" | "trashcan" | "simple" | "staggered" | "external";

function folderLabel(folder: FolderConfig): string {
  return folder.label && folder.label.trim().length > 0 ? folder.label : folder.id;
}

function deviceName(device: DeviceConfig | undefined): string {
  if (!device) {
    return "未知设备";
  }
  return device.name && device.name.trim().length > 0 ? device.name : device.deviceID.slice(0, 7);
}

function canReceive(folder: FolderConfig): boolean {
  return folder.type !== "sendonly";
}

function canPublish(folder: FolderConfig): boolean {
  return folder.type !== "receiveonly" && folder.type !== "receiveencrypted";
}

function createDefaultGuiVersioning() {
  return {
    selector: "none" as FolderVersioningSelector,
    trashcanClean: 0,
    cleanupIntervalS: 3600,
    simpleKeep: 5,
    staggeredMaxAge: 365,
    externalCommand: "",
  };
}

function completionRemoteStateLabel(remoteState?: string): string {
  switch (remoteState) {
    case "paused":
      return "远端已暂停";
    case "notSharing":
      return "远端尚未接受共享";
    case "idle":
      return "远端空闲";
    case "syncing":
      return "远端同步中";
    case "scanning":
      return "远端扫描中";
    default:
      return "";
  }
}

export default function FolderSettingsPanel(props: {
  draft: FolderConfig;
  allDevices: DeviceConfig[];
  completions: Record<string, Record<string, CompletionStatus>>;
  ignoreText: string;
  onIgnoreTextChange: (value: string) => void;
  ignoreError: string;
  ignoreBusy: boolean;
  addIgnores: boolean;
  onAddIgnoresChange: (value: boolean) => void;
  onChange: (value: FolderConfig) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  isNew: boolean;
  savedPath?: string;
  onDelete?: () => void;
}) {
  const draft = props.draft;
  const update = (patch: Partial<FolderConfig>) => props.onChange({ ...draft, ...patch });
  const [activeTab, setActiveTab] = useState<FolderEditorTab>("general");
  const selectedDeviceIds = useMemo(() => new Set((draft.devices ?? []).map((item) => item.deviceID)), [draft.devices]);
  const sharedDevices = useMemo(() => props.allDevices.filter((device) => selectedDeviceIds.has(device.deviceID)), [props.allDevices, selectedDeviceIds]);
  const unsharedDevices = useMemo(() => props.allDevices.filter((device) => !selectedDeviceIds.has(device.deviceID)), [props.allDevices, selectedDeviceIds]);
  const internalVersioningEnabled = draft._guiVersioning ? !["none", "external"].includes(draft._guiVersioning.selector) : false;

  useEffect(() => {
    setActiveTab("general");
  }, [draft.id]);

  const updateDeviceSelection = (deviceID: string, enabled: boolean) => {
    const current = draft.devices ?? [];
    if (enabled) {
      if (current.some((item) => item.deviceID === deviceID)) {
        return;
      }
      props.onChange({
        ...draft,
        devices: [...current, { deviceID }],
      });
      return;
    }
    props.onChange({
      ...draft,
      devices: current.filter((item) => item.deviceID !== deviceID),
    });
  };
  const updateDeviceEncryptionPassword = (deviceID: string, encryptionPassword: string) => {
    const current = draft.devices ?? [];
    props.onChange({
      ...draft,
      devices: current.map((item) => (item.deviceID === deviceID ? { ...item, encryptionPassword } : item)),
    });
  };
  const toggleAllDevices = (enabled: boolean, scope: "shared" | "unshared" | "all") => {
    const source = scope === "shared" ? sharedDevices : scope === "unshared" ? unsharedDevices : props.allDevices;
    const current = new Map((draft.devices ?? []).map((item) => [item.deviceID, item]));
    for (const device of source) {
      if (enabled) {
        if (!current.has(device.deviceID)) {
          current.set(device.deviceID, { deviceID: device.deviceID });
        }
      } else {
        current.delete(device.deviceID);
      }
    }
    props.onChange({ ...draft, devices: Array.from(current.values()) });
  };
  const guiVersioning = draft._guiVersioning ?? createDefaultGuiVersioning();
  const updateGuiVersioning = (patch: Partial<typeof guiVersioning>) => {
    update({ _guiVersioning: { ...guiVersioning, ...patch } });
  };
  const folderTypeLocked = !props.isNew && draft.type === "receiveencrypted";
  const remoteStateForFolder = (deviceID: string) => props.completions[deviceID]?.[draft.id]?.remoteState;
  const pathMoved = !props.isNew && folderPathChanged(props.savedPath, draft.path);

  return (
    <section className="panel surface workspace-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">文件夹设置</div>
          <h3>{folderLabel(draft)}</h3>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
          {props.onDelete && (
            <button className="ghost-button danger-button" onClick={props.onDelete} disabled={props.busy}>
              删除文件夹
            </button>
          )}
          <button className="primary-button" onClick={props.onSave} disabled={props.busy}>
            {props.busy ? "保存中..." : props.isNew ? "创建文件夹" : "保存文件夹设置"}
          </button>
        </div>
      </div>

      {props.message && <div className="inline-message info">{props.message}</div>}

      <div className="editor-tabs">
        <button className={activeTab === "general" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("general")}>
          常规
        </button>
        <button className={activeTab === "sharing" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("sharing")}>
          共享
        </button>
        <button className={activeTab === "versioning" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("versioning")}>
          文件版本控制
        </button>
        <button className={activeTab === "ignores" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("ignores")}>
          忽略模式
        </button>
        <button className={activeTab === "advanced" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("advanced")}>
          高级
        </button>
      </div>

      {activeTab === "general" && (
        <div className="settings-grid">
          <label>
            <span>文件夹名称</span>
            <input value={draft.label ?? ""} onChange={(event) => update({ label: event.target.value })} />
            <div className="help-block">可选的描述性名称。每个设备上的名称都可以不同。</div>
          </label>
          <label>
            <span>文件夹 ID</span>
            <input value={draft.id} disabled={!props.isNew} onChange={(event) => update({ id: event.target.value })} />
            <div className="help-block">文件夹的必填标识符。在所有设备上都必须完全一致，且区分大小写。</div>
          </label>
          <label className="wide-field">
            <span>本机路径</span>
            <input
              value={draft.path}
              onChange={(event) => update({ path: event.target.value })}
              placeholder={props.isNew ? "例如 E:\\myserver\\Server_special" : undefined}
            />
            {!props.isNew && props.savedPath && (
              <div className="help-block">当前已保存路径：{normalizeFolderPath(props.savedPath)}</div>
            )}
            {pathMoved && (
              <div className="inline-message warning">
                这会把同一个文件夹 ID 挂到新路径，索引会保留，不需要删掉重建。请先把原目录整份移过去（含 .stfolder）。如果新路径是空的，可能被当成删除。
              </div>
            )}
            <div className="help-block">
              {props.isNew
                ? "本机上的文件夹路径。目录不存在时会自动创建。电脑可用绝对路径或 ~/path（~ 是用户目录）。手机上请用绝对路径或 ~/path（~ 是 /storage/emulated/0/syncthing）。"
                : "搬家时先移动原目录，再在这里改路径并保存。文件夹 ID 不要改，也不要删除后新建。"}
            </div>
          </label>
        </div>
      )}

      {activeTab === "sharing" && (
        <div className="panel-subsection">
          <div className="section-title">当前共享到的设备</div>
          <div className="device-share-toolbar">
            <div className="help-inline">取消选择设备以停止共享此文件夹。</div>
            <div className="device-share-links">
              <button className="link-button" onClick={() => toggleAllDevices(true, "shared")}>
                全选
              </button>
              <button className="link-button" onClick={() => toggleAllDevices(false, "shared")}>
                取消全选
              </button>
            </div>
          </div>
          <div className="share-list">
            {sharedDevices.map((device) => (
              <div key={device.deviceID} className="share-folder-row selected">
                <label className="toggle-card share-card">
                  <input type="checkbox" checked onChange={(event) => updateDeviceSelection(device.deviceID, event.target.checked)} />
                  <span>{deviceName(device)}</span>
                </label>
                {completionRemoteStateLabel(remoteStateForFolder(device.deviceID)) && (
                  <div className="help-inline">{completionRemoteStateLabel(remoteStateForFolder(device.deviceID))}</div>
                )}
                {device.untrusted && (
                  <label className="share-password-field">
                    <span>如果不受信任，请输入加密密码</span>
                    <input
                      type="password"
                      value={(draft.devices ?? []).find((item) => item.deviceID === device.deviceID)?.encryptionPassword ?? ""}
                      onChange={(event) => updateDeviceEncryptionPassword(device.deviceID, event.target.value)}
                    />
                  </label>
                )}
              </div>
            ))}
            {sharedDevices.length === 0 && <div className="empty-mini">当前没有已共享的设备。</div>}
          </div>

          <div className="section-title">未共享的设备</div>
          <div className="device-share-toolbar">
            <div className="help-inline">
              {props.allDevices.length > 0 ? "选择额外设备以共享此文件夹。" : "当前没有可共享的远端设备。"}
            </div>
            {props.allDevices.length > 0 && (
              <div className="device-share-links">
                <button className="link-button" onClick={() => toggleAllDevices(true, "unshared")}>
                  全选
                </button>
                <button className="link-button" onClick={() => toggleAllDevices(false, "unshared")}>
                  取消全选
                </button>
              </div>
            )}
          </div>
          <div className="share-list">
            {unsharedDevices.map((device) => (
              <div key={device.deviceID} className="share-folder-row">
                <label className="toggle-card share-card">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={(event) => updateDeviceSelection(device.deviceID, event.target.checked)}
                  />
                  <span>{deviceName(device)}</span>
                </label>
                {device.untrusted && <div className="help-inline">如果不受信任，请输入加密密码</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "versioning" && (
        <div className="settings-grid">
          <label className="wide-field">
            <span>文件版本控制</span>
            <select
              value={guiVersioning.selector}
              onChange={(event) => updateGuiVersioning({ selector: event.target.value as FolderVersioningSelector })}
            >
              <option value="none">不启用文件版本控制</option>
              <option value="trashcan">回收站版本控制</option>
              <option value="simple">简单版本控制</option>
              <option value="staggered">分层版本控制</option>
              <option value="external">外部版本控制</option>
            </select>
            {guiVersioning.selector === "none" && <div className="help-block">不启用文件版本控制。</div>}
            {guiVersioning.selector === "trashcan" && <div className="help-block">文件被 Syncthing 替换或删除时，会移动到 .stversions 目录中。</div>}
            {guiVersioning.selector === "simple" && (
              <div className="help-block">文件被 Syncthing 替换或删除时，会移动到 .stversions 目录中的日期戳版本中。</div>
            )}
            {guiVersioning.selector === "staggered" && (
              <div className="help-block">
                文件被 Syncthing 替换或删除时，会移动到 .stversions 目录中的日期戳版本中。版本会根据时间分层保留，并在超过最大保留时间时清理。
              </div>
            )}
            {guiVersioning.selector === "external" && (
              <div className="help-block">由外部命令处理版本控制。该命令必须把文件从共享文件夹中移走。</div>
            )}
          </label>

          {guiVersioning.selector !== "none" && (
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={draft.archiveMetadataOnly ?? false}
                onChange={(event) => update({ archiveMetadataOnly: event.target.checked })}
              />
              <span>仅元数据变更时跳过归档</span>
              <div className="help-block">
                当文件内容未变（区块哈希一致）仅修改时间或权限等元数据变化时，不触发版本归档，直接原地更新文件元数据。
              </div>
            </label>
          )}

          {(guiVersioning.selector === "trashcan" || guiVersioning.selector === "simple") && (
            <label>
              <span>清理周期（天）</span>
              <input
                type="number"
                min={0}
                value={guiVersioning.trashcanClean}
                onChange={(event) => updateGuiVersioning({ trashcanClean: Number(event.target.value) || 0 })}
              />
              <div className="help-block">在回收站中保留文件的天数。0 表示永久保留。</div>
            </label>
          )}

          {guiVersioning.selector === "simple" && (
            <label>
              <span>保留版本数</span>
              <input
                type="number"
                min={1}
                value={guiVersioning.simpleKeep}
                onChange={(event) => updateGuiVersioning({ simpleKeep: Number(event.target.value) || 1 })}
              />
              <div className="help-block">每个文件保留的旧版本数量。</div>
            </label>
          )}

          {guiVersioning.selector === "staggered" && (
            <label>
              <span>最大保留时间（天）</span>
              <input
                type="number"
                min={0}
                value={guiVersioning.staggeredMaxAge}
                onChange={(event) => updateGuiVersioning({ staggeredMaxAge: Number(event.target.value) || 0 })}
              />
              <div className="help-block">版本的最大保留时间。0 表示永久保留。</div>
            </label>
          )}

          {internalVersioningEnabled && (
            <>
              <label className="wide-field">
                <span>版本路径</span>
                <input
                  value={draft.versioning?.fsPath ?? ""}
                  onChange={(event) => update({ versioning: { ...(draft.versioning ?? {}), fsPath: event.target.value } })}
                />
                <div className="help-block">版本文件保存路径。留空表示使用共享文件夹内默认的 .stversions 目录。</div>
              </label>
              <label>
                <span>清理间隔（秒）</span>
                <input
                  type="number"
                  min={0}
                  value={guiVersioning.cleanupIntervalS}
                  onChange={(event) => updateGuiVersioning({ cleanupIntervalS: Number(event.target.value) || 0 })}
                />
                <div className="help-block">版本目录清理任务的运行间隔。0 表示禁用周期性清理。</div>
              </label>
            </>
          )}

          {guiVersioning.selector === "external" && (
            <label className="wide-field">
              <span>命令</span>
              <input
                value={guiVersioning.externalCommand}
                onChange={(event) => updateGuiVersioning({ externalCommand: event.target.value })}
              />
              <div className="help-block">外部命令负责处理版本控制，并且必须把文件从共享目录中移走。</div>
            </label>
          )}
        </div>
      )}

      {activeTab === "ignores" && (
        <div className="panel-subsection">
          {props.isNew ? (
            <>
              <label className="toggle-card">
                <input type="checkbox" checked={props.addIgnores} onChange={(event) => props.onAddIgnoresChange(event.target.checked)} />
                <span>添加忽略模式</span>
              </label>
              <div className="help-block">忽略模式只能在文件夹创建后真正生效。勾选后会在保存时一并写入忽略规则。</div>
              {props.addIgnores && (
                <label className="wide-field">
                  <span>每行输入一条忽略规则</span>
                  <textarea
                    rows={8}
                    value={props.ignoreText}
                    onChange={(event) => props.onIgnoreTextChange(event.target.value)}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <div className="help-inline">每行一条忽略模式。</div>
              <label className="wide-field">
                <textarea
                  rows={10}
                  value={props.ignoreBusy ? "加载中..." : props.ignoreText}
                  onChange={(event) => props.onIgnoreTextChange(event.target.value)}
                  disabled={props.ignoreBusy}
                />
              </label>
              {props.ignoreError && <div className="inline-message danger">{props.ignoreError}</div>}
              <div className="help-block">支持的模式速查：</div>
              <div className="help-block"><code>(?d)</code> 表示：如果阻止目录删除，则该文件可被删除。</div>
              <div className="help-block"><code>(?i)</code> 表示：该模式按不区分大小写匹配。</div>
              <div className="help-block"><code>!</code> 表示：反转该规则（即不要排除）。</div>
              <div className="help-block"><code>*</code> 表示：单层通配符（只匹配单个目录层级）。</div>
              <div className="help-block"><code>**</code> 表示：多层通配符（匹配多个目录层级）。</div>
              <div className="help-block"><code>//</code> 表示：行首注释。</div>
            </>
          )}
        </div>
      )}

      {activeTab === "advanced" && (
        <div className="settings-grid">
          <label className="wide-field">
            <span>扫描</span>
            <div className="settings-columns">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.fsWatcherEnabled)}
                  onChange={(event) => update({ fsWatcherEnabled: event.target.checked })}
                />
                <span>监视文件变化</span>
              </label>
              <label>
                <span>完全重扫间隔（秒）</span>
                <input
                  type="number"
                  min={0}
                  value={draft.rescanIntervalS ?? 0}
                  onChange={(event) => update({ rescanIntervalS: Number(event.target.value) || 0 })}
                />
              </label>
            </div>
            <div className="help-block">监视文件变化会通过文件系统通知发现大部分变化；完全重扫用于兜底扫描。</div>
          </label>

          <label>
            <span>文件夹类型</span>
            <select value={draft.type} disabled={folderTypeLocked} onChange={(event) => update({ type: event.target.value })}>
              <option value="sendreceive">Send &amp; Receive</option>
              <option value="sendonly">Send Only</option>
              <option value="receiveonly">Receive Only</option>
              <option value="receiveencrypted">Receive Encrypted</option>
            </select>
            {draft.type === "sendonly" && <div className="help-block">文件不会接受其他设备上的变化，但本设备上的变化会发送给其他设备。</div>}
            {draft.type === "receiveonly" && <div className="help-block">文件从集群同步到当前设备，但本地变化不会发送给其他设备。</div>}
            {draft.type === "receiveencrypted" && (
              <div className="help-block">只存储和同步加密数据。所有连接设备上的文件夹必须使用相同密码，或者也设置为 Receive Encrypted。</div>
            )}
            {folderTypeLocked && <div className="help-block">Receive Encrypted 文件夹类型在添加后不能再修改。</div>}
          </label>

          <label>
            <span>文件拉取顺序</span>
            <select value={draft.order ?? "random"} disabled={draft.type === "sendonly"} onChange={(event) => update({ order: event.target.value })}>
              <option value="random">Random</option>
              <option value="alphabetic">Alphabetic</option>
              <option value="smallestFirst">Smallest First</option>
              <option value="largestFirst">Largest First</option>
              <option value="oldestFirst">Oldest First</option>
              <option value="newestFirst">Newest First</option>
            </select>
            {draft.type === "sendonly" && <div className="help-block">当文件夹类型为 Send Only 时，此功能不可用。</div>}
          </label>

          <label>
            <span>最小可用磁盘空间</span>
            <div className="inline-field">
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.minDiskFree?.value ?? 0}
                onChange={(event) =>
                  update({
                    minDiskFree: {
                      value: Number(event.target.value) || 0,
                      unit: draft.minDiskFree?.unit ?? "%",
                    },
                  })
                }
              />
              <select
                value={draft.minDiskFree?.unit ?? "%"}
                onChange={(event) =>
                  update({
                    minDiskFree: {
                      value: draft.minDiskFree?.value ?? 0,
                      unit: event.target.value as "%" | "kB" | "MB" | "GB" | "TB",
                    },
                  })
                }
              >
                <option value="%">%</option>
                <option value="kB">kB</option>
                <option value="MB">MB</option>
                <option value="GB">GB</option>
                <option value="TB">TB</option>
              </select>
            </div>
            <div className="help-block">当文件夹所在分区剩余空间低于此值时，Syncthing 将停止接收新数据。设为 0 表示不限制。百分比是相对于总磁盘容量。</div>
          </label>

            <div className="toggle-grid wide-field">
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.manualSync)}
                  disabled={!canReceive(draft)}
                  onChange={(event) => update({ manualSync: event.target.checked })}
                />
                <span>手动审核接收（以当前设备为基准）</span>
              </label>
              <div className="help-block">启用后，远端设备的变化不会自动同步到本设备，需要手动审核确认后才应用。仅控制接收方向。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.manualPublish)}
                  disabled={!canPublish(draft)}
                  onChange={(event) => update({ manualPublish: event.target.checked })}
                />
                <span>手动审核发布（以当前设备为基准）</span>
              </label>
              <div className="help-block">启用后，本设备上的变化不会自动发布给其他设备，需要手动审核确认后才公开。仅控制发送方向。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input type="checkbox" checked={Boolean(draft.paused)} onChange={(event) => update({ paused: event.target.checked })} />
                <span>暂停此文件夹</span>
              </label>
              <div className="help-block">暂停后本文件夹停止同步，但不会删除已同步的文件。恢复后自动继续。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.ignorePerms)}
                  onChange={(event) => update({ ignorePerms: event.target.checked })}
                />
                <span>忽略权限</span>
              </label>
              <div className="help-block">禁用文件权限的比较与同步。适用于不支持或自定义权限的文件系统（如 FAT、exFAT、Synology、Android）。Receive Encrypted 类型自动启用。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.ignoreDelete)}
                  onChange={(event) => update({ ignoreDelete: event.target.checked })}
                />
                <span>忽略删除</span>
              </label>
              <div className="help-block">启用后，其他设备上的删除操作不会同步到本设备。相当于本设备对所有文件只进不出（仅新增和修改会同步，删除被忽略）。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.autoNormalize)}
                  onChange={(event) => update({ autoNormalize: event.target.checked })}
                />
                <span>自动规范化文件名</span>
              </label>
              <div className="help-block">自动将文件名中不兼容当前操作系统的字符替换为等效字符。例如 Windows 不允许文件名含 <code>:</code>、<code>*</code> 等字符，开启后会自动处理。</div>
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.syncOwnership)}
                  disabled={draft.type === "sendonly" || draft.type === "receiveencrypted"}
                  onChange={(event) => update({ syncOwnership: event.target.checked })}
                />
                <span>同步所有权</span>
              </label>
              <div className="help-block">同时发送和接收文件的所有者/组信息（uid/gid）。通常需要以提升权限（root 或管理员）运行 Syncthing 才能生效。</div>
              {(draft.type === "sendonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Send Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.sendOwnership || draft.syncOwnership)}
                  disabled={draft.type === "receiveonly" || draft.type === "receiveencrypted" || Boolean(draft.syncOwnership)}
                  onChange={(event) => update({ sendOwnership: event.target.checked })}
                />
                <span>发送所有权</span>
              </label>
              <div className="help-block">仅发送文件的所有者/组信息给其他设备，但不应用接收到的所有权信息。可能对性能有显著影响。开启"同步所有权"时自动启用。</div>
              {(draft.type === "receiveonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Receive Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.syncXattrs)}
                  disabled={draft.type === "sendonly" || draft.type === "receiveencrypted"}
                  onChange={(event) => update({ syncXattrs: event.target.checked })}
                />
                <span>同步扩展属性</span>
              </label>
              <div className="help-block">同时发送和接收文件的扩展属性（xattr，如 SELinux 标签、macOS 元数据等）。可能需要以提升权限运行才能读写扩展属性。</div>
              {(draft.type === "sendonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Send Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
            <div className="toggle-item">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.sendXattrs || draft.syncXattrs)}
                  disabled={draft.type === "receiveonly" || draft.type === "receiveencrypted" || Boolean(draft.syncXattrs)}
                  onChange={(event) => update({ sendXattrs: event.target.checked })}
                />
                <span>发送扩展属性</span>
              </label>
              <div className="help-block">仅发送文件的扩展属性给其他设备，但不应用接收到的扩展属性。可能对性能有显著影响。开启"同步扩展属性"时自动启用。</div>
              {(draft.type === "receiveonly" || draft.type === "receiveencrypted") && (
                <div className="help-block">文件夹类型为 Receive Only 或 Receive Encrypted 时不可用。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

