import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAsyncDataCore, type AsyncDataCore, type AsyncDataSnapshot } from "./useAsyncData";

/**
 * useAsyncData 单测。
 *
 * 为什么只测 createAsyncDataCore 而不渲染 hook 本体：当前测试环境是纯 Node
 * （无 jsdom/happy-dom，且本轮约束不引入新依赖），无法挂载 React 组件。
 * 因此把语义全部收敛进零依赖的核心状态机（序号守卫 / 卸载丢弃 / 错误兜底 /
 * 轮询），React 绑定层只做 ref 转发与 effect 接线，经 code review 把关。
 * 通过 read() 每次交付前重读快照，测试可以中途替换 enabled / 回调，等价于
 * 驱动「卸载」「重渲染」这两个 React 事件。
 */

/** 可手动放行/拒绝的延迟 Promise，用于构造慢请求与竞态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Harness = {
  core: AsyncDataCore;
  state: {
    enabled: boolean;
    loader: ReturnType<typeof vi.fn>;
    onLoaded: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
  };
};

function createHarness<T>(): Harness {
  const state = {
    enabled: true,
    loader: vi.fn<() => Promise<T>>(),
    onLoaded: vi.fn(),
    onError: vi.fn(),
  };
  const core = createAsyncDataCore<T>(() => state as unknown as AsyncDataSnapshot<T>);
  return { core, state };
}

describe("createAsyncDataCore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("加载成功后经 onLoaded 交付数据，且只交付一次", async () => {
    const { core, state } = createHarness<number>();
    state.loader.mockResolvedValue(42);

    await core.load();

    expect(state.onLoaded).toHaveBeenCalledTimes(1);
    expect(state.onLoaded).toHaveBeenCalledWith(42);
    expect(state.onError).not.toHaveBeenCalled();
  });

  it("加载失败必须经 onError 交付，不得静默吞错", async () => {
    const { core, state } = createHarness<number>();
    const boom = new Error("boom");
    state.loader.mockRejectedValue(boom);

    await core.load();

    expect(state.onError).toHaveBeenCalledTimes(1);
    expect(state.onError).toHaveBeenCalledWith(boom);
    expect(state.onLoaded).not.toHaveBeenCalled();
  });

  it("loader 同步抛错与异步失败同一出口（调用方 void load() 不会拿到 rejection）", async () => {
    const { core, state } = createHarness<number>();
    state.loader.mockImplementation(() => {
      throw new Error("sync boom");
    });

    await expect(core.load()).resolves.toBeUndefined();
    expect(state.onError).toHaveBeenCalledWith(new Error("sync boom"));
  });

  it("序号守卫：慢的旧请求后返回，不得覆盖新请求的结果", async () => {
    const { core, state } = createHarness<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    state.loader.mockImplementationOnce(() => first.promise);
    state.loader.mockImplementationOnce(() => second.promise);

    const pendingFirst = core.load();
    const pendingSecond = core.load();
    second.resolve("new");
    await pendingSecond;
    first.resolve("old");
    await pendingFirst;

    expect(state.onLoaded).toHaveBeenCalledTimes(1);
    expect(state.onLoaded).toHaveBeenCalledWith("new");
  });

  it("序号守卫：旧请求的失败不得覆盖新请求的结果", async () => {
    const { core, state } = createHarness<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    state.loader.mockImplementationOnce(() => first.promise);
    state.loader.mockImplementationOnce(() => second.promise);

    const pendingFirst = core.load();
    const pendingSecond = core.load();
    second.resolve("new");
    await pendingSecond;
    first.reject(new Error("stale failure"));
    await pendingFirst;

    expect(state.onLoaded).toHaveBeenCalledTimes(1);
    expect(state.onLoaded).toHaveBeenCalledWith("new");
    expect(state.onError).not.toHaveBeenCalled();
  });

  it("宿主卸载（enabled=false）后，成功结果不交付", async () => {
    const { core, state } = createHarness<string>();
    const pending = deferred<string>();
    state.loader.mockImplementation(() => pending.promise);

    const running = core.load();
    state.enabled = false;
    pending.resolve("late");
    await running;

    expect(state.onLoaded).not.toHaveBeenCalled();
  });

  it("宿主卸载后，失败结果也不交付（无处展示，只能丢弃）", async () => {
    const { core, state } = createHarness<string>();
    const pending = deferred<string>();
    state.loader.mockImplementation(() => pending.promise);

    const running = core.load();
    state.enabled = false;
    pending.reject(new Error("late failure"));
    await running;

    expect(state.onError).not.toHaveBeenCalled();
  });

  it("交付时读取的是最新回调（等价于 ref 取最新闭包的语义）", async () => {
    const { core, state } = createHarness<number>();
    const staleOnLoaded = vi.fn();
    const freshOnLoaded = vi.fn();
    state.onLoaded.mockImplementation(staleOnLoaded);
    const pending = deferred<number>();
    state.loader.mockImplementation(() => pending.promise);

    const running = core.load();
    state.onLoaded = freshOnLoaded;
    pending.resolve(7);
    await running;

    expect(staleOnLoaded).not.toHaveBeenCalled();
    expect(freshOnLoaded).toHaveBeenCalledWith(7);
  });

  describe("轮询", () => {
    it("startPolling 到点自动触发 load，stopPolling 后停止", async () => {
      vi.useFakeTimers();
      try {
        const { core, state } = createHarness<number>();
        state.loader.mockResolvedValue(1);

        core.startPolling(1000);
        await vi.advanceTimersByTimeAsync(3500);
        expect(state.loader).toHaveBeenCalledTimes(3);

        core.stopPolling();
        await vi.advanceTimersByTimeAsync(5000);
        expect(state.loader).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("重复 startPolling 重置旧计时器（旧间隔不再触发）", async () => {
      vi.useFakeTimers();
      try {
        const { core, state } = createHarness<number>();
        state.loader.mockResolvedValue(1);

        core.startPolling(1000);
        core.startPolling(5000);
        await vi.advanceTimersByTimeAsync(5000);
        // 旧 1s 计时器若未清除，这里会是 5 次；新 5s 计时器只触发 1 次
        expect(state.loader).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
