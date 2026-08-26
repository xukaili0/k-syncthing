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
  | "disableFsync"
>;

type PresetGroup = "ssd" | "hdd" | "other";

export type PerformancePreset = {
  label: string;
  group: PresetGroup;
  summary: string;
  options: {
    maxFolderConcurrency: number;
    setLowPriority: boolean;
  };
  folder: Required<FolderPerformance>;
  numConnections: number;
};

const hddDiskOptions = { maxFolderConcurrency: 1, setLowPriority: true };
const hddFolderBase: Pick<
  Required<FolderPerformance>,
  "fsWatcherEnabled" | "rescanIntervalS" | "scanProgressIntervalS" | "disableFsync"
> = {
  fsWatcherEnabled: true,
  rescanIntervalS: 21600,
  scanProgressIntervalS: 0,
  disableFsync: false,
};

export const performancePresets: Record<string, PerformancePreset> = {
  balanced12600k: {
    label: "i5-12600K / 32 GB / SSD 平衡（推荐本机）",
    group: "ssd",
    summary: "适合 SSD 本机。提高扫描和本地块复用，同时给 Windows 留余量。机械盘请改用下面的 HDD 预设。",
    options: { maxFolderConcurrency: 2, setLowPriority: false },
    folder: {
      hashers: 6,
      copiers: 4,
      maxConcurrentWrites: 16,
      pullerMaxPendingKiB: 65536,
      fsWatcherEnabled: true,
      rescanIntervalS: 21600,
      scanProgressIntervalS: -1,
      disableFsync: false,
    },
    numConnections: 4,
  },
  nvmePerformance: {
    label: "NVMe 高性能",
    group: "ssd",
    summary: "适合高速 NVMe 和专用同步。并发更高，可能增加 CPU、磁盘活动和桌面卡顿。不要用在机械盘上。",
    options: { maxFolderConcurrency: 3, setLowPriority: false },
    folder: {
      hashers: 8,
      copiers: 4,
      maxConcurrentWrites: 32,
      pullerMaxPendingKiB: 65536,
      fsWatcherEnabled: true,
      rescanIntervalS: 21600,
      scanProgressIntervalS: -1,
      disableFsync: false,
    },
    numConnections: 4,
  },
  hddSmall500k: {
    label: "机械硬盘 · 小文件（约 500 KB）",
    group: "hdd",
    summary:
      "针对照片、文档、大量约 500 KB 文件。瓶颈是每个文件的打开、改名和 fsync，不是带宽。哈希/复制线程降到 1，拉取队列降到 8 MiB，避免一次同时落盘几十上百个小文件。局域网连接数保持 3 即可。",
    options: hddDiskOptions,
    folder: {
      ...hddFolderBase,
      hashers: 1,
      copiers: 1,
      maxConcurrentWrites: 4,
      pullerMaxPendingKiB: 8192,
    },
    numConnections: 3,
  },
  hddMedium10m: {
    label: "机械硬盘 · 中等文件（约 10 MB）",
    group: "hdd",
    summary:
      "针对安装包、音频、普通视频切片等约 10 MB 文件。单个文件已经能顺序读写，但仍不要并行扫两个文件夹。拉取队列 16 MiB，大约同时处理一到两个文件；连接数 3 用来掩盖局域网往返延迟。",
    options: hddDiskOptions,
    folder: {
      ...hddFolderBase,
      hashers: 1,
      copiers: 2,
      maxConcurrentWrites: 4,
      pullerMaxPendingKiB: 16384,
    },
    numConnections: 3,
  },
  hddLarge200m: {
    label: "机械硬盘 · 大文件（约 200 MB）",
    group: "hdd",
    summary:
      "针对电影、虚拟机镜像、大安装包等约 200 MB 文件。机械盘最擅长整文件顺序读写，因此哈希线程 1、并发写入 2，让磁头尽量少跳。拉取队列保持默认 32 MiB，方便边下边写；连接数仍用 3，不必为了大文件加到 4 以上。",
    options: hddDiskOptions,
    folder: {
      ...hddFolderBase,
      hashers: 1,
      copiers: 2,
      maxConcurrentWrites: 2,
      pullerMaxPendingKiB: 32768,
    },
    numConnections: 3,
  },
  hddStable: {
    label: "机械硬盘 · 混合大小",
    group: "hdd",
    summary:
      "文件夹里大小混杂、或不清楚以哪类为主时使用。比小文件预设更敢拉网络，比大文件预设更限制并发写入。一律单文件夹干活，哈希线程为 1。",
    options: hddDiskOptions,
    folder: {
      ...hddFolderBase,
      hashers: 1,
      copiers: 2,
      maxConcurrentWrites: 4,
      pullerMaxPendingKiB: 16384,
    },
    numConnections: 3,
  },
  syncthingAuto: {
    label: "Syncthing 自动/默认",
    group: "other",
    summary: "尽量恢复自动决策：0 在 hashers、copiers、连接数等字段中表示自动或内置默认值。机械盘上 0 会按 CPU 核心数放开文件夹并发，通常不合适。",
    options: { maxFolderConcurrency: 0, setLowPriority: true },
    folder: {
      hashers: 0,
      copiers: 0,
      maxConcurrentWrites: 16,
      pullerMaxPendingKiB: 0,
      fsWatcherEnabled: true,
      rescanIntervalS: 3600,
      scanProgressIntervalS: 0,
      disableFsync: false,
    },
    numConnections: 0,
  },
};

