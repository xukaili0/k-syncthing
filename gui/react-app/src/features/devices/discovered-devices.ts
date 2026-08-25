import type { DiscoveryCacheResponse, PendingDevicesResponse } from "../../api";

export type NearbyDeviceKind = "pending" | "discovered";

export type NearbyDevice = {
  deviceID: string;
  kind: NearbyDeviceKind;
  name: string;
  address: string;
};

export function compactDeviceID(id: string): string {
  return id.replace(/[-:\s]/g, "").toUpperCase();
}

export function shortDeviceID(id: string): string {
  const compact = compactDeviceID(id);
  return compact.slice(0, 7) || id;
}

export function formatFullDeviceID(id: string): string {
  const compact = compactDeviceID(id);
  if (compact.length === 56) {
    return compact.match(/.{4}/g)?.join("-") ?? id;
  }
  return id;
}

export function preferLanAddress(addresses: string[] | undefined): string {
  if (!addresses?.length) {
    return "";
  }
  const lan = addresses.find((address) => isLikelyLanAddress(address));
  return stripProtocol(lan ?? addresses[0]);
}

export function listNearbyDevices(
  discoveryCache: DiscoveryCacheResponse,
  pendingDevices: PendingDevicesResponse,
  existingDeviceIds: Set<string>,
  localDeviceId?: string,
): NearbyDevice[] {
  const known = new Set([...existingDeviceIds].map((id) => compactDeviceID(id)));
  if (localDeviceId) {
    known.add(compactDeviceID(localDeviceId));
  }

  const pending = Object.entries(pendingDevices)
    .filter(([id]) => !known.has(compactDeviceID(id)))
    .sort((left, right) => new Date(right[1].time).getTime() - new Date(left[1].time).getTime())
    .map(([deviceID, entry]) => ({
      deviceID,
      kind: "pending" as const,
      name: entry.name?.trim() || shortDeviceID(deviceID),
      address: stripProtocol(entry.address),
    }));

  const pendingIds = new Set(pending.map((item) => compactDeviceID(item.deviceID)));
  const discovered = Object.entries(discoveryCache)
    .filter(([id, entry]) => !known.has(compactDeviceID(id)) && !pendingIds.has(compactDeviceID(id)))
    .filter(([, entry]) => (entry.addresses ?? []).length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([deviceID, entry]) => ({
      deviceID,
      kind: "discovered" as const,
      name: shortDeviceID(deviceID),
      address: preferLanAddress(entry.addresses),
    }));

  return [...pending, ...discovered];
}

function isLikelyLanAddress(address: string): boolean {
  return /(?:tcp|quic):\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[0-1])\.|fe80:)/i.test(address);
}

function stripProtocol(address: string | undefined): string {
  if (!address) {
    return "";
  }
  return address.replace(/^(?:tcp|quic|relay):\/\//i, "");
}
