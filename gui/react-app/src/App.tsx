import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CompareEntry,
  CompareResult,
  CompletionStatus,
  ConfigResponse,
  ConnectionsResponse,
  DeviceConfig,
  FolderConfig,
  FolderStatus,
  OptionsConfig,
  PendingPublishEntry,
  PendingPublishResult,
  SystemStatus,
  VersionResponse,
  deleteJSON,
  getJSON,
  login,
  logout,
  putJSON,
  postJSON,
  triggerSystemAction,
} from "./api";

type ViewMode = "overview" | "receive" | "publish";

const MAIN_REFRESH_KEY = "reactGuiMainRefreshSeconds";
const PANEL_REFRESH_KEY = "reactGuiPanelRefreshSeconds";

const compareViewOptions = [
  { value: "different", label: "仅看差异" },
  { value: "all", label: "显示全部" },
  { value: "delete", label: "仅看删除" },
  { value: "modified", label: "仅看修改" },
  { value: "conflict", label: "仅看冲突" },
  { value: "only-local", label: "仅本地存在" },
  { value: "only-remote", label: "仅远端存在" },
  { value: "rename", label: "疑似移动/重命名" },
] as const;

const publishViewOptions = [
  { value: "all", label: "全部待发布项" },
  { value: "added", label: "仅看新增" },
  { value: "modified", label: "仅看修改" },
  { value: "delete", label: "仅看删除" },
] as const;

const refreshChoices = [2, 3, 5, 10, 15, 30];

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

function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
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

function folderStateTone(status?: FolderStatus): "success" | "warning" | "danger" | "muted" {
  if (!status) {
    return "muted";
  }
  if (status.errors) {
    return "danger";
  }
  if (status.needTotalItems || status.needBytes || status.receiveOnlyTotalItems) {
    return "warning";
  }
  if (status.state === "idle") {
    return "success";
  }
  return "muted";
}

function compareStatusLabel(entry: CompareEntry): string {
  if (entry.renameCandidate) {
    switch (compareRenameRole(entry)) {
      case "old":
        return "疑似移动/重命名（旧路径）";
      case "new":
        return "疑似移动/重命名（新路径）";
      default:
        return "疑似移动/重命名";
    }
  }

  switch (entry.status) {
    case "same":
      return "相同";
    case "only-local":
      return "仅本地存在";
    case "only-remote":
      return "仅远端存在";
    case "deleted-local":
      return "本地路径已删除";
    case "deleted-remote":
      return "远端路径已删除";
    case "modified":
      return "已修改";
    case "conflict":
      return "冲突";
    case "type-changed":
      return "类型变化";
    default:
      return entry.status;
  }
}

function compareRenameRole(entry: CompareEntry): "old" | "new" | "" {
  if (!entry.renameCandidate) {
    return "";
  }
  switch (entry.status) {
    case "deleted-remote":
    case "only-local":
      return "old";
    case "deleted-local":
    case "only-remote":
      return "new";
    default:
      return "";
  }
}

function pendingPublishLabel(entry: PendingPublishEntry): string {
  if (entry.renameCandidate) {
    switch (pendingRenameRole(entry)) {
      case "old":
        return "疑似移动/重命名（旧路径）";
      case "new":
        return "疑似移动/重命名（新路径）";
      default:
        return "疑似移动/重命名";
    }
  }
  switch (entry.action) {
    case "added":
      return "待发布新增";
    case "delete":
      return "待发布删除";
    default:
      return "待发布修改";
  }
}

