/**
 * useNotice：全局提示队列。
 *
 * 职责边界：
 * - 队列/去重/上限/停留时长由 `src/lib/notice.ts` 的纯函数决定；
 * - 本 hook 只负责生成 id、挂定时器、在卸载时清理；
 * - 渲染由 `NoticeViewport` 负责，App 不再写死绿色 Check。
 *
 * 定时器策略：按“已入队且尚无计时器”的项补挂，而不是每条消息各自
 * setTimeout。这样被上限挤出的旧项会被清理，去重沿用的旧 id 也不会
 * 重新计时（重复点击不会让提示一直赖着不走）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearNotices,
  dismissNotice,
  EMPTY_NOTICE_STATE,
  inferNoticeKind,
  noticeTtl,
  pushNotice,
  type Notice,
  type NoticeReporter,
} from "../lib/notice";

export type { NoticeOptions, NoticeReporter } from "../lib/notice";

export type NoticeApi = {
  notices: Notice[];
  showNotice: NoticeReporter;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

export function useNotice(): NoticeApi {
  const [state, setState] = useState(EMPTY_NOTICE_STATE);
  const seqRef = useRef(0);
  const timersRef = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setState((current) => dismissNotice(current, id));
  }, []);

  const showNotice = useCallback<NoticeReporter>((message, options) => {
    seqRef.current += 1;
    const notice: Notice = {
      id: `notice-${seqRef.current}`,
      kind: options?.kind ?? inferNoticeKind(message),
      message,
    };
    setState((current) => pushNotice(current, notice));
  }, []);

  const showError = useCallback(
    (message: string) => showNotice(message, { kind: "error" }),
    [showNotice],
  );
  const showWarning = useCallback(
    (message: string) => showNotice(message, { kind: "warning" }),
    [showNotice],
  );
  const showInfo = useCallback(
    (message: string) => showNotice(message, { kind: "info" }),
    [showNotice],
  );

  // 给新入队项挂计时器；清掉已被移除项的计时器。
  useEffect(() => {
    const timers = timersRef.current;

    for (const item of state.items) {
      if (timers.has(item.id)) continue;
      const timer = window.setTimeout(() => {
        timers.delete(item.id);
        setState((current) => dismissNotice(current, item.id));
      }, noticeTtl(item.kind));
      timers.set(item.id, timer);
    }

    for (const [id, timer] of timers) {
      if (!state.items.some((item) => item.id === id)) {
        window.clearTimeout(timer);
        timers.delete(id);
      }
    }
  }, [state.items]);

  // 卸载时清空所有计时器，避免对已卸载组件 setState。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const clear = useCallback(() => setState(clearNotices()), []);

  return {
    notices: state.items,
    showNotice,
    showError,
    showWarning,
    showInfo,
    dismiss,
    clear,
  };
}
