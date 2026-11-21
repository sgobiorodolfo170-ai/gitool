/**
 * 全局提示的纯状态机（不依赖 React / 定时器 / DOM）。
 *
 * 为什么抽纯函数：原 `useNotice` 只保存一个字符串，后一条提示会直接顶掉
 * 前一条，且无法区分成功与失败。这里把「队列、去重、上限、存活时长」
 * 收敛成可单测的纯函数，hook 只负责计时与派发。
 */

export type NoticeKind = "success" | "error" | "warning" | "info";

export type Notice = {
  id: string;
  kind: NoticeKind;
  message: string;
};

export type NoticeState = {
  items: Notice[];
};

/** 同时可见的提示上限：再多会遮挡工作区，也不利于扫读。 */
export const NOTICE_LIMIT = 3;

/**
 * 按语义决定停留时长：错误需要更长时间读完（路径 / 命令输出可能较长），
 * 成功只需要确认动作完成。
 */
export const NOTICE_TTL_MS: Record<NoticeKind, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

export const EMPTY_NOTICE_STATE: NoticeState = { items: [] };

export function noticeTtl(kind: NoticeKind): number {
  return NOTICE_TTL_MS[kind];
}

function isSameNotice(left: Notice, right: Notice): boolean {
  return left.kind === right.kind && left.message === right.message;
}

/**
 * 入队一条提示。
 *
 * 去重语义：同 kind + 同文案视为同一条，沿用原 id（避免 React key 变化导致
 * 节点重建、动画重置），但移动到队尾——用户最后一次触发应当最靠近视线。
 * 超出上限时丢弃最旧的，而不是把最新一条挤掉。
 */
export function pushNotice(
  state: NoticeState,
  notice: Notice,
  limit: number = NOTICE_LIMIT,
): NoticeState {
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const existing = state.items.find((item) => isSameNotice(item, notice));
  const next = state.items.filter((item) => !isSameNotice(item, notice));
  next.push(existing ? { ...notice, id: existing.id } : notice);
  return { items: next.slice(Math.max(0, next.length - effectiveLimit)) };
}

/** 关闭指定提示；id 不存在时返回原状态，避免无意义的重渲染。 */
export function dismissNotice(state: NoticeState, id: string): NoticeState {
  const items = state.items.filter((item) => item.id !== id);
  return items.length === state.items.length ? state : { items };
}

export function clearNotices(): NoticeState {
  return EMPTY_NOTICE_STATE;
}