function pendingRenameRole(entry: PendingPublishEntry): "old" | "new" | "" {
  if (!entry.renameCandidate) {
    return "";
  }
  switch (entry.action) {
    case "delete":
      return "old";
    case "added":
      return "new";
    default:
      return "";
  }
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

function fileTypeLabel(value?: string): string {
  switch (value) {
    case "FILE_INFO_TYPE_FILE":
      return "文件";
    case "FILE_INFO_TYPE_DIRECTORY":
      return "目录";
    case "FILE_INFO_TYPE_SYMLINK":
      return "符号链接";
    case "FILE_INFO_TYPE_SYMLINK_FILE":
      return "文件链接";
    case "FILE_INFO_TYPE_SYMLINK_DIRECTORY":
      return "目录链接";
    default:
      return value || "-";
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "same":
      return "success";
    case "modified":
    case "type-changed":
      return "warning";
    case "conflict":
      return "danger";
    case "deleted-local":
    case "deleted-remote":
      return "muted";
    default:
      return "info";
  }
}

function compareSideTone(entry: CompareEntry, side: "local" | "remote"): "success" | "warning" | "danger" | "muted" | "info" {
  if (entry.renameCandidate) {
    return "info";
  }
  switch (entry.status) {
    case "only-remote":
      return side === "remote" ? "success" : "muted";
    case "only-local":
      return side === "local" ? "success" : "muted";
    case "deleted-remote":
      return side === "remote" ? "danger" : "warning";
    case "deleted-local":
      return side === "local" ? "danger" : "warning";
    case "modified":
    case "type-changed":
      return "warning";
    case "conflict":
      return "danger";
    case "same":
      return "success";
    default:
      return "info";
  }
}

function completionPercent(value?: CompletionStatus): number {
  if (!value) {
    return 0;
  }
  const percent = Number(value.completion ?? 0);
  if (Number.isNaN(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, percent));
}

function connectionBadgeLabel(connected: boolean, remoteState?: string): string {
  if (!connected) {
    return "离线";
  }
  if (remoteState === "syncing") {
    return "同步中";
  }
  if (remoteState === "scanning") {
    return "扫描中";
  }
  if (remoteState === "paused") {
    return "已暂停";
  }
  return "已连接";
}

function connectionBadgeTone(connected: boolean, remoteState?: string): "success" | "warning" | "muted" {
  if (!connected) {
    return "muted";
  }
  if (remoteState === "syncing" || remoteState === "scanning") {
    return "warning";
  }
  return "success";
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

type ColumnDef = {
  key: string;
  label: string;
  width: number;
  minWidth?: number;
};

function ResizableTable(props: {
  columns: ColumnDef[];
  onColumnsChange: (columns: ColumnDef[]) => void;
  children: ReactNode;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const resizingRef = useRef<{ columnIndex: number; startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (columnIndex: number, event: React.MouseEvent) => {
      event.preventDefault();
      const column = props.columns[columnIndex];
      resizingRef.current = {
        columnIndex,
        startX: event.clientX,
        startWidth: column.width,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientX - resizingRef.current.startX;
        const newWidth = Math.max(column.minWidth ?? 60, resizingRef.current.startWidth + delta);
        const newColumns = [...props.columns];
        newColumns[columnIndex] = { ...newColumns[columnIndex], width: newWidth };
        props.onColumnsChange(newColumns);
      };

      const handleMouseUp = () => {
        resizingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [props.columns, props.onColumnsChange]
  );

  return (
    <div className="compare-table-wrapper">
      <table ref={tableRef} className="compare-table">
        <colgroup>
          {props.columns.map((col) => (
            <col key={col.key} style={{ width: col.width }} />
          ))}
        </colgroup>
        {props.children}
      </table>
    </div>
  );
}

function renderResizableHeaders(columns: ColumnDef[], onColumnsChange: (columns: ColumnDef[]) => void) {
  return columns.map((col) => (
    <th key={col.key}>
      {col.label}
      {col.key !== "checkbox" && (
        <div
          className="resize-handle"
          onMouseDown={(e) => {
            const colIndex = columns.findIndex((c) => c.key === col.key);
            if (colIndex < 0) {
              return;
            }
            const startX = e.clientX;
            const startWidth = col.width;
            const handleMouseMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientX - startX;
              const newWidth = Math.max(col.minWidth ?? 60, startWidth + delta);
              const newColumns = [...columns];
              newColumns[colIndex] = { ...newColumns[colIndex], width: newWidth };
              onColumnsChange(newColumns);
            };
            const handleMouseUp = () => {
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />
      )}
    </th>
  ));
}

function FileVersionCell(props: {
  file?: CompareEntry["local"] | CompareEntry["remote"] | PendingPublishEntry["local"] | PendingPublishEntry["global"];
  missingLabel: string;
  tone?: "success" | "warning" | "danger" | "muted" | "info";
}) {
  if (!props.file) {
    return (
      <div className={`compare-side compare-side-missing${props.tone ? ` tone-${props.tone}` : ""}`}>
        <div className="compare-side-empty">{props.missingLabel}</div>
      </div>
    );
  }

  return (
    <div className={`compare-side${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="compare-side-primary">
        <span>{formatBinary(props.file.size)}</span>
        <span>{fileTypeLabel(props.file.type)}</span>
      </div>
      <div className="compare-side-secondary">
        <span>{formatDate(props.file.modified)}</span>
        <span>{props.file.deleted ? "路径已删除" : "存在"}</span>
      </div>
    </div>
  );
}

function ProgressBar(props: { percent: number; tone?: "success" | "warning" | "danger" | "muted" | "info"; label?: string }) {
  const percent = Math.max(0, Math.min(100, props.percent));
  return (
    <div className="progress-block">
      {props.label && <div className="progress-label">{props.label}</div>}
      <div className="progress-track">
        <div className={`progress-fill${props.tone ? ` tone-${props.tone}` : ""}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-value">{percent.toFixed(0)}%</div>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(window.metadata?.authenticated));
  const [loginState, setLoginState] = useState({ username: "", password: "", error: "", busy: false });

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [version, setVersion] = useState<VersionResponse | null>(null);
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [folderStatuses, setFolderStatuses] = useState<Record<string, FolderStatus>>({});
  const [completions, setCompletions] = useState<Record<string, Record<string, CompletionStatus>>>({});
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [mainRefreshSeconds, setMainRefreshSeconds] = useState(readStoredSeconds(MAIN_REFRESH_KEY, 5));
  const [panelRefreshSeconds, setPanelRefreshSeconds] = useState(readStoredSeconds(PANEL_REFRESH_KEY, 3));
  const [bootBusy, setBootBusy] = useState(false);
  const [bootError, setBootError] = useState("");
  const [overviewMessage, setOverviewMessage] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [compareView, setCompareView] = useState("different");
  const [comparePrefix, setComparePrefix] = useState("");
  const [compareSelection, setCompareSelection] = useState<Record<string, boolean>>({});
  const [compareMessage, setCompareMessage] = useState("");

  const [publish, setPublish] = useState<PendingPublishResult | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishView, setPublishView] = useState("all");
  const [publishPrefix, setPublishPrefix] = useState("");
  const [publishSelection, setPublishSelection] = useState<Record<string, boolean>>({});
  const [publishMessage, setPublishMessage] = useState("");

  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState<FolderConfig | null>(null);
  const [folderSaveBusy, setFolderSaveBusy] = useState(false);
  const [folderSaveMessage, setFolderSaveMessage] = useState("");
  const [newFolderBusy, setNewFolderBusy] = useState(false);

  const [deviceEditorId, setDeviceEditorId] = useState("");
  const [deviceDraft, setDeviceDraft] = useState<DeviceConfig | null>(null);
  const [deviceSaveBusy, setDeviceSaveBusy] = useState(false);
  const [deviceSaveMessage, setDeviceSaveMessage] = useState("");
  const [newDeviceBusy, setNewDeviceBusy] = useState(false);

  const [options, setOptions] = useState<OptionsConfig | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<OptionsConfig | null>(null);
  const [optionsSaveBusy, setOptionsSaveBusy] = useState(false);
  const [optionsSaveMessage, setOptionsSaveMessage] = useState("");
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [systemActionBusy, setSystemActionBusy] = useState<"" | "restart" | "shutdown">("");
  const [systemActionMessage, setSystemActionMessage] = useState("");

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
      .filter((device): device is DeviceConfig => Boolean(device) && device.deviceID !== system?.myID);
  }, [selectedFolder, devicesById, system?.myID]);

  const selectedDevice = useMemo(
    () => selectedFolderDevices.find((device) => device.deviceID === selectedDeviceId) ?? null,
    [selectedFolderDevices, selectedDeviceId],
  );

  const allDevices = config?.devices ?? [];
  const editingDevice = useMemo(
    () => allDevices.find((device) => device.deviceID === deviceEditorId) ?? null,
    [allDevices, deviceEditorId],
  );
  const editingExistingDevice = Boolean(editingDevice);
  const editingNewDevice = Boolean(deviceDraft && deviceEditorId === "__new__");
  const editingExistingFolder = Boolean(selectedFolder && folderDraft && folderDraft.id === selectedFolder.id);
  const editingNewFolder = Boolean(folderDraft && (!selectedFolder || folderDraft.id !== selectedFolder.id));

  const loadBootstrap = useCallback(async () => {
    if (!authenticated) {
      return;
    }
    setBootBusy(true);
    setBootError("");
    try {
      const [nextConfig, nextSystem, nextVersion, nextConnections] = await Promise.all([
        getJSON<ConfigResponse>("/rest/config"),
        getJSON<SystemStatus>("/rest/system/status"),
        getJSON<VersionResponse>("/rest/system/version"),
        getJSON<ConnectionsResponse>("/rest/system/connections"),
      ]);

      const statusEntries = await Promise.all(
        nextConfig.folders.map(async (folder) => {
          const status = await getJSON<FolderStatus>(`/rest/db/status?folder=${encodeURIComponent(folder.id)}`);
          return [folder.id, status] as const;
        }),
      );

      const completionPairs = await Promise.all(
        nextConfig.folders.flatMap((folder) =>
          folder.devices.map(async (folderDevice) => {
            const completion = await getJSON<CompletionStatus>(
              `/rest/db/completion?device=${encodeURIComponent(folderDevice.deviceID)}&folder=${encodeURIComponent(folder.id)}`,
            );
            return [folderDevice.deviceID, folder.id, completion] as const;
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
      setConnections(nextConnections);
      setFolderStatuses(nextStatuses);
      setCompletions(nextCompletions);

      const nextOptions = await getJSON<OptionsConfig>("/rest/config/options");
      setOptions(nextOptions);
      setOptionsDraft((previous) => previous ?? cloneJSON(nextOptions));

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

  const loadCompare = useCallback(async () => {
    if (!selectedFolder || !selectedDeviceId) {
      setCompare(null);
      return;
    }

    setCompareBusy(true);
    setCompareError("");
    try {
      const data = await getJSON<CompareResult>(
        `/rest/db/compare?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(compareView)}&prefix=${encodeURIComponent(comparePrefix)}&page=1&perpage=500`,
      );
      setCompare(data);
      setCompareSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path] && entry.canPrioritize) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "加载接收审核失败");
    } finally {
      setCompareBusy(false);
    }
  }, [comparePrefix, compareView, selectedDeviceId, selectedFolder]);

  const loadPublish = useCallback(async () => {
    if (!selectedFolder) {
      setPublish(null);
      return;
    }

    setPublishBusy(true);
    setPublishError("");
    try {
      const data = await getJSON<PendingPublishResult>(
        `/rest/db/pendingpublish?folder=${encodeURIComponent(selectedFolder.id)}&view=${encodeURIComponent(publishView)}&prefix=${encodeURIComponent(publishPrefix)}&page=1&perpage=500`,
      );
      setPublish(data);
      setPublishSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path] && entry.canPublish) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "加载发布审核失败");
    } finally {
      setPublishBusy(false);
    }
  }, [publishPrefix, publishView, selectedFolder]);

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

  useEffect(() => {
    if (!receiveModalOpen || !selectedFolder || !selectedDeviceId) {
      return;
    }
    void loadCompare();
    const handle = window.setInterval(() => {
      void loadCompare();
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [loadCompare, panelRefreshSeconds, selectedDeviceId, selectedFolder, receiveModalOpen]);

  useEffect(() => {
    if (!publishModalOpen || !selectedFolder) {
      return;
    }
    void loadPublish();
    const handle = window.setInterval(() => {
      void loadPublish();
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [loadPublish, panelRefreshSeconds, selectedFolder, publishModalOpen]);

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

  const compareVisibleEntries = useMemo(
    () => (compare?.entries ?? []).filter((entry) => entry.canPrioritize),
    [compare],
  );

  const publishVisibleEntries = useMemo(
    () => (publish?.entries ?? []).filter((entry) => entry.canPublish),
    [publish],
  );

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

  const syncEntries = async (entries: CompareEntry[]) => {
    if (!selectedFolder || !compare) {
      return;
    }
    setCompareMessage(compare.manualSync ? "正在提交同步请求..." : "正在提交优先处理请求...");
    try {
      await Promise.all(
        entries.map((entry) =>
          postJSON(`/rest/db/prio?folder=${encodeURIComponent(selectedFolder.id)}&file=${encodeURIComponent(entry.path)}`),
        ),
      );
      if (compare.manualSync) {
        await postJSON(`/rest/db/pullselected?folder=${encodeURIComponent(selectedFolder.id)}`, {
          files: entries.map((entry) => entry.path),
        });
      }
      setCompareMessage(compare.manualSync ? "已提交同步请求。" : "已提交优先处理请求。");
      await Promise.all([loadCompare(), loadBootstrap()]);
    } catch (error) {
      setCompareMessage(error instanceof Error ? error.message : "提交请求失败");
    }
  };

  const publishEntries = async (entries: PendingPublishEntry[]) => {
    if (!selectedFolder) {
      return;
    }
    setPublishMessage("正在提交发布请求...");
    try {
      await postJSON(`/rest/db/publishselected?folder=${encodeURIComponent(selectedFolder.id)}`, {
        files: entries.map((entry) => entry.path),
      });
      setPublishMessage("已提交发布请求。远端会按自己的接收策略处理。");
      await Promise.all([loadPublish(), loadBootstrap()]);
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "发布请求失败");
    }
  };

  const openFolderEditor = () => {
    if (!selectedFolder) {
      return;
    }
    setFolderDraft(cloneJSON(selectedFolder));
    setFolderSaveMessage("");
    setFolderEditorOpen(true);
  };

  const closeFolderEditor = () => {
    setFolderEditorOpen(false);
    setFolderDraft(null);
    setFolderSaveMessage("");
  };

  const openDeviceEditor = (device: DeviceConfig) => {
    setDeviceEditorId(device.deviceID);
    setDeviceDraft(cloneJSON(device));
    setDeviceSaveMessage("");
  };

  const closeDeviceEditor = () => {
    setDeviceEditorId("");
    setDeviceDraft(null);
    setDeviceSaveMessage("");
  };

  const saveFolderDraft = async () => {
    if (!selectedFolder || !folderDraft) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      const payload = cloneJSON(folderDraft);
      if (!canReceive(payload)) {
        payload.manualSync = false;
      }
      if (!canPublish(payload)) {
        payload.manualPublish = false;
      }
      await putJSON(`/rest/config/folders/${encodeURIComponent(selectedFolder.id)}`, payload);
      setFolderSaveMessage("文件夹设置已保存。");
      await loadBootstrap();
      setFolderEditorOpen(false);
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "保存文件夹设置失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const deleteCurrentFolder = async () => {
    if (!selectedFolder || !window.confirm(`确认删除文件夹“${folderLabel(selectedFolder)}”的配置吗？`)) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      await deleteJSON(`/rest/config/folders/${encodeURIComponent(selectedFolder.id)}`);
      closeFolderEditor();
      await loadBootstrap();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "删除文件夹配置失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const saveDeviceDraft = async () => {
    if (!editingDevice || !deviceDraft) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      const payload = cloneJSON(deviceDraft);
      payload.addresses = (payload.addresses ?? []).filter((value) => value.trim().length > 0);
      payload.allowedNetworks = (payload.allowedNetworks ?? []).filter((value) => value.trim().length > 0);
      await putJSON(`/rest/config/devices/${encodeURIComponent(editingDevice.deviceID)}`, payload);
      setDeviceSaveMessage("设备设置已保存。");
      await loadBootstrap();
      closeDeviceEditor();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "保存设备设置失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const deleteCurrentDevice = async () => {
    if (!editingDevice || !window.confirm(`确认删除设备“${deviceName(editingDevice)}”的配置吗？`)) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      await deleteJSON(`/rest/config/devices/${encodeURIComponent(editingDevice.deviceID)}`);
      closeDeviceEditor();
      await loadBootstrap();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "删除设备配置失败");
    } finally {
      setDeviceSaveBusy(false);
    }
  };

  const createFolder = async () => {
    setNewFolderBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<FolderConfig>("/rest/config/defaults/folder");
      const nextFolder: FolderConfig = {
        ...cloneJSON(defaults),
        id: `folder-${Date.now()}`,
        label: "新文件夹",
        path: "",
        devices: [],
        type: "sendreceive",
      };
      setFolderDraft(nextFolder);
      setFolderEditorOpen(true);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开新文件夹表单失败");
    } finally {
      setNewFolderBusy(false);
    }
  };

  const createDevice = async () => {
    setNewDeviceBusy(true);
    setOptionsSaveMessage("");
    try {
      const defaults = await getJSON<DeviceConfig>("/rest/config/defaults/device");
      const nextDevice: DeviceConfig = {
        ...cloneJSON(defaults),
        deviceID: "",
        name: "新设备",
        addresses: defaults.addresses?.length ? defaults.addresses : ["dynamic"],
      };
      setDeviceEditorId("__new__");
      setDeviceDraft(nextDevice);
      setSettingsModalOpen(false);
    } catch (error) {
      setOptionsSaveMessage(error instanceof Error ? error.message : "打开新设备表单失败");
    } finally {
      setNewDeviceBusy(false);
    }
  };

  const saveNewFolder = async () => {
    if (!folderDraft) {
      return;
    }
    setFolderSaveBusy(true);
    setFolderSaveMessage("");
    try {
      const payload = cloneJSON(folderDraft);
      if (!canReceive(payload)) {
        payload.manualSync = false;
      }
      if (!canPublish(payload)) {
        payload.manualPublish = false;
      }
      await postJSON("/rest/config/folders", payload);
      await loadBootstrap();
      setSelectedFolderId(payload.id);
      closeFolderEditor();
    } catch (error) {
      setFolderSaveMessage(error instanceof Error ? error.message : "创建文件夹失败");
    } finally {
      setFolderSaveBusy(false);
    }
  };

  const saveNewDevice = async () => {
    if (!deviceDraft) {
      return;
    }
    setDeviceSaveBusy(true);
    setDeviceSaveMessage("");
    try {
      const payload = cloneJSON(deviceDraft);
      payload.addresses = (payload.addresses ?? []).filter((value) => value.trim().length > 0);
      payload.allowedNetworks = (payload.allowedNetworks ?? []).filter((value) => value.trim().length > 0);
      await postJSON("/rest/config/devices", payload);
      await loadBootstrap();
      closeDeviceEditor();
    } catch (error) {
      setDeviceSaveMessage(error instanceof Error ? error.message : "创建设备失败");
    } finally {
      setDeviceSaveBusy(false);
    }
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

  const rescanFolder = async (folder: FolderConfig) => {
    setOverviewMessage(`正在请求重新扫描“${folderLabel(folder)}”...`);
    try {
      await postJSON(`/rest/db/scan?folder=${encodeURIComponent(folder.id)}`);
      setOverviewMessage(`已提交“${folderLabel(folder)}”的重新扫描请求。`);
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
          <div className="eyebrow">Syncthing Workspace</div>
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

  const localDeviceId = system?.myID;
  const remoteDevices = allDevices.filter((device) => device.deviceID !== localDeviceId);

  const localDeviceExpanded = Boolean(expandedFolders["device-local"]);

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="brand-block">
          <div className="eyebrow">Syncthing</div>
          <h1>{window.metadata?.deviceIDShort ?? "设备"}</h1>
        </div>

        <section className="local-device-section">
          <div className="section-title">本机设备</div>
          <div className="device-card local">
            <div className="device-card-main">
              <button
                className="device-card-info"
                onClick={() => setExpandedFolders((prev) => ({ ...prev, "device-local": !prev["device-local"] }))}
              >
                <strong>{window.metadata?.deviceIDShort ?? "本机"}</strong>
                <span className="badge tone-success">在线</span>
              </button>
              <div className="device-card-actions">
                <button
                  className="mini-button"
                  onClick={() => setExpandedFolders((prev) => ({ ...prev, "device-local": !prev["device-local"] }))}
                  title="展开详情"
                >
                  {localDeviceExpanded ? "▾" : "▸"}
                </button>
              </div>
            </div>
            {!localDeviceExpanded && (
              <div className="device-meta">
                版本：{version?.version ?? "-"}
              </div>
            )}
            {localDeviceExpanded && (
              <div className="device-detail">
                <div className="device-detail-row">
                  <span className="detail-label">设备 ID</span>
                  <span className="detail-value">{localDeviceId?.slice(0, 20) ?? "-"}...</span>
                </div>
                <div className="device-detail-row">
                  <span className="detail-label">版本</span>
                  <span className="detail-value">{version?.version ?? "-"}</span>
                </div>
                <div className="device-detail-row">
                  <span className="detail-label">GUI 地址</span>
                  <span className="detail-value">{system?.guiAddressUsed ?? "-"}</span>
                </div>
                <div className="device-detail-row">
                  <span className="detail-label">运行时间</span>
                  <span className="detail-value">{system?.uptime ? `${Math.floor(system.uptime / 3600)}h ${Math.floor((system.uptime % 3600) / 60)}m` : "-"}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="device-list">
          <div className="section-title">远端设备</div>
          {remoteDevices.length === 0 ? (
            <div className="empty-mini">当前还没有已配置的远端设备。</div>
          ) : (
            remoteDevices.map((device) => {
              const connection = connections?.connections[device.deviceID];
              const relatedFolderCompletion = folders
                .map((folder) => completions[device.deviceID]?.[folder.id])
                .find((value) => Boolean(value));
              const badgeTone = connectionBadgeTone(Boolean(connection?.connected), relatedFolderCompletion?.remoteState);
              const badgeLabel = connectionBadgeLabel(Boolean(connection?.connected), relatedFolderCompletion?.remoteState);
              const expanded = Boolean(expandedFolders[`device-${device.deviceID}`]);
              return (
                <div key={device.deviceID} className="device-card">
                  <div className="device-card-main">
                    <button
                      className="device-card-info"
                      onClick={() => setExpandedFolders((prev) => ({ ...prev, [`device-${device.deviceID}`]: !prev[`device-${device.deviceID}`] }))}
                    >
                      <strong>{deviceName(device)}</strong>
                      <span className={`badge tone-${badgeTone}`}>{badgeLabel}</span>
                    </button>
                    <div className="device-card-actions">
                      <button className="mini-button" onClick={() => openDeviceEditor(device)} title="设备设置">✎</button>
                      <button
                        className="mini-button"
                        onClick={() => setExpandedFolders((prev) => ({ ...prev, [`device-${device.deviceID}`]: !prev[`device-${device.deviceID}`] }))}
                        title="展开详情"
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                    </div>
                  </div>
                  {!expanded && (
                    <div className="device-meta">
                      完成度：{relatedFolderCompletion?.completion ?? 0}% · 待同步：{relatedFolderCompletion?.needItems ?? 0} 项
                    </div>
                  )}
                  {expanded && (
                    <div className="device-detail">
                      <div className="device-detail-row">
                        <span className="detail-label">设备 ID</span>
                        <span className="detail-value">{device.deviceID.slice(0, 20)}...</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">连接类型</span>
                        <span className="detail-value">{connection?.type || "未连接"}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">地址</span>
                        <span className="detail-value">{connection?.address || "未知"}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">下行速率</span>
                        <span className="detail-value">{formatRate(connection?.inbps)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">上行速率</span>
                        <span className="detail-value">{formatRate(connection?.outbps)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">远端状态</span>
                        <span className="detail-value">{remoteStateLabel(relatedFolderCompletion?.remoteState)}</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">完成度</span>
                        <span className="detail-value">{relatedFolderCompletion?.completion ?? 0}%</span>
                      </div>
                      <div className="device-detail-row">
                        <span className="detail-label">待同步</span>
                        <span className="detail-value">{relatedFolderCompletion?.needItems ?? 0} 项 / {formatBinary(relatedFolderCompletion?.needBytes)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <section className="folder-list">
          <div className="section-title">文件夹</div>
          <div className="folder-table">
            <div className="folder-table-header">
              <span className="folder-col-name">名称</span>
              <span className="folder-col-status">状态</span>
              <span className="folder-col-sync">待同步</span>
              <span className="folder-col-error">错误</span>
            </div>
            {folders.map((folder) => {
              const status = folderStatuses[folder.id];
              const active = folder.id === selectedFolderId;
              return (
                <button
                  key={folder.id}
                  className={`folder-table-row${active ? " active" : ""}`}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <span className="folder-col-name">{folderLabel(folder)}</span>
                  <span className={`folder-col-status badge tone-${folderStateTone(status)}`}>
                    {status?.state ?? folder.type}
                  </span>
                  <span className="folder-col-sync">{status?.needTotalItems ?? 0}</span>
                  <span className={`folder-col-error${(status?.errors ?? 0) > 0 ? " has-error" : ""}`}>
                    {status?.errors ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-row">
            <span>页面刷新</span>
            <select value={mainRefreshSeconds} onChange={(event) => applyRefreshSettings(Number(event.target.value), panelRefreshSeconds)}>
              {refreshChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} 秒
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span>审核刷新</span>
            <select value={panelRefreshSeconds} onChange={(event) => applyRefreshSettings(mainRefreshSeconds, Number(event.target.value))}>
              {refreshChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} 秒
                </option>
              ))}
            </select>
          </div>
          <button className="ghost-button" onClick={() => void loadBootstrap()} disabled={bootBusy} style={{ width: "100%" }}>
            {bootBusy ? "正在刷新..." : "立即刷新"}
          </button>
        </section>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          <div>
            <div className="eyebrow">当前设备</div>
            <h2>{window.metadata?.deviceIDShort ?? "Syncthing"}</h2>
          </div>
          <div className="topbar-actions">
            <button className={`tab-button${viewMode === "overview" ? " active" : ""}`} onClick={() => setViewMode("overview")}>
              概览
            </button>
            <button
              className="tab-button"
              onClick={() => setReceiveModalOpen(true)}
              disabled={!selectedFolder || !canReceive(selectedFolder)}
            >
              接收审核
            </button>
            <button
              className="tab-button"
              onClick={() => setPublishModalOpen(true)}
              disabled={!selectedFolder || !canPublish(selectedFolder)}
            >
              发布审核
            </button>
            <button className="ghost-button" onClick={() => setSettingsModalOpen(true)}>
              设置
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
            <p>当前不是“没有文件夹”，而是前端还没拿到配置或状态数据。你可以先点刷新再试一次。</p>
            <div className="inline-message danger">{bootError}</div>
            <div className="panel-actions">
              <button className="ghost-button" onClick={() => void loadBootstrap()} disabled={bootBusy}>
                {bootBusy ? "正在刷新..." : "重新加载"}
              </button>
            </div>
          </section>
        ) : !selectedFolder ? (
          <section className="panel surface">
            <h3>没有可用文件夹</h3>
            <p>当前配置里没有共享文件夹。React 工作台目前围绕文件夹差异、接收审核和发布审核展开，所以需要至少一个已配置文件夹。</p>
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
                onOpenPublish={(folder) => {
                  setSelectedFolderId(folder.id);
                  setPublishModalOpen(true);
                }}
                onEditFolder={(folder) => {
                  setSelectedFolderId(folder.id);
                  setFolderDraft(cloneJSON(folder));
                  setFolderSaveMessage("");
                  setFolderEditorOpen(true);
                }}
                onEditDevice={openDeviceEditor}
                onRescan={(folder) => void rescanFolder(folder)}
                localDeviceId={system?.myID}
              />
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
              setFolderDraft(cloneJSON(folder));
              setFolderSaveMessage("");
              setFolderEditorOpen(true);
              setSettingsModalOpen(false);
            }}
            onRestart={() => void restartSyncthing()}
            onShutdown={() => void shutdownSyncthing()}
            systemActionBusy={systemActionBusy}
            systemActionMessage={systemActionMessage}
          />
        </ModalShell>
      )}

      {folderEditorOpen && folderDraft && (
        <ModalShell title={editingNewFolder ? "新建文件夹" : "编辑文件夹"} onClose={closeFolderEditor}>
          <FolderSettingsPanel
            draft={folderDraft}
            allDevices={allDevices}
            onChange={setFolderDraft}
            onClose={closeFolderEditor}
            onSave={() => void (editingExistingFolder ? saveFolderDraft() : saveNewFolder())}
            busy={folderSaveBusy}
            message={folderSaveMessage}
            isNew={editingNewFolder}
            onDelete={editingExistingFolder ? () => void deleteCurrentFolder() : undefined}
          />
        </ModalShell>
      )}

      {deviceDraft && (editingExistingDevice || editingNewDevice) && (
        <ModalShell title={editingNewDevice ? "新建设备" : "编辑设备"} onClose={closeDeviceEditor}>
          <DeviceSettingsPanel
            draft={deviceDraft}
            onChange={setDeviceDraft}
            onClose={closeDeviceEditor}
            onSave={() => void (editingExistingDevice ? saveDeviceDraft() : saveNewDevice())}
            busy={deviceSaveBusy}
            message={deviceSaveMessage}
            isNew={editingNewDevice}
            onDelete={editingExistingDevice ? () => void deleteCurrentDevice() : undefined}
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
            onRefresh={() => void loadCompare()}
            onSyncSelected={() =>
              void syncEntries((compare?.entries ?? []).filter((entry) => compareSelection[entry.path] && entry.canPrioritize))
            }
            onSyncVisible={() => void syncEntries(compareVisibleEntries)}
            remoteCompletion={selectedDeviceId ? completions[selectedDeviceId]?.[selectedFolder.id] : undefined}
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
            onRefresh={() => void loadPublish()}
            onPublishSelected={() =>
              void publishEntries((publish?.entries ?? []).filter((entry) => publishSelection[entry.path] && entry.canPublish))
            }
            onPublishVisible={() => void publishEntries(publishVisibleEntries)}
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

function StatusCard(props: { title: string; value: string; subtitle: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className={`status-card${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="status-title">{props.title}</div>
      <div className="status-value">{props.value}</div>
      <div className="status-subtitle">{props.subtitle}</div>
    </div>
  );
}

function OverviewPanel(props: {
  folders: FolderConfig[];
  selectedFolderId: string;
  folderStatuses: Record<string, FolderStatus>;
  devicesById: Map<string, DeviceConfig>;
  completions: Record<string, Record<string, CompletionStatus>>;
  connections: ConnectionsResponse | null;
  overviewMessage: string;
  expandedFolders: Record<string, boolean>;
  localDeviceId?: string;
  onToggleExpand: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onOpenReceive: (folder: FolderConfig) => void;
  onOpenPublish: (folder: FolderConfig) => void;
  onEditFolder: (folder: FolderConfig) => void;
  onEditDevice: (device: DeviceConfig) => void;
  onRescan: (folder: FolderConfig) => void;
}) {
  const [ovColumns, setOvColumns] = useState([
    { key: "name", label: "文件夹", width: 140, minWidth: 80 },
    { key: "type", label: "类型", width: 70, minWidth: 50 },
    { key: "status", label: "状态", width: 60, minWidth: 50 },
    { key: "receive", label: "接收", width: 70, minWidth: 50 },
    { key: "publish", label: "发布", width: 70, minWidth: 50 },
    { key: "local", label: "本地", width: 100, minWidth: 70 },
    { key: "global", label: "全局", width: 100, minWidth: 70 },
    { key: "need", label: "待同步", width: 55, minWidth: 40 },
    { key: "error", label: "错误", width: 45, minWidth: 35 },
    { key: "devices", label: "远端设备", width: 90, minWidth: 60 },
    { key: "actions", label: "操作", width: 130, minWidth: 100 },
  ]);

  const handleOvResize = (colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = ovColumns[colIndex].width;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(ovColumns[colIndex].minWidth ?? 40, startWidth + delta);
      const newColumns = [...ovColumns];
      newColumns[colIndex] = { ...newColumns[colIndex], width: newWidth };
      setOvColumns(newColumns);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const gridTemplate = ovColumns.map((col) => `${col.width}px`).join(" ");

  return (
    <section className="panel surface compact-overview-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">文件夹概览</div>
          <h3>文件夹工作台</h3>
        </div>
      </div>
      {props.overviewMessage && <div className="inline-message info">{props.overviewMessage}</div>}

      <div className="overview-table-wrapper">
        <div className="overview-table" style={{ gridTemplateColumns: gridTemplate }}>
          {ovColumns.map((col) => (
            <div key={col.key} className="overview-table-header-cell">
              {col.label}
              <div
                className="ov-resize-handle"
                onMouseDown={(e) => handleOvResize(ovColumns.findIndex((c) => c.key === col.key), e)}
              />
            </div>
          ))}
        </div>

        {props.folders.map((folder) => {
          const status = props.folderStatuses[folder.id];
          const devices = folder.devices
            .map((folderDevice) => props.devicesById.get(folderDevice.deviceID))
            .filter((device): device is DeviceConfig => Boolean(device) && device.deviceID !== props.localDeviceId);
          const expanded = Boolean(props.expandedFolders[folder.id]);
          const active = props.selectedFolderId === folder.id;
          const receiveCapable = canReceive(folder);
          const publishCapable = canPublish(folder);
          const remoteDeviceNames = devices.slice(0, 2).map((d) => deviceName(d)).join(", ");
          const extraCount = devices.length - 2;

          return (
            <div key={folder.id} className="overview-table-group">
              <div
                className={`overview-table-row${active ? " active" : ""}`}
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="ov-cell ov-cell-name">
                  <button className="ov-name-button" onClick={() => props.onSelectFolder(folder.id)}>
                    {folderLabel(folder)}
                  </button>
                </div>
                <div className="ov-cell">
                  <span className="badge badge-sm tone-info">{folderTypeLabel(folder.type)}</span>
                </div>
                <div className="ov-cell">
                  <span className={`badge badge-sm tone-${folderStateTone(status)}`}>{status?.state ?? "未知"}</span>
                </div>
                <div className="ov-cell">
                  <span className={`badge badge-sm ${folder.manualSync ? "tone-warning" : "tone-success"}`}>
                    {folder.manualSync ? "手动" : "自动"}
                  </span>
                </div>
                <div className="ov-cell">
                  <span className={`badge badge-sm ${folder.manualPublish ? "tone-warning" : "tone-success"}`}>
                    {folder.manualPublish ? "手动" : "自动"}
                  </span>
                </div>
                <div className="ov-cell ov-cell-num">
                  {status?.localFiles ?? 0} / {formatBinary(status?.localBytes)}
                </div>
                <div className="ov-cell ov-cell-num">
                  {status?.globalFiles ?? 0} / {formatBinary(status?.globalBytes)}
                </div>
                <div className={`ov-cell ov-cell-num${(status?.needTotalItems ?? 0) > 0 ? " has-need" : ""}`}>
                  {status?.needTotalItems ?? 0}
                </div>
                <div className={`ov-cell ov-cell-num${(status?.errors ?? 0) > 0 ? " has-error" : ""}`}>
                  {status?.errors ?? 0}
                </div>
                <div className="ov-cell ov-cell-devices">
                  {devices.length === 0 ? (
                    <span className="muted">无</span>
                  ) : (
                    <span title={devices.map((d) => deviceName(d)).join(", ")}>
                      {remoteDeviceNames}{extraCount > 0 ? ` +${extraCount}` : ""}
                    </span>
                  )}
                </div>
                <div className="ov-cell ov-cell-actions">
                  <button className="mini-button" onClick={() => props.onRescan(folder)} title="刷新状态">↻</button>
                  <button className="mini-button" onClick={() => props.onEditFolder(folder)} title="编辑设置">✎</button>
                  <button
                    className="mini-button primary"
                    onClick={() => props.onOpenReceive(folder)}
                    disabled={!receiveCapable}
                    title="接收审核"
                  >
                    接收
                  </button>
                  <button
                    className="mini-button"
                    onClick={() => props.onOpenPublish(folder)}
                    disabled={!publishCapable}
                    title="发布审核"
                  >
                    发布
                  </button>
                  <button className="mini-button" onClick={() => props.onToggleExpand(folder.id)} title="展开详情">
                    {expanded ? "▾" : "▸"}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="overview-detail">
                  <div className="overview-detail-grid">
                    <div className="overview-detail-row">
                      <span className="detail-label">路径</span>
                      <span className="detail-value">{folder.path}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">接收模式</span>
                      <span className="detail-value">{receiveModeLabel(folder)}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">发布模式</span>
                      <span className="detail-value">{publishModeLabel(folder)}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">重扫间隔</span>
                      <span className="detail-value">{folder.rescanIntervalS ? `${folder.rescanIntervalS} 秒` : "未设置"}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">本地文件/目录</span>
                      <span className="detail-value">{status?.localFiles ?? 0} / {status?.localDirectories ?? 0}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">全局文件/目录</span>
                      <span className="detail-value">{status?.globalFiles ?? 0} / {status?.globalDirectories ?? 0}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">未同步体积</span>
                      <span className="detail-value">{formatBinary(status?.needBytes)}</span>
                    </div>
                    <div className="overview-detail-row">
                      <span className="detail-label">共享设备</span>
                      <span className="detail-value">{devices.length} 台</span>
                    </div>
                  </div>

                  {devices.length > 0 && (
                    <div className="overview-device-list">
                      <div className="detail-label" style={{ marginBottom: 4 }}>共享设备详情</div>
                      <table className="device-status-table">
                        <thead>
                          <tr>
                            <th>设备</th>
                            <th>状态</th>
                            <th>完成度</th>
                            <th>待同步</th>
                            <th>连接</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devices.map((device) => {
                            const connection = props.connections?.connections[device.deviceID];
                            const completion = props.completions[device.deviceID]?.[folder.id];
                            const badgeTone = connectionBadgeTone(Boolean(connection?.connected), completion?.remoteState);
                            const badgeLabel = connectionBadgeLabel(Boolean(connection?.connected), completion?.remoteState);
                            return (
                              <tr key={device.deviceID}>
                                <td>
                                  <button className="link-button" onClick={() => props.onEditDevice(device)}>
                                    {deviceName(device)}
                                  </button>
                                </td>
                                <td><span className={`badge badge-sm tone-${badgeTone}`}>{badgeLabel}</span></td>
                                <td>{completion?.completion ?? 0}%</td>
                                <td>{completion?.needItems ?? 0} 项</td>
                                <td>{connection?.type || "-"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReceiveReviewPanel(props: {
  folder: FolderConfig;
  devices: DeviceConfig[];
  selectedDeviceId: string;
  onSelectDevice: (value: string) => void;
  selectedDevice: DeviceConfig | null;
  compare: CompareResult | null;
  compareBusy: boolean;
  compareError: string;
  compareView: string;
  onCompareViewChange: (value: string) => void;
  comparePrefix: string;
  onComparePrefixChange: (value: string) => void;
  compareSelection: Record<string, boolean>;
  onCompareSelectionChange: (value: Record<string, boolean>) => void;
  compareMessage: string;
  onRefresh: () => void;
  onSyncSelected: () => void;
  onSyncVisible: () => void;
  remoteCompletion?: CompletionStatus;
}) {
  const entries = props.compare?.entries ?? [];
  const selectedCount = entries.filter((entry) => props.compareSelection[entry.path] && entry.canPrioritize).length;
  const [columns, setColumns] = useState<ColumnDef[]>([
    { key: "checkbox", label: "", width: 40, minWidth: 40 },
    { key: "summary", label: "差异 / 路径", width: 360, minWidth: 220 },
    { key: "local", label: "当前设备", width: 290, minWidth: 180 },
    { key: "remote", label: "目标设备", width: 290, minWidth: 180 },
  ]);
  if (props.devices.length === 0) {
    return (
      <div className="review-modal-layout">
        <div className="review-modal-main">
          <div className="empty-mini">这个文件夹当前没有共享设备，所以没有可对比的远端索引。</div>
        </div>
      </div>
    );
  }
  return (
    <div className="review-modal-layout">
      <div className="review-modal-main">
        <div className="review-toolbar">
          <label>
            <span>查看范围</span>
            <select value={props.compareView} onChange={(event) => props.onCompareViewChange(event.target.value)}>
              {compareViewOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-grow">
            <span>路径前缀</span>
            <input value={props.comparePrefix} onChange={(event) => props.onComparePrefixChange(event.target.value)} placeholder="目录 / 子目录" />
          </label>
        </div>

        <div className="review-stats">
          <span className={`badge tone-${props.compare?.remoteConnected ? "success" : "warning"}`}>{props.compare?.remoteConnected ? "已连接" : "离线"}</span>
          <span>目标设备：{deviceName(props.selectedDevice ?? undefined)}</span>
          <span>远端状态：{remoteStateLabel(props.remoteCompletion?.remoteState)}</span>
          <span>共 {props.compare?.total ?? 0} 项</span>
          <span>可操作 {entries.filter((entry) => entry.canPrioritize).length} 项</span>
          <span>已选 {selectedCount} 项</span>
        </div>

        {props.compareMessage && <div className="inline-message info">{props.compareMessage}</div>}
        {props.compareError && <div className="inline-message danger">{props.compareError}</div>}

        <ResizableTable columns={columns} onColumnsChange={setColumns}>
          <thead>
            <tr>{renderResizableHeaders(columns, setColumns)}</tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const selected = Boolean(props.compareSelection[entry.path]);
              return (
                <tr
                  key={entry.path}
                  className={`tone-${statusTone(entry.status)}${selected ? " selected" : ""}`}
                >
                  <td>
                    <input
                      type="checkbox"
                      className="compare-checkbox"
                      checked={selected}
                      disabled={!entry.canPrioritize}
                      onChange={(event) =>
                        props.onCompareSelectionChange({
                          ...props.compareSelection,
                          [entry.path]: event.target.checked,
                        })
                      }
                    />
                  </td>
                  <td>
                    <div className="compare-status-cell compare-status-stack">
                      <span className={`badge tone-${statusTone(entry.status)}`}>
                        {compareStatusLabel(entry)}
                      </span>
                      <div className="compare-path compare-main-path">{entry.path}</div>
                      {entry.renameCandidate && (
                        <div className="helper-line">
                          {compareRenameRole(entry) === "new"
                            ? `新路径；旧路径：${entry.renameCandidate}`
                            : `旧路径；新路径：${entry.renameCandidate}`}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <FileVersionCell
                      file={entry.local}
                      missingLabel="不存在"
                      tone={compareSideTone(entry, "local")}
                    />
                  </td>
                  <td>
                    <FileVersionCell
                      file={entry.remote}
                      missingLabel="不存在"
                      tone={compareSideTone(entry, "remote")}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResizableTable>

        {entries.length === 0 && !props.compareBusy && (
          <div className="compare-empty">当前筛选条件下没有差异项。</div>
        )}
      </div>

      <div className="review-modal-sidebar">
        <div className="review-sidebar-card">
          <div className="section-title">目标设备</div>
          <select value={props.selectedDeviceId} onChange={(event) => props.onSelectDevice(event.target.value)} style={{ width: "100%", marginTop: 6 }}>
            {props.devices.map((device) => (
              <option key={device.deviceID} value={device.deviceID}>
                {deviceName(device)}
              </option>
            ))}
          </select>
          <div className="review-target-status">
            <span className={`badge tone-${props.compare?.remoteConnected ? "success" : "warning"}`}>
              {props.compare?.remoteConnected ? "已连接" : "离线"}
            </span>
            <span className={`badge tone-${props.remoteCompletion?.remoteState === "syncing" ? "warning" : "muted"}`}>
              {remoteStateLabel(props.remoteCompletion?.remoteState)}
            </span>
            <span className="helper-line">完成度 {props.remoteCompletion?.completion ?? 0}% · 待同步 {props.remoteCompletion?.needItems ?? 0} 项</span>
            <ProgressBar
              percent={completionPercent(props.remoteCompletion)}
              tone={props.compare?.remoteConnected ? "success" : "muted"}
              label="接收进度"
            />
          </div>
        </div>

        <div className="review-sidebar-card">
          <div className="section-title">同步模式</div>
          <span className="badge tone-info" style={{ marginTop: 6 }}>{props.compare?.manualSync ? "手动审核接收" : "自动接收"}</span>
        </div>

        <div className="review-sidebar-card">
          <div className="section-title">索引状态</div>
          <span className="badge tone-muted" style={{ marginTop: 6 }}>{props.compare?.remoteConnected ? "实时" : "最近已知"}</span>
        </div>

        <div className="review-actions">
          <button className="ghost-button" onClick={props.onRefresh} disabled={props.compareBusy} style={{ width: "100%" }}>
            {props.compareBusy ? "刷新中..." : "刷新"}
          </button>
          <button
            className="ghost-button"
            onClick={props.onSyncVisible}
            disabled={!entries.some((entry) => entry.canPrioritize)}
            style={{ width: "100%" }}
          >
            {props.compare?.manualSync ? "同步当前结果" : "优先处理当前结果"}
          </button>
          <button
            className="primary-button"
            onClick={props.onSyncSelected}
            disabled={selectedCount === 0}
            style={{ width: "100%" }}
          >
            {props.compare?.manualSync ? "同步已选条目" : "优先处理已选条目"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PublishReviewPanel(props: {
  folder: FolderConfig;
  publish: PendingPublishResult | null;
  publishBusy: boolean;
  publishError: string;
  publishView: string;
  onPublishViewChange: (value: string) => void;
  publishPrefix: string;
  onPublishPrefixChange: (value: string) => void;
  publishSelection: Record<string, boolean>;
  onPublishSelectionChange: (value: Record<string, boolean>) => void;
  publishMessage: string;
  onRefresh: () => void;
  onPublishSelected: () => void;
  onPublishVisible: () => void;
  devices: DeviceConfig[];
  devicesById: Map<string, DeviceConfig>;
  completions: Record<string, Record<string, CompletionStatus>>;
  connections: ConnectionsResponse | null;
}) {
  const entries = props.publish?.entries ?? [];
  const selectedCount = entries.filter((entry) => props.publishSelection[entry.path] && entry.canPublish).length;
  const [columns, setColumns] = useState<ColumnDef[]>([
    { key: "checkbox", label: "", width: 40, minWidth: 40 },
    { key: "summary", label: "发布变化 / 路径", width: 360, minWidth: 220 },
    { key: "local", label: "当前待发布版本", width: 290, minWidth: 180 },
    { key: "global", label: "当前对外可见版本", width: 290, minWidth: 180 },
  ]);
  return (
    <div className="review-modal-layout">
      <div className="review-modal-main">
        <div className="review-toolbar">
          <label>
            <span>查看范围</span>
            <select value={props.publishView} onChange={(event) => props.onPublishViewChange(event.target.value)}>
              {publishViewOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-grow">
            <span>路径前缀</span>
            <input value={props.publishPrefix} onChange={(event) => props.onPublishPrefixChange(event.target.value)} placeholder="目录 / 子目录" />
          </label>
        </div>

        <div className="review-stats">
          <span className="badge tone-info">{props.publish?.manualPublish ? "手动审核发布" : "自动发布"}</span>
          <span>共享设备：{props.devices.length}</span>
          <span>共 {props.publish?.total ?? 0} 项</span>
          <span>可发布 {entries.filter((entry) => entry.canPublish).length} 项</span>
          <span>已选 {selectedCount} 项</span>
        </div>

        {props.publishMessage && <div className="inline-message info">{props.publishMessage}</div>}
        {props.publishError && <div className="inline-message danger">{props.publishError}</div>}

        <ResizableTable columns={columns} onColumnsChange={setColumns}>
          <thead>
            <tr>{renderResizableHeaders(columns, setColumns)}</tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const selected = Boolean(props.publishSelection[entry.path]);
              const tone = entry.renameCandidate ? "info" : entry.action === "delete" ? "muted" : entry.action === "added" ? "success" : "warning";
              return (
                <tr
                  key={entry.path}
                  className={`tone-${tone}${selected ? " selected" : ""}`}
                >
                  <td>
                    <input
                      type="checkbox"
                      className="compare-checkbox"
                      checked={selected}
                      disabled={!entry.canPublish}
                      onChange={(event) =>
                        props.onPublishSelectionChange({
                          ...props.publishSelection,
                          [entry.path]: event.target.checked,
                        })
                      }
                    />
                  </td>
                  <td>
                    <div className="compare-status-cell compare-status-stack">
                      <span className={`badge tone-${tone}`}>{pendingPublishLabel(entry)}</span>
                      <div className="compare-path compare-main-path">{entry.path}</div>
                      {entry.renameCandidate && (
                        <div className="helper-line">
                          {pendingRenameRole(entry) === "new"
                            ? `新路径；旧路径：${entry.renameCandidate}`
                            : `旧路径；新路径：${entry.renameCandidate}`}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <FileVersionCell file={entry.local} missingLabel="不存在" tone={tone} />
                  </td>
                  <td>
                    <FileVersionCell file={entry.global} missingLabel="尚未对外可见" tone={tone} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResizableTable>

        {entries.length === 0 && !props.publishBusy && (
          <div className="compare-empty">当前筛选条件下没有待发布项。</div>
        )}
      </div>

      <div className="review-modal-sidebar">
        <div>
          <div className="section-title">共享设备</div>
          <div className="device-stack" style={{ marginTop: 6, gap: 8 }}>
            {props.devices.map((device) => {
              const completion = props.completions[device.deviceID]?.[props.folder.id];
              const connected = Boolean(props.connections?.connections[device.deviceID]?.connected);
              return (
                <div key={device.deviceID} className="device-mini-card">
                  <div className="device-card-top">
                    <strong>{deviceName(props.devicesById.get(device.deviceID))}</strong>
                    <span className={`badge tone-${connected ? "success" : "muted"}`}>{connected ? "已连接" : "离线"}</span>
                  </div>
                  <div className="device-meta">
                    状态：{remoteStateLabel(completion?.remoteState)} · {completion?.completion ?? 0}%
                  </div>
                  <ProgressBar percent={completionPercent(completion)} tone={connected ? "success" : "muted"} />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="section-title">发布模式</div>
          <span className="badge tone-info" style={{ marginTop: 6 }}>
            {props.publish?.manualPublish ? "手动审核发布" : "自动发布"}
          </span>
        </div>

        <div className="review-actions">
          <button className="ghost-button" onClick={props.onRefresh} disabled={props.publishBusy} style={{ width: "100%" }}>
            {props.publishBusy ? "刷新中..." : "刷新"}
          </button>
          <button
            className="ghost-button"
            onClick={props.onPublishVisible}
            disabled={!entries.some((entry) => entry.canPublish)}
            style={{ width: "100%" }}
          >
            发布当前结果
          </button>
          <button
            className="primary-button"
            onClick={props.onPublishSelected}
            disabled={selectedCount === 0}
            style={{ width: "100%" }}
          >
            发布已选条目
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalShell(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section className="modal-shell surface" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">React Workspace</div>
            <h3>{props.title}</h3>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <div className="modal-content">{props.children}</div>
      </section>
    </div>
  );
}

function SettingsHubPanel(props: {
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
}) {
  const options = props.optionsDraft;
  const update = (patch: Partial<OptionsConfig>) => props.onOptionsChange({ ...(options ?? {}), ...patch });

  return (
    <section className="settings-modal-stack">
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
                <span>自动升级间隔（小时）</span>
                <input
                  type="number"
                  min={0}
                  value={options.autoUpgradeIntervalH ?? 0}
                  onChange={(event) => update({ autoUpgradeIntervalH: Number(event.target.value) || 0 })}
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
            </div>
          </>
        ) : (
          <div className="empty-mini">正在读取全局设置。</div>
        )}
      </div>

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
        <div className="device-meta">“登出”只会退出 Web GUI；这里的“完全关闭 Syncthing”会退出后端程序并停止同步。</div>
        {props.systemActionMessage && <div className="inline-message info">{props.systemActionMessage}</div>}
      </div>
    </section>
  );
}

function FolderSettingsPanel(props: {
  draft: FolderConfig;
  allDevices: DeviceConfig[];
  onChange: (value: FolderConfig) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  isNew: boolean;
  onDelete?: () => void;
}) {
  const draft = props.draft;
  const update = (patch: Partial<FolderConfig>) => props.onChange({ ...draft, ...patch });
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

      <div className="settings-grid">
        <label>
          <span>文件夹名称</span>
          <input value={draft.label ?? ""} onChange={(event) => update({ label: event.target.value })} />
        </label>
        <label>
          <span>文件夹 ID</span>
          <input value={draft.id} disabled={!props.isNew} onChange={(event) => update({ id: event.target.value })} />
        </label>
        <label className="wide-field">
          <span>本地路径</span>
          <input value={draft.path} onChange={(event) => update({ path: event.target.value })} />
        </label>
        <label>
          <span>文件夹类型</span>
          <select value={draft.type} onChange={(event) => update({ type: event.target.value })}>
            <option value="sendreceive">双向同步</option>
            <option value="sendonly">仅发送</option>
            <option value="receiveonly">仅接收</option>
            <option value="receiveencrypted">加密接收</option>
          </select>
        </label>
        <label>
          <span>重扫间隔（秒）</span>
          <input
            type="number"
            min={0}
            value={draft.rescanIntervalS ?? 0}
            onChange={(event) => update({ rescanIntervalS: Number(event.target.value) || 0 })}
          />
        </label>
        <label>
          <span>拉取顺序</span>
          <select value={draft.order ?? "random"} onChange={(event) => update({ order: event.target.value })}>
            <option value="random">随机</option>
            <option value="alphabetic">按字母</option>
            <option value="smallestFirst">小文件优先</option>
            <option value="largestFirst">大文件优先</option>
            <option value="oldestFirst">旧文件优先</option>
            <option value="newestFirst">新文件优先</option>
          </select>
        </label>
      </div>

      <div className="toggle-grid">
        <label className="toggle-card">
          <input type="checkbox" checked={Boolean(draft.paused)} onChange={(event) => update({ paused: event.target.checked })} />
          <span>暂停此文件夹</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.fsWatcherEnabled)}
            onChange={(event) => update({ fsWatcherEnabled: event.target.checked })}
          />
          <span>启用文件监视</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.manualSync)}
            disabled={!canReceive(draft)}
            onChange={(event) => update({ manualSync: event.target.checked })}
          />
          <span>手动审核接收</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.manualPublish)}
            disabled={!canPublish(draft)}
            onChange={(event) => update({ manualPublish: event.target.checked })}
          />
          <span>手动审核发布</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.ignorePerms)}
            onChange={(event) => update({ ignorePerms: event.target.checked })}
          />
          <span>忽略权限</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.ignoreDelete)}
            onChange={(event) => update({ ignoreDelete: event.target.checked })}
          />
          <span>忽略删除</span>
        </label>
      </div>

      <div className="panel-subsection">
        <div className="section-title">共享设备</div>
        <div className="share-grid">
          {props.allDevices.length === 0 ? (
            <div className="empty-mini">当前还没有可共享的远端设备。</div>
          ) : (
            props.allDevices.map((device) => {
              const checked = (draft.devices ?? []).some((item) => item.deviceID === device.deviceID);
              return (
                <label key={device.deviceID} className="toggle-card share-card">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => updateDeviceSelection(device.deviceID, event.target.checked)}
                  />
                  <span>{deviceName(device)}</span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function DeviceSettingsPanel(props: {
  draft: DeviceConfig;
  onChange: (value: DeviceConfig) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  message: string;
  isNew: boolean;
  onDelete?: () => void;
}) {
  const draft = props.draft;
  const update = (patch: Partial<DeviceConfig>) => props.onChange({ ...draft, ...patch });
  const addresses = (draft.addresses ?? ["dynamic"]).join("\n");
  const allowedNetworks = (draft.allowedNetworks ?? []).join("\n");

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

      <div className="settings-grid">
        <label>
          <span>设备名称</span>
          <input value={draft.name ?? ""} onChange={(event) => update({ name: event.target.value })} />
        </label>
        <label className="wide-field">
          <span>设备 ID</span>
          <input value={draft.deviceID} disabled={!props.isNew} onChange={(event) => update({ deviceID: event.target.value })} />
        </label>
        <label className="wide-field">
          <span>地址列表（每行一个）</span>
          <textarea
            rows={4}
            value={addresses}
            onChange={(event) =>
              update({
                addresses: event.target.value
                  .split(/\r?\n/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
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
        <label>
          <span>发送限速（KiB/s）</span>
          <input
            type="number"
            min={0}
            value={draft.maxSendKbps ?? 0}
            onChange={(event) => update({ maxSendKbps: Number(event.target.value) || 0 })}
          />
        </label>
        <label>
          <span>接收限速（KiB/s）</span>
          <input
            type="number"
            min={0}
            value={draft.maxRecvKbps ?? 0}
            onChange={(event) => update({ maxRecvKbps: Number(event.target.value) || 0 })}
          />
        </label>
        <label>
          <span>连接数</span>
          <input
            type="number"
            min={0}
            value={draft.numConnections ?? 0}
            onChange={(event) => update({ numConnections: Number(event.target.value) || 0 })}
          />
        </label>
        <label>
          <span>压缩</span>
          <select value={draft.compression ?? "metadata"} onChange={(event) => update({ compression: event.target.value })}>
            <option value="metadata">仅元数据</option>
            <option value="always">始终压缩</option>
            <option value="never">不压缩</option>
          </select>
        </label>
      </div>

      <div className="toggle-grid">
        <label className="toggle-card">
          <input type="checkbox" checked={Boolean(draft.paused)} onChange={(event) => update({ paused: event.target.checked })} />
          <span>暂停此设备</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.introducer)}
            onChange={(event) => update({ introducer: event.target.checked })}
          />
          <span>设为引入者</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.autoAcceptFolders)}
            onChange={(event) => update({ autoAcceptFolders: event.target.checked })}
          />
          <span>自动接受文件夹</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.skipIntroductionRemovals)}
            onChange={(event) => update({ skipIntroductionRemovals: event.target.checked })}
          />
          <span>跳过引入移除</span>
        </label>
        <label className="toggle-card">
          <input
            type="checkbox"
            checked={Boolean(draft.untrusted)}
            onChange={(event) => update({ untrusted: event.target.checked })}
          />
          <span>不受信任设备</span>
        </label>
      </div>
    </section>
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
