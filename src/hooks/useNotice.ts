import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 全局轻提示。
 *
 * 抽出来的原因：原先 41 处「setNotice(...) + window.setTimeout(() => setNotice(null), N)」
 * 重复展开，既占行数又容易漏掉清理（连续两次提示时，前一个定时器会把新提示提前关掉）。
 * 这里用单一定时器 ref，后一条提示会自动顶掉前一条的倒计时。
 */
export type NoticeApi = {
  notice: string | null;
  /** 展示一条提示，durationMs 后自动消失。 */
  showNotice: (message: string, durationMs?: number) => void;
  clearNotice: () => void;
};

export function useNotice(): NoticeApi {
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearNotice = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  const showNotice = useCallback(
    (message: string, durationMs = 3000) => {
      clearTimer();
      setNotice(message);
      timerRef.current = window.setTimeout(() => {
        setNotice(null);
        timerRef.current = null;
      }, durationMs);
    },
    [clearTimer],
  );

  // 组件卸载时清掉定时器，避免对已卸载组件 setState
  useEffect(() => clearTimer, [clearTimer]);

  return { notice, showNotice, clearNotice };
}
