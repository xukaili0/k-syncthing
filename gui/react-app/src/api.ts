export type FolderDevice = {
  deviceID: string;
  introducedBy?: string;
  encryptionPassword?: string;
};

export type FolderVersioning = {
  type?: string;
  cleanupIntervalS?: number;
  fsPath?: string;
  params?: Record<string, string>;
};

export type MinDiskFree = {
  value?: number;
  unit?: "%" | "kB" | "MB" | "GB" | "TB";
};

export type GuiVersioningDraft = {
  selector: string;
  trashcanClean: number;
  cleanupIntervalS: number;
  simpleKeep: number;
  staggeredMaxAge: number;
  externalCommand: string;
};

export type FolderConfig = {
  id: string;
  label?: string;
  path: string;
  type: string;
  paused?: boolean;
  rescanIntervalS?: number;
  fsWatcherEnabled?: boolean;
  fsWatcherDelayS?: number;
  ignorePerms?: boolean;
  autoNormalize?: boolean;
  ignoreDelete?: boolean;
  order?: string;
  maxConflicts?: number;
  scanProgressIntervalS?: number;
  minDiskFree?: MinDiskFree;
  manualSync?: boolean;
  manualPublish?: boolean;
  typeDescription?: string;
  versioning?: FolderVersioning;
  syncOwnership?: boolean;
  sendOwnership?: boolean;
  syncXattrs?: boolean;
  sendXattrs?: boolean;
  junctionsAsDirs?: boolean;
  copyOwnershipFromParent?: boolean;
  archiveMetadataOnly?: boolean;
  devices: FolderDevice[];
  _guiVersioning?: GuiVersioningDraft;
  _addIgnores?: boolean;
};

export type DeviceConfig = {
  deviceID: string;
  name?: string;
  addresses?: string[];
  compression?: string;
  certName?: string;
  introducer?: boolean;
  skipIntroductionRemovals?: boolean;
  introducedBy?: string;
  paused?: boolean;
  allowedNetworks?: string[];
  autoAcceptFolders?: boolean;
  maxSendKbps?: number;
  maxRecvKbps?: number;
  maxRequestKiB?: number;
  untrusted?: boolean;
  remoteGUIPort?: number;
  numConnections?: number;
  ignoredFolders?: ObservedFolder[];
};

export type ObservedDevice = {
  time: string;
  deviceID: string;
  name?: string;
  address?: string;
};

export type ObservedFolder = {
  time: string;
  id: string;
  label?: string;
};

export type DiscoveryCacheEntry = {
  addresses: string[];
};

export type DiscoveryCacheResponse = Record<string, DiscoveryCacheEntry>;

export type PendingDeviceEntry = {
  time: string;
  name: string;
  address: string;
};

export type PendingDevicesResponse = Record<string, PendingDeviceEntry>;

export type GuiConfig = {
  enabled?: boolean;
  address?: string;
  unixSocketPermissions?: string;
  user?: string;
  password?: string;
  authMode?: string;
  metricsWithoutAuth?: boolean;
  useTLS?: boolean;
  apiKey?: string;
  insecureAdminAccess?: boolean;
  theme?: string;
  insecureSkipHostCheck?: boolean;
  insecureAllowFrameLoading?: boolean;
  sendBasicAuthPrompt?: boolean;
};

export type LDAPConfig = {
  address?: string;
  bindDN?: string;
  transport?: number;
  insecureSkipVerify?: boolean;
  searchBaseDN?: string;
  searchFilter?: string;
};

export type ConfigResponse = {
  folders: FolderConfig[];
  devices: DeviceConfig[];
  gui: GuiConfig;
  remoteIgnoredDevices?: ObservedDevice[];
};

export type SystemStatus = {
  myID: string;
  pathSeparator: string;
  discoveryStatus: Record<string, { error?: string }>;
  connectionServiceStatus: Record<string, { error?: string }>;
  guiAddressUsed: string;
  guiAddressOverridden?: boolean;
  uptime: number;
  urVersionMax?: number;
};

export type VersionResponse = {
  version: string;
  longVersion: string;
  isCandidate?: boolean;
  isBeta?: boolean;
};

export type DeviceConnection = {
  connected: boolean;
  address?: string;
  type?: string;
  paused?: boolean;
  clientVersion?: string;
  crypto?: string;
  isLocal?: boolean;
  startedAt?: string;
  inBytesTotal: number;
  outBytesTotal: number;
  inbps?: number;
  outbps?: number;
};

