import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { exportIdentity, getIdentityInfo, importIdentity, type IdentityInfo } from "../../api";

export default function IdentityBackupPanel(props: {
  onClose: () => void;
}) {
  const [identityInfo, setIdentityInfo] = useState<IdentityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadIdentityInfo();
  }, []);

  const loadIdentityInfo = async () => {
    setLoading(true);
    setError("");
    try {
      const info = await getIdentityInfo();
      setIdentityInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load identity info");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExportBusy(true);
    setError("");
    try {
      const blob = await exportIdentity();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "syncthing-identity.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportBusy(true);
    setError("");
    setImportResult("");
    try {
      const result = await importIdentity(file);
      if (result.success) {
        setImportResult(result.message);
        await loadIdentityInfo();
      } else {
        setError("Import failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="panel surface workspace-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">设备身份</div>
          <h3>备份与恢复</h3>
        </div>
        <div className="panel-actions">
          <button className="ghost-button" onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>

      {error && <div className="inline-message error">{error}</div>}
      {importResult && <div className="inline-message success">{importResult}</div>}

      {loading ? (
        <div className="empty-mini">加载中...</div>
      ) : identityInfo ? (
        <div className="settings-modal-stack">
          <div className="identity-info-section">
            <div className="section-title">当前设备信息</div>
            <div className="identity-info-grid">
              <div className="info-item">
                <span className="info-label">设备 ID</span>
                <span className="info-value device-id-mono">{identityInfo.deviceID}</span>
              </div>
              <div className="info-item">
                <span className="info-label">短 ID</span>
                <span className="info-value">{identityInfo.deviceIDShort}</span>
              </div>
              <div className="info-item">
                <span className="info-label">证书文件</span>
                <span className="info-value">
                  <span className={`status-dot ${identityInfo.certExists ? "online" : "offline"}`} />
                  {identityInfo.certExists ? "存在" : "不存在"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">密钥文件</span>
                <span className="info-value">
                  <span className={`status-dot ${identityInfo.keyExists ? "online" : "offline"}`} />
                  {identityInfo.keyExists ? "存在" : "不存在"}
                </span>
              </div>
            </div>
          </div>

          <div className="identity-actions-section">
            <div className="section-title">导出设备身份</div>
            <div className="help-block">
              导出设备证书和密钥文件。此备份可用于在其他设备上恢复相同的设备 ID，无需重新配对。
            </div>
            <button
              className="primary-button"
              onClick={handleExport}
              disabled={exportBusy || !identityInfo.certExists || !identityInfo.keyExists}
            >
              {exportBusy ? "导出中..." : "导出备份"}
            </button>
          </div>

          <div className="identity-actions-section">
            <div className="section-title">导入设备身份</div>
            <div className="help-block">
              ⚠️ 警告：导入将覆盖当前的设备证书和密钥。导入后需要重启 Syncthing 才能生效。请确保您已备份当前身份。
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleImport}
              style={{ display: "none" }}
            />
            <button
              className="ghost-button danger-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importBusy}
            >
              {importBusy ? "导入中..." : "导入备份"}
            </button>
          </div>

          <div className="identity-help-section">
            <div className="section-title">使用说明</div>
            <div className="help-block">
              <p><strong>什么是设备身份？</strong></p>
              <p>设备身份由证书（cert.pem）和密钥（key.pem）组成。设备 ID 是证书的 SHA-256 哈希值，用于在网络中唯一标识您的设备。</p>
              <p><strong>什么时候需要备份？</strong></p>
              <ul>
                <li>卸载 Syncthing 前</li>
                <li>升级系统或更换设备前</li>
                <li>需要在多台设备上使用相同身份时</li>
              </ul>
              <p><strong>如何恢复设备身份？</strong></p>
              <ol>
                <li>在新设备上安装 Syncthing</li>
                <li>导入之前导出的备份文件</li>
                <li>重启 Syncthing</li>
                <li>对端设备会自动识别，无需重新配对</li>
              </ol>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

