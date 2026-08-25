import type { BiDiffEntry, CompareEntry, PendingPublishEntry } from "../../api";
import { fileTypeLabel, formatBinary, formatDate } from "./review-formatters";

export function FileVersionCell(props: {
  file?:
    | CompareEntry["local"]
    | CompareEntry["remote"]
    | PendingPublishEntry["local"]
    | PendingPublishEntry["global"]
    | BiDiffEntry["left"]
    | BiDiffEntry["right"];
  missingLabel: string;
  tone?: "success" | "warning" | "danger" | "muted" | "info";
  dateMode?: "full" | "compact";
}) {
  if (!props.file) {
    return (
      <div className={`compare-side compare-side-missing${props.tone ? ` tone-${props.tone}` : ""}`}>
        <div className="compare-side-empty">{props.missingLabel}</div>
      </div>
    );
  }

  return (
    <div className={`compare-side${props.tone ? ` tone-${props.tone}` : ""}`}>
      <div className="compare-side-primary">
        <span>{formatBinary(props.file.size)}</span>
        <span>{fileTypeLabel(props.file.type)}</span>
      </div>
      <div className="compare-side-secondary">
        <span>{formatDate(props.file.modified, props.dateMode ?? "full")}</span>
        <span>{props.file.deleted ? "路径已删除" : "存在"}</span>
      </div>
    </div>
  );
}

export function BiDiffSizeCell(props: {
  file?:
    | CompareEntry["local"]
    | CompareEntry["remote"]
    | PendingPublishEntry["local"]
    | PendingPublishEntry["global"]
    | BiDiffEntry["left"]
    | BiDiffEntry["right"];
  missingLabel: string;
}) {
  if (!props.file) {
    return (
      <div className="compare-side-cell compare-side-cell-missing tone-muted">
        <span className="compare-side-cell-empty">{props.missingLabel}</span>
      </div>
    );
  }
  const tone = props.file.deleted ? "danger" : "success";
  return (
    <div className={`compare-side-cell tone-${tone}`}>
      <span className="compare-side-cell-value">{formatBinary(props.file.size)}</span>
    </div>
  );
}

export function BiDiffTimeCell(props: {
  file?:
    | CompareEntry["local"]
    | CompareEntry["remote"]
    | PendingPublishEntry["local"]
    | PendingPublishEntry["global"]
    | BiDiffEntry["left"]
    | BiDiffEntry["right"];
  missingLabel: string;
  dateMode?: "full" | "compact";
}) {
  if (!props.file) {
    return (
      <div className="compare-side-cell compare-side-cell-missing tone-muted">
        <span className="compare-side-cell-empty">{props.missingLabel}</span>
      </div>
    );
  }
  const tone = props.file.deleted ? "danger" : "success";
  return (
    <div className={`compare-side-cell tone-${tone}`}>
      <span className="compare-side-cell-value">{formatDate(props.file.modified, props.dateMode ?? "compact")}</span>
    </div>
  );
}

export function BiDiffPresenceCell(props: {
  file?: BiDiffEntry["left"] | BiDiffEntry["right"];
  missingLabel?: string;
  tone?: "success" | "warning" | "danger" | "muted" | "info";
}) {
  const state = !props.file ? "missing" : props.file.deleted ? "deleted" : "live";
  const label = !props.file ? props.missingLabel ?? "不存在" : props.file.deleted ? "路径已删除" : "存在";
  const symbol = state === "live" ? "●" : state === "deleted" ? "⊘" : "∅";
  return (
    <div
      className={`compare-side compare-side-state compare-side-state-${state}${props.tone ? ` tone-${props.tone}` : ""}`}
      title={label}
      aria-label={label}
    >
      <span className={`compare-side-state-symbol state-${state}`} aria-hidden="true">
        {symbol}
      </span>
    </div>
  );
}

export function ProgressBar(props: { percent: number; tone?: "success" | "warning" | "danger" | "muted" | "info"; label?: string }) {
  const percent = Math.max(0, Math.min(100, props.percent));
  return (
    <div className="progress-block">
      {props.label && <div className="progress-label">{props.label}</div>}
      <div className="progress-track">
        <div className={`progress-fill${props.tone ? ` tone-${props.tone}` : ""}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-value">{percent.toFixed(0)}%</div>
    </div>
  );
}