export type ConnectionsResponse = {
  total: {
    inBytesTotal: number;
    outBytesTotal: number;
  };
  connections: Record<string, DeviceConnection>;
};

export type DeviceStatistics = {
  lastSeen: string;
  lastConnectionDurationS?: number;
};

export type SyncthingEvent = {
  id: number;
  globalID: number;
  time: string;
  type: string;
  data: Record<string, unknown>;
};

export type DownloadProgressData = Record<string, Record<string, { total: number; reused: number; copiedFromOrigin: number; copiedFromElsewhere: number; pulled: number; pulling: number; bytesDone: number; bytesTotal: number }>>;

export type ItemFinishedData = {
  folder: string;
  item: string;
  type: string;
  action: string;
  error?: string;
};

export type FolderStatus = {
  state: string;
  localFiles: number;
  localDirectories: number;
  localBytes: number;
  globalFiles?: number;
  globalDirectories?: number;
  globalBytes?: number;
  needTotalItems?: number;
  needBytes?: number;
  errors?: number;
  receiveOnlyTotalItems?: number;
};

export type CompletionStatus = {
  completion: number;
  globalBytes: number;
  needBytes: number;
  needItems: number;
  needDeletes: number;
  remoteState: string;
};

export type JsonFileInfo = {
  name: string;
  type: string;
  size: number;
  deleted: boolean;
  modified: string;
  modifiedBy: string;
  version: unknown;
  localFlags: number;
  blocksHash?: string | number[] | null;
  previousBlocksHash?: string | number[] | null;
};

export type CompareEntry = {
  path: string;
  status: string;
  renameCandidate?: string;
  canPrioritize: boolean;
  local?: JsonFileInfo;
  remote?: JsonFileInfo;
};

export type CompareResult = {
  entries: CompareEntry[];
  page: number;
  perpage: number;
  total: number;
  remoteConnected: boolean;
  folderHasPuller: boolean;
  manualSync: boolean;
};

export type BiDiffEntry = {
  path: string;
  status: string;
  renameCandidate?: string;
  canApplyLeftToRight: boolean;
  canApplyRightToLeft: boolean;
  leftToRightReason?: string;
  rightToLeftReason?: string;
  left?: JsonFileInfo;
  right?: JsonFileInfo;
};

export type BiDiffResult = {
  entries: BiDiffEntry[];
  page: number;
  perpage: number;
  total: number;
  rightConnected: boolean;
  folderCanReceive: boolean;
  folderCanPublish: boolean;
  manualSync: boolean;
  manualPublish: boolean;
  localPendingItems?: number;
  previewMode?: string;
  localSequence?: number;
  rightSequence?: number;
  remotePreviewAvailable?: boolean;
  remotePreviewSequence?: number;
  remotePreviewUpdated?: string;
  peerApplyResults?: {
    path: string;
    direction: "left-to-right" | "right-to-left";
    status: "success" | "failed";
    message?: string;
    updated: string;
  }[];
  rightDeviceID: string;
  workbench?: "bidiff" | "peer";
};

export type PeerDiffResult = BiDiffResult;

export type PendingPublishEntry = {
  path: string;
  action: string;
  renameCandidate?: string;
  canPublish: boolean;
  settled?: boolean;
  canClear?: boolean;
  local?: JsonFileInfo;
  global?: JsonFileInfo;
};

export type PendingPublishResult = {
  entries: PendingPublishEntry[];
  page: number;
  perpage: number;
  total: number;
  settledTotal?: number;
  manualPublish: boolean;
  folderCanPublish: boolean;
};

export type MinHomeDiskFree = {
  value: number;
  unit: string;
};

