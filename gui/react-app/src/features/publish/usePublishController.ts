import { useCallback, useMemo, useState } from "react";
import { getJSON, postJSON, triggerFolderScan, type FolderConfig, type PendingPublishEntry, type PendingPublishResult } from "../../api";
import { isPausedFolder } from "../../components/review/review-formatters";
import { useReviewAutoRefresh } from "../../hooks/useReviewAutoRefresh";

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
  const folderId = selectedFolder?.id ?? "";
  const folderPaused = isPausedFolder(selectedFolder);

  const loadPublish = useCallback(async () => {
    if (!folderId) {
      setPublish(null);
      return;
    }
    if (folderPaused) {
      setPublish(null);
      setPublishError("当前文件夹已暂停，请先恢复后再进行发布审核。");
      return;
    }

    setPublishBusy(true);
    setPublishError("");
    try {
      const data = await getJSON<PendingPublishResult>(
        `/rest/db/pendingpublish?folder=${encodeURIComponent(folderId)}&view=${encodeURIComponent(publishView)}&prefix=${encodeURIComponent(publishPrefix)}&page=1&perpage=5000`,
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
  }, [folderId, folderPaused, publishPrefix, publishView]);

  const refreshPublish = useCallback(async (rescanLocal: boolean) => {
    if (!folderId) {
      return;
    }
    if (folderPaused) {
      setPublish(null);
      setPublishError("当前文件夹已暂停，请先恢复后再进行发布审核。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("publish");
      try {
        await triggerFolderScan(folderId);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadPublish();
  }, [folderId, folderPaused, loadPublish, setPanelScanBusy]);

  const initialRefresh = useCallback(() => refreshPublish(true), [refreshPublish]);
  const intervalRefresh = useCallback(() => refreshPublish(false), [refreshPublish]);
  useReviewAutoRefresh({
    enabled: publishModalOpen && Boolean(folderId),
    intervalSeconds: panelRefreshSeconds,
    onInitialRefresh: initialRefresh,
    onIntervalRefresh: intervalRefresh,
  });

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
