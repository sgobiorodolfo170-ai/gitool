/**
 * 跨组件 UI 事件（阶段 D7）。
 *
 * 为什么用 DOM 事件而不是状态上提：顶栏按钮与「我的项目」页的搜索框分属
 * App 与 ProjectsWorkspace 两棵子树，而这个动作是「一次性命令」而非持续
 * 状态——上提会让 App 多持有一份「请求聚焦」状态并在消费后负责清除。
 * 用带命名空间的事件名，两侧只共享常量，不共享状态。
 */

export const FOCUS_SEARCH_EVENT = "gitool:focus-search";

/** 请求聚焦项目搜索框；无监听者（非项目页）时静默无事。 */
export function requestSearchFocus(): void {
  window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
}
