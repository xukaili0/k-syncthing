import { useMemo, useState } from "react";
import type { ConfigResponse, DeviceConfig, FolderConfig } from "../../api";

type FolderPerformance = Pick<
  FolderConfig,
  | "hashers"
  | "copiers"
  | "maxConcurrentWrites"
  | "pullerMaxPendingKiB"
  | "fsWatcherEnabled"
  | "rescanIntervalS"
  | "scanProgressIntervalS"
>;

export type PerformancePreset = {
  label: string;
  summary: string;
  options: {
    maxFolderConcurrency: number;
    setLowPriority: boolean;
  };
  folder: Required<FolderPerformance>;
  numConnections: number;
};

export const performancePresets: Record<string, PerformancePreset> = {
  balanced12600k: {
    label: "i5-12600K / 32 GB / SSD 平衡（推荐）",
    summary: "适合你的电脑。提高扫描和本地块复用能力，同时保留足够资源供 Windows 和前台程序使用。",
    options: { maxFolderConcurrency: 2, setLowPriority: false },
    folder: {
      hashers: 6,
      copiers: 4,
      maxConcurrentWrites: 16,
      pullerMaxPendingKiB: 65536,
      fsWatcherEnabled: true,
      rescanIntervalS: 21600,
      scanProgressIntervalS: -1,
    },
    numConnections: 4,
  },
  nvmePerformance: {
    label: "NVMe 高性能",
    summary: "适合高速 NVMe 和专用同步场景。并发更高，可能增加 CPU、磁盘活动和桌面卡顿。",
    options: { maxFolderConcurrency: 3, setLowPriority: false },
    folder: {
      hashers: 8,
      copiers: 4,
      maxConcurrentWrites: 32,
      pullerMaxPendingKiB: 65536,
      fsWatcherEnabled: true,
      rescanIntervalS: 21600,
      scanProgressIntervalS: -1,
    },
    numConnections: 4,
  },
  hddStable: {
    label: "机械硬盘稳定",
    summary: "限制并发以减少磁头寻道和随机 I/O，通常比盲目增加线程更快、更稳定。",
    options: { maxFolderConcurrency: 1, setLowPriority: true },
    folder: {
      hashers: 2,
      copiers: 2,
      maxConcurrentWrites: 8,
      pullerMaxPendingKiB: 32768,
      fsWatcherEnabled: true,
      rescanIntervalS: 21600,
      scanProgressIntervalS: 0,
    },
    numConnections: 3,
  },
  syncthingAuto: {
    label: "Syncthing 自动/默认",
    summary: "尽量恢复自动决策：0 在 hashers、copiers、连接数等字段中表示自动或内置默认值。",
    options: { maxFolderConcurrency: 0, setLowPriority: true },
    folder: {
      hashers: 0,
      copiers: 0,
      maxConcurrentWrites: 16,
      pullerMaxPendingKiB: 0,
      fsWatcherEnabled: true,
      rescanIntervalS: 3600,
      scanProgressIntervalS: 0,
    },
    numConnections: 0,
  },
};

type FolderScope = "all" | "defaults" | string;
type DeviceScope = "all" | "defaults" | string;

const folderKeys: Array<keyof FolderPerformance> = [
  "hashers",
  "copiers",
  "maxConcurrentWrites",
  "pullerMaxPendingKiB",
  "fsWatcherEnabled",
  "rescanIntervalS",
  "scanProgressIntervalS",
];

function cloneConfig(config: ConfigResponse): ConfigResponse {
  return JSON.parse(JSON.stringify(config)) as ConfigResponse;
}

function updateFolderScope(
  config: ConfigResponse,
  scope: FolderScope,
  patch: Partial<FolderPerformance>,
): ConfigResponse {
  const next = cloneConfig(config);
  if (scope === "all") {
    next.folders = next.folders.map((folder) => ({ ...folder, ...patch }));
    next.defaults.folder = { ...next.defaults.folder, ...patch };
  } else if (scope === "defaults") {
    next.defaults.folder = { ...next.defaults.folder, ...patch };
  } else {
    next.folders = next.folders.map((folder) => (folder.id === scope ? { ...folder, ...patch } : folder));
  }
  return next;
}

