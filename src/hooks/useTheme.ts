import { useEffect, useState } from "react";
import { resolveTheme, type ResolvedTheme, type ThemePreference } from "../lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 与窗口底色（主进程 windowTheme.ts）保持一致，供 meta[name=theme-color] 使用。 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#f5f7f9",
  dark: "#14181b",
};

function systemPrefersDark(): boolean {
  // jsdom / 极老环境没有 matchMedia：按浅色处理，不影响应用可用性
  return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY).matches : false;
}

/**
 * 主题应用（阶段 F2）。
 *
 * 采用「偏好 + 系统状态 → 最终主题」的纯函数决策（lib/theme.ts），
 * 这里只负责两件副作用：写 `<html data-theme>` 与同步 meta theme-color；
 * 系统偏好变化时实时重算，system 模式下无需重启。
 */
export function useTheme(preference: ThemePreference): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", THEME_COLORS[resolved]);
  }, [resolved]);

  return resolved;
}
