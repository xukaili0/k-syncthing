import type { CSSProperties, ReactNode, RefObject } from "react";

export type ColumnDef = {
  key: string;
  label: string;
  width: number;
  minWidth?: number;
  visible?: boolean;
};

type BiDiffDensity = "relaxed" | "normal" | "compact" | "tight";

type FolderVersioningSelector = "none" | "trashcan" | "simple" | "staggered" | "external";

function biDiffColumnsForDensity(density: BiDiffDensity, actionVisible = false): ColumnDef[] {
  const presets: Record<BiDiffDensity, Record<string, number>> = {
    relaxed: { checkbox: 52, leftSize: 104, leftTime: 118, action: 72, summary: 376, rightTime: 118, rightSize: 104 },
    normal: { checkbox: 48, leftSize: 90, leftTime: 100, action: 62, summary: 324, rightTime: 100, rightSize: 90 },
    compact: { checkbox: 44, leftSize: 82, leftTime: 92, action: 56, summary: 288, rightTime: 92, rightSize: 82 },
    tight: { checkbox: 42, leftSize: 74, leftTime: 84, action: 52, summary: 252, rightTime: 84, rightSize: 74 },
  };
  const preset = presets[density];
  return [
    { key: "checkbox", label: "", width: preset.checkbox, minWidth: 36 },
    { key: "leftSize", label: "左侧大小", width: preset.leftSize, minWidth: 64 },
    { key: "leftTime", label: "左侧时间", width: preset.leftTime, minWidth: 76 },
    { key: "action", label: "接发", width: preset.action, minWidth: 48, visible: actionVisible },
    { key: "summary", label: "名称 / 路径", width: preset.summary, minWidth: 180 },
    { key: "rightTime", label: "右侧时间", width: preset.rightTime, minWidth: 76 },
    { key: "rightSize", label: "右侧大小", width: preset.rightSize, minWidth: 64 },
  ];
}

export function beginColumnResize(
  clientX: number,
  columnIndex: number,
  columns: ColumnDef[],
  onColumnsChange: (columns: ColumnDef[]) => void,
) {
  const column = columns[columnIndex];
  if (!column) {
    return;
  }
  const startWidth = column.width;
  const handlePointerMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - clientX;
    const newWidth = Math.max(20, startWidth + delta);
    const newColumns = [...columns];
    newColumns[columnIndex] = { ...newColumns[columnIndex], width: newWidth };
    onColumnsChange(newColumns);
  };
  const handlePointerUp = () => {
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

export function ResizableTable(props: {
  columns: ColumnDef[];
  onColumnsChange: (columns: ColumnDef[]) => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  wrapperRef?: RefObject<HTMLDivElement | null>;
}) {
  const visibleColumns = props.columns.filter((col) => col.visible !== false);
  return (
    <div ref={props.wrapperRef} className={`compare-table-wrapper${props.className ? ` ${props.className}` : ""}`} style={props.style}>
      <table className="compare-table">
        <colgroup>
          {visibleColumns.map((col) => (
            <col key={col.key} style={{ width: col.width, minWidth: 0 }} />
          ))}
        </colgroup>
        {props.children}
      </table>
    </div>
  );
}

export function renderResizableHeaders(
  columns: ColumnDef[],
  onColumnsChange: (columns: ColumnDef[]) => void,
  customLabels?: Partial<Record<string, ReactNode>>,
) {
  const visibleColumns = columns.filter((col) => col.visible !== false);
  return visibleColumns.map((col) => (
    <th key={col.key}>
      {customLabels?.[col.key] ?? col.label}
      {col.key !== "checkbox" && (
        <div
          className="resize-handle"
          onPointerDown={(e) => {
            e.preventDefault();
            const colIndex = columns.findIndex((c) => c.key === col.key);
            if (colIndex < 0) {
              return;
            }
            beginColumnResize(e.clientX, colIndex, columns, onColumnsChange);
          }}
        />
      )}
    </th>
  ));
}

