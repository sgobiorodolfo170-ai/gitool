import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { Notice, NoticeKind } from "../lib/notice";

const NOTICE_ICONS: Record<NoticeKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * 全局提示视口。
 *
 * 与旧实现的区别：
 * 1. 类型化：成功/失败/警告/信息各有图标与色板，失败不再显示绿色对勾；
 * 2. 可堆叠：最多 3 条（队列由 useNotice 控制），不再后一条顶掉前一条；
 * 3. 语义：error 用 role="alert"（立即播报），其余 role="status"；
 * 4. 可关闭：长错误（路径 / 命令输出）允许用户读完再关。
 *
 * 视口本身 pointer-events: none，只有每张卡片可点击，避免遮挡下方工作区。
 */
export function NoticeViewport({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: string) => void;
}) {
  if (notices.length === 0) return null;

  return (
    <div className="notice-viewport">
      {notices.map((notice) => {
        const Icon = NOTICE_ICONS[notice.kind];
        return (
          <div
            key={notice.id}
            className={`notice notice-${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{notice.message}</span>
            <button
              type="button"
              className="notice-dismiss"
              onClick={() => onDismiss(notice.id)}
              aria-label="关闭提示"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
