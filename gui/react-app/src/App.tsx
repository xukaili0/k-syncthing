import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BiDiffEntry,
  BiDiffResult,
  CompareEntry,
  CompareResult,
  CompletionStatus,
  ConfigResponse,
  ConnectionsResponse,
  DeviceConnection,
  DeviceConfig,
  DeviceStatistics,
  DiscoveryCacheResponse,
  DownloadProgressData,
  FolderConfig,
  FolderStatus,
  GuiConfig,
  IgnoreResponse,
  LDAPConfig,
  ItemFinishedData,
  JsonFileInfo,
  MinHomeDiskFree,
  ObservedDevice,
  ObservedFolder,
  OptionsConfig,
  PendingDevicesResponse,
  PendingFoldersResponse,
  PendingPublishEntry,
  PendingPublishResult,
  SyncthingEvent,
  SystemStatus,
  VersionResponse,
  deleteJSON,
  getJSON,
  login,
  logout,
  putJSON,
  postJSON,
  triggerFolderScan,
  triggerSystemAction,
} from "./api";
import AdvancedConfigModal from "./AdvancedConfigModal";
import WorkspaceSidebar from "./components/sidebar/WorkspaceSidebar";
import BiDiffPanel from "./features/bidiff/BiDiffPanel";
import { useBiDiffController } from "./features/bidiff/useBiDiffController";
import { useTransferProgressController } from "./features/bidiff/useTransferProgressController";
import { type BiDiffTask, type BiDiffTaskStatus, bidiffTaskKey } from "./features/bidiff/bidiff-model";
import OverviewPanel from "./features/overview/OverviewPanel";
import PublishReviewPanel from "./features/publish/PublishReviewPanel";
import { usePublishController } from "./features/publish/usePublishController";
import ReceiveReviewPanel from "./features/receive/ReceiveReviewPanel";
import { useReceiveCompareController } from "./features/receive/useReceiveCompareController";
import DeviceSettingsPanel, { type DeviceShareDraft } from "./features/devices/DeviceSettingsPanel";
import FolderSettingsPanel from "./features/folders/FolderSettingsPanel";
import { prepareFolderDraft } from "./features/folders/folder-editor-utils";
import { useConfigEditorController } from "./features/folders/useConfigEditorController";
import IdentityBackupPanel from "./features/identity/IdentityBackupPanel";
import SettingsHubPanel from "./features/settings/SettingsHubPanel";

type ViewMode = "overview" | "receive" | "publish";
type UiMode = "desktop" | "mobile";

const MAIN_REFRESH_KEY = "reactGuiMainRefreshSeconds";
const PANEL_REFRESH_KEY = "reactGuiPanelRefreshSeconds";
function readStoredSeconds(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 2) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function storeSeconds(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
}

function detectInitialUiMode(): UiMode {
  try {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("view");
    if (explicit === "mobile" || explicit === "desktop") {
      return explicit;
    }
  } catch {
    // Ignore URL parse issues.
  }

  const ua = window.navigator.userAgent || "";
  const isMobileUA = /Android|iPhone|iPad|Mobile/i.test(ua);
  const isNarrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 980px)").matches;
  return isMobileUA || isNarrow ? "mobile" : "desktop";
}

function updateUiModeInUrl(mode: UiMode) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("view", mode);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Ignore URL update failures.
  }
}

function formatBinary(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

function formatDate(value?: string, mode: "full" | "compact" = "full"): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (mode === "compact") {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    return `${yy}/${mm}/${dd} ${hh}`;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLastSeen(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return "从未";
  }
  return formatDate(value, "full");
}

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

function canReceive(folder: FolderConfig): boolean {
  return folder.type !== "sendonly";
}

function canPublish(folder: FolderConfig): boolean {
  return folder.type !== "receiveonly" && folder.type !== "receiveencrypted";
}

function isPausedFolder(folder: FolderConfig | null | undefined): boolean {
  return Boolean(folder?.paused);
}

function pausedFolderStatus(): FolderStatus {
  return {
    state: "paused",
    localFiles: 0,
    localDirectories: 0,
    localBytes: 0,
    globalFiles: 0,
    globalDirectories: 0,
    globalBytes: 0,
    needTotalItems: 0,
    needBytes: 0,
    errors: 0,
    receiveOnlyTotalItems: 0,
  };
}

function pausedCompletionStatus(): CompletionStatus {
  return {
    completion: 100,
    globalBytes: 0,
    needBytes: 0,
    needItems: 0,
    needDeletes: 0,
    remoteState: "paused",
  };
}

function isFolderPausedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("folder is paused");
}

function receiveModeLabel(folder: FolderConfig): string {
  if (!canReceive(folder)) {
    return "不接收";
  }
  return folder.manualSync ? "手动审核接收" : "自动接收";
}

