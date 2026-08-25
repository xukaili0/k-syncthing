import { useCallback, useEffect, useMemo, useState } from "react";
import { getJSON, postJSON, triggerFolderScan, type CompareEntry, type CompareResult, type FolderConfig } from "../../api";
import { compareRequestView, isPausedFolder } from "../../components/review/review-formatters";

type PanelScanBusy = "" | "compare" | "bidiff" | "peerdiff" | "publish";

type ReceiveCompareControllerOptions = {
  selectedFolder: FolderConfig | null;
  selectedDeviceId: string;
  modalOpen: boolean;
  panelRefreshSeconds: number;
  setPanelScanBusy: (value: PanelScanBusy) => void;
  loadBootstrap: () => Promise<void>;
};

export function useReceiveCompareController({
  selectedFolder,
  selectedDeviceId,
  modalOpen: receiveModalOpen,
  panelRefreshSeconds,
  setPanelScanBusy,
  loadBootstrap,
}: ReceiveCompareControllerOptions) {
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [compareView, setCompareView] = useState("different");
  const [comparePrefix, setComparePrefix] = useState("");
  const [compareIgnoreModTime, setCompareIgnoreModTime] = useState(true);
  const [compareSelection, setCompareSelection] = useState<Record<string, boolean>>({});
  const [compareMessage, setCompareMessage] = useState("");

  const loadCompare = useCallback(async () => {
    if (!selectedFolder || !selectedDeviceId) {
      setCompare(null);
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setCompare(null);
      setCompareError("当前文件夹已暂停，请先恢复后再进行接收审核。");
      return;
    }

    setCompareBusy(true);
    setCompareError("");
    try {
      const requestView = compareRequestView(compareView);
      const data = await getJSON<CompareResult>(
        `/rest/db/compare?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(requestView)}&prefix=${encodeURIComponent(comparePrefix)}&page=1&perpage=5000${compareIgnoreModTime ? "&ignoreModTime=true" : ""}`,
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
  }, [comparePrefix, compareView, compareIgnoreModTime, selectedDeviceId, selectedFolder]);

  const refreshCompare = useCallback(async (rescanLocal: boolean) => {
    if (!selectedFolder) {
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setCompare(null);
      setCompareError("当前文件夹已暂停，请先恢复后再进行接收审核。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("compare");
      try {
        await triggerFolderScan(selectedFolder.id);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadCompare();
  }, [loadCompare, selectedFolder]);

  useEffect(() => {
    if (!receiveModalOpen || !selectedFolder || !selectedDeviceId) {
      return;
    }
    void refreshCompare(true);
    const handle = window.setInterval(() => {
      void refreshCompare(!selectedFolder.fsWatcherEnabled);
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [panelRefreshSeconds, receiveModalOpen, refreshCompare, selectedDeviceId, selectedFolder]);

  const compareVisibleEntries = useMemo(
    () => (compare?.entries ?? []).filter((entry) => entry.canPrioritize),
    [compare],
  );

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
      await Promise.all([refreshCompare(true), loadBootstrap()]);
    } catch (error) {
      setCompareMessage(error instanceof Error ? error.message : "提交请求失败");
    }
  };


  return {
    state: {
      compare,
      compareBusy,
      compareError,
      compareView,
      comparePrefix,
      compareIgnoreModTime,
      compareSelection,
      compareMessage,
      compareVisibleEntries,
    },
    actions: {
      setCompareView,
      setComparePrefix,
      setCompareIgnoreModTime,
      setCompareSelection,
      loadCompare,
      refreshCompare,
      syncEntries,
    },
  };
}
