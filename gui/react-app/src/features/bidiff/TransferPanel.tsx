import { formatRate } from "../../components/review/review-formatters";

export default function TransferPanel(props: {
  folderId: string;
  downloadProgress?: Record<string, Record<string, { total: number; reused: number; copiedFromOrigin: number; copiedFromElsewhere: number; pulled: number; pulling: number; bytesDone: number; bytesTotal: number }>>;
  uploadProgress?: Record<string, Record<string, number>>;
  uploadFileInfo?: Record<string, { totalBlocks: number; size: number }>;
  completedUploads?: Array<{ folder: string; device: string; file: string; blocks: number; size: number; at: number }>;
  completedDownloads?: Array<{ folder: string; item: string; action: string; size: number; at: number }>;
  connectionRates?: { inbps: number; outbps: number };
  progressUpdateIntervalS?: number;
  onSaveProgressInterval?: (value: number) => void;
}) {
  const folderDownload = props.downloadProgress?.[props.folderId] ?? {};
  const folderUpload = props.uploadProgress?.[props.folderId] ?? {};
  const downloadingFiles = Object.entries(folderDownload).map(([path, p]) => ({
    path,
    ...p,
    percent: p.bytesTotal > 0 ? Math.round((100 * p.bytesDone) / p.bytesTotal) : 0,
  }));
  const uploadingFiles = Object.entries(folderUpload).map(([key, blockCount]) => {
    const info = props.uploadFileInfo?.[key];
    const totalBlocks = info?.totalBlocks ?? 0;
    const size = info?.size ?? 0;
    return {
      path: key.includes("/") ? key.slice(key.indexOf("/") + 1) : key,
      blocksDownloaded: blockCount,
      totalBlocks,
      size,
      percent: totalBlocks > 0 ? Math.round((100 * blockCount) / totalBlocks) : -1,
    };
  });
  const dlBytesDone = downloadingFiles.reduce((s, f) => s + f.bytesDone, 0);
  const dlBytesTotal = downloadingFiles.reduce((s, f) => s + f.bytesTotal, 0);
  const dlPulled = downloadingFiles.reduce((s, f) => s + f.pulled, 0);
  const dlBlocks = downloadingFiles.reduce((s, f) => s + f.total, 0);
  const ulBlocks = uploadingFiles.reduce((s, f) => s + f.blocksDownloaded, 0);
  const ulTotalBlocks = uploadingFiles.reduce((s, f) => s + f.totalBlocks, 0);
  const completedDownloadsForFolder = (props.completedDownloads ?? []).filter((d) => d.folder === props.folderId).slice(0, 30);
  const completedUploadsForFolder = (props.completedUploads ?? []).filter((u) => u.folder === props.folderId).slice(0, 30);
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };
  const formatElapsed = (ts: number) => {
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}秒前`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
    return `${Math.floor(sec / 3600)}小时前`;
  };
  return (
    <div className="transfer-panel">
      <div className="panel-subsection">
        <div className="section-title">传输概览</div>
        <div className="transfer-stats-grid">
          <div className="transfer-stat">
            <span className="transfer-stat-label">正在下载</span>
            <span className="transfer-stat-value">{downloadingFiles.length} 个文件</span>
          </div>
          <div className="transfer-stat">
            <span className="transfer-stat-label">正在上传</span>
            <span className="transfer-stat-value">{uploadingFiles.length} 个文件</span>
          </div>
          {downloadingFiles.length > 0 && (
            <div className="transfer-stat">
              <span className="transfer-stat-label">下载进度</span>
              <span className="transfer-stat-value">{formatSize(dlBytesDone)} / {formatSize(dlBytesTotal)}</span>
            </div>
          )}
          {downloadingFiles.length > 0 && (
            <div className="transfer-stat">
              <span className="transfer-stat-label">下载块</span>
              <span className="transfer-stat-value">{dlPulled} / {dlBlocks}</span>
            </div>
          )}
          {uploadingFiles.length > 0 && (
            <div className="transfer-stat">
              <span className="transfer-stat-label">上传块</span>
              <span className="transfer-stat-value">{ulBlocks} / {ulTotalBlocks > 0 ? ulTotalBlocks : "?"}{ulTotalBlocks > 0 ? ` (${Math.round((100 * ulBlocks) / ulTotalBlocks)}%)` : ""}</span>
            </div>
          )}
          <div className="transfer-stat">
            <span className="transfer-stat-label">下行速率</span>
            <span className="transfer-stat-value">{formatRate(props.connectionRates?.inbps)}</span>
          </div>
          <div className="transfer-stat">
            <span className="transfer-stat-label">上行速率</span>
            <span className="transfer-stat-value">{formatRate(props.connectionRates?.outbps)}</span>
          </div>
          <div className="transfer-stat">
            <span className="transfer-stat-label">刷新间隔</span>
            <span className="transfer-stat-value" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <select
                value={props.progressUpdateIntervalS ?? 1}
                onChange={(e) => props.onSaveProgressInterval?.(Number(e.target.value))}
                style={{ fontSize: "0.75rem", padding: "1px 2px", borderRadius: 3, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
              >
                <option value={1}>1秒</option>
                <option value={2}>2秒</option>
                <option value={5}>5秒</option>
                <option value={10}>10秒</option>
              </select>
            </span>
          </div>
        </div>
      </div>

      {downloadingFiles.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">正在下载 ({downloadingFiles.length})</div>
          <div className="transfer-file-list">
            {downloadingFiles.map((file) => (
              <div key={file.path} className="transfer-file-item">
                <div className="transfer-file-header">
                  <span className="transfer-file-path" title={file.path}>{file.path}</span>
                  <span className="transfer-file-percent">{file.percent}%</span>
                </div>
                <div className="transfer-progress-bar">
                  <div className="transfer-progress-fill" style={{ width: `${file.percent}%` }} />
                </div>
                <div className="transfer-file-detail">
                  {formatSize(file.bytesDone)} / {formatSize(file.bytesTotal)}
                  {" · 块"} {file.pulled} / {file.total}
                  {file.pulling > 0 && ` · 传输中 ${file.pulling}`}
                  {file.reused > 0 && ` · 复用 ${file.reused}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadingFiles.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">正在上传 ({uploadingFiles.length})</div>
          <div className="transfer-file-list">
            {uploadingFiles.map((file) => (
              <div key={file.path} className="transfer-file-item">
                <div className="transfer-file-header">
                  <span className="transfer-active-dot" />
                  <span className="transfer-file-path" title={file.path}>{file.path}</span>
                  {file.percent >= 0 && <span className="transfer-file-percent">{file.percent}%</span>}
                </div>
                {file.percent >= 0 ? (
                  <div className="transfer-progress-bar">
                    <div className="transfer-progress-fill" style={{ width: `${file.percent}%` }} />
                  </div>
                ) : (
                  <div className="transfer-progress-bar transfer-progress-indeterminate">
                    <div className="transfer-progress-fill" />
                  </div>
                )}
                <div className="transfer-file-detail">
                  {file.size > 0 && `${formatSize(file.size)} · `}
                  {file.blocksDownloaded} / {file.totalBlocks > 0 ? file.totalBlocks : "?"} 块
                  {file.totalBlocks > 0 && ` · ${file.percent}%`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {downloadingFiles.length === 0 && uploadingFiles.length === 0 && (
        <div className="panel-subsection">
          <div className="empty-mini">当前没有正在传输的文件。</div>
        </div>
      )}

      {completedUploadsForFolder.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">上传完成 ({completedUploadsForFolder.length})</div>
          <div className="transfer-file-list">
            {completedUploadsForFolder.map((item, i) => (
              <div key={`${item.file}-${i}`} className="transfer-file-item finished">
                <div className="transfer-file-header">
                  <span className="transfer-file-path" title={item.file}>{item.file}</span>
                  <span className="transfer-file-time">{formatElapsed(item.at)}</span>
                </div>
                <div className="transfer-file-detail">
                  {item.size > 0 && `${formatSize(item.size)} · `}
                  已传 {item.blocks} 个块 · {formatTime(item.at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedDownloadsForFolder.length > 0 && (
        <div className="panel-subsection">
          <div className="section-title">下载完成 ({completedDownloadsForFolder.length})</div>
          <div className="transfer-file-list">
            {completedDownloadsForFolder.map((item, i) => (
              <div key={`${item.item}-${i}`} className="transfer-file-item finished">
                <div className="transfer-file-header">
                  <span className="transfer-file-path" title={item.item}>{item.item}</span>
                  <span className="transfer-file-time">{formatElapsed(item.at)}</span>
                </div>
                <div className="transfer-file-detail">
                  {item.size > 0 && `${formatSize(item.size)} · `}
                  {item.action === "update" ? "更新" : item.action === "delete" ? "删除" : item.action === "create" ? "创建" : item.action}
                  {" · "}{formatTime(item.at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