function updateDeviceScope(config: ConfigResponse, scope: DeviceScope, numConnections: number): ConfigResponse {
  const next = cloneConfig(config);
  if (scope === "all") {
    next.devices = next.devices.map((device) => ({ ...device, numConnections }));
    next.defaults.device = { ...next.defaults.device, numConnections };
  } else if (scope === "defaults") {
    next.defaults.device = { ...next.defaults.device, numConnections };
  } else {
    next.devices = next.devices.map((device) => (device.deviceID === scope ? { ...device, numConnections } : device));
  }
  return next;
}

export function applyPerformancePreset(config: ConfigResponse, preset: PerformancePreset): ConfigResponse {
  let next = cloneConfig(config);
  next.options = { ...next.options, ...preset.options };
  next = updateFolderScope(next, "all", preset.folder);
  return updateDeviceScope(next, "all", preset.numConnections);
}

function folderForScope(config: ConfigResponse, scope: FolderScope): FolderConfig {
  if (scope === "defaults" || scope === "all") return config.defaults.folder;
  return config.folders.find((folder) => folder.id === scope) ?? config.defaults.folder;
}

function deviceForScope(config: ConfigResponse, scope: DeviceScope): DeviceConfig {
  if (scope === "defaults" || scope === "all") return config.defaults.device;
  return config.devices.find((device) => device.deviceID === scope) ?? config.defaults.device;
}

function hasMixedFolderValues(config: ConfigResponse): boolean {
  const candidates = [...config.folders, config.defaults.folder];
  if (candidates.length < 2) return false;
  return folderKeys.some((key) => candidates.some((folder) => folder[key] !== candidates[0][key]));
}

function hasMixedDeviceValues(config: ConfigResponse): boolean {
  const values = [...config.devices.map((device) => device.numConnections ?? 0), config.defaults.device.numConnections ?? 0];
  return new Set(values).size > 1;
}

function PerformanceNumberField(props: {
  label: string;
  value: number;
  recommended: string;
  description: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="performance-field">
      <span className="performance-field-title">{props.label}</span>
      <input
        type="number"
        value={props.value}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) props.onChange(value);
        }}
      />
      <span className="performance-recommended">推荐：{props.recommended}</span>
      <span className="performance-description">{props.description}</span>
    </label>
  );
}