export type OptionsConfig = {
  listenAddresses?: string[];
  globalAnnounceServers?: string[];
  globalAnnounceEnabled?: boolean;
  localAnnounceEnabled?: boolean;
  localAnnouncePort?: number;
  localAnnounceMCAddr?: string;
  maxSendKbps?: number;
  maxRecvKbps?: number;
  reconnectionIntervalS?: number;
  relaysEnabled?: boolean;
  relayReconnectIntervalM?: number;
  startBrowser?: boolean;
  natEnabled?: boolean;
  natLeaseMinutes?: number;
  natRenewalMinutes?: number;
  natTimeoutSeconds?: number;
  urAccepted?: number;
  urUniqueId?: string;
  urURL?: string;
  urPostInsecurely?: boolean;
  urInitialDelayS?: number;
  autoUpgradeIntervalH?: number;
  upgradeToPreReleases?: boolean;
  keepTemporariesH?: number;
  cacheIgnoredFiles?: boolean;
  progressUpdateIntervalS?: number;
  limitBandwidthInLan?: boolean;
  minHomeDiskFree?: MinHomeDiskFree;
  releasesURL?: string;
  alwaysLocalNets?: string[];
  overwriteRemoteDeviceNamesOnConnect?: boolean;
  tempIndexMinBlocks?: number;
  setLowPriority?: boolean;
  maxFolderConcurrency?: number;
  crashReportingEnabled?: boolean;
  stunKeepaliveStartS?: number;
  stunKeepaliveMinS?: number;
  stunServers?: string[];
  announceLANAddresses?: boolean;
  sendFullIndexOnUpgrade?: boolean;
  featureFlags?: string[];
  connectionLimitEnough?: number;
  connectionLimitMax?: number;
  unackedNotificationID?: string;
};

export type IgnoreResponse = {
  ignore: string[];
  expanded?: string[];
  error?: string | null;
};

export type PendingFolderObserved = {
  time: string;
  label: string;
  receiveEncrypted?: boolean;
  remoteEncrypted?: boolean;
};

export type PendingFoldersResponse = Record<
  string,
  {
    offeredBy: Record<string, PendingFolderObserved>;
  }
>;

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function getCSRFCookieName(): string | null {
  const shortID = window.metadata?.deviceIDShort;
  if (!shortID) {
    return null;
  }
  return `CSRF-Token-${shortID}`;
}

function getCSRFCookieValue(): string | null {
  const cookieName = getCSRFCookieName();
  if (!cookieName) {
    return null;
  }

  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    if (!cookie.startsWith(`${cookieName}=`)) {
      continue;
    }
    return decodeURIComponent(cookie.slice(cookieName.length + 1));
  }

  return null;
}

function buildHeaders(includeJSONBody: boolean): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (includeJSONBody) {
    headers["Content-Type"] = "application/json";
  }

  const shortID = window.metadata?.deviceIDShort;
  const csrfToken = getCSRFCookieValue();
  if (shortID && csrfToken) {
    headers[`X-CSRF-Token-${shortID}`] = csrfToken;
  }

  return headers;
}

export async function getJSON<T>(path: string): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      credentials: "same-origin",
      headers: buildHeaders(false),
    }),
  );
}

export async function postJSON<T>(path: string, body?: unknown): Promise<T | undefined> {
  return sendJSONRequest<T>("POST", path, body);
}

export async function putJSON<T>(path: string, body?: unknown): Promise<T | undefined> {
  return sendJSONRequest<T>("PUT", path, body);
}

export async function patchJSON<T>(path: string, body?: unknown): Promise<T | undefined> {
  return sendJSONRequest<T>("PATCH", path, body);
}

export async function deleteJSON<T>(path: string): Promise<T | undefined> {
  return sendJSONRequest<T>("DELETE", path);
}

async function sendJSONRequest<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: buildHeaders(true),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return undefined;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return undefined;
  }
  return response.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch("/rest/noauth/auth/password", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username,
      password,
      stayLoggedIn: true,
    }),
  });

  if (!response.ok) {
    throw new Error(response.status === 403 ? "用户名或密码错误" : "登录失败");
  }
}

export async function logout(): Promise<void> {
  const response = await fetch("/rest/noauth/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: buildHeaders(true),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
}

export async function triggerSystemAction(action: "restart" | "shutdown"): Promise<void> {
  const response = await fetch(`/rest/system/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: buildHeaders(true),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
}

export async function triggerFolderScan(folder: string, subs?: string[], next?: number): Promise<void> {
  const params = new URLSearchParams();
  params.set("folder", folder);
  if (subs) {
    for (const sub of subs) {
      params.append("sub", sub);
    }
  }
  if (typeof next === "number" && Number.isFinite(next)) {
    params.set("next", String(next));
  }

  const response = await fetch(`/rest/db/scan?${params.toString()}`, {
    method: "POST",
    credentials: "same-origin",
    headers: buildHeaders(false),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
}
