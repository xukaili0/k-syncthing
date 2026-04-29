export type FolderDevice = {
  deviceID: string;
  introducedBy?: string;
  encryptionPassword?: string;
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
  manualSync?: boolean;
  manualPublish?: boolean;
  devices: FolderDevice[];
};

export type DeviceConfig = {
  deviceID: string;
  name?: string;
  addresses?: string[];
  compression?: string;
  certName?: string;
  introducer?: boolean;
  skipIntroductionRemovals?: boolean;
  paused?: boolean;
  allowedNetworks?: string[];
  autoAcceptFolders?: boolean;
  maxSendKbps?: number;
  maxRecvKbps?: number;
  maxRequestKiB?: number;
  untrusted?: boolean;
  remoteGUIPort?: number;
  numConnections?: number;
};

export type ConfigResponse = {
  folders: FolderConfig[];
  devices: DeviceConfig[];
  gui: {
    theme: string;
    authMode?: string;
    user?: string;
    password?: string;
  };
};

export type SystemStatus = {
  myID: string;
  pathSeparator: string;
  discoveryStatus: Record<string, { error?: string }>;
  connectionServiceStatus: Record<string, { error?: string }>;
  guiAddressUsed: string;
  uptime: number;
};

export type VersionResponse = {
  version: string;
  longVersion: string;
};

export type DeviceConnection = {
  connected: boolean;
  address?: string;
  type?: string;
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
  rightDeviceID: string;
};

export type PendingPublishEntry = {
  path: string;
  action: string;
  renameCandidate?: string;
  canPublish: boolean;
  local?: JsonFileInfo;
  global?: JsonFileInfo;
};

export type PendingPublishResult = {
  entries: PendingPublishEntry[];
  page: number;
  perpage: number;
  total: number;
  manualPublish: boolean;
  folderCanPublish: boolean;
};

export type OptionsConfig = {
  globalAnnounceEnabled?: boolean;
  localAnnounceEnabled?: boolean;
  relaysEnabled?: boolean;
  natEnabled?: boolean;
  startBrowser?: boolean;
  autoUpgradeIntervalH?: number;
  progressUpdateIntervalS?: number;
  reconnectionIntervalS?: number;
  maxSendKbps?: number;
  maxRecvKbps?: number;
  limitBandwidthInLan?: boolean;
  alwaysLocalNets?: string[];
  connectionLimitEnough?: number;
  connectionLimitMax?: number;
};

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
