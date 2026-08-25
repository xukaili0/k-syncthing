import { useCallback, useEffect, useMemo, useState } from "react";
import { getJSON, postJSON, triggerFolderScan, type BiDiffEntry, type BiDiffResult, type CompletionStatus, type FolderConfig } from "../../api";
import { bidiffRequestView, isPausedFolder } from "../../components/review/review-formatters";
import { useReviewAutoRefresh } from "../../hooks/useReviewAutoRefresh";
import { bidiffTaskKey, type BiDiffTask, type BiDiffTaskStatus } from "./bidiff-model";

type PanelScanBusy = "" | "compare" | "bidiff" | "peerdiff" | "publish";

type BiDiffControllerOptions = {
  selectedFolder: FolderConfig | null;
  selectedDeviceId: string;
  completions: Record<string, Record<string, CompletionStatus>>;
  bidiffModalOpen: boolean;
  peerDiffModalOpen: boolean;
  panelRefreshSeconds: number;
  setPanelScanBusy: (value: PanelScanBusy) => void;
  loadBootstrap: () => Promise<void>;
  refreshCompare: (rescanLocal: boolean) => Promise<void>;
  refreshPublish: (rescanLocal: boolean) => Promise<void>;
};

export function useBiDiffController({
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
}: BiDiffControllerOptions) {
  const [bidiff, setBiDiff] = useState<BiDiffResult | null>(null);
  const [bidiffBusy, setBiDiffBusy] = useState(false);
  const [bidiffError, setBiDiffError] = useState("");
  const [bidiffView, setBiDiffView] = useState("different");
  const [bidiffPrefix, setBiDiffPrefix] = useState("");
  const [bidiffIgnoreModTime, setBiDiffIgnoreModTime] = useState(true);
  const [bidiffSelection, setBiDiffSelection] = useState<Record<string, boolean>>({});
  const [bidiffMessage, setBiDiffMessage] = useState("");
  const [bidiffTasks, setBiDiffTasks] = useState<Record<string, BiDiffTask>>({});
  const [bidiffAutoRefreshPaused, setBidiffAutoRefreshPaused] = useState(false);
  const [bidiffWorkbenchView, setBidiffWorkbenchView] = useState<"diff" | "transfer">("diff");

  const [peerDiff, setPeerDiff] = useState<BiDiffResult | null>(null);
  const [peerDiffBusy, setPeerDiffBusy] = useState(false);
  const [peerDiffError, setPeerDiffError] = useState("");
  const [peerDiffView, setPeerDiffView] = useState("different");
  const [peerDiffPrefix, setPeerDiffPrefix] = useState("");
  const [peerDiffIgnoreModTime, setPeerDiffIgnoreModTime] = useState(true);
  const [peerDiffSelection, setPeerDiffSelection] = useState<Record<string, boolean>>({});
  const [peerDiffMessage, setPeerDiffMessage] = useState("");
  const [peerDiffTasks, setPeerDiffTasks] = useState<Record<string, BiDiffTask>>({});
  const [peerDiffAutoRefreshPaused, setPeerDiffAutoRefreshPaused] = useState(false);
  const [peerWorkbenchView, setPeerWorkbenchView] = useState<"diff" | "transfer">("diff");
  const folderId = selectedFolder?.id ?? "";
  const folderPaused = isPausedFolder(selectedFolder);

  const loadBiDiff = useCallback(async () => {
    if (!folderId || !selectedDeviceId) {
      setBiDiff(null);
      return;
    }
    if (folderPaused) {
      setBiDiff(null);
      setBiDiffError("当前文件夹已暂停，请先恢复后再进行双向接发。");
      return;
    }

    setBiDiffBusy(true);
    setBiDiffError("");
    try {
      const requestView = bidiffRequestView(bidiffView);
      const data = await getJSON<BiDiffResult>(
        `/rest/db/bidiff?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(requestView)}&prefix=${encodeURIComponent(bidiffPrefix)}&page=1&perpage=5000${bidiffIgnoreModTime ? "&ignoreModTime=true" : ""}`,
      );
      setBiDiff(data);
      setBiDiffSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path]) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setBiDiffError(error instanceof Error ? error.message : "加载双向接发失败");
    } finally {
      setBiDiffBusy(false);
    }
  }, [bidiffIgnoreModTime, bidiffPrefix, bidiffView, folderId, folderPaused, selectedDeviceId]);

  const refreshBiDiff = useCallback(async (rescanLocal: boolean) => {
    if (!folderId) {
      return;
    }
    if (folderPaused) {
      setBiDiff(null);
      setBiDiffError("当前文件夹已暂停，请先恢复后再进行双向接发。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("bidiff");
      try {
        await triggerFolderScan(folderId);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadBiDiff();
  }, [folderId, folderPaused, loadBiDiff, setPanelScanBusy]);

  const loadPeerDiff = useCallback(async () => {
    if (!folderId || !selectedDeviceId) {
      setPeerDiff(null);
      return;
    }
    if (folderPaused) {
      setPeerDiff(null);
      setPeerDiffError("当前文件夹已暂停，请先恢复后再查看直传差异。");
      return;
    }

    setPeerDiffBusy(true);
    setPeerDiffError("");
    try {
      const requestView = bidiffRequestView(peerDiffView);
      const data = await getJSON<BiDiffResult>(
        `/rest/db/peerdiff?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(selectedDeviceId)}&view=${encodeURIComponent(requestView)}&prefix=${encodeURIComponent(peerDiffPrefix)}&page=1&perpage=5000${peerDiffIgnoreModTime ? "&ignoreModTime=true" : ""}`,
      );
      setPeerDiff(data);
      setPeerDiffSelection((previous) => {
        const next: Record<string, boolean> = {};
        for (const entry of data.entries) {
          if (previous[entry.path]) {
            next[entry.path] = true;
          }
        }
        return next;
      });
    } catch (error) {
      setPeerDiffError(error instanceof Error ? error.message : "加载直传工作台失败");
    } finally {
      setPeerDiffBusy(false);
    }
  }, [folderId, folderPaused, peerDiffIgnoreModTime, peerDiffPrefix, peerDiffView, selectedDeviceId]);

  const refreshPeerDiff = useCallback(async (rescanLocal: boolean) => {
    if (!folderId) {
      return;
    }
    if (folderPaused) {
      setPeerDiff(null);
      setPeerDiffError("当前文件夹已暂停，请先恢复后再查看直传差异。");
      return;
    }
    if (rescanLocal) {
      setPanelScanBusy("peerdiff");
      try {
        await triggerFolderScan(folderId);
      } finally {
        setPanelScanBusy("");
      }
    }
    await loadPeerDiff();
  }, [folderId, folderPaused, loadPeerDiff, setPanelScanBusy]);

  const initialBiDiffRefresh = useCallback(() => refreshBiDiff(true), [refreshBiDiff]);
  const intervalBiDiffRefresh = useCallback(() => refreshBiDiff(false), [refreshBiDiff]);
  useReviewAutoRefresh({
    enabled: bidiffModalOpen && Boolean(folderId) && Boolean(selectedDeviceId),
    paused: bidiffAutoRefreshPaused,
    intervalSeconds: panelRefreshSeconds,
    onInitialRefresh: initialBiDiffRefresh,
    onIntervalRefresh: intervalBiDiffRefresh,
  });

  const initialPeerDiffRefresh = useCallback(() => refreshPeerDiff(true), [refreshPeerDiff]);
  const intervalPeerDiffRefresh = useCallback(() => refreshPeerDiff(false), [refreshPeerDiff]);
  useReviewAutoRefresh({
    enabled: peerDiffModalOpen && Boolean(folderId) && Boolean(selectedDeviceId),
    paused: peerDiffAutoRefreshPaused,
    intervalSeconds: panelRefreshSeconds,
    onInitialRefresh: initialPeerDiffRefresh,
    onIntervalRefresh: intervalPeerDiffRefresh,
  });

  useEffect(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    setBiDiffTasks((previous) => {
      const next = { ...previous };
      const entryMap = new Map((bidiff?.entries ?? []).map((entry) => [entry.path, entry]));
      let changed = false;
      for (const [key, task] of Object.entries(previous)) {
        if (task.folderId !== selectedFolder.id || task.deviceId !== selectedDeviceId) {
          continue;
        }
        if (task.status === "failed" || task.status === "completed") {
          continue;
        }
        const entry = entryMap.get(task.path);
        const stillActionable =
          task.direction === "left-to-right" ? entry?.canApplyLeftToRight : entry?.canApplyRightToLeft;
        let nextStatus: BiDiffTaskStatus = task.status;
        if (!entry || !stillActionable) {
          nextStatus = "completed";
        } else if (
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "syncing" ||
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "scanning" ||
          bidiffBusy
        ) {
          nextStatus = "processing";
        } else if (task.status === "queued") {
          nextStatus = "submitted";
        }
        if (nextStatus !== task.status) {
          next[key] = { ...task, status: nextStatus, updatedAt: Date.now() };
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [bidiff, bidiffBusy, completions, selectedDeviceId, selectedFolder]);

  useEffect(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    setPeerDiffTasks((previous) => {
      const next = { ...previous };
      const entryMap = new Map((peerDiff?.entries ?? []).map((entry) => [entry.path, entry]));
      const resultMap = new Map(
        (peerDiff?.peerApplyResults ?? []).map((result) => [`${result.direction}::${result.path}`, result]),
      );
      let changed = false;
      for (const [key, task] of Object.entries(previous)) {
        if (task.folderId !== selectedFolder.id || task.deviceId !== selectedDeviceId) {
          continue;
        }
        if (task.status === "failed" || task.status === "completed") {
          continue;
        }
        const result = resultMap.get(`${task.direction}::${task.path}`);
        if (result) {
          const nextStatus = result.status === "failed" ? "failed" : "completed";
          next[key] = {
            ...task,
            status: nextStatus,
            error: result.status === "failed" ? result.message || "远端显式应用失败" : undefined,
            updatedAt: Date.now(),
          };
          changed = true;
          continue;
        }
        const entry = entryMap.get(task.path);
        const stillActionable =
          task.direction === "left-to-right" ? entry?.canApplyLeftToRight : entry?.canApplyRightToLeft;
        let nextStatus: BiDiffTaskStatus = task.status;
        if (!entry || !stillActionable) {
          nextStatus = "completed";
        } else if (
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "syncing" ||
          completions[selectedDeviceId]?.[selectedFolder.id]?.remoteState === "scanning" ||
          peerDiffBusy
        ) {
          nextStatus = "processing";
        } else if (task.status === "queued") {
          nextStatus = "submitted";
        }
        if (nextStatus !== task.status) {
          next[key] = { ...task, status: nextStatus, updatedAt: Date.now() };
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [completions, peerDiff, peerDiffBusy, selectedDeviceId, selectedFolder]);

  const bidiffVisibleLeftToRightEntries = useMemo(
    () => (bidiff?.entries ?? []).filter((entry) => entry.canApplyLeftToRight),
    [bidiff],
  );

  const bidiffVisibleRightToLeftEntries = useMemo(
    () => (bidiff?.entries ?? []).filter((entry) => entry.canApplyRightToLeft),
    [bidiff],
  );

  const activeBiDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(bidiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .filter((task) => task.status !== "completed")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bidiffTasks, selectedDeviceId, selectedFolder]);

  const allBiDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(bidiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bidiffTasks, selectedDeviceId, selectedFolder]);

  const activePeerDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(peerDiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .filter((task) => task.status !== "completed")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [peerDiffTasks, selectedDeviceId, selectedFolder]);

  const allPeerDiffTasks = useMemo(() => {
    if (!selectedFolder || !selectedDeviceId) {
      return [];
    }
    return Object.values(peerDiffTasks)
      .filter((task) => task.folderId === selectedFolder.id && task.deviceId === selectedDeviceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [peerDiffTasks, selectedDeviceId, selectedFolder]);

  const applyBiDiffEntries = async (direction: "left-to-right" | "right-to-left", entries: BiDiffEntry[]) => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    if (entries.length === 0) {
      setBiDiffMessage("当前没有可执行的已选条目。");
      return;
    }
    const directionLabel = direction === "left-to-right" ? "采用左侧到右侧" : "采用右侧到左侧";
    const summary = entries.length === 1 ? `\n\n${entries[0].path}` : `\n\n共 ${entries.length} 项`;
    if (!window.confirm(`确认执行"${directionLabel}"？${summary}`)) {
      return;
    }
    const now = Date.now();
    setBiDiffTasks((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
        next[key] = {
          key,
          folderId: selectedFolder.id,
          deviceId: selectedDeviceId,
          path: entry.path,
          direction,
          status: "submitted",
          updatedAt: now,
        };
      }
      return next;
    });
    setBiDiffMessage(direction === "left-to-right" ? "正在采用左侧状态..." : "正在采用右侧状态...");
    try {
      await postJSON(
        `/rest/db/bidiffapply?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}`,
        {
          direction,
          files: entries.map((entry) => entry.path),
        },
      );
      setBiDiffMessage(direction === "left-to-right" ? "已提交左侧到右侧的接发动作。" : "已提交右侧到左侧的接发动作。");
      setBiDiffSelection({});
      await Promise.all([refreshBiDiff(true), loadBootstrap(), refreshCompare(true), refreshPublish(true)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "双向接发提交失败";
      setBiDiffTasks((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
          const current = next[key];
          if (!current) {
            continue;
          }
          next[key] = { ...current, status: "failed", error: message, updatedAt: Date.now() };
        }
        return next;
      });
      setBiDiffMessage(message);
    }
  };

  const applyPeerDiffEntries = async (direction: "left-to-right" | "right-to-left", entries: BiDiffEntry[]) => {
    if (!selectedFolder || !selectedDeviceId) {
      return;
    }
    if (entries.length === 0) {
      setPeerDiffMessage("当前没有可执行的已选条目。");
      return;
    }
    const directionLabel = direction === "left-to-right" ? "采用左侧到右侧" : "采用右侧到左侧";
    const summary = entries.length === 1 ? `\n\n${entries[0].path}` : `\n\n共 ${entries.length} 项`;
    if (!window.confirm(`确认执行"${directionLabel}"？${summary}`)) {
      return;
    }
    const now = Date.now();
    setPeerDiffTasks((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
        next[key] = {
          key,
          folderId: selectedFolder.id,
          deviceId: selectedDeviceId,
          path: entry.path,
          direction,
          status: "submitted",
          updatedAt: now,
        };
      }
      return next;
    });
    setPeerDiffMessage(direction === "left-to-right" ? "正在将左侧状态应用到右侧..." : "正在将右侧状态应用到左侧...");
    try {
      await postJSON(
        `/rest/db/peerdiffapply?folder=${encodeURIComponent(selectedFolder.id)}&device=${encodeURIComponent(selectedDeviceId)}`,
        {
          direction,
          files: entries.map((entry) => entry.path),
        },
      );
      setPeerDiffMessage(direction === "left-to-right" ? "已提交左侧到右侧的直传动作。" : "已提交右侧到左侧的直传动作。");
      setPeerDiffSelection({});
      await Promise.all([refreshPeerDiff(true), loadBootstrap(), refreshCompare(true), refreshPublish(true)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "直传提交失败";
      setPeerDiffTasks((previous) => {
        const next = { ...previous };
        for (const entry of entries) {
          const key = bidiffTaskKey(selectedFolder.id, selectedDeviceId, direction, entry.path);
          const current = next[key];
          if (!current) {
            continue;
          }
          next[key] = { ...current, status: "failed", error: message, updatedAt: Date.now() };
        }
        return next;
      });
      setPeerDiffMessage(message);
    }
  };


  return {
    state: {
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
    },
    actions: {
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
      loadBiDiff,
      refreshBiDiff,
      loadPeerDiff,
      refreshPeerDiff,
      applyBiDiffEntries,
      applyPeerDiffEntries,
    },
  };
}
