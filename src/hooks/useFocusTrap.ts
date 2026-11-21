import { useEffect, useRef } from "react";
import { getFocusableElements, handleTabKey } from "../lib/a11y/focusTrap";

/**
 * 把焦点陷阱绑定到容器上（阶段 E5 供 4 个弹窗层复用）。
 *
 * 行为：
 * 1. 激活时记录当前焦点，聚焦容器内第一个可聚焦元素（没有则聚焦容器本身）；
 * 2. Tab / Shift+Tab 在容器内循环；
 * 3. Escape 调用 onEscape（调用方负责关闭并恢复状态）；
 * 4. 失活/卸载时把焦点还给打开前的元素。
 *
 * onEscape 放进 ref：调用方通常传内联箭头函数，若放进 effect 依赖，
 * 每次渲染都会重新捕获焦点。依赖只保留 active。
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;

    const container = ref.current;
    previousFocusRef.current = document.activeElement;

    const first = container ? getFocusableElements(container)[0] : null;
    (first ?? container)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        escapeRef.current?.();
        return;
      }
      if (container) handleTabKey(container, event, document.activeElement);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [active]);

  return ref;
}
