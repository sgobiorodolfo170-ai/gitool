import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useAsyncData：封装「加载 + 轮询 + 卸载取消 + 错误兜底」的数据加载编排。
 *
 * 抽出来的原因（2026-11-07 审查「仍遗留」清单）：Settings/Backups/Logs/Tasks
 * 四个 Workspace 各自手写同构的 load() 模板且普遍无 try/catch——bridge 调用
 * 一旦 reject 就是 unhandled rejection，用户侧表现为静默失败。本 hook 把
 * 四段模板收敛为一个入口，并强制错误经 onError 出口展示，禁止静默吞错。
 *
 * 设计对齐既有范式：
 * - 序号守卫 → useWorkspaces.switchSeqRef / git/loadSequence（新请求使旧请求失效）；
 * - 卸载取消 → useNotice 的 timerRef 生命周期范式（cleanup 必清、可重入）；
 * - 轮询 → TasksWorkspace 原 4s interval 同款，但结果经守卫过滤，慢响应不再互踩。
 *
 * 为什么拆出 createAsyncDataCore：当前测试环境是纯 Node（无 DOM），无法挂载
 * React hook。把全部语义收敛进零依赖核心状态机，单测直接驱动；下面的
 * useAsyncData 只做 ref 转发与 effect 接线（最新闭包 ref 范式，同 runsRef）。
 */

/**
 * 加载状态（阶段 D4）。
 *
 * 为什么需要四态：页面要区分「首屏还没回来」（骨架）与「确实没有数据」
 * （空态），也要区分「加载失败」（错误态 + 重试）。只有 onLoaded/onError
 * 两个回调时，空数组与「尚未加载」在渲染层无法区分，早期总览/项目页会
 * 在首帧闪一下「没有匹配」。
 */
export type AsyncDataStatus = "idle" | "loading" | "ready" | "error";

/** 核心每次开始加载 / 交付结果前读取的最新快照。 */
export type AsyncDataSnapshot<T> = {
  /** false 表示宿主已卸载：丢弃结果、回调不触发（避免对已卸载组件 setState）。 */
  enabled: boolean;
  loader: () => Promise<T>;
  onLoaded: (data: T) => void;
  /** 加载失败兜底出口：由调用方接到用户可见的提示通道（如 showNotice）。 */
  onError: (error: unknown) => void;
  /** 状态流转出口（可选）：每次开始加载发 loading，最新一次交付发 ready/error。 */
  onStatus?: (status: AsyncDataStatus) => void;
};

/**
 * 核心的公开句柄不含 T：交付回调经 read() 提供的快照流转，
 * 句柄本身只暴露「触发/轮询/停止」三个动作。
 */
export type AsyncDataCore = {
  /** 触发一次加载；永不 reject（失败走 onError），调用方可安全 await / void。 */
  load: () => Promise<void>;
  /** 开启轮询（仅到点触发，不立即加载）；重复调用会先清掉旧计时器。 */
  startPolling: (intervalMs: number) => void;
  stopPolling: () => void;
};

/**
 * 零依赖核心状态机。
 *
 * 两条丢弃规则（改这里前先读 useAsyncData.test.ts 的竞态用例）：
 * 1. 序号守卫：同核心内新 load 使在途旧 load 的成功/失败结果全部失效——
 *    轮询或手动连点时，慢的旧响应不得覆盖新数据、不得拿旧错误打扰用户；
 * 2. enabled=false（宿主卸载）：结果无处展示，成功失败都只丢弃。
 * 每次交付前都重新 read()：回调与 enabled 永远取交付时刻的最新值。
 * 计时器用全局 setInterval 而非 window.*：让核心可在纯 Node 测试环境直接驱动。
 */
export function createAsyncDataCore<T>(read: () => AsyncDataSnapshot<T>): AsyncDataCore {
  let seq = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const clearPollTimer = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const load = (): Promise<void> => {
    const current = ++seq;
    // 每次发起都回到 loading（含轮询与手动刷新）；卸载后不再通知状态。
    const started = read();
    if (started.enabled) started.onStatus?.("loading");
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(read().loader());
    } catch (error) {
      // loader 同步抛错与异步失败同一出口，保证 load() 的返回值永不 reject
      if (read().enabled && current === seq) {
        read().onStatus?.("error");
        read().onError(error);
      }
      return Promise.resolve();
    }
    return pending.then(
      (data) => {
        if (read().enabled && current === seq) {
          read().onStatus?.("ready");
          read().onLoaded(data);
        }
      },
      (error) => {
        if (read().enabled && current === seq) {
          read().onStatus?.("error");
          read().onError(error);
        }
      },
    );
  };

  return {
    load,
    startPolling: (intervalMs) => {
      clearPollTimer();
      pollTimer = setInterval(() => {
        void load();
      }, intervalMs);
    },
    stopPolling: clearPollTimer,
  };
}

