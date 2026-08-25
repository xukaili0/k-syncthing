import { useMemo, useState } from "react";
import type { CompletionStatus, DeviceConfig, DiscoveryCacheResponse, FolderConfig, PendingDevicesResponse } from "../../api";
import DiscoveredDevicesList from "./DiscoveredDevicesList";
import { shortDeviceID } from "./discovered-devices";

export type DeviceShareDraft = {
  selected: Record<string, boolean>;
  encryptionPasswords: Record<string, string>;
};

type DeviceEditorTab = "general" | "sharing" | "advanced";

function folderLabel(folder: FolderConfig): string {
  return folder.label && folder.label.trim().length > 0 ? folder.label : folder.id;
}

function deviceName(device: DeviceConfig | undefined): string {
  if (!device) {
    return "未知设备";
  }
  return device.name && device.name.trim().length > 0 ? device.name : device.deviceID.slice(0, 7);
}

export default function DeviceSettingsPanel(props: {
  draft: DeviceConfig;
  onChange: (value: DeviceConfig) => void;
  shareDraft: DeviceShareDraft;
  onShareDraftChange: (value: DeviceShareDraft) => void;
  allFolders: FolderConfig[];
  allDevices: DeviceConfig[];
  completions: Record<string, Record<string, CompletionStatus>>;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  isNew: boolean;
  onDelete?: () => void;
  discoveryCache?: DiscoveryCacheResponse;
  pendingDevices?: PendingDevicesResponse;
  existingDeviceIds?: Set<string>;
  localDeviceId?: string;
}) {
  const draft = props.draft;
  const update = (patch: Partial<DeviceConfig>) => props.onChange({ ...draft, ...patch });
  const [activeTab, setActiveTab] = useState<DeviceEditorTab>("general");
  const addresses = (draft.addresses ?? ["dynamic"]).join(", ");
  const allowedNetworks = (draft.allowedNetworks ?? []).join("\n");
  const willBeReintroducedBy = useMemo(() => {
    if (!draft.introducedBy) {
      return "";
    }
    const introducerDevice = props.allDevices.find((device) => device.deviceID === draft.introducedBy);
    return introducerDevice && introducerDevice.introducer ? deviceName(introducerDevice) : "";
  }, [draft.introducedBy, props.allDevices]);
  const sharedFolders = useMemo(
    () => props.allFolders.filter((folder) => props.shareDraft.selected[folder.id]),
    [props.allFolders, props.shareDraft.selected],
  );
  const unsharedFolders = useMemo(
    () => props.allFolders.filter((folder) => !props.shareDraft.selected[folder.id]),
    [props.allFolders, props.shareDraft.selected],
  );
  const updateShareSelection = (folderID: string, selected: boolean) => {
    props.onShareDraftChange({
      ...props.shareDraft,
      selected: {
        ...props.shareDraft.selected,
        [folderID]: selected,
      },
    });
  };
  const updateSharePassword = (folderID: string, value: string) => {
    props.onShareDraftChange({
      ...props.shareDraft,
      encryptionPasswords: {
        ...props.shareDraft.encryptionPasswords,
        [folderID]: value,
      },
    });
  };
  const selectAllSharedState = (selected: boolean) => {
    const nextSelected: Record<string, boolean> = { ...props.shareDraft.selected };
    for (const folder of props.allFolders) {
      nextSelected[folder.id] = selected;
    }
    props.onShareDraftChange({
      ...props.shareDraft,
      selected: nextSelected,
    });
  };

  return (
    <section className="panel surface workspace-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">设备设置</div>
          <h3>{deviceName(draft)}</h3>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
          {props.onDelete && (
            <button className="ghost-button danger-button" onClick={props.onDelete} disabled={props.busy}>
              删除设备
            </button>
          )}
          <button className="primary-button" onClick={props.onSave} disabled={props.busy}>
            {props.busy ? "保存中..." : props.isNew ? "创建设备" : "保存设备设置"}
          </button>
        </div>
      </div>

      {props.message && <div className="inline-message info">{props.message}</div>}

      <div className="editor-tabs">
        <button className={`tab-button${activeTab === "general" ? " active" : ""}`} onClick={() => setActiveTab("general")}>
          常规
        </button>
        <button className={`tab-button${activeTab === "sharing" ? " active" : ""}`} onClick={() => setActiveTab("sharing")}>
          共享
        </button>
        <button className={`tab-button${activeTab === "advanced" ? " active" : ""}`} onClick={() => setActiveTab("advanced")}>
          高级
        </button>
      </div>

      {activeTab === "general" && (
        <div className="settings-modal-stack">
          <div className="settings-grid">
            <label className="wide-field">
              <span>设备 ID</span>
              <input value={draft.deviceID} disabled={!props.isNew} onChange={(event) => update({ deviceID: event.target.value })} />
              {props.isNew ? (
                <div className="help-block">一般不用手抄完整 ID。等下面出现附近设备后点添加；也可以粘贴设备 ID。</div>
              ) : null}
            </label>
            <label>
              <span>设备名称</span>
              <input value={draft.name ?? ""} onChange={(event) => update({ name: event.target.value })} />
              <div className="help-block">在集群状态中显示，用于替代设备 ID。若留空，则会使用设备自己广播的名称。</div>
            </label>
            <label>
              <span>暂停</span>
              <input type="checkbox" checked={Boolean(draft.paused)} onChange={(event) => update({ paused: event.target.checked })} />
            </label>
          </div>

          {props.isNew && (
            <DiscoveredDevicesList
              discoveryCache={props.discoveryCache ?? {}}
              pendingDevices={props.pendingDevices ?? {}}
              existingDeviceIds={props.existingDeviceIds ?? new Set()}
              localDeviceId={props.localDeviceId}
              onSelectDevice={(deviceID, name) =>
                update({
                  deviceID,
                  name: name && name !== shortDeviceID(deviceID) ? name : draft.name,
                })
              }
              showWhenEmpty
            />
          )}
        </div>
      )}

      {activeTab === "sharing" && (
        <div className="settings-modal-stack">
          <div className="settings-columns">
            <div className="panel-subsection">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.introducer)}
                  disabled={Boolean(draft.untrusted)}
                  onChange={(event) => update({ introducer: event.target.checked })}
                />
                <span>作为中介</span>
              </label>
              <div className="help-block">将中介中的设备添加到我们的设备列表中，用于相互共享的文件夹。</div>
            </div>
            <div className="panel-subsection">
              <label className="toggle-card">
                <input
                  type="checkbox"
                  checked={Boolean(draft.autoAcceptFolders)}
                  disabled={Boolean(draft.untrusted)}
                  onChange={(event) => update({ autoAcceptFolders: event.target.checked })}
                />
                <span>自动接受</span>
              </label>
              <div className="help-block">当此远端设备共享一个当前设备尚不存在的新文件夹时，当前设备会自动按默认路径创建并接受该文件夹；关闭后，这类邀请会出现在"待接受共享文件夹"面板中，由你手动确认。</div>
            </div>
          </div>

          {willBeReintroducedBy && <div className="inline-message info">{willBeReintroducedBy} 可能会重新引入此设备。</div>}

          <div className="panel-subsection">
            <div className="section-title">共享文件夹</div>
            <div className="device-share-toolbar">
              <span className="help-inline">取消选择文件夹以停止与此设备共享。</span>
              <span className="device-share-links">
                <button className="link-button" onClick={() => selectAllSharedState(true)}>全选</button>
                <button className="link-button" onClick={() => selectAllSharedState(false)}>取消全选</button>
              </span>
            </div>
            <div className="share-list">
              {props.allFolders.length === 0 ? (
                <div className="empty-mini">当前没有可共享的文件夹。</div>
              ) : (
                props.allFolders.map((folder) => {
                  const selected = Boolean(props.shareDraft.selected[folder.id]);
                  const completion = props.completions[draft.deviceID]?.[folder.id];
                  return (
                    <div key={folder.id} className={`share-folder-row${selected ? " selected" : ""}`}>
                      <label className="toggle-card share-card">
                        <input type="checkbox" checked={selected} onChange={(event) => updateShareSelection(folder.id, event.target.checked)} />
                        <span>{folderLabel(folder)}</span>
                      </label>
                      {draft.untrusted && selected && (
                        <label className="share-password-field">
                          <span>如果不受信任，请输入加密密码</span>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={props.shareDraft.encryptionPasswords[folder.id] ?? ""}
                            onChange={(event) => updateSharePassword(folder.id, event.target.value)}
                          />
                        </label>
                      )}
                      {completion?.remoteState === "notSharing" && <div className="help-block">远端设备尚未接受共享此文件夹。</div>}
                      {completion?.remoteState === "paused" && <div className="help-block">远端设备已暂停此文件夹。</div>}
                    </div>
                  );
                })
              )}
            </div>
            {sharedFolders.length === 0 && <div className="help-block">当前没有与此设备共享的文件夹。</div>}
          </div>
        </div>
      )}

      {activeTab === "advanced" && (
        <div className="settings-modal-stack">
          <div className="settings-grid">
            <label className="wide-field">
              <span>地址</span>
              <input
                value={addresses}
                onChange={(event) =>
                  update({
                    addresses: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
              <div className="help-block">输入以半角逗号分隔的（"tcp://ip:port", "tcp://host:port"）设备地址，或者输入"dynamic"以自动发现设备地址。</div>
            </label>
            <label>
              <span>压缩</span>
              <select value={draft.compression ?? "metadata"} onChange={(event) => update({ compression: event.target.value })}>
                <option value="always">全部数据</option>
                <option value="metadata">仅元数据</option>
                <option value="never">关闭</option>
              </select>
            </label>
          </div>

          <div className="settings-columns">
            <div className="panel-subsection">
              <div className="section-title">连接管理</div>
              <label className="inline-field">
                <span>连接数</span>
                <span className="inline-help">帮助</span>
              </label>
              <input
                type="number"
                min={0}
                value={draft.numConnections ?? 0}
                onChange={(event) => update({ numConnections: Number(event.target.value) || 0 })}
              />
              <div className="help-block">当两台设备上的连接数均被设为大于 1 时，Syncthing 会尝试建立多个并行连接。如果两台设备上的设置的连接数不同，则会使用最大的连接数。设为 0 表示让 Syncthing 自行决定。</div>
            </div>

            <div className="panel-subsection">
              <div className="section-title">设备速率限制</div>
              <label>
                <span>传入速率限制（KiB/s）</span>
                <input
                  type="number"
                  min={0}
                  value={draft.maxRecvKbps ?? 0}
                  onChange={(event) => update({ maxRecvKbps: Number(event.target.value) || 0 })}
                />
              </label>
              <label>
                <span>传出速率限制（KiB/s）</span>
                <input
                  type="number"
                  min={0}
                  value={draft.maxSendKbps ?? 0}
                  onChange={(event) => update({ maxSendKbps: Number(event.target.value) || 0 })}
                />
              </label>
              <div className="help-block">速率限制适用于到此设备的所有连接的累积流量。</div>
            </div>
          </div>

          <div className="panel-subsection">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={Boolean(draft.untrusted)}
                onChange={(event) =>
                  update({
                    untrusted: event.target.checked,
                    introducer: event.target.checked ? false : draft.introducer,
                    autoAcceptFolders: event.target.checked ? false : draft.autoAcceptFolders,
                  })
                }
              />
              <span>不受信任</span>
            </label>
            <div className="help-block">与此设备共享的所有文件夹都必须有密码保护，这样所有发送的数据在没有密码的情况下是不可读的。</div>
          </div>

          <div className="panel-subsection">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={Boolean(draft.skipIntroductionRemovals)}
                onChange={(event) => update({ skipIntroductionRemovals: event.target.checked })}
              />
              <span>跳过引入移除</span>
            </label>
          </div>

          <label className="wide-field">
            <span>允许网络（每行一个）</span>
            <textarea
              rows={3}
              value={allowedNetworks}
              onChange={(event) =>
                update({
                  allowedNetworks: event.target.value
                    .split(/\r?\n/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      )}
    </section>
  );
}

