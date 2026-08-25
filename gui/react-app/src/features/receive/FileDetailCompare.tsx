import { useEffect, useState } from "react";
import { getJSON, type CompareEntry, type JsonFileInfo } from "../../api";

type FileBlocksResponse = {
  local?: { size: number; Blocks?: { Hash?: string | number[]; Offset?: number; Size?: number }[] };
  global?: { size: number; Blocks?: { Hash?: string | number[]; Offset?: number; Size?: number }[] };
};

export default function FileDetailCompare({ entry, folder, onClose }: { entry: CompareEntry; folder: string; onClose: () => void }) {
  const [showBlocks, setShowBlocks] = useState(false);
  const [blockData, setBlockData] = useState<FileBlocksResponse | null>(null);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blocksError, setBlocksError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setBlocksLoading(true);
    setBlocksError("");
    getJSON<FileBlocksResponse>(`/rest/db/file?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(entry.path)}`)
      .then((data) => { if (!cancelled) setBlockData(data); })
      .catch((err: unknown) => { if (!cancelled) { setBlockData(null); setBlocksError(err instanceof Error ? err.message : String(err)); } })
      .finally(() => { if (!cancelled) setBlocksLoading(false); });
    return () => { cancelled = true; };
  }, [folder, entry.path]);

  function formatTime(modified: string | undefined): string {
    if (!modified) return "—";
    try { return new Date(modified).toLocaleString("zh-CN"); } catch { return modified; }
  }

  function formatBytes(val: number | string | undefined): string {
    if (val === undefined || val === null) return "—";
    const n = typeof val === "string" ? parseInt(val, 10) : val;
    if (isNaN(n)) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MiB`;
    return `${(n / 1073741824).toFixed(2)} GiB`;
  }

  function hashToHex(h: string | number[] | null | undefined): string {
    if (!h) return "—";
    if (typeof h === "string") {
      try {
        const raw = atob(h);
        let hex = "";
        for (let i = 0; i < raw.length; i++) hex += raw.charCodeAt(i).toString(16).padStart(2, "0");
        return hex;
      } catch { return h; }
    }
    if (Array.isArray(h)) return h.map((b) => b.toString(16).padStart(2, "0")).join("");
    return "—";
  }

  function blocksEqual(a: JsonFileInfo | undefined, b: JsonFileInfo | undefined): boolean {
    const ha = hashToHex(a?.blocksHash ?? null);
    const hb = hashToHex(b?.blocksHash ?? null);
    return ha !== "—" && hb !== "—" && ha === hb;
  }

  function fileField(label: string, localVal: string, remoteVal: string, eq: boolean) {
    return (
      <tr>
        <td style={{ fontWeight: 600, whiteSpace: "nowrap", paddingRight: 16 }}>{label}</td>
        <td className={eq ? "" : "tone-warning"}>{localVal}</td>
        <td className={eq ? "" : "tone-warning"}>{remoteVal}</td>
      </tr>
    );
  }

  const local = entry.local;
  const remote = entry.remote;
  const sizeEq = local && remote ? local.size === remote.size : false;
  const mtimeEq = local && remote ? local.modified === remote.modified : false;
  const blockHashEq = blocksEqual(local, remote);

  const localBlocks = blockData?.local?.Blocks ?? [];
  const remoteBlocks = blockData?.global?.Blocks ?? [];
  const hasBlockData = localBlocks.length > 0 || remoteBlocks.length > 0;
  const maxBlocks = Math.max(localBlocks.length, remoteBlocks.length);

  return (
    <div className="panel panel-default" style={{ marginBottom: 12 }}>
      <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>📋 文件详细对比：{entry.path}</strong>
        <button className="ghost-button compact-button" onClick={onClose}>✕ 关闭</button>
      </div>
      <div className="panel-body" style={{ maxHeight: 480, overflow: "auto" }}>
        <table className="table table-condensed table-bordered" style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ width: "25%" }}>字段</th>
              <th style={{ width: "37.5%" }}>本地</th>
              <th style={{ width: "37.5%" }}>远端</th>
            </tr>
          </thead>
          <tbody>
            {fileField("类型", local?.type ?? "—", remote?.type ?? "—", local?.type === remote?.type)}
            {fileField("大小", formatBytes(local?.size), formatBytes(remote?.size), sizeEq)}
            {fileField("修改时间", formatTime(local?.modified), formatTime(remote?.modified), mtimeEq)}
            {fileField("已删除", local?.deleted ? "是" : "否", remote?.deleted ? "是" : "否", !local?.deleted === !remote?.deleted)}
            {fileField("权限", local ? `0o${(local as any).permissions?.toString(8) ?? "—"}` : "—", remote ? `0o${(remote as any).permissions?.toString(8) ?? "—"}` : "—", (local as any)?.permissions === (remote as any)?.permissions)}
            {fileField("修改者", local?.modifiedBy ?? "—", remote?.modifiedBy ?? "—", local?.modifiedBy === remote?.modifiedBy)}
            {fileField("本地标记", `0x${(local?.localFlags ?? 0).toString(16)}`, `0x${(remote?.localFlags ?? 0).toString(16)}`, local?.localFlags === remote?.localFlags)}
            {fileField("BlocksHash", hashToHex(local?.blocksHash ?? null).substring(0, 32) + "...", hashToHex(remote?.blocksHash ?? null).substring(0, 32) + "...", blockHashEq)}
            {fileField("块列表大小", localBlocks.length > 0 ? `${localBlocks.length} 个块` : "—", remoteBlocks.length > 0 ? `${remoteBlocks.length} 个块` : "—", localBlocks.length === remoteBlocks.length && localBlocks.length > 0)}
          </tbody>
        </table>

        <div style={{ marginTop: 12 }}>
          <button className="ghost-button compact-button" onClick={() => { if (!showBlocks && !blockData) setBlocksLoading(true); setShowBlocks(!showBlocks); }}>
            {blocksLoading ? "⏳ 加载块数据中..." : showBlocks ? "▾ 隐藏块列表" : "▸ 展开块列表"}
          </button>
          {showBlocks && blocksLoading && <span className="text-muted" style={{ marginLeft: 12 }}>正在从服务器获取完整块数据...</span>}
          {showBlocks && !blocksLoading && hasBlockData && (
            <table className="table table-condensed table-bordered" style={{ marginTop: 8, marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>块号</th>
                  <th>本地哈希 (SHA-256)</th>
                  <th>远端哈希 (SHA-256)</th>
                  <th>偏移</th>
                  <th>大小</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxBlocks }, (_, i) => {
                  const lb = localBlocks[i];
                  const rb = remoteBlocks[i];
                  const lh = lb?.Hash ? hashToHex((lb.Hash as any)).substring(0, 16) : "—";
                  const rh = rb?.Hash ? hashToHex((rb.Hash as any)).substring(0, 16) : "—";
                  const match = lb && rb && lh !== "—" && rh !== "—" && lh === rh;
                  return (
                    <tr key={i} className={match ? "" : "tone-warning"}>
                      <td>{i}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }} title={lb?.Hash ? hashToHex((lb.Hash as any)) : ""}>{lh}...</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }} title={rb?.Hash ? hashToHex((rb.Hash as any)) : ""}>{rh}...</td>
                      <td>{lb?.Offset ?? rb?.Offset ?? "—"}</td>
                      <td>{formatBytes(lb?.Size ?? rb?.Size)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {showBlocks && !blocksLoading && !hasBlockData && !blocksError && (
            <div className="text-muted" style={{ marginTop: 8 }}>
              无法获取块数据：API 返回的 local/global 中均无 Blocks 字段。可能原因：① 该文件的块列表尚未写入数据库；② 该文件是远端文件，本地未存储其块详情。
            </div>
          )}
          {showBlocks && !blocksLoading && blocksError && (
            <div className="inline-message danger" style={{ marginTop: 8 }}>
              API 请求失败：{blocksError}
            </div>
          )}
          {showBlocks && !blocksLoading && blockData && (
            <div className="text-muted small" style={{ marginTop: 4 }}>
              API 响应：local={blockData.local ? "有" : "无"} · global={blockData.global ? "有" : "无"} · 本地块数={(blockData.local as any)?.Blocks?.length ?? 0} · 全局块数={(blockData.global as any)?.Blocks?.length ?? 0}
            </div>
          )}
        </div>

        {!blockHashEq && local && remote && (
          <div className="inline-message warning" style={{ marginTop: 12 }}>
            ⚠️ BlocksHash 不一致：虽然文件大小相同，但实际内容不同。差异字段已用橙色高亮。
          </div>
        )}
        {blockHashEq && local && remote && (
          <div className="inline-message success" style={{ marginTop: 12 }}>
            ✅ BlocksHash 一致：文件内容完全相同，差异仅在于元数据（如修改时间）。
          </div>
        )}
      </div>
    </div>
  );
}

