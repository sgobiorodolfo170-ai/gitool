import type { DesktopBridge } from "../../shared/types";

export function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.gitool;
}

export function isDesktopRuntime(): boolean {
  return getDesktopBridge() !== undefined;
}

export function requireDesktopBridge(): DesktopBridge {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("该功能需要在 Gitool 桌面应用中使用");
  }
  return bridge;
}
