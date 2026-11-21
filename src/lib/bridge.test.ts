import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopBridge, isDesktopRuntime, requireDesktopBridge } from "./bridge";
import type { DesktopBridge } from "../../shared/types";

/**
 * DesktopBridge 是 Electron preload 注入的完整接口，测试里只需要一个
 * 可比较引用的假对象，因此用最小实现 + 类型断言，避免逐字段伪造 100+ 方法。
 */
function makeFakeBridge(): DesktopBridge {
  return {
    loadProjects: async () => [],
    saveProjects: async () => undefined,
  } as unknown as DesktopBridge;
}

const NOT_DESKTOP_MESSAGE = "该功能需要在 Gitool 桌面应用中使用";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDesktopBridge", () => {
  it("没有 window（Node / SSR 环境）时返回 undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(getDesktopBridge()).toBeUndefined();
    expect(isDesktopRuntime()).toBe(false);
  });

  it("window 存在但未注入 gitool 时返回 undefined", () => {
    vi.stubGlobal("window", {});
    expect(getDesktopBridge()).toBeUndefined();
    expect(isDesktopRuntime()).toBe(false);
  });

  it("window.gitool 显式为 undefined 时返回 undefined", () => {
    vi.stubGlobal("window", { gitool: undefined });
    expect(getDesktopBridge()).toBeUndefined();
    expect(isDesktopRuntime()).toBe(false);
  });

  it("桥可用时返回注入的同一个对象", () => {
    const bridge = makeFakeBridge();
    vi.stubGlobal("window", { gitool: bridge });
    expect(getDesktopBridge()).toBe(bridge);
    expect(isDesktopRuntime()).toBe(true);
  });
});

describe("requireDesktopBridge", () => {
  it("桥可用时返回同一个对象", () => {
    const bridge = makeFakeBridge();
    vi.stubGlobal("window", { gitool: bridge });
    expect(requireDesktopBridge()).toBe(bridge);
  });

  it("无 window 时抛出具体文案", () => {
    vi.stubGlobal("window", undefined);
    expect(() => requireDesktopBridge()).toThrow(NOT_DESKTOP_MESSAGE);
  });

  it("window 未注入 gitool 时抛出具体文案", () => {
    vi.stubGlobal("window", {});
    expect(() => requireDesktopBridge()).toThrow(NOT_DESKTOP_MESSAGE);
  });

  it("边界：window.gitool 为 null 时同样抛错（实现用 falsy 判定守住 require）", () => {
    vi.stubGlobal("window", { gitool: null });
    expect(() => requireDesktopBridge()).toThrow(NOT_DESKTOP_MESSAGE);
  });
});

describe("window.gitool 为 null 的边界（归一为非桌面环境）", () => {
  it("getDesktopBridge 把 null 归一为 undefined，isDesktopRuntime 判定为 false", () => {
    vi.stubGlobal("window", { gitool: null });
    // `window.gitool ?? undefined`：null 归一为 undefined，符合 DesktopBridge | undefined 契约
    expect(getDesktopBridge()).toBeUndefined();
    // Boolean(getDesktopBridge())：null 不再被误判为桌面环境
    expect(isDesktopRuntime()).toBe(false);
  });
});
