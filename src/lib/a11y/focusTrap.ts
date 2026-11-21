/**
 * 焦点陷阱的纯逻辑（阶段 E5 供 4 个弹窗层复用）。
 *
 * 为什么拆成纯函数：React 组件里直接写 Tab 计算很难测，而且四个弹窗
 * （首启引导、远程仓库表单、README 阅读层、确认框）会各写一遍。这里把
 * “可聚焦元素收集 / 下一个索引 / Tab 处理”收敛到一处，组件只负责在
 * 挂载时绑 keydown、卸载时解绑。
 */

/**
 * 可聚焦元素选择器。
 *
 * 只列原生可交互元素与显式 tabindex，不把 `contenteditable` 纳入：
 * 本应用没有富文本编辑区，纳入只会扩大误判面。
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]:not([tabindex='-1'])",
  "button:not([disabled]):not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden']):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** 在 total 个可聚焦元素中计算下一个索引；total <= 0 时返回 -1。 */
export function nextFocusIndex(current: number, total: number, shift: boolean): number {
  if (total <= 0) return -1;
  if (current < 0) return shift ? total - 1 : 0;
  const delta = shift ? -1 : 1;
  return (current + delta + total) % total;
}

/**
 * 按 DOM 顺序收集可聚焦元素，过滤 aria-hidden 的子树。
 *
 * 用 `Element.closest` 判断祖先 aria-hidden：仅看元素自身的 aria-hidden
 * 会漏掉“整个分区被隐藏”的情况（例如 README 层打开时背景区的按钮）。
 */
export function getFocusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.closest('[aria-hidden="true"]') === null,
  );
}

/**
 * 处理 Tab / Shift+Tab：在容器内循环，并在边界处阻止默认行为。
 *
 * activeElement 由调用方传入，便于测试与 Shadow DOM 场景；传 null 时
 * 视为“焦点尚未进入容器”，Tab 落到第一个、Shift+Tab 落到最后一个。
 */
export function handleTabKey(
  root: HTMLElement,
  event: KeyboardEvent,
  activeElement: Element | null,
): void {
  if (event.key !== "Tab") return;

  const elements = getFocusableElements(root);
  if (elements.length === 0) {
    event.preventDefault();
    return;
  }

  const current = activeElement instanceof HTMLElement ? elements.indexOf(activeElement) : -1;
  const next = nextFocusIndex(current, elements.length, event.shiftKey);

  event.preventDefault();
  elements[next]?.focus();
}
