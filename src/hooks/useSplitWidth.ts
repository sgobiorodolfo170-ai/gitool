import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 可拖拽分栏宽度（百分比）。
 *
 * 设计要点：
 * - 宽度以百分比存，窗口缩放时比例保持不变
 * - 拖拽过程中不写 localStorage（每帧写会有明显卡顿），松手时落一次
 * - 用 Pointer Events + setPointerCapture：鼠标拖出容器外也不会丢失追踪
 * - 双击分隔条恢复默认宽度
 */
export type SplitWidthApi = {
  percent: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 绑定到分隔条上的事件处理器。 */
  splitterHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onDoubleClick: () => void;
  };
  reset: () => void;
};

const MIN_PERCENT = 30;
const MAX_PERCENT = 75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPercent(key: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = Number.parseFloat(stored);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed, MIN_PERCENT, MAX_PERCENT);
  } catch {
    return fallback;
  }
}

function writePercent(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 存储不可用时忽略，本次会话仍然生效
  }
}

export function useSplitWidth(storageKey: string, defaultPercent: number): SplitWidthApi {
  const [percent, setPercent] = useState(() => readPercent(storageKey, defaultPercent));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // 拖拽回调里要读最新值，state 闭包会滞后一帧
  const percentRef = useRef(percent);
  percentRef.current = percent;

  const reset = useCallback(() => {
    setPercent(defaultPercent);
    writePercent(storageKey, defaultPercent);
  }, [defaultPercent, storageKey]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    const next = ((event.clientX - rect.left) / rect.width) * 100;
    setPercent(clamp(next, MIN_PERCENT, MAX_PERCENT));
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove("is-resizing");
      writePercent(storageKey, percentRef.current);
    },
    [storageKey],
  );

  // 组件卸载时兜底清掉拖拽态，避免 body 一直保持 col-resize 光标
  useEffect(() => () => document.body.classList.remove("is-resizing"), []);

  return {
    percent,
    containerRef,
    splitterHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onDoubleClick: reset,
    },
    reset,
  };
}
