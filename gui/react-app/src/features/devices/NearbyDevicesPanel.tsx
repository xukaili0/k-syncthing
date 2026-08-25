import type { DiscoveryCacheResponse, PendingDevicesResponse } from "../../api";
import DiscoveredDevicesList from "./DiscoveredDevicesList";

export default function NearbyDevicesPanel(props: {
  discoveryCache: DiscoveryCacheResponse;
  pendingDevices: PendingDevicesResponse;
  existingDeviceIds: Set<string>;
  localDeviceId?: string;
  onAdd: (deviceID: string, name?: string) => void;
  onRefresh?: () => void;
  busy?: boolean;
  refreshBusy?: boolean;
  message?: string;
  compact?: boolean;
}) {
  const refreshButton = props.onRefresh ? (
    <button className="mini-button" onClick={props.onRefresh} disabled={props.refreshBusy || props.busy} title="重新读取局域网发现和待接受设备">
      {props.refreshBusy ? "刷新中" : "刷新"}
    </button>
  ) : null;

  if (props.compact) {
    return (
      <section className="nearby-devices-sidebar">
        <div className="section-title-row">
          <div className="section-title">附近设备</div>
          {refreshButton}
        </div>
        {props.busy ? <div className="help-inline">正在添加...</div> : null}
        {props.message ? <div className="inline-message info">{props.message}</div> : null}
        <DiscoveredDevicesList
          discoveryCache={props.discoveryCache}
          pendingDevices={props.pendingDevices}
          existingDeviceIds={props.existingDeviceIds}
          localDeviceId={props.localDeviceId}
          onSelectDevice={props.onAdd}
          showWhenEmpty
          compact
          emptyText="还没看到其他设备。点刷新，或确认另一台已打开并启用了本地发现。"
        />
      </section>
    );
  }

  return (
    <section className="panel surface nearby-devices-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">局域网配对</div>
          <h3>附近设备</h3>
        </div>
        <div className="panel-actions">
          {refreshButton}
          {props.busy ? <span className="help-inline">正在添加...</span> : null}
        </div>
      </div>
      <div className="help-block">不用手抄完整设备 ID。对照局域网 IP 点添加；对方在左侧「附近设备」里点接受，不会单独弹窗。</div>
      {props.message ? <div className="inline-message info">{props.message}</div> : null}
      <DiscoveredDevicesList
        discoveryCache={props.discoveryCache}
        pendingDevices={props.pendingDevices}
        existingDeviceIds={props.existingDeviceIds}
        localDeviceId={props.localDeviceId}
        onSelectDevice={props.onAdd}
        showWhenEmpty
      />
    </section>
  );
}
