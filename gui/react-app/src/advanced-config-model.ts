import type { ConfigResponse } from "./api";

export type AdvancedConfigGroup = "gui" | "options" | "ldap" | "folder" | "device";
export type AdvancedInputKind = "boolean" | "number" | "text" | "list" | "enum" | "size" | "unsupported";

export type FieldChoice = {
  value: string;
  label: string;
};

export type FieldMeta = {
  label: string;
  description: string;
  docsURL: string;
  kind?: AdvancedInputKind;
  choices?: FieldChoice[];
  sensitive?: "password" | "apiKey" | "secret";
  multiline?: boolean;
};

const labels: Record<string, string> = {
  enabled: "启用",
  address: "监听地址",
  unixSocketPermissions: "Unix 套接字权限",
  user: "用户名",
  password: "管理密码",
  authMode: "认证模式",
  metricsWithoutAuth: "允许未认证访问指标",
  useTLS: "启用 HTTPS",
  apiKey: "API 密钥",
  insecureAdminAccess: "允许不安全的管理员访问",
  theme: "界面主题",
  insecureSkipHostcheck: "跳过主机头检查（不安全）",
  insecureAllowFrameLoading: "允许在网页框架中加载（不安全）",
  sendBasicAuthPrompt: "发送基础认证提示",
  bindDN: "绑定 DN",
  transport: "LDAP 传输方式",
  insecureSkipVerify: "跳过 LDAP TLS 证书验证（不安全）",
  searchBaseDN: "LDAP 搜索基础 DN",
  searchFilter: "LDAP 搜索过滤器",
  listenAddresses: "同步监听地址",
  globalAnnounceServers: "全局发现服务器",
  globalAnnounceEnabled: "启用全局发现",
  localAnnounceEnabled: "启用本地发现",
  localAnnouncePort: "本地发现端口",
  localAnnounceMCAddr: "本地发现组播地址",
  maxSendKbps: "最大发送速率（KiB/s）",
  maxRecvKbps: "最大接收速率（KiB/s）",
  reconnectionIntervalS: "重新连接间隔（秒）",
  relaysEnabled: "启用中继",
  relayReconnectIntervalM: "中继重连间隔（分钟）",
  startBrowser: "启动时打开浏览器",
  natEnabled: "启用 NAT 穿透",
  natLeaseMinutes: "NAT 映射租期（分钟）",
  natRenewalMinutes: "NAT 映射续期间隔（分钟）",
  natTimeoutSeconds: "NAT 操作超时（秒）",
  urAccepted: "使用情况报告接受版本",
  urSeen: "已查看的使用报告版本",
  urUniqueId: "使用情况报告匿名 ID",
  urURL: "使用情况报告地址",
  urPostInsecurely: "允许通过 HTTP 提交使用报告",
  urInitialDelayS: "首次报告延迟（秒）",
  autoUpgradeIntervalH: "自动升级检查间隔（小时，0 表示关闭）",
  upgradeToPreReleases: "允许升级到预发布版本",
  keepTemporariesH: "临时文件保留时间（小时）",
  cacheIgnoredFiles: "缓存被忽略文件的信息",
  progressUpdateIntervalS: "传输进度更新间隔（秒）",
  limitBandwidthInLan: "局域网连接也应用限速",
  minHomeDiskFree: "数据目录最小可用空间",
  releasesURL: "版本更新元数据地址",
  alwaysLocalNets: "始终视为局域网的网段",
  overwriteRemoteDeviceNamesOnConnect: "连接时采用远端设备名称",
  tempIndexMinBlocks: "临时索引最小块数",
  unackedNotificationIDs: "未确认通知 ID",
  trafficClass: "网络流量类别",
  setLowPriority: "降低进程优先级",
  maxFolderConcurrency: "最大文件夹并发数",
  crURL: "崩溃报告地址",
  crashReportingEnabled: "启用崩溃报告",
  stunKeepaliveStartS: "STUN 保活起始间隔（秒）",
  stunKeepaliveMinS: "STUN 最小保活间隔（秒）",
  stunServers: "STUN 服务器",
  maxConcurrentIncomingRequestKiB: "传入请求最大并发容量（KiB）",
  announceLANAddresses: "公布局域网地址",
  sendFullIndexOnUpgrade: "升级后发送完整索引",
  featureFlags: "实验性功能标志",
  auditEnabled: "启用审计日志",
  auditFile: "审计日志路径",
  connectionLimitEnough: "足够连接数阈值",
  connectionLimitMax: "最大连接总数",
  connectionPriorityTcpLan: "局域网 TCP 连接优先级",
  connectionPriorityQuicLan: "局域网 QUIC 连接优先级",
  connectionPriorityTcpWan: "广域网 TCP 连接优先级",
  connectionPriorityQuicWan: "广域网 QUIC 连接优先级",
  connectionPriorityRelay: "中继连接优先级",
  connectionPriorityUpgradeThreshold: "连接升级优先级阈值",
  id: "文件夹 ID",
  label: "显示名称",
  filesystemType: "文件系统类型",
  path: "文件夹路径",
  type: "文件夹类型",
  rescanIntervalS: "完全重扫间隔（秒）",
  fsWatcherEnabled: "监视文件系统变化",
  fsWatcherDelayS: "文件监视延迟（秒）",
  fsWatcherTimeoutS: "文件监视超时（秒）",
  ignorePerms: "忽略文件权限",
  autoNormalize: "自动规范化文件名",
  copiers: "本地复制协程数",
  pullerMaxPendingKiB: "拉取器最大待处理容量（KiB）",
  hashers: "哈希计算协程数",
  order: "文件拉取顺序",
  ignoreDelete: "忽略远端删除",
  scanProgressIntervalS: "扫描进度更新间隔（秒）",
  pullerPauseS: "拉取失败暂停时间（秒）",
  pullerDelayS: "拉取器启动延迟（秒）",
  maxConflicts: "最多保留冲突文件数",
  disableSparseFiles: "禁用稀疏文件",
  paused: "暂停",
  manualSync: "手动审核接收",
  manualPublish: "手动审核发布",
  markerName: "文件夹标记名称",
  copyOwnershipFromParent: "从父目录复制所有权",
  modTimeWindowS: "修改时间容差（秒）",
  maxConcurrentWrites: "最大并发写入数",
  disableFsync: "禁用 fsync（不安全）",
  blockPullOrder: "文件块拉取顺序",
  copyRangeMethod: "本地数据复制方法",
  caseSensitiveFS: "文件系统区分大小写",
  junctionsAsDirs: "将目录联接视为目录",
  syncOwnership: "同步文件所有权",
  sendOwnership: "发送文件所有权",
  syncXattrs: "同步扩展属性",
  sendXattrs: "发送扩展属性",
  archiveMetadataOnly: "仅元数据变化时跳过归档",
  minDiskFree: "文件夹最小可用空间",
  versioning: "文件版本控制",
  xattrFilter: "扩展属性过滤器",
  deviceID: "设备 ID",
  name: "设备名称",
  addresses: "设备地址",
  compression: "压缩模式",
  certName: "证书名称",
  introducer: "作为中介设备",
  skipIntroductionRemovals: "跳过中介移除操作",
  introducedBy: "引入此设备的设备 ID",
  allowedNetworks: "允许连接的网络",
  autoAcceptFolders: "自动接受文件夹",
  maxRequestKiB: "最大请求大小（KiB）",
  untrusted: "不受信任设备",
  remoteGUIPort: "远端 GUI 端口",
  numConnections: "连接数量",
};

