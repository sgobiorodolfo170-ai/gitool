/**
 * 界面字号缩放。
 *
 * 只缩放字号（`--font-scale` 参与每个 font-size 的 calc），不动布局尺寸。
 * 这样调大字号时容器不会跟着变形，但极端值下文字可能挤破容器，
 * 所以把范围限制在 0.9–1.8，并且默认值保持 1（与改造前完全一致）。
 */

const FONT_SCALE_KEY = "gitool.fontScale";

export const FONT_SCALE_MIN = 0.9;
export const FONT_SCALE_MAX = 1.8;
export const FONT_SCALE_STEP = 0.1;
export const FONT_SCALE_DEFAULT = 1;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

export function loadFontScale(): number {
  try {
    const stored = window.localStorage.getItem(FONT_SCALE_KEY);
    if (stored === null) return FONT_SCALE_DEFAULT;
    return clamp(Number.parseFloat(stored));
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

export function saveFontScale(scale: number): void {
  try {
    window.localStorage.setItem(FONT_SCALE_KEY, String(clamp(scale)));
  } catch {
    // 隐私模式 / 存储被禁用时忽略，缩放仅在本次会话生效
  }
}

/** 把比例写到根元素的 CSS 变量上，CSS 里所有 font-size 会立即跟着变。 */
export function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty("--font-scale", String(clamp(scale)));
}
