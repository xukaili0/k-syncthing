import { useCallback, useEffect, useMemo, useState } from "react";
import { getJSON, postJSON, triggerFolderScan, type FolderConfig, type PendingPublishEntry, type PendingPublishResult } from "../../api";
import { isPausedFolder } from "../../components/review/review-formatters";

type PanelScanBusy = "" | "compare" | "bidiff" | "peerdiff" | "publish";

type PublishControllerOptions = {
  selectedFolder: FolderConfig | null;
  modalOpen: boolean;
  panelRefreshSeconds: number;
  setPanelScanBusy: (value: PanelScanBusy) => void;
  loadBootstrap: () => Promise<void>;
};

export function usePublishController({
  selectedFolder,
  modalOpen: publishModalOpen,
  panelRefreshSeconds,
  setPanelScanBusy,
  loadBootstrap,
}: PublishControllerOptions) {
  const [publish, setPublish] = useState<PendingPublishResult | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishView, setPublishView] = useState("all");
  const [publishPrefix, setPublishPrefix] = useState("");
  const [publishSelection, setPublishSelection] = useState<Record<string, boolean>>({});
  const [publishMessage, setPublishMessage] = useState("");
  const loadPublish = useCallback(async () => {
    if (!selectedFolder) {
      setPublish(null);
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setPublish(null);
      setPublishError("当前文件夹已暂停，请先恢复后再进行发布审核。");
      return;
    }

    setPublishBusy(true);
    setPublishError("");
    try {
      const data = await getJSON<PendingPublishResult>(
        `/rest/db/pendingpublish?folder=${encodeURIComponent(selectedFolder.id)}&view=${encodeURIComponent(publishView)}&prefix=${encodeURIComponent(publishPrefix)}&page=1&perpage=5000`,
      );
      setPublish(data);
      setPublishSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path] && (entry.canPublish || entry.canClear)) {
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

  const refreshPublish = useCallback(async (rescanLocal: boolean) => {
    if (!selectedFolder) {
      return;
    }
    if (isPausedFolder(selectedFolder)) {
      setPublish(null);
      setPublishError("当前文件夹已暂停，请先恢复后再进行发布审核。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("publish");
      try {
        await triggerFolderScan(selectedFolder.id);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadPublish();
  }, [loadPublish, selectedFolder]);

  useEffect(() => {
    if (!publishModalOpen || !selectedFolder) {
      return;
    }
    void refreshPublish(true);
    const handle = window.setInterval(() => {
      void refreshPublish(!selectedFolder.fsWatcherEnabled);
    }, panelRefreshSeconds * 1000);
    return () => window.clearInterval(handle);
  }, [panelRefreshSeconds, publishModalOpen, refreshPublish, selectedFolder]);

  const publishVisibleEntries = useMemo(
    () => (publish?.entries ?? []).filter((entry) => entry.canPublish),
    [publish],
  );
  const publishClearableEntries = useMemo(
    () => (publish?.entries ?? []).filter((entry) => entry.canClear),
    [publish],
  );

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
      await Promise.all([refreshPublish(true), loadBootstrap()]);
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "发布请求失败");
    }
  };

  const clearSettledPublishEntries = async (entries: PendingPublishEntry[]) => {
    if (!selectedFolder) {
      return;
    }
    if (entries.length === 0) {
      setPublishMessage("当前没有可清理的已收敛待发布项。");
      return;
    }
    setPublishMessage("正在清理已收敛待发布标记...");
    try {
      await postJSON(`/rest/db/clearpendingpublish?folder=${encodeURIComponent(selectedFolder.id)}`, {
        files: entries.map((entry) => entry.path),
      });
      setPublishMessage(`已清理 ${entries.length} 项已收敛待发布标记。`);
      setPublishSelection((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          delete next[entry.path];
        }
        return next;
      });
      await Promise.all([refreshPublish(true), loadBootstrap()]);
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : "清理已收敛待发布标记失败");
    }
  };


  return {
    state: {
      publish,
      publishBusy,
      publishError,
      publishView,
      publishPrefix,
      publishSelection,
      publishMessage,
      publishVisibleEntries,
      publishClearableEntries,
    },
    actions: {
      setPublishView,
      setPublishPrefix,
      setPublishSelection,
      loadPublish,
      refreshPublish,
      publishEntries,
      clearSettledPublishEntries,
    },
  };
}