export default function PerformanceSettingsPanel(props: {
  config: ConfigResponse;
  onChange: (config: ConfigResponse) => void;
}) {
  const [presetKey, setPresetKey] = useState("balanced12600k");
  const [folderScope, setFolderScope] = useState<FolderScope>("all");
  const [deviceScope, setDeviceScope] = useState<DeviceScope>("all");
  const [message, setMessage] = useState("");
  const preset = performancePresets[presetKey];
  const folder = folderForScope(props.config, folderScope);
  const device = deviceForScope(props.config, deviceScope);
  const mixedFolders = useMemo(() => folderScope === "all" && hasMixedFolderValues(props.config), [folderScope, props.config]);
  const mixedDevices = useMemo(() => deviceScope === "all" && hasMixedDeviceValues(props.config), [deviceScope, props.config]);

  const updateOptions = (patch: Record<string, unknown>) => {
    props.onChange({ ...props.config, options: { ...props.config.options, ...patch } });
    setMessage("性能配置已修改到草稿，点击顶部“保存高级配置”后才会生效。");
  };
  const updateFolder = (patch: Partial<FolderPerformance>) => {
    props.onChange(updateFolderScope(props.config, folderScope, patch));
    setMessage("文件夹性能配置已修改到草稿，点击顶部“保存高级配置”后才会生效。");
  };
  const updateDevice = (value: number) => {
    props.onChange(updateDeviceScope(props.config, deviceScope, value));
    setMessage("设备连接配置已修改到草稿，点击顶部“保存高级配置”后才会生效。");
  };

  const applyPreset = () => {
    const next = applyPerformancePreset(props.config, preset);
    props.onChange(next);
    setFolderScope("all");
    setDeviceScope("all");
    setMessage(`已将“${preset.label}”应用到所有现有文件夹、设备及默认值。点击顶部“保存高级配置”后才会生效。`);
  };

  return (
    <div className="performance-settings-panel">
      <div className="performance-intro">
        <div>
          <div className="eyebrow">集中调优</div>
          <h3>性能优化</h3>
          <p>把分散在全局、文件夹和设备中的主要性能参数集中到这里。下面的推荐值以 i5-12600K、32 GB 内存和 SSD 为基础。</p>
        </div>
        <div className="performance-preset-actions">
          <select value={presetKey} onChange={(event) => setPresetKey(event.target.value)}>
            {Object.entries(performancePresets).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
          <button type="button" className="primary-button" onClick={applyPreset}>
            应用此预设到全部
          </button>
        </div>
      </div>
      <div className="performance-preset-summary">{preset.summary}</div>
      {message && <div className="inline-message info">{message}</div>}

      <div className="performance-group">
        <div className="performance-group-heading">
          <div>
            <strong>全局调度</strong>
            <span>控制多个文件夹竞争 CPU 和磁盘的方式。</span>
          </div>
        </div>
        <div className="performance-grid">
          <PerformanceNumberField
            label="最大文件夹并发数（maxFolderConcurrency）"
            value={props.config.options.maxFolderConcurrency ?? 0}
            recommended="2；0 表示按逻辑核心数自动决定"
            description="限制同时进行扫描、同步等高 I/O 操作的文件夹数量。它不会增加单个文件夹内部的文件并发；SSD 推荐 2，机械硬盘推荐 1。"
            onChange={(value) => updateOptions({ maxFolderConcurrency: value })}
          />
          <label className="performance-field performance-toggle-field">
            <span className="performance-field-title">降低进程优先级（setLowPriority）</span>
            <span className="advanced-boolean">
              <input
                type="checkbox"
                checked={Boolean(props.config.options.setLowPriority)}
                onChange={(event) => updateOptions({ setLowPriority: event.target.checked })}
              />
              <span>{props.config.options.setLowPriority ? "已降低，桌面更流畅" : "未降低，优先追求同步速度"}</span>
            </span>
            <span className="performance-recommended">推荐：专用同步时关闭；日常办公卡顿时开启</span>
            <span className="performance-description">关闭后 Syncthing 可以更积极地使用 CPU 和磁盘，但首次扫描或大量同步时可能影响其他程序。</span>
          </label>
        </div>
      </div>

      <div className="performance-group">
        <div className="performance-group-heading">
          <div>
            <strong>扫描与磁盘</strong>
            <span>选择修改范围后，下面的字段会集中写入相应文件夹。</span>
          </div>
          <select value={folderScope} onChange={(event) => setFolderScope(event.target.value)}>
            <option value="all">全部现有文件夹 + 默认文件夹</option>
            <option value="defaults">仅默认文件夹（以后新建）</option>
            {props.config.folders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || item.id}
              </option>
            ))}
          </select>
        </div>
        {mixedFolders && (
          <div className="inline-message warning">
            当前各文件夹的性能值不完全一致。下方显示默认文件夹的值；修改任一字段会把该字段应用到全部文件夹。
          </div>
        )}
        <div className="performance-grid">
          <PerformanceNumberField
            label="哈希线程数（hashers）"
            value={folder.hashers ?? 0}
            recommended="6；0 表示 Syncthing 自动决定"
            description="并行读取新增或已变化的文件并计算 SHA-256。增加它只加速内容哈希，不会显著加速未变化文件的元数据遍历；磁盘满载时继续增加反而可能变慢。"
            onChange={(value) => updateFolder({ hashers: value })}
          />
          <PerformanceNumberField
            label="本地块复制线程数（copiers）"
            value={folder.copiers ?? 0}
            recommended="4；0 使用内置默认 2"
            description="同步时从本机已有文件或临时文件复用相同数据块。它不负责首次扫描和网络下载；SSD 可适度提高，机械硬盘应保持较低。"
            onChange={(value) => updateFolder({ copiers: value })}
          />
          <PerformanceNumberField
            label="最大并发写入数（maxConcurrentWrites）"
            value={folder.maxConcurrentWrites ?? 16}
            recommended="16；高速 NVMe 可测试 32"
            description="限制接收同步时同时执行的磁盘写入。默认是 16；手动设为 0 会取消写入并发限制，并不代表自动，通常不推荐。"
            onChange={(value) => updateFolder({ maxConcurrentWrites: value })}
          />
          <PerformanceNumberField
            label="待处理拉取容量 KiB（pullerMaxPendingKiB）"
            value={folder.pullerMaxPendingKiB ?? 0}
            recommended="65536；0 使用默认 32768 KiB"
            description="控制已请求但尚未处理的网络数据量。提高到 64 MiB 有助于高带宽或高延迟连接，也会增加内存和磁盘写入压力。"
            onChange={(value) => updateFolder({ pullerMaxPendingKiB: value })}
          />
          <PerformanceNumberField
            label="完整重扫间隔秒（rescanIntervalS）"
            value={folder.rescanIntervalS ?? 3600}
            recommended="21600（6 小时）；0 禁用定期重扫"
            description="文件监视负责实时发现大部分变化，完整重扫用于发现遗漏事件。建议保留每 6～12 小时一次，不建议仅依赖文件监视。"
            onChange={(value) => updateFolder({ rescanIntervalS: value })}
          />
          <PerformanceNumberField
            label="扫描进度间隔秒（scanProgressIntervalS）"
            value={folder.scanProgressIntervalS ?? 0}
            recommended="-1；0 表示默认每 2 秒更新"
            description="-1 会关闭扫描百分比事件，并允许遍历与哈希直接流水执行；不会停止扫描。需要观察扫描速度和百分比时使用 0。"
            onChange={(value) => updateFolder({ scanProgressIntervalS: value })}
          />
          <label className="performance-field performance-toggle-field">
            <span className="performance-field-title">监视文件变化（fsWatcherEnabled）</span>
            <span className="advanced-boolean">
              <input
                type="checkbox"
                checked={Boolean(folder.fsWatcherEnabled)}
                onChange={(event) => updateFolder({ fsWatcherEnabled: event.target.checked })}
              />
              <span>{folder.fsWatcherEnabled ? "已启用" : "已禁用"}</span>
            </span>
            <span className="performance-recommended">推荐：启用</span>
            <span className="performance-description">使用 Windows 文件系统通知扫描发生变化的路径，显著降低日常增量扫描开销；仍应保留周期性完整重扫。</span>
          </label>
        </div>
      </div>

      <div className="performance-group">
        <div className="performance-group-heading">
          <div>
            <strong>设备连接</strong>
            <span>控制每个远端设备建立的并行连接数量。</span>
          </div>
          <select value={deviceScope} onChange={(event) => setDeviceScope(event.target.value)}>
            <option value="all">全部现有设备 + 默认设备</option>
            <option value="defaults">仅默认设备（以后新建）</option>
            {props.config.devices.map((item) => (
              <option key={item.deviceID} value={item.deviceID}>
                {item.name || item.deviceID.slice(0, 12)}
              </option>
            ))}
          </select>
        </div>
        {mixedDevices && (
          <div className="inline-message warning">
            当前各设备的连接数不完全一致。下方显示默认设备值；修改后会应用到全部设备。
          </div>
        )}
        <div className="performance-grid">
          <PerformanceNumberField
            label="连接数量（numConnections）"
            value={device.numConnections ?? 0}
            recommended="4；0 使用默认 3"
            description="增加连接数可能改善高延迟或高速网络的吞吐，但会增加 TLS、内存和调度开销。大量小文件的瓶颈通常在磁盘元数据，不会因连接数增加而成倍提升。"
            onChange={updateDevice}
          />
        </div>
      </div>

      <div className="performance-safety-note">
        <strong>调整方法：</strong>
        一次只改变一个档位。扫描时如果磁盘活动时间已经接近 100%，继续增加 hashers 或写入并发通常不会更快；如果 Windows 明显卡顿，可将 hashers 降到 4，或重新启用低优先级。
      </div>
    </div>
  );
}