function publishModeLabel(folder: FolderConfig): string {
  if (!canPublish(folder)) {
    return "不发布";
  }
  return folder.manualPublish ? "手动审核发布" : "自动发布";
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

function pendingFolderOfferDevices(pending: PendingFoldersResponse[string], devicesById: Map<string, DeviceConfig>) {
  return Object.entries(pending.offeredBy).map(([deviceID, observed]) => ({
    deviceID,
    observed,
    device: devicesById.get(deviceID),
  }));
}

function remoteStateLabel(value?: string): string {
  switch (value) {
    case "idle":
      return "空闲";
    case "syncing":
      return "同步中";
    case "scanning":
      return "扫描中";
    case "paused":
      return "已暂停";
    case "notSharing":
      return "未共享";
    case "cleaning":
      return "清理中";
    default:
      return value || "未知";
  }
}

function compareRequestView(view: string): string {
  return view === "incoming" ? "different" : view;
}

function bidiffRequestView(view: string): string {
  return view === "all-with-same" ? "all" : view;
}

function formatRate(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return "0 B/s";
  }
  return `${formatBinary(bytesPerSecond)}/s`;
}

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(window.metadata?.authenticated));
  const [loginState, setLoginState] = useState({ username: "", password: "", error: "", busy: false });

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [version, setVersion] = useState<VersionResponse | null>(null);
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [connectionRates, setConnectionRates] = useState<Record<string, { inbps: number; outbps: number }>>({});
  const prevConnectionsRef = useRef<{ data: ConnectionsResponse; time: number } | null>(null);
  const [folderStatuses, setFolderStatuses] = useState<Record<string, FolderStatus>>({});
  const [completions, setCompletions] = useState<Record<string, Record<string, CompletionStatus>>>({});
  const [deviceStats, setDeviceStats] = useState<Record<string, DeviceStatistics>>({});
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [uiMode, setUiMode] = useState<UiMode>(() => detectInitialUiMode());
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const mode = detectInitialUiMode();
    return mode === "desktop";
  });
  const [mainRefreshSeconds, setMainRefreshSeconds] = useState(readStoredSeconds(MAIN_REFRESH_KEY, 5));
  const [panelRefreshSeconds, setPanelRefreshSeconds] = useState(readStoredSeconds(PANEL_REFRESH_KEY, 15));
  const [bootBusy, setBootBusy] = useState(false);
  const [bootError, setBootError] = useState("");
  const [overviewMessage, setOverviewMessage] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const [panelScanBusy, setPanelScanBusy] = useState<"" | "compare" | "bidiff" | "peerdiff" | "publish">("");

  const [options, setOptions] = useState<OptionsConfig | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<OptionsConfig | null>(null);
  const [pendingFolders, setPendingFolders] = useState<PendingFoldersResponse>({});
  const [optionsSaveBusy, setOptionsSaveBusy] = useState(false);
  const [optionsSaveMessage, setOptionsSaveMessage] = useState("");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [identityBackupOpen, setIdentityBackupOpen] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [bidiffModalOpen, setBiDiffModalOpen] = useState(false);
  const [peerDiffModalOpen, setPeerDiffModalOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [titleBarStats, setTitleBarStats] = useState<{ total: number; selected: number; leftToRight: number; rightToLeft: number; pending?: number; previewReady?: boolean } | null>(null);
  const [systemActionBusy, setSystemActionBusy] = useState<"" | "restart" | "shutdown">("");
  const [systemActionMessage, setSystemActionMessage] = useState("");

  const [guiDraft, setGuiDraft] = useState<GuiConfig | null>(null);
  const [guiSaveBusy, setGuiSaveBusy] = useState(false);
  const [guiSaveMessage, setGuiSaveMessage] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [advancedModalOpen, setAdvancedModalOpen] = useState(false);
  const [advancedConfig, setAdvancedConfig] = useState<ConfigResponse | null>(null);
  const [advancedSaveBusy, setAdvancedSaveBusy] = useState(false);
  const [advancedSaveMessage, setAdvancedSaveMessage] = useState("");
  const [advancedRestartRequired, setAdvancedRestartRequired] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "gui" | "connections" | "ignored-devices" | "ignored-folders">("general");

  const folders = config?.folders ?? [];
  const devicesById = useMemo(() => {
    const map = new Map<string, DeviceConfig>();
    for (const device of config?.devices ?? []) {
      map.set(device.deviceID, device);
    }
    return map;
  }, [config]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  const selectedFolderDevices = useMemo(() => {
    if (!selectedFolder) {
      return [];
    }
    return selectedFolder.devices
      .map((folderDevice) => devicesById.get(folderDevice.deviceID))
      .filter((device): device is DeviceConfig => device !== undefined && device.deviceID !== system?.myID);
  }, [selectedFolder, devicesById, system?.myID]);

  const selectedDevice = useMemo(
    () => selectedFolderDevices.find((device) => device.deviceID === selectedDeviceId) ?? null,
    [selectedFolderDevices, selectedDeviceId],
  );

  const allDevices = config?.devices ?? [];
  const existingDeviceIds = useMemo(() => new Set(allDevices.map((device) => device.deviceID)), [allDevices]);
  const loadBootstrap = useCallback(async () => {
    if (!authenticated) {
      return;
    }
    setBootBusy(true);
    setBootError("");
    try {
      const [nextConfig, nextSystem, nextVersion, nextConnections, nextDeviceStats, nextPendingFolders] = await Promise.all([
        getJSON<ConfigResponse>("/rest/config"),
        getJSON<SystemStatus>("/rest/system/status"),
        getJSON<VersionResponse>("/rest/system/version"),
        getJSON<ConnectionsResponse>("/rest/system/connections"),
        getJSON<Record<string, DeviceStatistics>>("/rest/stats/device"),
        getJSON<PendingFoldersResponse>("/rest/cluster/pending/folders"),
      ]);

      const statusEntries = await Promise.all(
        nextConfig.folders.map(async (folder) => {
          if (folder.paused) {
            return [folder.id, pausedFolderStatus()] as const;
          }
          try {
            const status = await getJSON<FolderStatus>(`/rest/db/status?folder=${encodeURIComponent(folder.id)}`);
            return [folder.id, status] as const;
          } catch (error) {
            if (isFolderPausedError(error)) {
              return [folder.id, pausedFolderStatus()] as const;
            }
            throw error;
          }
        }),
      );

      const completionPairs = await Promise.all(
        nextConfig.folders.flatMap((folder) =>
          folder.devices.map(async (folderDevice) => {
            if (folder.paused) {
              return [folderDevice.deviceID, folder.id, pausedCompletionStatus()] as const;
            }
            try {
              const completion = await getJSON<CompletionStatus>(
                `/rest/db/completion?device=${encodeURIComponent(folderDevice.deviceID)}&folder=${encodeURIComponent(folder.id)}`,
              );
              return [folderDevice.deviceID, folder.id, completion] as const;
            } catch (error) {
              if (isFolderPausedError(error)) {
                return [folderDevice.deviceID, folder.id, pausedCompletionStatus()] as const;
              }
              throw error;
            }
          }),
        ),
      );

      const nextStatuses = Object.fromEntries(statusEntries);
      const nextCompletions: Record<string, Record<string, CompletionStatus>> = {};
      for (const [deviceId, folderId, completion] of completionPairs) {
        if (!nextCompletions[deviceId]) {
          nextCompletions[deviceId] = {};
        }
        nextCompletions[deviceId][folderId] = completion;
      }

      setConfig(nextConfig);
      setSystem(nextSystem);
      setVersion(nextVersion);

      // Compute transfer rates from snapshot diff
      const now = Date.now();
      const prev = prevConnectionsRef.current;
      if (prev) {
        const td = (now - prev.time) / 1000;
        if (td > 0) {
          const rates: Record<string, { inbps: number; outbps: number }> = {};
          for (const [id, conn] of Object.entries(nextConnections.connections)) {
            const old = prev.data.connections[id];
            if (old && conn.connected && old.connected) {
              rates[id] = {
                inbps: Math.max(0, (conn.inBytesTotal - old.inBytesTotal) / td),
                outbps: Math.max(0, (conn.outBytesTotal - old.outBytesTotal) / td),
              };
            } else {
              rates[id] = { inbps: 0, outbps: 0 };
            }
          }
          setConnectionRates(rates);
        }
      }
      prevConnectionsRef.current = { data: nextConnections, time: now };

      setConnections(nextConnections);
      setDeviceStats(nextDeviceStats);
      setPendingFolders(nextPendingFolders);
      setFolderStatuses(nextStatuses);
      setCompletions(nextCompletions);

      const nextOptions = await getJSON<OptionsConfig>("/rest/config/options");
      setOptions(nextOptions);
      setOptionsDraft((previous) => previous ?? cloneJSON(nextOptions));

      setGuiDraft((previous) => previous ?? cloneJSON(nextConfig.gui));

      try {
        const themesResp = await fetch("/themes.json");
        if (themesResp.ok) {
          const themesData = await themesResp.json();
          setThemes((themesData?.themes ?? []).sort());
        }
      } catch {
        // themes endpoint may not be available
      }

      if (!selectedFolderId && nextConfig.folders.length > 0) {
        setSelectedFolderId(nextConfig.folders[0].id);
      }
      if (selectedFolderId && !nextConfig.folders.some((folder) => folder.id === selectedFolderId)) {
        setSelectedFolderId(nextConfig.folders[0]?.id ?? "");
      }
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "加载主界面数据失败");
    } finally {
      setBootBusy(false);
    }
  }, [authenticated, selectedFolderId]);

  const {
    downloadProgress,
    uploadProgress,
    completedUploads,
    completedDownloads,
    uploadFileInfo,
  } = useTransferProgressController({ authenticated });

  const receiveController = useReceiveCompareController({
    selectedFolder,
    selectedDeviceId,
    modalOpen: receiveModalOpen,
    panelRefreshSeconds,
    setPanelScanBusy,
    loadBootstrap,
  });
  const {
    compare,
    compareBusy,
    compareError,
    compareView,
    comparePrefix,
    compareIgnoreModTime,
    compareSelection,
    compareMessage,
    compareVisibleEntries,
  } = receiveController.state;
  const {
    setCompareView,
    setComparePrefix,
    setCompareIgnoreModTime,
    setCompareSelection,
    refreshCompare,
    syncEntries,
  } = receiveController.actions;

  const publishController = usePublishController({
    selectedFolder,
    modalOpen: publishModalOpen,
    panelRefreshSeconds,
    setPanelScanBusy,
    loadBootstrap,
  });
  const {
    publish,
    publishBusy,
    publishError,
    publishView,
    publishPrefix,
    publishSelection,
    publishMessage,
    publishVisibleEntries,
    publishClearableEntries,
  } = publishController.state;
  const {
    setPublishView,
    setPublishPrefix,
    setPublishSelection,
    refreshPublish,
    publishEntries,
    clearSettledPublishEntries,
  } = publishController.actions;

  const bidiffController = useBiDiffController({
    selectedFolder,
    selectedDeviceId,
    completions,
    bidiffModalOpen,
    peerDiffModalOpen,
    panelRefreshSeconds,
    setPanelScanBusy,
    loadBootstrap,
    refreshCompare,
    refreshPublish,
  });
  const {
    bidiff,
    bidiffBusy,
    bidiffError,
    bidiffView,
    bidiffPrefix,
    bidiffIgnoreModTime,
    bidiffSelection,
    bidiffMessage,
    bidiffAutoRefreshPaused,
    bidiffWorkbenchView,
    peerDiff,
    peerDiffBusy,
    peerDiffError,
    peerDiffView,
    peerDiffPrefix,
    peerDiffIgnoreModTime,
    peerDiffSelection,
    peerDiffMessage,
    peerDiffAutoRefreshPaused,
    peerWorkbenchView,
    activeBiDiffTasks,
    allBiDiffTasks,
    activePeerDiffTasks,
    allPeerDiffTasks,
  } = bidiffController.state;
  const {
    setBiDiffView,
    setBiDiffPrefix,
    setBiDiffIgnoreModTime,
    setBiDiffSelection,
    setBidiffAutoRefreshPaused,
    setBidiffWorkbenchView,
    setPeerDiffView,
    setPeerDiffPrefix,
    setPeerDiffIgnoreModTime,
    setPeerDiffSelection,
    setPeerDiffAutoRefreshPaused,
    setPeerWorkbenchView,
    refreshBiDiff,
    refreshPeerDiff,
    applyBiDiffEntries,
    applyPeerDiffEntries,
  } = bidiffController.actions;

  const editorController = useConfigEditorController({
    folders,
    allDevices,
    selectedFolder,
    pendingFolders,
    loadBootstrap,
    setSelectedFolderId,
    setOverviewMessage,
    setOptionsSaveMessage,
    setSettingsModalOpen,
  });
  const {
    folderEditorOpen,
    folderDraft,
    folderIgnoreText,
    folderIgnoreError,
    folderIgnoreBusy,
    folderAddIgnores,
    folderSaveBusy,
    folderSaveMessage,
    newFolderBusy,
    deviceDraft,
    deviceShareDraft,
    deviceSaveBusy,
    deviceSaveMessage,
    newDeviceBusy,
    discoveryCache,
    pendingDevicesList,
    nearbyAddBusy,
    nearbyAddMessage,
    nearbyRefreshBusy,
    editingExistingDevice,
    editingNewDevice,
    editingExistingFolder,
    editingNewFolder,
  } = editorController.state;
  const {
    setFolderEditorOpen,
    setFolderDraft,
    setFolderIgnoreText,
    setFolderIgnoreError,
    setFolderAddIgnores,
    setFolderSaveMessage,
    setDeviceDraft,
    setDeviceShareDraft,
    loadFolderIgnores,
    closeFolderEditor,
    openDeviceEditor,
    closeDeviceEditor,
    toggleFolderPaused,
    saveFolderDraft,
    deleteCurrentFolder,
    saveDeviceDraft,
    deleteCurrentDevice,
    createFolder,
    createDevice,
    quickAddNearbyDevice,
    refreshNearbyDevicesNow,
    saveNewFolder,
    saveNewDevice,
    acceptPendingFolder,
    dismissPendingFolder,
  } = editorController.actions;

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!config || selectedFolderId) {
      return;
    }
    if (config.folders.length > 0) {
      setSelectedFolderId(config.folders[0].id);
    }
  }, [config, selectedFolderId]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }
    if (selectedFolderDevices.length === 0) {
      setSelectedDeviceId("");
      return;
    }
    const stillValid = selectedFolderDevices.some((device) => device.deviceID === selectedDeviceId);
    if (!stillValid) {
      setSelectedDeviceId(selectedFolderDevices[0].deviceID);
    }
  }, [selectedDeviceId, selectedFolder, selectedFolderDevices]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }
    if (viewMode === "receive" && !canReceive(selectedFolder)) {
      setViewMode(canPublish(selectedFolder) ? "publish" : "overview");
      return;
    }
    if (viewMode === "publish" && !canPublish(selectedFolder)) {
      setViewMode(canReceive(selectedFolder) ? "receive" : "overview");
    }
  }, [selectedFolder, viewMode]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    const handle = window.setInterval(() => {
      void loadBootstrap();
    }, mainRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [authenticated, loadBootstrap, mainRefreshSeconds]);

  const discoverySummary = useMemo(() => {
    const discovery = system?.discoveryStatus ?? {};
    const entries = Object.entries(discovery);
    const failed = entries.filter(([, value]) => value?.error).length;
    return {
      total: entries.length,
      failed,
      running: entries.length - failed,
    };
  }, [system]);

  const listenerSummary = useMemo(() => {
    const listeners = system?.connectionServiceStatus ?? {};
    const entries = Object.entries(listeners);
    const failed = entries.filter(([, value]) => value?.error).length;
    return {
      total: entries.length,
      failed,
      running: entries.length - failed,
    };
  }, [system]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginState((previous) => ({ ...previous, busy: true, error: "" }));
    try {
      await login(loginState.username, loginState.password);
      window.location.reload();
    } catch (error) {
      setLoginState((previous) => ({
        ...previous,
        busy: false,
        error: error instanceof Error ? error.message : "登录失败",
      }));
    }
  };

  const handleLogout = async () => {
    if (!window.confirm("这只会登出 Web GUI，不会停止 Syncthing 后台同步服务。")) {
      return;
    }
    await logout();
    setAuthenticated(false);
    setConfig(null);
    window.location.reload();
  };

  const applyRefreshSettings = (nextMain: number, nextPanel: number) => {
    setMainRefreshSeconds(nextMain);
    setPanelRefreshSeconds(nextPanel);
    storeSeconds(MAIN_REFRESH_KEY, nextMain);
    storeSeconds(PANEL_REFRESH_KEY, nextPanel);
  };

  const saveOptionsDraft = async () => {
    if (!optionsDraft) {
      return;
    }
    setOptionsSaveBusy(true);
    setOptionsSaveMessage("");
    try {
      const payload = cloneJSON(optionsDraft);
      payload.alwaysLocalNets = (payload.alwaysLocalNets ?? []).filter((value) => value.trim().length > 0);
      await putJSON("/rest/config/options", payload);
      setOptions(payload);
      setOptionsSaveMessage("全局设置已保存。");
      await loadBootstrap();
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "保存全局设置失败");
    } finally {
      setOptionsSaveBusy(false);
    }
  };

  const saveGuiDraft = async () => {
    if (!guiDraft) return;
    setGuiSaveBusy(true);
    setGuiSaveMessage("");
    try {
      await putJSON("/rest/config/gui", guiDraft);
      setGuiSaveMessage("GUI 设置已保存。");
      await loadBootstrap();
    } catch (error) {
      setGuiSaveMessage(error instanceof Error ? error.message : "保存 GUI 设置失败");
    } finally {
      setGuiSaveBusy(false);
    }
  };

  const saveAdvancedConfig = async () => {
    if (!advancedConfig) return;
    setAdvancedSaveBusy(true);
    setAdvancedSaveMessage("");
    try {
      await putJSON("/rest/config", advancedConfig);
      const [savedConfig, restartStatus] = await Promise.all([
        getJSON<ConfigResponse>("/rest/config"),
        getJSON<{ requiresRestart: boolean }>("/rest/config/restart-required").catch(() => ({ requiresRestart: false })),
      ]);
      setAdvancedConfig(cloneJSON(savedConfig));
      setAdvancedRestartRequired(Boolean(restartStatus.requiresRestart));
      setAdvancedSaveMessage(
        restartStatus.requiresRestart ? "高级配置已保存；部分配置需要重启后生效。" : "高级配置已保存并已重新读取。",
      );
      await loadBootstrap();
    } catch (error) {
      setAdvancedSaveMessage(error instanceof Error ? error.message : "保存高级配置失败");
    } finally {
      setAdvancedSaveBusy(false);
    }
  };

  const loadAdvancedConfig = async () => {
    try {
      const [fullConfig, restartStatus] = await Promise.all([
        getJSON<ConfigResponse>("/rest/config"),
        getJSON<{ requiresRestart: boolean }>("/rest/config/restart-required").catch(() => ({ requiresRestart: false })),
      ]);
      setAdvancedConfig(cloneJSON(fullConfig));
      setAdvancedRestartRequired(Boolean(restartStatus.requiresRestart));
      setAdvancedSaveMessage("");
      setAdvancedModalOpen(true);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "加载高级配置失败");
    }
  };

  const unignoreDevice = async (deviceID: string) => {
    try {
      await deleteJSON(`/rest/config/remoteIgnoredDevices/${encodeURIComponent(deviceID)}`);
      await loadBootstrap();
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "取消忽略设备失败");
    }
  };

  const unignoreFolder = async (deviceID: string, folderID: string) => {
    try {
      const device = allDevices.find((d) => d.deviceID === deviceID);
      if (!device) return;
      const updated = {
        ...device,
        ignoredFolders: (device.ignoredFolders ?? []).filter((f) => f.id !== folderID),
      };
      await putJSON(`/rest/config/devices/${encodeURIComponent(deviceID)}`, updated);
      await loadBootstrap();
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "取消忽略文件夹失败");
    }
  };

  const saveProgressInterval = async (value: number) => {
    if (!optionsDraft) return;
    const updated = { ...optionsDraft, progressUpdateIntervalS: value };
    setOptionsDraft(updated);
    try {
      const payload = cloneJSON(updated);
      payload.alwaysLocalNets = (payload.alwaysLocalNets ?? []).filter((v) => v.trim().length > 0);
      await putJSON("/rest/config/options", payload);
      setOptions(payload);
    } catch {
      // ignore
    }
  };

  const rescanFolder = async (folder: FolderConfig) => {
    setOverviewMessage(`正在请求重新扫描"${folderLabel(folder)}"...`);
    try {
      await postJSON(`/rest/db/scan?folder=${encodeURIComponent(folder.id)}`);
      setOverviewMessage(`已提交"${folderLabel(folder)}"的重新扫描请求。`);
      await loadBootstrap();
    } catch (error) {
      setOverviewMessage(error instanceof Error ? error.message : "提交重新扫描失败");
    }
  };

  const restartSyncthing = async () => {
    if (!window.confirm("确认重启 Syncthing 后端进程吗？当前同步会短暂中断。")) {
      return;
    }
    setSystemActionBusy("restart");
    setSystemActionMessage("");
    try {
      await triggerSystemAction("restart");
      setSystemActionMessage("已提交重启请求，Syncthing 正在重启。页面稍后会失去连接。");
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "提交重启请求失败");
    } finally {
      setSystemActionBusy("");
    }
  };

  const shutdownSyncthing = async () => {
    if (!window.confirm("确认完全关闭 Syncthing 后端程序吗？关闭后同步会停止，直到你重新启动程序。")) {
      return;
    }
    setSystemActionBusy("shutdown");
    setSystemActionMessage("");
    try {
      await triggerSystemAction("shutdown");
      setSystemActionMessage("已提交关闭请求，Syncthing 后端正在退出。页面很快会失去连接。");
    } catch (error) {
      setSystemActionMessage(error instanceof Error ? error.message : "提交关闭请求失败");
    } finally {
      setSystemActionBusy("");
    }
  };

  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="eyebrow">Syncthing Compare</div>
          <h1>登录 Web GUI</h1>
          <p>新的 React 工作台已接管核心审核流程。登录后可直接进入文件夹对比、接收审核和发布审核。</p>
          <form onSubmit={handleLogin} className="login-form">
            <label>
              <span>用户名</span>
              <input
                value={loginState.username}
                onChange={(event) => setLoginState((previous) => ({ ...previous, username: event.target.value }))}
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                value={loginState.password}
                onChange={(event) => setLoginState((previous) => ({ ...previous, password: event.target.value }))}
              />
            </label>
            {loginState.error && <div className="inline-message danger">{loginState.error}</div>}
            <button type="submit" className="primary-button" disabled={loginState.busy}>
              {loginState.busy ? "正在登录..." : "登录"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  useEffect(() => {
    updateUiModeInUrl(uiMode);
  }, [uiMode]);

  useEffect(() => {
    if (uiMode === "desktop") {
      setSidebarOpen(true);
    } else {
      setSidebarOpen(false);
    }
  }, [uiMode]);

  return (
    <div className={`workspace-shell ui-mode-${uiMode}${uiMode === "mobile" && sidebarOpen ? " sidebar-open" : ""}`}>
      {uiMode === "mobile" && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <WorkspaceSidebar
        uiMode={uiMode}
        setSidebarOpen={setSidebarOpen}
        version={version}
        system={system}
        allDevices={allDevices}
        connections={connections}
        connectionRates={connectionRates}
        completions={completions}
        deviceStats={deviceStats}
        folders={folders}
        folderStatuses={folderStatuses}
        selectedFolderId={selectedFolderId}
        setSelectedFolderId={setSelectedFolderId}
        expandedFolders={expandedFolders}
        setExpandedFolders={setExpandedFolders}
        mainRefreshSeconds={mainRefreshSeconds}
        panelRefreshSeconds={panelRefreshSeconds}
        applyRefreshSettings={applyRefreshSettings}
        loadBootstrap={loadBootstrap}
        bootBusy={bootBusy}
        openDeviceEditor={openDeviceEditor}
        discoveryCache={discoveryCache}
        pendingDevices={pendingDevicesList}
        existingDeviceIds={existingDeviceIds}
        onQuickAddDevice={(deviceID, name) => void quickAddNearbyDevice(deviceID, name)}
        onRefreshNearbyDevices={() => void refreshNearbyDevicesNow()}
        nearbyBusy={nearbyAddBusy}
        nearbyRefreshBusy={nearbyRefreshBusy}
        nearbyMessage={nearbyAddMessage}
      />

      <main className="workspace-main">
        <header className="topbar">
          {uiMode === "mobile" && !sidebarOpen && (
            <button className="menu-toggle-btn" onClick={() => setSidebarOpen(true)} title="打开侧栏">☰</button>
          )}
          <div>
            <div className="eyebrow">当前设备</div>
            <h2>{window.metadata?.deviceIDShort ?? "Compare"}</h2>
          </div>
          <div className="topbar-actions">
            <button className={`tab-button${uiMode === "desktop" ? " active" : ""}`} onClick={() => setUiMode("desktop")}>
              桌面版
            </button>
            <button className={`tab-button${uiMode === "mobile" ? " active" : ""}`} onClick={() => setUiMode("mobile")}>
              手机版
            </button>
            <button className={`tab-button${viewMode === "overview" ? " active" : ""}`} onClick={() => setViewMode("overview")}>
              概览
            </button>
            <button
              className="tab-button"
              onClick={() => setReceiveModalOpen(true)}
              disabled={!selectedFolder || isPausedFolder(selectedFolder) || !canReceive(selectedFolder)}
            >
              接收审核
            </button>
            <button
              className="tab-button"
              onClick={() => setPublishModalOpen(true)}
              disabled={!selectedFolder || isPausedFolder(selectedFolder) || !canPublish(selectedFolder)}
            >
              发布审核
            </button>
            <button className="ghost-button" onClick={() => setSettingsModalOpen(true)}>
              设置
            </button>
            <button className="ghost-button" onClick={() => setIdentityBackupOpen(true)}>
              设备身份
            </button>
            <button className="ghost-button" onClick={() => void handleLogout()}>
              登出
            </button>
          </div>
        </header>

        {bootError && <div className="inline-message danger">{bootError}</div>}

        {bootBusy && !config ? (
          <section className="panel surface">
            <h3>正在加载工作台</h3>
            <p>正在读取当前设备的文件夹、远端设备和同步状态。</p>
          </section>
        ) : bootError && !config ? (
          <section className="panel surface">
            <h3>工作台加载失败</h3>
            <p>当前不是"没有文件夹"，而是前端还没拿到配置或状态数据。你可以先点刷新再试一次。</p>
            <div className="inline-message danger">{bootError}</div>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => void loadBootstrap()} disabled={bootBusy}>
                {bootBusy ? "正在刷新..." : "重新加载"}
              </button>
            </div>
          </section>
        ) : (
          <>
            {Object.keys(pendingFolders).length > 0 && (
              <section className="panel surface pending-offers-panel">
                <div className="panel-header">
                  <div>
                    <div className="eyebrow">待接受共享文件夹</div>
                    <h3>来自远端设备的新文件夹邀请</h3>
                  </div>
                </div>
                <div className="help-block">
                  本机当前即使还没有文件夹，也可以直接接受对方共享过来的文件夹。如果你希望某台远端设备以后共享的新文件夹自动落到当前设备，可在"编辑设备 &gt; 共享"中开启"自动接受"。
                </div>
                <div className="share-list">
                  {Object.entries(pendingFolders).map(([folderId, pending]) => {
                    const offers = pendingFolderOfferDevices(pending, devicesById);
                    return (
                      <div key={folderId} className="share-folder-row selected">
                        <div className="folder-offer-head">
                          <strong>{folderId}</strong>
                          <span className="help-inline">{offers.map((offer) => deviceName(offer.device)).join("，")}</span>
                        </div>
                        {offers.map((offer) => (
                          <div key={offer.deviceID} className="folder-offer-device">
                            <div className="help-block">
                              来自设备：{deviceName(offer.device)}。标签：{offer.observed.label || folderId}
                              {offer.observed.receiveEncrypted ? "。对端建议使用 Receive Encrypted。" : ""}
                            </div>
                            <div className="panel-actions">
                              <button className="primary-button" onClick={() => void acceptPendingFolder(folderId, offer.deviceID)}>
                                接受
                              </button>
                              <button className="ghost-button" onClick={() => void dismissPendingFolder(folderId, offer.deviceID)}>
                                忽略
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {!selectedFolder ? (
              <section className="panel surface">
                <h3>没有可用文件夹</h3>
                <p>
                  {Object.keys(pendingFolders).length > 0
                    ? "本机还没有自己的文件夹。上方就是对方发来的共享邀请，接受后会出现在左侧。"
                    : "当前配置里没有共享文件夹。可以先在左侧添加局域网设备，再新增文件夹并勾选共享。"}
                </p>
              </section>
            ) : (
              <>
            {viewMode === "overview" && (
              <OverviewPanel
                folders={folders}
                selectedFolderId={selectedFolderId}
                folderStatuses={folderStatuses}
                devicesById={devicesById}
                completions={completions}
                connections={connections}
                overviewMessage={overviewMessage}
                expandedFolders={expandedFolders}
                onToggleExpand={(folderId) =>
                  setExpandedFolders((previous) => ({
                    ...previous,
                    [folderId]: !previous[folderId],
                  }))
                }
                onSelectFolder={setSelectedFolderId}
                onOpenReceive={(folder) => {
                  setSelectedFolderId(folder.id);
                  setReceiveModalOpen(true);
                }}
                onOpenBiDiff={(folder) => {
                  setSelectedFolderId(folder.id);
                  setBiDiffModalOpen(true);
                }}
                onOpenPeerDiff={(folder) => {
                  setSelectedFolderId(folder.id);
                  setPeerDiffModalOpen(true);
                }}
                onOpenPublish={(folder) => {
                  setSelectedFolderId(folder.id);
                  setPublishModalOpen(true);
                }}
                onEditFolder={(folder) => {
                  setSelectedFolderId(folder.id);
                  setFolderDraft(prepareFolderDraft(folder));
                  setFolderIgnoreText("");
                  setFolderIgnoreError("");
                  setFolderAddIgnores(false);
                  void loadFolderIgnores(folder.id);
                  setFolderSaveMessage("");
                  setFolderEditorOpen(true);
                }}
                onEditDevice={openDeviceEditor}
                onRescan={(folder) => void rescanFolder(folder)}
                onTogglePaused={(folder) => void toggleFolderPaused(folder)}
                localDeviceId={system?.myID}
              />
            )}
              </>
            )}
          </>
        )}

      </main>

      {settingsModalOpen && (
        <ModalShell title="设置" onClose={() => setSettingsModalOpen(false)}>
          <SettingsHubPanel
            optionsDraft={optionsDraft}
            onOptionsChange={setOptionsDraft}
            onSaveOptions={() => void saveOptionsDraft()}
            optionsBusy={optionsSaveBusy}
            optionsMessage={optionsSaveMessage}
            onCreateFolder={() => void createFolder()}
            onCreateDevice={() => void createDevice()}
            newFolderBusy={newFolderBusy}
            newDeviceBusy={newDeviceBusy}
            devices={allDevices}
            folders={folders}
            onEditDevice={openDeviceEditor}
            onEditFolder={(folder) => {
              setSelectedFolderId(folder.id);
              setFolderDraft(prepareFolderDraft(folder));
              setFolderIgnoreText("");
              setFolderIgnoreError("");
              setFolderAddIgnores(false);
              void loadFolderIgnores(folder.id);
              setFolderSaveMessage("");
              setFolderEditorOpen(true);
              setSettingsModalOpen(false);
            }}
            onRestart={() => void restartSyncthing()}
            onShutdown={() => void shutdownSyncthing()}
            systemActionBusy={systemActionBusy}
            systemActionMessage={systemActionMessage}
            onOpenAdvanced={() => {
              setSettingsModalOpen(false);
              void loadAdvancedConfig();
            }}
            discoveryCache={discoveryCache}
            pendingDevices={pendingDevicesList}
            existingDeviceIds={existingDeviceIds}
            localDeviceId={system?.myID}
            onQuickAddDevice={(deviceID, name) => void quickAddNearbyDevice(deviceID, name)}
            onRefreshNearbyDevices={() => void refreshNearbyDevicesNow()}
            nearbyBusy={nearbyAddBusy}
            nearbyRefreshBusy={nearbyRefreshBusy}
            nearbyMessage={nearbyAddMessage}
          />
        </ModalShell>
      )}

      {advancedModalOpen && advancedConfig && (
        <ModalShell title="高级配置" onClose={() => setAdvancedModalOpen(false)}>
          <AdvancedConfigModal
            config={advancedConfig}
            themes={themes}
            busy={advancedSaveBusy}
            message={advancedSaveMessage}
            restartRequired={advancedRestartRequired}
            onChange={setAdvancedConfig}
            onSave={() => void saveAdvancedConfig()}
            onClose={() => setAdvancedModalOpen(false)}
          />
        </ModalShell>
      )}

      {identityBackupOpen && (
        <ModalShell title="设备身份备份" onClose={() => setIdentityBackupOpen(false)}>
          <IdentityBackupPanel onClose={() => setIdentityBackupOpen(false)} />
        </ModalShell>
      )}

      {folderEditorOpen && folderDraft && (
        <ModalShell title={editingNewFolder ? "新建文件夹" : "编辑文件夹"} onClose={closeFolderEditor}>
          <FolderSettingsPanel
            draft={folderDraft}
            allDevices={allDevices}
            completions={completions}
            ignoreText={folderIgnoreText}
            onIgnoreTextChange={setFolderIgnoreText}
            ignoreError={folderIgnoreError}
            ignoreBusy={folderIgnoreBusy}
            addIgnores={folderAddIgnores}
            onAddIgnoresChange={setFolderAddIgnores}
            onChange={setFolderDraft}
            onClose={closeFolderEditor}
            onSave={() => void (editingExistingFolder ? saveFolderDraft() : saveNewFolder())}
            busy={folderSaveBusy}
            message={folderSaveMessage}
            isNew={editingNewFolder}
            savedPath={editingExistingFolder ? selectedFolder?.path : undefined}
            onDelete={editingExistingFolder ? () => void deleteCurrentFolder() : undefined}
          />
        </ModalShell>
      )}

      {deviceDraft && (editingExistingDevice || editingNewDevice) && (
        <ModalShell
          title={editingNewDevice ? `新建设备 (${deviceName(deviceDraft)})` : `编辑设备 (${deviceName(deviceDraft)})`}
          onClose={closeDeviceEditor}
        >
          <DeviceSettingsPanel
            draft={deviceDraft}
            onChange={setDeviceDraft}
            shareDraft={deviceShareDraft}
            onShareDraftChange={setDeviceShareDraft}
            allFolders={folders}
            allDevices={allDevices.filter((device) => device.deviceID !== system?.myID)}
            completions={completions}
            onClose={closeDeviceEditor}
            onSave={() => void (editingExistingDevice ? saveDeviceDraft() : saveNewDevice())}
            busy={deviceSaveBusy}
            message={deviceSaveMessage}
            isNew={editingNewDevice}
            onDelete={editingExistingDevice ? () => void deleteCurrentDevice() : undefined}
            discoveryCache={discoveryCache}
            pendingDevices={pendingDevicesList}
            existingDeviceIds={existingDeviceIds}
            localDeviceId={system?.myID}
          />
        </ModalShell>
      )}

      {receiveModalOpen && selectedFolder && (
        <ModalShell title={`接收审核 - ${folderLabel(selectedFolder)}`} onClose={() => setReceiveModalOpen(false)}>
          <ReceiveReviewPanel
            folder={selectedFolder}
            devices={selectedFolderDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            selectedDevice={selectedDevice}
            compare={compare}
            compareBusy={compareBusy}
            compareError={compareError}
            compareView={compareView}
            onCompareViewChange={setCompareView}
            comparePrefix={comparePrefix}
            onComparePrefixChange={setComparePrefix}
            compareSelection={compareSelection}
            onCompareSelectionChange={setCompareSelection}
            compareMessage={compareMessage}
            compareIgnoreModTime={compareIgnoreModTime}
            onCompareIgnoreModTimeChange={setCompareIgnoreModTime}
            onRefresh={() => void refreshCompare(true)}
            onSyncSelected={() =>
              void syncEntries((compare?.entries ?? []).filter((entry) => compareSelection[entry.path] && entry.canPrioritize))
            }
            onSyncVisible={() => void syncEntries(compareVisibleEntries)}
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
          />
        </ModalShell>
      )}

      {bidiffModalOpen && selectedFolder && (
        <ModalShell
          title={
            <WorkbenchTitle
              label={`接发 · ${folderLabel(selectedFolder)}`}
              device={selectedDevice}
              connection={selectedDeviceId ? connections?.connections[selectedDeviceId] : undefined}
              rates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
              stats={titleBarStats}
            />
          }
          titleExtra={
            <>
              <button className={bidiffWorkbenchView === "diff" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setBidiffWorkbenchView("diff")}>差异</button>
              <button className={bidiffWorkbenchView === "transfer" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setBidiffWorkbenchView("transfer")}>
                传输
                {(Object.keys(downloadProgress).length > 0 || Object.keys(uploadProgress).length > 0) && (
                  <span className="badge tone-info" style={{ marginLeft: 6, fontSize: "0.7rem" }}>
                    {Object.values(downloadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0) + Object.values(uploadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0)}
                  </span>
                )}
              </button>
            </>
          }
          onClose={() => {
            setBiDiffModalOpen(false);
            setTitleBarStats(null);
          }}
        >
          <BiDiffPanel
            mode="bidiff"
            folder={selectedFolder}
            devices={selectedFolderDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            selectedDevice={selectedDevice}
            bidiff={bidiff}
            bidiffBusy={bidiffBusy}
            bidiffError={bidiffError}
            bidiffView={bidiffView}
            onBidiffViewChange={setBiDiffView}
            bidiffPrefix={bidiffPrefix}
            onBidiffPrefixChange={setBiDiffPrefix}
            bidiffSelection={bidiffSelection}
            onBidiffSelectionChange={setBiDiffSelection}
            bidiffMessage={bidiffMessage}
            bidiffIgnoreModTime={bidiffIgnoreModTime}
            onBidiffIgnoreModTimeChange={setBiDiffIgnoreModTime}
            onRefresh={() => void refreshBiDiff(true)}
            onApplyLeftToRight={() =>
              void applyBiDiffEntries(
                "left-to-right",
                (bidiff?.entries ?? []).filter((entry) => bidiffSelection[entry.path] && entry.canApplyLeftToRight),
              )
            }
            onApplyRightToLeft={() =>
              void applyBiDiffEntries(
                "right-to-left",
                (bidiff?.entries ?? []).filter((entry) => bidiffSelection[entry.path] && entry.canApplyRightToLeft),
              )
            }
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
            scanBusy={panelScanBusy === "bidiff"}
            activeTasks={activeBiDiffTasks}
            allTasks={allBiDiffTasks}
            uiMode={uiMode}
            autoRefreshPaused={bidiffAutoRefreshPaused}
            onToggleAutoRefreshPaused={() => setBidiffAutoRefreshPaused((previous) => !previous)}
            titleStats={setTitleBarStats}
            downloadProgress={downloadProgress}
            uploadProgress={uploadProgress}
            completedUploads={completedUploads}
            uploadFileInfo={uploadFileInfo}
            completedDownloads={completedDownloads}
            connectionRates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
            workbenchView={bidiffWorkbenchView}
            onWorkbenchViewChange={setBidiffWorkbenchView}
            progressUpdateIntervalS={options?.progressUpdateIntervalS}
            onSaveProgressInterval={saveProgressInterval}
          />
        </ModalShell>
      )}

      {peerDiffModalOpen && selectedFolder && (
        <ModalShell
          title={
            <WorkbenchTitle
              label={`直传 · ${folderLabel(selectedFolder)}`}
              device={selectedDevice}
              connection={selectedDeviceId ? connections?.connections[selectedDeviceId] : undefined}
              rates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
              stats={titleBarStats}
              isPeer
            />
          }
          titleExtra={
            <>
              <button className={peerWorkbenchView === "diff" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setPeerWorkbenchView("diff")}>差异</button>
              <button className={peerWorkbenchView === "transfer" ? "primary-button compact-button" : "ghost-button compact-button"} onClick={() => setPeerWorkbenchView("transfer")}>
                传输
                {(Object.keys(downloadProgress).length > 0 || Object.keys(uploadProgress).length > 0) && (
                  <span className="badge tone-info" style={{ marginLeft: 6, fontSize: "0.7rem" }}>
                    {Object.values(downloadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0) + Object.values(uploadProgress).reduce((sum, folder) => sum + Object.keys(folder).length, 0)}
                  </span>
                )}
              </button>
            </>
          }
          onClose={() => {
            setPeerDiffModalOpen(false);
            setTitleBarStats(null);
          }}
        >
          <BiDiffPanel
            mode="peer"
            folder={selectedFolder}
            devices={selectedFolderDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            selectedDevice={selectedDevice}
            bidiff={peerDiff}
            bidiffBusy={peerDiffBusy}
            bidiffError={peerDiffError}
            bidiffView={peerDiffView}
            onBidiffViewChange={setPeerDiffView}
            bidiffPrefix={peerDiffPrefix}
            onBidiffPrefixChange={setPeerDiffPrefix}
            bidiffSelection={peerDiffSelection}
            onBidiffSelectionChange={setPeerDiffSelection}
            bidiffMessage={peerDiffMessage}
            bidiffIgnoreModTime={peerDiffIgnoreModTime}
            onBidiffIgnoreModTimeChange={setPeerDiffIgnoreModTime}
            onRefresh={() => void refreshPeerDiff(true)}
            onApplyLeftToRight={() =>
              void applyPeerDiffEntries(
                "left-to-right",
                (peerDiff?.entries ?? []).filter((entry) => peerDiffSelection[entry.path] && entry.canApplyLeftToRight),
              )
            }
            onApplyRightToLeft={() =>
              void applyPeerDiffEntries(
                "right-to-left",
                (peerDiff?.entries ?? []).filter((entry) => peerDiffSelection[entry.path] && entry.canApplyRightToLeft),
              )
            }
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
            scanBusy={panelScanBusy === "peerdiff"}
            activeTasks={activePeerDiffTasks}
            allTasks={allPeerDiffTasks}
            uiMode={uiMode}
            autoRefreshPaused={peerDiffAutoRefreshPaused}
            onToggleAutoRefreshPaused={() => setPeerDiffAutoRefreshPaused((previous) => !previous)}
            titleStats={setTitleBarStats}
            downloadProgress={downloadProgress}
            uploadProgress={uploadProgress}
            completedUploads={completedUploads}
            uploadFileInfo={uploadFileInfo}
            completedDownloads={completedDownloads}
            connectionRates={selectedDeviceId ? connectionRates[selectedDeviceId] : undefined}
            workbenchView={peerWorkbenchView}
            onWorkbenchViewChange={setPeerWorkbenchView}
            progressUpdateIntervalS={options?.progressUpdateIntervalS}
            onSaveProgressInterval={saveProgressInterval}
          />
        </ModalShell>
      )}

      {publishModalOpen && selectedFolder && (
        <ModalShell title={`发布审核 - ${folderLabel(selectedFolder)}`} onClose={() => setPublishModalOpen(false)}>
          <PublishReviewPanel
            folder={selectedFolder}
            publish={publish}
            publishBusy={publishBusy}
            publishError={publishError}
            publishView={publishView}
            onPublishViewChange={setPublishView}
            publishPrefix={publishPrefix}
            onPublishPrefixChange={setPublishPrefix}
            publishSelection={publishSelection}
            onPublishSelectionChange={setPublishSelection}
            publishMessage={publishMessage}
            onRefresh={() => void refreshPublish(true)}
            onPublishSelected={() =>
              void publishEntries((publish?.entries ?? []).filter((entry) => publishSelection[entry.path] && entry.canPublish))
            }
            onPublishVisible={() => void publishEntries(publishVisibleEntries)}
            onClearSettledSelected={() =>
              void clearSettledPublishEntries((publish?.entries ?? []).filter((entry) => publishSelection[entry.path] && entry.canClear))
            }
            onClearSettledVisible={() => void clearSettledPublishEntries(publishClearableEntries)}
            devices={selectedFolderDevices}
            devicesById={devicesById}
            completions={completions}
            connections={connections}
          />
        </ModalShell>
      )}
    </div>
  );
}

function ModalShell(props: { title: ReactNode; titleExtra?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section className="modal-shell surface" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <span className="eyebrow-inline">工作台</span>
            <h3>{props.title}</h3>
          </div>
          {props.titleExtra && <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>{props.titleExtra}</div>}
          <button className="ghost-button compact-button" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <div className="modal-content">{props.children}</div>
      </section>
    </div>
  );
}

function WorkbenchTitle(props: {
  label: string;
  device?: DeviceConfig | null;
  connection?: DeviceConnection;
  rates?: { inbps: number; outbps: number };
  stats?: { total: number; selected: number; leftToRight: number; rightToLeft: number; pending?: number; previewReady?: boolean } | null;
  isPeer?: boolean;
}) {
  const device = props.device ? deviceName(props.device) : "未选择设备";
  const down = formatRate(props.rates?.inbps ?? props.connection?.inbps);
  const up = formatRate(props.rates?.outbps ?? props.connection?.outbps);
  const s = props.stats;
  return (
    <span className="workbench-title-inline">
      <span>{props.label}</span>
      <span className="workbench-title-meta">
        · {device} · ↓ {down} · ↑ {up}
        {s && (
          <>
            {" · 共"} {s.total} 项 · 已选 {s.selected} · 左→右 {s.leftToRight} · 右→左 {s.rightToLeft}
            {props.isPeer && s.pending != null && ` · 未发布 ${s.pending}`}
            {props.isPeer && (s.previewReady ? " · 预览已接收" : " · 预览未接收")}
          </>
        )}
      </span>
    </span>
  );
}

function FileSide(props: { title: string; file?: CompareEntry["local"] | PendingPublishEntry["global"]; emptyLabel: string }) {
  return (
    <div className="file-side">
      <div className="file-side-title">{props.title}</div>
      {props.file ? (
        <>
          <div className="file-main-metric">{props.file.type === "directory" ? "目录" : formatBinary(props.file.size)}</div>
          <div className="file-meta">{formatDate(props.file.modified)}</div>
          <div className="file-meta muted">{props.file.deleted ? "路径已删除" : props.file.type}</div>
        </>
      ) : (
        <div className="file-main-metric muted">{props.emptyLabel}</div>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className={`metric-card${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.value}</div>
    </div>
  );
}

function InfoCell(props: { label: string; value: string }) {
  return (
    <div className="info-cell">
      <div className="info-label">{props.label}</div>
      <div className="info-value">{props.value}</div>
    </div>
  );
}

export default App;
