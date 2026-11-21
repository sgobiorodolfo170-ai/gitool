/**
 * 主题偏好的解析与持久化（纯逻辑，不直接读 window）。
 *
 * 渲染层真正应用主题（<html data-theme> / meta theme-color）属于阶段 F2；
 * 这里先把「非法值回退、系统偏好解析、存储读写」做成可单测的纯函数，
 * 避免 F2 的阶段把判断逻辑埋进 hook。
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "gitool.theme";

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** 非法/缺失值一律回退到跟随系统，不抛错：设置读坏时应用仍应可用。 */
export function parseTheme(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : "system";
}

/** 把偏好与系统当前状态合成为最终主题。 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function loadTheme(storage: ThemeStorage): ThemePreference {
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    // 隐私模式 / 存储被禁用：按跟随系统处理，本次会话仍可用
    return "system";
  }
}

export function saveTheme(storage: ThemeStorage, preference: ThemePreference): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, parseTheme(preference));
  } catch {
    // 存储不可用时静默失败，主题只在本次会话生效
  }
}