const presetGroups: Array<{ id: PresetGroup; label: string }> = [
  { id: "ssd", label: "固态硬盘（SSD / NVMe）" },
  { id: "hdd", label: "机械硬盘（按常见文件大小）" },
  { id: "other", label: "其他" },
];

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
  "disableFsync",
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
  hints: string[];
  presetLabel: string;
  presetValue: number;
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
      <span className="performance-preset-value">
        当前预设「{props.presetLabel}」建议：{props.presetValue}
      </span>
      <span className="performance-recommended">对照：{props.recommended}</span>
      <span className="performance-description">{props.description}</span>
      <ul className="performance-hints">
        {props.hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </label>
  );
}

function PerformanceToggleField(props: {
  label: string;
  checked: boolean;
  stateText: string;
  recommended: string;
  description: string;
  hints: string[];
  presetLabel: string;
  presetValue: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="performance-field performance-toggle-field">
      <span className="performance-field-title">{props.label}</span>
      <span className="advanced-boolean">
        <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
        <span>{props.stateText}</span>
      </span>
      <span className="performance-preset-value">
        当前预设「{props.presetLabel}」建议：{props.presetValue ? "开启" : "关闭"}
      </span>
      <span className="performance-recommended">对照：{props.recommended}</span>
      <span className="performance-description">{props.description}</span>
      <ul className="performance-hints">
        {props.hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
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
          <p>
            先按磁盘类型和常见文件大小选预设，再点「应用此预设到全部」。下面每个字段会显示当前预设建议值，并对照 SSD 与机械盘。机械盘不要使用 SSD / NVMe 预设。
          </p>
        </div>
        <div className="performance-preset-actions">
          <select value={presetKey} onChange={(event) => setPresetKey(event.target.value)}>
            {presetGroups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {Object.entries(performancePresets)
                  .filter(([, value]) => value.group === group.id)
                  .map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
              </optgroup>
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
            recommended="SSD 2；机械盘 1；0 按 CPU 核心数自动"
            description="限制同时进行扫描、同步等高 I/O 的文件夹数量。它不增加单个文件夹内部的文件并发。机械盘上 0 会按核心数放开，多个文件夹同时干活会让磁头来回寻道。"
            hints={[
              "SSD / NVMe：2～3。随机 I/O 便宜，可并行多个文件夹。",
              "机械盘（500 KB / 10 MB / 200 MB）：一律 1。这是机械盘最重要的一项。",
              "0 表示按逻辑核心数自动决定，只适合 SSD。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.options.maxFolderConcurrency}
            onChange={(value) => updateOptions({ maxFolderConcurrency: value })}
          />
          <PerformanceToggleField
            label="降低进程优先级（setLowPriority）"
            checked={Boolean(props.config.options.setLowPriority)}
            stateText={props.config.options.setLowPriority ? "已降低，桌面更流畅" : "未降低，优先追求同步速度"}
            recommended="办公机开启；专用同步机关闭"
            description="关闭后 Syncthing 更积极使用 CPU 和磁盘，首次扫描或大量同步时可能让资源管理器卡顿。机械盘寻道本身就会拖慢桌面，办公本建议开启。"
            hints={[
              "SSD 本机、专用同步：可关闭，同步更快。",
              "机械盘笔记本 / 日常办公：开启，避免扫盘时整个 Windows 卡住。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.options.setLowPriority}
            onChange={(checked) => updateOptions({ setLowPriority: checked })}
          />
        </div>
      </div>

      <div className="performance-group">
        <div className="performance-group-heading">
          <div>
            <strong>扫描、磁盘与拉取</strong>
            <span>选择修改范围后，下面的字段会集中写入相应文件夹。机械盘请按常见文件大小选预设。</span>
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
            recommended="SSD 6；机械盘 1；0 自动"
            description="并行读取新增或已变化的文件并计算 SHA-256。只加速内容哈希，不加速未变化文件的目录遍历。机械盘上 2 个线程会同时读两个文件，磁头乱跳，扫描往往更慢。"
            hints={[
              "SSD：6～8。随机读很快，多线程能喂满 CPU。",
              "机械盘 500 KB：1。小文件几乎全是寻道，加线程只会更慢。",
              "机械盘 10 MB / 200 MB：1。让单个文件顺序读完，接近盘的顺序速度。",
              "0 在 Windows 上大约按 CPU/4 分配，机械盘仍可能偏高。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.hashers}
            onChange={(value) => updateFolder({ hashers: value })}
          />
          <PerformanceNumberField
            label="本地块复制线程数（copiers）"
            value={folder.copiers ?? 0}
            recommended="SSD 4；机械盘小文件 1，其余 2；0 默认 2"
            description="同步时从本机已有文件或临时文件复用相同数据块。它不负责首次扫描，也不负责从网络下载。小文件很少能复用块；大文件复用时仍要限制并发，避免随机读。"
            hints={[
              "SSD：4。本地块复用可以多路进行。",
              "机械盘 500 KB：1。几乎没有可复用块，多线程只会抢磁盘。",
              "机械盘 10 MB / 200 MB：2。偶尔能从本机拷块，但不要更高。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.copiers}
            onChange={(value) => updateFolder({ copiers: value })}
          />
          <PerformanceNumberField
            label="最大并发写入数（maxConcurrentWrites）"
            value={folder.maxConcurrentWrites ?? 16}
            recommended="SSD 16；NVMe 可试 32；机械盘小/中 4，大文件 2"
            description="限制接收同步时同时执行的磁盘写入。默认 16。设为 0 会取消写入并发限制，不代表自动，机械盘上通常更卡。小文件的写入量很小，真正贵的是建临时文件和改名。"
            hints={[
              "SSD：16。NVMe 专用同步可试 32。",
              "机械盘 500 KB：4。同时落盘太多小文件会打满目录项。",
              "机械盘 10 MB：4。保持少量顺序写。",
              "机械盘 200 MB：2。让大文件尽量连续写入，减少磁头跳动。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.maxConcurrentWrites}
            onChange={(value) => updateFolder({ maxConcurrentWrites: value })}
          />
          <PerformanceNumberField
            label="待处理拉取容量 KiB（pullerMaxPendingKiB）"
            value={folder.pullerMaxPendingKiB ?? 0}
            recommended="SSD 65536；机械盘小文件 8192，10 MB 16384，200 MB 32768；0 默认 32768"
            description="已向对端请求、尚未写完的网络数据上限。按字节计算：同样 32 MiB，对 500 KB 文件等于几十个文件同时在飞，机械盘会被元数据打满；对 200 MB 文件则只是一个文件的一小段预读。单位是 KiB，8192 即 8 MiB。"
            hints={[
              "SSD / 高带宽：65536（64 MiB），有利于喂满网络。",
              "机械盘 500 KB：8192（8 MiB），大约十几个小文件在途，避免几百个同时建文件。",
              "机械盘 10 MB：16384（16 MiB），大约同时拉取 1～2 个文件。",
              "机械盘 200 MB：32768（32 MiB），给大文件边下边写留缓冲，不要提到 64 MiB。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.pullerMaxPendingKiB}
            onChange={(value) => updateFolder({ pullerMaxPendingKiB: value })}
          />
          <PerformanceNumberField
            label="完整重扫间隔秒（rescanIntervalS）"
            value={folder.rescanIntervalS ?? 3600}
            recommended="21600（6 小时）；机械盘同样；0 禁用定期重扫"
            description="文件监视负责实时发现大部分变化，完整重扫用于发现遗漏事件。机械盘上整树 stat 一万个小文件也要一段时间，不建议每小时全量重扫。"
            hints={[
              "SSD / 机械盘都建议 21600（6 小时）。",
              "小文件特别多时，12 小时（43200）也可以，前提是文件监视保持开启。",
              "不要设 0 只靠监视：漏事件后两边会长期不一致。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.rescanIntervalS}
            onChange={(value) => updateFolder({ rescanIntervalS: value })}
          />
          <PerformanceNumberField
            label="扫描进度间隔秒（scanProgressIntervalS）"
            value={folder.scanProgressIntervalS ?? 0}
            recommended="SSD -1；机械盘 0；需要百分比时用 0"
            description="0 表示默认每 2 秒更新扫描百分比，并先走完目录再哈希。-1 关闭百分比，让遍历和哈希流水重叠。机械盘上重叠会把「读目录」和「读文件」混在一起寻道，通常更慢。"
            hints={[
              "SSD：-1。流水执行更快，也不在乎随机 I/O。",
              "机械盘（无论 500 KB / 10 MB / 200 MB）：0。先遍历，再集中哈希。",
              "想看扫描百分比和速率时，SSD 也可以临时改回 0。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.scanProgressIntervalS}
            onChange={(value) => updateFolder({ scanProgressIntervalS: value })}
          />
          <PerformanceToggleField
            label="监视文件变化（fsWatcherEnabled）"
            checked={Boolean(folder.fsWatcherEnabled)}
            stateText={folder.fsWatcherEnabled ? "已启用" : "已禁用"}
            recommended="一律启用"
            description="用系统通知扫描发生变化的路径，避免每次都整树 stat。机械盘小文件尤其依赖它；关闭后只能靠完整重扫，会非常慢。"
            hints={[
              "SSD / 机械盘：都启用。",
              "仍需保留 6～12 小时完整重扫，用来补上漏掉的通知。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.fsWatcherEnabled}
            onChange={(checked) => updateFolder({ fsWatcherEnabled: checked })}
          />
          <PerformanceToggleField
            label="关闭落盘同步（disableFsync）"
            checked={Boolean(folder.disableFsync)}
            stateText={folder.disableFsync ? "已关闭 fsync，落盘更快、掉电风险更高" : "保持 fsync，更安全"}
            recommended="默认关闭；仅机械盘海量小文件且可接受掉电风险时开启"
            description="默认每个临时文件写完和父目录更新后会 fsync。小文件场景下这是机械盘最重的一步。开启后同步会快不少，但突然断电或系统崩溃时，最后一批刚写入的文件更容易丢失或不完整。"
            hints={[
              "重要资料、没有 UPS：保持关闭。",
              "机械盘 500 KB、可接受丢失最后几秒数据：可手动开启，预设不会替你打开。",
              "10 MB / 200 MB：收益较小，建议保持关闭。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.folder.disableFsync}
            onChange={(checked) => updateFolder({ disableFsync: checked })}
          />
        </div>
      </div>

      <div className="performance-group">
        <div className="performance-group-heading">
          <div>
            <strong>设备连接（网络）</strong>
            <span>控制每个远端设备建立的并行连接数量。小文件在局域网上通常已经不是网络瓶颈。</span>
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
            recommended="SSD 4；机械盘 3；0 使用默认 3"
            description="多条连接可以并行拉不同块，改善高延迟或高速链路。机械盘上小文件的瓶颈在建文件和改名，连接数加到 4 以上几乎不会更快，还会增加 TLS 和内存开销。请走局域网直连，避免中继。"
            hints={[
              "SSD / 高带宽 WAN：4。",
              "机械盘 500 KB：3。再多也喂不饱磁盘元数据。",
              "机械盘 10 MB / 200 MB：3。大文件靠块流水，不靠堆连接。",
              "高延迟（跨网、中继）：可试 4，但先解决直连。",
            ]}
            presetLabel={preset.label}
            presetValue={preset.numConnections}
            onChange={updateDevice}
          />
        </div>
      </div>

      <div className="performance-safety-note">
        <strong>调整方法：</strong>
        机械盘先选文件大小预设再应用。磁盘活动已经接近 100% 时，不要再加 hashers、copiers 或写入并发。小文件变慢时优先降低 pullerMaxPendingKiB，而不是增加连接数。一次只改一个档位，保存后观察扫描和同步是否更稳。
      </div>
    </div>
  );
}
