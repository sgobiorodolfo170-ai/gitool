import type { DesktopBridge } from "../../shared/types";

export function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  // 统一归一为 undefined：外部（preload 失败、用户脚本）可能把 gitool 写成 null，
  // 不能让它以「已定义但不可用」的形态穿透，否则会违反 DesktopBridge | undefined 的类型契约。
  return window.gitool ?? undefined;
}

export function isDesktopRuntime(): boolean {
  // 用真假值判定而非 `!== undefined`，保证 null / undefined 都算非桌面环境
  return Boolean(getDesktopBridge());
}

export function requireDesktopBridge(): DesktopBridge {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("该功能需要在 Gitool 桌面应用中使用");
  }
  return bridge;
}
