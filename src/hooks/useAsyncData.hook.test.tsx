// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAsyncData } from "./useAsyncData";

/**
 * hook 绑定层测试（阶段 D4）：核心状态机已由 useAsyncData.test.ts 覆盖，
 * 这里只验证 React 侧的接线——挂载后 status 从 idle 进入 loading/ready，
 * 失败进入 error，且 hasLoaded 只在成功交付后置真。
 */
afterEach(cleanup);

describe("useAsyncData（React 绑定）", () => {
  it("挂载后自动加载：loading → ready，并标记 hasLoaded", async () => {
    const { result } = renderHook(() =>
      useAsyncData({
        loader: async () => 42,
        onLoaded: () => {},
        onError: () => {},
      }),
    );

    // renderHook 会同步刷新挂载 effect，因此此处已进入 loading
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.hasLoaded).toBe(true);
  });

  it("加载失败进入 error，hasLoaded 保持 false", async () => {
    const { result } = renderHook(() =>
      useAsyncData({
        loader: () => Promise.reject(new Error("boom")),
        onLoaded: () => {},
        onError: () => {},
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.hasLoaded).toBe(false);
  });

  it("成功一次后再触发加载，hasLoaded 不回退（轮询不闪骨架）", async () => {
    const { result } = renderHook(() =>
      useAsyncData({
        loader: async () => 1,
        onLoaded: () => {},
        onError: () => {},
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    void result.current.load();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.hasLoaded).toBe(true);
  });
});
