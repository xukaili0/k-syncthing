import type { BiDiffResult, CompletionStatus, DeviceConfig, FolderConfig } from "../../api";
import type { BiDiffTask } from "./bidiff-model";

type UiMode = "desktop" | "mobile";

export type BiDiffPanelProps = {
  mode: "bidiff" | "peer";
  folder: FolderConfig;
  devices: DeviceConfig[];
  selectedDeviceId: string;
  onSelectDevice: (value: string) => void;
  selectedDevice: DeviceConfig | null;
  bidiff: BiDiffResult | null;
  bidiffBusy: boolean;
  bidiffError: string;
  bidiffView: string;
  onBidiffViewChange: (value: string) => void;
  bidiffPrefix: string;
  onBidiffPrefixChange: (value: string) => void;
  bidiffSelection: Record<string, boolean>;
  onBidiffSelectionChange: (value: Record<string, boolean>) => void;
  bidiffMessage: string;
  bidiffIgnoreModTime: boolean;
  onBidiffIgnoreModTimeChange: (value: boolean) => void;
  onRefresh: () => void;
  onApplyLeftToRight: () => void;
  onApplyRightToLeft: () => void;
  remoteCompletion?: CompletionStatus;
  scanBusy: boolean;
  activeTasks: BiDiffTask[];
  allTasks: BiDiffTask[];
  uiMode: UiMode;
  autoRefreshPaused: boolean;
  onToggleAutoRefreshPaused: () => void;
  titleStats?: (stats: {
    total: number;
    selected: number;
    leftToRight: number;
    rightToLeft: number;
    pending?: number;
    previewReady?: boolean;
  }) => void;
  downloadProgress?: Record<
    string,
    Record<
      string,
      {
        total: number;
        reused: number;
        copiedFromOrigin: number;
        copiedFromElsewhere: number;
        pulled: number;
        pulling: number;
        bytesDone: number;
        bytesTotal: number;
      }
    >
  >;
  uploadProgress?: Record<string, Record<string, number>>;
  uploadFileInfo?: Record<string, { totalBlocks: number; size: number }>;
  completedUploads?: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }>;
  completedDownloads?: Array<{ folder: string; item: string; action: string; size: number; at: number }>;
  connectionRates?: { inbps: number; outbps: number };
  workbenchView: "diff" | "transfer";
  onWorkbenchViewChange: (view: "diff" | "transfer") => void;
  progressUpdateIntervalS?: number;
  onSaveProgressInterval?: (value: number) => void;
};