const descriptions: Record<string, string> = {
  password: "用于 Web GUI 静态认证。已保存的密码由后端以 bcrypt 哈希返回；不修改时必须保留原值。",
  apiKey: "可直接访问 REST API 的高敏感凭据。不要发送给不受信任的人，重新生成后旧密钥立即失效。",
  authMode: "选择用户名/密码静态认证或 LDAP 认证。使用 LDAP 时还必须正确配置 LDAP 分组。",
  address: "GUI 分组中是 Web 管理界面的监听地址；LDAP 分组中是 LDAP 服务器的主机与端口。",
  insecureAdminAccess: "允许从非本机地址通过未加密 HTTP 管理 Syncthing，会明显降低安全性。",
  insecureSkipHostcheck: "关闭 Host 请求头保护，仅应在已正确隔离的反向代理环境中使用。",
  insecureAllowFrameLoading: "允许其他网页通过 iframe 加载管理界面，可能引入点击劫持风险。",
  bindDN: "LDAP 绑定用户模板，可用 %s 代表经过 DN 转义的登录用户名。",
  searchBaseDN: "LDAP 用户搜索的根 DN。必须与搜索过滤器同时填写或同时留空。",
  searchFilter: "LDAP 用户搜索过滤器，可用 %s 代表经过过滤器转义的登录用户名，且必须与搜索基础 DN 配对。",
  insecureSkipVerify: "跳过 LDAP TLS 证书验证，容易受到中间人攻击，仅用于受控测试环境。",
  autoUpgradeIntervalH: "检查官方发布包的间隔，单位小时。0 表示关闭自动升级。开启后可能把当前定制版本替换成官方 Syncthing。",
  upgradeToPreReleases: "允许自动升级到候选/预发布版本。当前定制版本建议保持关闭。",
  listenAddresses: "Syncthing 接受设备连接的地址列表。default 让 Syncthing 自动选择推荐的 TCP 与 QUIC 监听地址。",
  globalAnnounceServers: "向其公布本设备地址的全局发现服务器列表。default 使用官方默认服务器。",
  maxFolderConcurrency: "限制同时执行扫描、同步等 I/O 密集任务的文件夹数量；0 使用自动值，负数表示不限制。",
  minHomeDiskFree: "当 Syncthing 数据目录所在磁盘低于此剩余空间时停止需要额外空间的操作。",
  auditEnabled: "记录 REST API 与事件审计信息。修改此选项需要重启 Syncthing。",
  auditFile: "审计日志输出路径。修改此选项需要重启 Syncthing。",
  featureFlags: "实验性功能开关。错误值可能被忽略，启用前应确认当前版本文档。",
  path: "本机文件夹路径。已有文件夹改路径只会换挂载点，文件夹 ID 和索引会保留；请先把原目录整份移到新位置，不要删除后重建。",
  hashers: "并行读取文件并计算块哈希的工作协程数。0 表示根据 CPU 和文件夹数量自动决定。",
  scanProgressIntervalS: "扫描进度事件间隔。负数禁用扫描进度并允许遍历与哈希直接流水执行。",
  disableFsync: "跳过关键落盘同步可提高部分存储的速度，但断电或系统崩溃时更容易损坏数据。",
  ignoreDelete: "忽略其他设备传播的删除。该模式容易产生与全局状态不一致的文件，应谨慎使用。",
  manualSync: "远端变化先进入接收审核，确认后才应用到当前设备。",
  manualPublish: "本地变化先进入发布审核，确认后才对其他设备可见。",
  untrusted: "此设备只接收加密后的文件内容；共享时需要为相关文件夹配置加密密码。",
  introducer: "允许该设备自动向本机介绍它所连接的设备和共享关系。",
  skipIntroductionRemovals: "中介设备取消共享或移除设备时，本机保留之前由它引入的配置。",
};

