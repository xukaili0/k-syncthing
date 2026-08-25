export const BIDIFF_SIDEBAR_WIDTH_KEY = "reactGuiBidiffSidebarWidth";
export const BIDIFF_TIME_MODE_KEY = "reactGuiBidiffTimeMode";
export const BIDIFF_FONT_SCALE_KEY = "reactGuiBidiffFontScale";
export const BIDIFF_DENSITY_KEY = "reactGuiBidiffDensity";

export const bidiffViewOptions = [
  { value: "different", label: "仅看待接发差异" },
  { value: "all", label: "显示全部有效条目" },
  { value: "all-with-same", label: "显示全部（含相同）" },
  { value: "delete", label: "仅看删除 / 缺失" },
  { value: "modified", label: "仅看内容变化" },
  { value: "conflict", label: "仅看冲突" },
  { value: "only-local", label: "仅左侧存在" },
  { value: "only-remote", label: "仅右侧存在" },
  { value: "rename", label: "疑似移动 / 重命名" },
] as const;

export function readStoredPixels(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  } catch {
    return fallback;
  }
}

export function storePixels(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures.
  }
}

export function readStoredChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}
