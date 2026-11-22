// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_COLORS, useTheme } from "./useTheme";

/**
 * useTheme（阶段 F2）：偏好解析由 lib/theme 纯函数覆盖，这里验证副作用——
 * data-theme、meta theme-color 与系统偏好变化时的实时重算。
 */
const originalMatchMedia = window.matchMedia;

function installMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: initial,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn(() => query),
  });

  return {
    setMatches(value: boolean) {
      query.matches = value;
      for (const listener of listeners) listener({ matches: value } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
  delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe("useTheme", () => {
  it("强制深色写入 data-theme 与 meta theme-color", async () => {
    installMatchMedia(false);
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);

    renderHook(() => useTheme("dark"));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(meta.getAttribute("content")).toBe(THEME_COLORS.dark);
  });

  it("system 跟随系统；系统变化时实时切换", async () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useTheme("system"));

    await waitFor(() => expect(result.current).toBe("light"));
    expect(document.documentElement.dataset.theme).toBe("light");

    media.setMatches(true);
    await waitFor(() => expect(result.current).toBe("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("强制浅色不受系统深色影响", async () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme("light"));

    await waitFor(() => expect(result.current).toBe("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
