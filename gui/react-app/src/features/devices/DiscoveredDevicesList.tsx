import { useMemo } from "react";
import type { DiscoveryCacheResponse, PendingDevicesResponse } from "../../api";

export default function DiscoveredDevicesList(props: {
  discoveryCache: DiscoveryCacheResponse;
  pendingDevices: PendingDevicesResponse;
  existingDeviceIds: Set<string>;
  onSelectDevice: (deviceID: string) => void;
}) {
  const { discoveryCache, pendingDevices, existingDeviceIds, onSelectDevice } = props;

  // Filter out already configured devices
  const pendingEntries = useMemo(
    () =>
      Object.entries(pendingDevices)
        .filter(([id]) => !existingDeviceIds.has(id))
        .sort((a, b) => new Date(b[1].time).getTime() - new Date(a[1].time).getTime()),
    [pendingDevices, existingDeviceIds],
  );

  const discoveredEntries = useMemo(
    () =>
      Object.entries(discoveryCache)
        .filter(([id]) => !existingDeviceIds.has(id) && !pendingDevices[id])
        .filter(([, entry]) => entry.addresses && entry.addresses.length > 0)
        .sort((a, b) => a[0].localeCompare(b[0])),
    [discoveryCache, existingDeviceIds, pendingDevices],
  );

  const hasEntries = pendingEntries.length > 0 || discoveredEntries.length > 0;

  if (!hasEntries) {
    return null;
  }

  return (
    <div className="discovered-devices-section">
      <div className="section-title">已发现的设备</div>
      <div className="help-block">以下设备在局域网或全局发现中被检测到，点击即可快速添加。</div>

      {pendingEntries.length > 0 && (
        <div className="discovered-device-group">
          <div className="group-title">待处理设备（曾尝试连接）</div>
          {pendingEntries.map(([deviceID, entry]) => (
            <div key={deviceID} className="discovered-device-card pending">
              <div className="discovered-device-info">
                <div className="device-name">{entry.name || "未知设备"}</div>
                <div className="device-address">{entry.address}</div>
                <div className="device-id">{formatDeviceID(deviceID)}</div>
              </div>
              <button className="primary-button small-button" onClick={() => onSelectDevice(deviceID)}>
                添加此设备
              </button>
            </div>
          ))}
        </div>
      )}

      {discoveredEntries.length > 0 && (
        <div className="discovered-device-group">
          <div className="group-title">局域网/全局发现的设备</div>
          {discoveredEntries.map(([deviceID, entry]) => (
            <div key={deviceID} className="discovered-device-card">
              <div className="discovered-device-info">
                <div className="device-id">{formatDeviceID(deviceID)}</div>
                <div className="device-address">{entry.addresses.join(", ")}</div>
              </div>
              <button className="ghost-button small-button" onClick={() => onSelectDevice(deviceID)}>
                选择
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDeviceID(id: string): string {
  // Format device ID with dashes for readability: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
  const clean = id.replace(/-/g, "");
  if (clean.length === 56) {
    return clean.match(/.{4}/g)?.join("-") ?? id;
  }
  return id;
}