const choices: Partial<Record<AdvancedConfigGroup, Record<string, FieldChoice[]>>> = {
  gui: {
    authMode: [
      { value: "static", label: "静态用户名和密码" },
      { value: "ldap", label: "LDAP" },
    ],
  },
  ldap: {
    transport: [
      { value: "plain", label: "明文 LDAP" },
      { value: "tls", label: "LDAP over TLS" },
      { value: "starttls", label: "StartTLS" },
    ],
  },
  folder: {
    filesystemType: [{ value: "basic", label: "普通文件系统" }],
    type: [
      { value: "sendreceive", label: "双向同步" },
      { value: "sendonly", label: "仅发送" },
      { value: "receiveonly", label: "仅接收" },
      { value: "receiveencrypted", label: "仅接收加密数据" },
    ],
    order: [
      { value: "random", label: "随机" },
      { value: "alphabetic", label: "按名称" },
      { value: "smallestFirst", label: "小文件优先" },
      { value: "largestFirst", label: "大文件优先" },
      { value: "oldestFirst", label: "旧文件优先" },
      { value: "newestFirst", label: "新文件优先" },
    ],
    blockPullOrder: [
      { value: "standard", label: "标准" },
      { value: "random", label: "随机" },
      { value: "inOrder", label: "按顺序" },
    ],
    copyRangeMethod: [
      { value: "standard", label: "标准自动选择" },
      { value: "ioctl", label: "ioctl" },
      { value: "copy_file_range", label: "copy_file_range" },
      { value: "sendfile", label: "sendfile" },
      { value: "duplicate_extents", label: "duplicate_extents" },
      { value: "all", label: "依次尝试全部方法" },
    ],
  },
  device: {
    compression: [
      { value: "never", label: "从不压缩" },
      { value: "metadata", label: "仅压缩元数据" },
      { value: "always", label: "始终压缩" },
    ],
  },
};

