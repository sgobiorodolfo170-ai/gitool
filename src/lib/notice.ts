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

export type NoticeOptions = { kind?: NoticeKind };

/** 统一的消息上报签名：旧的 `(message: string) => void` 可直接赋值。 */
export type NoticeReporter = (message: string, options?: NoticeOptions) => void;

/**
 * 文案启发式分级：仅在调用方没有显式传 kind 时兜底。
 *
 * 为什么需要它：77 个调用点里仍有 `onNotice(error.message)` 这类
 * “消息内容由底层决定”的路径，无法在调用点静态判断。兜底至少保证
 * 失败不会渲染成绿色对勾；显式 `{ kind }` 永远优先。
 */
const ERROR_HINTS = /失败|错误|无法|不可用|未完成|异常|拒绝/;
const WARNING_HINTS = /请先|不支持|不会|只能|注意|尚未|没有|已经是/;

export function inferNoticeKind(message: string): NoticeKind {
  if (ERROR_HINTS.test(message)) return "error";
  if (WARNING_HINTS.test(message)) return "warning";
  return "success";
}

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
