import { useMemo } from "react";
import type { DiscoveryCacheResponse, PendingDevicesResponse } from "../../api";
import { formatFullDeviceID, listNearbyDevices } from "./discovered-devices";

export default function DiscoveredDevicesList(props: {
  discoveryCache: DiscoveryCacheResponse;
  pendingDevices: PendingDevicesResponse;
  existingDeviceIds: Set<string>;
  localDeviceId?: string;
  onSelectDevice: (deviceID: string, name?: string) => void;
  showWhenEmpty?: boolean;
  emptyText?: string;
  compact?: boolean;
}) {
  const nearby = useMemo(
    () => listNearbyDevices(props.discoveryCache, props.pendingDevices, props.existingDeviceIds, props.localDeviceId),
    [props.discoveryCache, props.pendingDevices, props.existingDeviceIds, props.localDeviceId],
  );

  if (nearby.length === 0) {
    if (!props.showWhenEmpty) {
      return null;
    }
    return (
      <div className="discovered-devices-section">
        <div className="empty-mini">
          {props.emptyText ?? "局域网里还没看到其他设备。确认另一台已经打开本程序，两边都启用了本地发现，并等几秒。"}
        </div>
      </div>
    );
  }

  const pending = nearby.filter((item) => item.kind === "pending");
  const discovered = nearby.filter((item) => item.kind === "discovered");

  return (
    <div className="discovered-devices-section">
      {pending.length > 0 && (
        <div className="discovered-device-group">
          <div className="group-title">对方已添加你，点接受即可</div>
          {pending.map((item) => (
            <div key={item.deviceID} className="discovered-device-card pending">
              <div className="discovered-device-info">
                <div className="device-name">{item.name}</div>
                {item.address ? <div className="device-address">{item.address}</div> : null}
                {props.compact ? null : <div className="device-id">{formatFullDeviceID(item.deviceID)}</div>}
              </div>
              <button className="primary-button small-button" onClick={() => props.onSelectDevice(item.deviceID, item.name)}>
                接受
              </button>
            </div>
          ))}
        </div>
      )}

      {discovered.length > 0 && (
        <div className="discovered-device-group">
          <div className="group-title">局域网里看到的设备</div>
          {discovered.map((item) => (
            <div key={item.deviceID} className="discovered-device-card">
              <div className="discovered-device-info">
                <div className="device-name">{item.name}</div>
                {item.address ? <div className="device-address">{item.address}</div> : null}
                {props.compact ? null : <div className="device-id">{formatFullDeviceID(item.deviceID)}</div>}
              </div>
              <button className="primary-button small-button" onClick={() => props.onSelectDevice(item.deviceID, item.name)}>
                添加
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