const groupAnchors: Record<AdvancedConfigGroup, string> = {
  gui: "gui",
  options: "options",
  ldap: "ldap",
  folder: "folder",
  device: "device",
};

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\bId\b/g, "ID")
    .replace(/\bKbps\b/g, "KiB/s")
    .replace(/\bS\b/g, "秒")
    .replace(/^./, (value) => value.toUpperCase());
}

export function fieldMetaFor(group: AdvancedConfigGroup, key: string, value: unknown): FieldMeta {
  const label = labels[key] ?? humanizeKey(key);
  const groupChoices = choices[group]?.[key];
  let kind: AdvancedInputKind | undefined;
  if (groupChoices) {
    kind = "enum";
  } else if (key === "minDiskFree" || key === "minHomeDiskFree") {
    kind = "size";
  }

  const sensitive =
    group === "gui" && key === "password"
      ? "password"
      : group === "gui" && key === "apiKey"
        ? "apiKey"
        : key === "urUniqueId"
          ? "secret"
        : key === "encryptionPassword"
          ? "secret"
          : undefined;

  return {
    label,
    description:
      descriptions[key] ??
      `用于控制“${label}”的高级行为。当前 JSON 字段为 ${key}；不同平台或版本可能有额外限制，请通过下方官方文档确认取值。`,
    docsURL: `https://docs.syncthing.net/users/config#config-option-${groupAnchors[group]}.${key.toLowerCase()}`,
    kind: kind ?? inputKindFor(value),
    choices: groupChoices,
    sensitive,
    multiline: Array.isArray(value),
  };
}

export function inputKindFor(value: unknown): AdvancedInputKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string" || value === null) return "text";
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) return "list";
  if (
    value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).value === "number" &&
    typeof (value as Record<string, unknown>).unit === "string"
  ) {
    return "size";
  }
  return "unsupported";
}

export function editableEntries(object: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(object).filter(([key, value]) => !key.startsWith("_") && inputKindFor(value) !== "unsupported");
}

export function setConfigValue(config: ConfigResponse, path: Array<string | number>, value: unknown): ConfigResponse {
  const next = JSON.parse(JSON.stringify(config)) as ConfigResponse;
  let target: unknown = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    target = (target as Record<string | number, unknown>)[path[index]];
  }
  (target as Record<string | number, unknown>)[path[path.length - 1]] = value;
  return next;
}

export function encodeSimpleList(value: unknown[]): string {
  return value.map(String).join("\n");
}

export function decodeSimpleList(value: string, original: unknown[]): Array<string | number> {
  const lines = value.split(/\r?\n/);
  if (original.every((item) => typeof item === "number")) {
    return lines.filter((item) => item.trim() !== "").map((item) => Number(item.trim()));
  }
  return lines.map((item) => item.trim()).filter(Boolean);
}

export function validateAdvancedConfig(config: ConfigResponse): string[] {
  const errors: string[] = [];
  const base = config.ldap?.searchBaseDN?.trim() ?? "";
  const filter = config.ldap?.searchFilter?.trim() ?? "";
  if (Boolean(base) !== Boolean(filter)) {
    errors.push("LDAP 搜索基础 DN 与搜索过滤器必须同时填写或同时留空。");
  }
  if (config.gui?.authMode === "ldap" && !config.ldap?.address?.trim()) {
    errors.push("启用 LDAP 认证时必须填写 LDAP 服务器地址。");
  }
  return errors;
}

export function generateAPIKey(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const random = new Uint32Array(32);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}