export type UseAsyncDataOptions<T> = {
  loader: () => Promise<T>;
  /** 加载成功回调；仅「最新一次加载 + 宿主仍挂载」时触发。 */
  onLoaded: (data: T) => void;
  /** 加载失败兜底：必须接到用户可见的提示通道，禁止传空函数静默吞错。 */
  onError: (error: unknown) => void;
  /** 轮询间隔毫秒；缺省不轮询。 */
  pollMs?: number;
  /** 依赖数组：变化即重载；缺省仅在挂载时加载一次。数组长度须逐帧稳定。 */
  reloadDeps?: readonly unknown[];
};

export type UseAsyncDataHandle = {
  /** 手动触发一次加载（刷新按钮 / 写操作后回读）。永不 reject。 */
  load: () => Promise<void>;
  /** 最近一次加载的状态；首帧为 idle，挂载 effect 后进入 loading。 */
  status: AsyncDataStatus;
  /**
   * 是否至少成功交付过一次数据。
   *
   * 轮询场景专用：status 在每次轮询都会回 loading，若页面只看 status，
   * 已有内容的列表会每 4 秒闪一次骨架。骨架条件应为
   * `status === "loading" && !hasLoaded`。
   */
  hasLoaded: boolean;
};

const EMPTY_DEPS: readonly unknown[] = [];

export function useAsyncData<T>(options: UseAsyncDataOptions<T>): UseAsyncDataHandle {
  const { loader, onLoaded, onError, pollMs, reloadDeps } = options;

  const [status, setStatus] = useState<AsyncDataStatus>("idle");
  const [hasLoaded, setHasLoaded] = useState(false);

  // 三个回调按「取最新闭包」语义保存（同 TasksWorkspace 的 runsRef 范式）：
  // 调用方通常传内联箭头函数，逐帧变化，不能进 effect 依赖。
  // onLoaded 在这里包一层：先置 hasLoaded 再交给调用方，页面无需各自维护
  // 「是否已完成首载」的本地状态。
  const latestRef = useRef({
    loader,
    onStatus: setStatus,
    onLoaded: (data: T) => {
      setHasLoaded(true);
      onLoaded(data);
    },
    onError,
  });
  latestRef.current = {
    loader,
    onStatus: setStatus,
    onLoaded: (data: T) => {
      setHasLoaded(true);
      onLoaded(data);
    },
    onError,
  };

  // 卸载取消用 enabledRef 而非一次性 dispose：StrictMode 的模拟卸载/重挂载
  // 会复用同一组件实例（ref 不重建），必须可重入——cleanup 置 false 丢弃在途
  // 结果，重挂载 setup 重新置 true。核心本体（seq/计时器）跨重挂载连续，
  // 轮询 effect 会重新接线，生产环境一次性挂载不受影响。
  const enabledRef = useRef(true);
  const coreRef = useRef<AsyncDataCore | null>(null);
  if (coreRef.current === null) {
    coreRef.current = createAsyncDataCore<T>(() => ({
      enabled: enabledRef.current,
      ...latestRef.current,
    }));
  }

  useEffect(() => {
    enabledRef.current = true;
    return () => {
      enabledRef.current = false;
    };
  }, []);

  // core 在首次渲染时已惰性创建，任何 effect / 事件触发前必已存在
  const load = useCallback(() => {
    const core = coreRef.current;
    return core ? core.load() : Promise.resolve();
  }, []);

  // 挂载加载 + 依赖变化重载。数据键（如选中的项目 id）只有调用方知道，
  // 依赖数组由调用方声明，与 useWorkspaces 的显式依赖风格一致。
  useEffect(() => {
    void load();
  }, [load, ...(reloadDeps ?? EMPTY_DEPS)]);

  // 轮询与 useNotice 的定时器同范式：effect 持有、cleanup 必清，卸载即停。
  useEffect(() => {
    if (!pollMs) return;
    coreRef.current?.startPolling(pollMs);
    return () => {
      coreRef.current?.stopPolling();
    };
  }, [pollMs, load]);

  return { load, status, hasLoaded };
}
