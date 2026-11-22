import { nativeTheme } from "electron";
import type { ThemePreference } from "../../../shared/types";

/**
 * 原生窗口主题（阶段 F4）。
 *
 * 为什么独立成模块：`nativeTheme.themeSource` 需要在两个入口保持一致——
 * ① 启动时在建窗之前设置，避免先出浅色窗口再变暗；② 设置页切换后即时同步。
 * 两个入口共用同一底色取值，窗口底色与页面 `--bg-app` 对齐，懒加载期间
 * 不出现白色闪屏。
 */
export const WINDOW_BACKGROUND_LIGHT = "#f5f7f9";
export const WINDOW_BACKGROUND_DARK = "#14181b";

/** 设置原生主题来源，返回当前应使用的窗口底色。 */
export function applyNativeTheme(theme: ThemePreference): string {
  nativeTheme.themeSource = theme;
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}
