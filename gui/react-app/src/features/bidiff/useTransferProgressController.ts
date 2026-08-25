import { useEffect, useRef, useState } from "react";
import { getJSON, type DownloadProgressData, type ItemFinishedData, type SyncthingEvent } from "../../api";

type TransferProgressControllerOptions = {
  authenticated: boolean;
};

export function useTransferProgressController({ authenticated }: TransferProgressControllerOptions) {
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressData>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, Record<string, number>>>({});
  const [completedUploads, setCompletedUploads] = useState<Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }>>([]);
  const [completedDownloads, setCompletedDownloads] = useState<Array<{ folder: string; item: string; action: string; size: number; at: number }>>([]);
  const downloadFileSizeCacheRef = useRef<Record<string, number>>({}); // folder/file -> bytesTotal
  const [uploadFileInfo, setUploadFileInfo] = useState<Record<string, { totalBlocks: number; size: number }>>({});
  const uploadFileInfoRef = useRef(uploadFileInfo);
  uploadFileInfoRef.current = uploadFileInfo;
  const downloadProgressRef = useRef(downloadProgress);
  downloadProgressRef.current = downloadProgress;
  const uploadProgressRef = useRef(uploadProgress);
  uploadProgressRef.current = uploadProgress;
  const prevUploadRef = useRef<Record<string, Record<string, number>>>({});
  const lastUploadSeenRef = useRef<Record<string, Record<string, number>>>({});
  // Poll for DownloadProgress and ItemFinished events
  const lastEventIdRef = useRef(0);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const since = lastEventIdRef.current;
        const url = `/rest/events?since=${since}&limit=50&timeout=0&events=DownloadProgress,RemoteDownloadProgress,ItemFinished`;
        const events = await getJSON<SyncthingEvent[]>(url);
        if (cancelled || !events || events.length === 0) return;
        let maxId = since;
        let progressChanged = false;
        let uploadChanged = false;
        let newProgress = downloadProgressRef.current;
        let newUpload = { ...uploadProgressRef.current };
        const prevUpload = prevUploadRef.current;
        const newLastSeen = { ...lastUploadSeenRef.current };
        const newCompletedDownloads: Array<{ folder: string; item: string; action: string; size: number; at: number }> = [];
        const newCompletedUploads: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }> = [];
        for (const ev of events) {
          if (ev.id > maxId) maxId = ev.id;
          if (ev.type === "DownloadProgress") {
            const data = ev.data as unknown as DownloadProgressData;
            newProgress = data;
            progressChanged = true;
            for (const [folder, files] of Object.entries(data)) {
              for (const [file, info] of Object.entries(files)) {
                if (info.bytesTotal > 0) {
                  downloadFileSizeCacheRef.current[`${folder}/${file}`] = info.bytesTotal;
                }
              }
            }
          } else if (ev.type === "RemoteDownloadProgress") {
            const data = ev.data as { device: string; folder: string; state: Record<string, number> };
            if (!newUpload[data.folder]) newUpload[data.folder] = {};
            if (!newLastSeen[data.folder]) newLastSeen[data.folder] = {};
            newLastSeen[data.folder][data.device] = Date.now();
            const folderState = newUpload[data.folder];
            const devicePrefix = `${data.device}/`;
            const prevEntries: Record<string, number> = {};
            for (const key of Object.keys(folderState)) {
              if (key.startsWith(devicePrefix)) {
                prevEntries[key] = folderState[key];
                delete folderState[key];
              }
            }
            for (const [file, blockCount] of Object.entries(data.state)) {
              const key = `${data.device}/${file}`;
              folderState[key] = blockCount;
              delete prevEntries[key];
            }
            for (const [key, blocks] of Object.entries(prevEntries)) {
              const slashIdx = key.indexOf("/");
              const file = slashIdx > 0 ? key.slice(slashIdx + 1) : key;
              newCompletedUploads.push({ folder: data.folder, device: data.device, file, blocks, size: 0, at: Date.now() });
            }
            uploadChanged = true;
          } else if (ev.type === "ItemFinished") {
            const data = ev.data as unknown as ItemFinishedData;
            if (!data.error) {
              const cacheKey = `${data.folder}/${data.item}`;
              const size = downloadFileSizeCacheRef.current[cacheKey] ?? 0;
              delete downloadFileSizeCacheRef.current[cacheKey];
              newCompletedDownloads.push({ folder: data.folder, item: data.item, action: data.action, size, at: new Date(ev.time).getTime() });
            }
          }
        }
        lastEventIdRef.current = maxId;
        if (progressChanged) {
          setDownloadProgress(newProgress);
        }
        if (uploadChanged) {
          prevUploadRef.current = newUpload;
          lastUploadSeenRef.current = newLastSeen;
          setUploadProgress(newUpload);
        }
        if (newCompletedUploads.length > 0) {
          setCompletedUploads((prev) => [...newCompletedUploads, ...prev].slice(0, 100));
        }
        if (newCompletedDownloads.length > 0) {
          setCompletedDownloads((prev) => [...newCompletedDownloads, ...prev].slice(0, 200));
        }
      } catch {
        // ignore polling errors
      }
    };
    const handle = window.setInterval(poll, 1000);
    poll();
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [authenticated]);

  // Detect stale uploads per device per folder (events stopped coming)
  useEffect(() => {
    if (!authenticated) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const current = uploadProgressRef.current;
      const lastSeen = lastUploadSeenRef.current;
      const prev = prevUploadRef.current;
      const newCompleted: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }> = [];
      for (const [folder, files] of Object.entries(current)) {
        for (const [key, blocks] of Object.entries(files)) {
          const slashIdx = key.indexOf("/");
          const device = slashIdx > 0 ? key.slice(0, slashIdx) : "";
          const file = slashIdx > 0 ? key.slice(slashIdx + 1) : key;
          const lastDeviceSeen = lastSeen[folder]?.[device] ?? 0;
          if (now - lastDeviceSeen > 10000) {
            newCompleted.push({ folder, device, file, blocks, size: 0, at: now });
            delete current[folder][key];
          }
        }
        if (current[folder] && Object.keys(current[folder]).length === 0) {
          delete current[folder];
        }
      }
      if (newCompleted.length > 0) {
        prevUploadRef.current = { ...current };
        lastUploadSeenRef.current = { ...lastSeen };
        setUploadProgress({ ...current });
        setCompletedUploads((prev) => [...newCompleted, ...prev].slice(0, 100));
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [authenticated]);

  // Poll file info (total blocks, size) for currently uploading files
  useEffect(() => {
    if (!authenticated) return;
    const up = uploadProgress;
    const entries: Array<{ folder: string; file: string; key: string }> = [];
    for (const [folder, files] of Object.entries(up)) {
      for (const key of Object.keys(files)) {
        if (!uploadFileInfoRef.current[key]) {
          const slashIdx = key.indexOf("/");
          const file = slashIdx > 0 ? key.slice(slashIdx + 1) : key;
          entries.push({ folder, file, key });
        }
      }
    }
    if (entries.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        entries.map(async ({ folder, file, key }) => {
          const info = await getJSON<{ global?: { size: number; numBlocks?: number }; local?: { size: number; numBlocks?: number } }>(`/rest/db/file?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(file)}`);
          const fi = info?.global ?? info?.local;
          if (fi && typeof fi.size === "number") {
            return { key, totalBlocks: fi.numBlocks ?? 0, size: fi.size };
          }
          return null;
        })
      );
      if (cancelled) return;
      const newInfo: Record<string, { totalBlocks: number; size: number }> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          newInfo[r.value.key] = { totalBlocks: r.value.totalBlocks, size: r.value.size };
        }
      }
      if (Object.keys(newInfo).length > 0) {
        setUploadFileInfo((prev) => ({ ...prev, ...newInfo }));
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, uploadProgress]);

  // Periodically retry file info for uploads still showing "?"
  useEffect(() => {
    if (!authenticated) return;
    const interval = window.setInterval(() => {
      const current = uploadProgressRef.current;
      const fileInfo = uploadFileInfoRef.current;
      const missingKeys: string[] = [];
      for (const files of Object.values(current)) {
        for (const key of Object.keys(files)) {
          if (!fileInfo[key]) missingKeys.push(key);
        }
      }
      if (missingKeys.length > 0) {
        // Clear missing entries so the fetch useEffect re-triggers
        setUploadFileInfo((prev) => {
          const next = { ...prev };
          for (const k of missingKeys) delete next[k];
          return next;
        });
        // Force uploadProgress reference change to trigger the fetch effect
        setUploadProgress((prev) => ({ ...prev }));
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [authenticated]);


  return {
    downloadProgress,
    uploadProgress,
    completedUploads,
    completedDownloads,
    uploadFileInfo,
  };
}
