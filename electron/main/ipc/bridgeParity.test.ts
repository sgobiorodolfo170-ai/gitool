import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 契约对齐：preload 的 bridge 方法集合 与 主进程 ipcMain.handle 注册表必须一致。
 *
 * 为什么需要：两边都是手写清单，编译器检查不到「注册了但没人能调」的死通道
 * （2026-11-21 审查 L-14：tasks:updateRun / operations:record 就是这样躺了半年）。
 * 本测试是白名单门禁——新增通道必须同时改两侧，删一侧就会红。
 */

// vi.mock 会被提升到 import 之前，收集容器必须用 vi.hoisted 一并提升，
// 否则 mock 工厂执行时变量还在 TDZ（Cannot access before initialization）。
const { handlerChannels, invokeChannels, listenerChannels } = vi.hoisted(() => ({
  handlerChannels: [] as string[],
  invokeChannels: [] as string[],
  listenerChannels: [] as string[],
}));

/** 纯 Node 环境没有 electron 运行时，给 ipc.ts / preload 需要的全部入口打桩。 */
vi.mock("electron", () => ({
  app: {
    getPath: () => process.cwd(),
    getVersion: () => "0.0.0",
    isPackaged: false,
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  ipcMain: {
    // 真实 ipcMain.handle 对同一 channel 重复注册会抛错，这里只记录，由测试断言唯一性
    handle: (channel: string) => {
      handlerChannels.push(channel);
    },
  },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    // 记录 invoke 的通道名即可，不关心返回值
    invoke: async (channel: string) => {
      invokeChannels.push(channel);
      return undefined;
    },
    // on* 方法注册的是「主进程 → 渲染层」单向事件，不参与 invoke 差集
    on: (channel: string) => {
      listenerChannels.push(channel);
    },
    removeListener: () => undefined,
  },
}));

import { bridge } from "../../preload/index";
import { registerIpcHandlers } from "../ipc";

/** 本批次（删除 2 个死通道后）的 handler 基线，任何增减都必须显式改这个数字。 */
const EXPECTED_HANDLER_COUNT = 76;

beforeAll(() => {
  registerIpcHandlers();
  // 逐个调用 bridge 方法：invoke 桩会把通道名记下来，从而得到「渲染层能调的通道」全集。
  // bridge 的入参类型各异，这里只关心通道名，统一喂 undefined。
  for (const method of Object.values(bridge) as Array<(...args: unknown[]) => unknown>) {
    void method(undefined);
  }
});

describe("bridge 与 ipcMain 注册表的契约一致性", () => {
  it(`handler 数量为 ${EXPECTED_HANDLER_COUNT}`, () => {
    expect(handlerChannels).toHaveLength(EXPECTED_HANDLER_COUNT);
  });

  it("handler 通道不重复注册（真实 ipcMain.handle 会直接抛错）", () => {
    expect(handlerChannels).toHaveLength(new Set(handlerChannels).size);
  });

  it("bridge 方法与 handler 双向差集为空", () => {
    const handlerSet = new Set(handlerChannels);
    const bridgeSet = new Set(invokeChannels);
    // 有 handler 但 bridge 调不到 = 死通道（死通道就是 IPC 攻击面）
    const handlersOnly = [...handlerSet].filter((channel) => !bridgeSet.has(channel));
    // 有 bridge 方法但没有 handler = 调用必失败的假接口
    const bridgeOnly = [...bridgeSet].filter((channel) => !handlerSet.has(channel));
    expect(handlersOnly).toEqual([]);
    expect(bridgeOnly).toEqual([]);
  });

  it("单向上报事件（on*）不算 invoke 通道", () => {
    expect(listenerChannels.length).toBeGreaterThan(0);
    for (const channel of listenerChannels) {
      expect(invokeChannels).not.toContain(channel);
      expect(handlerChannels).not.toContain(channel);
    }
  });
});
