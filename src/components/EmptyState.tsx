import type { ReactNode } from "react";

export type EmptyStateVariant = "no-data" | "no-match" | "error";

/**
 * 空态统一组件（阶段 D3）。
 *
 * 区分三种语义：
 * - no-data：确实还没有数据（引导创建/导入）；
 * - no-match：有数据但筛选/搜索无结果（引导调整条件）；
 * - error：加载失败（引导重试）。
 *
 * 旧实现把三者都写成“没有匹配的项目”，0 项目时也在说“换一个搜索词”。
 */
export function EmptyState({
  variant = "no-data",
  icon,
  title,
  description,
  action,
}: {
  variant?: EmptyStateVariant;
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`empty-state empty-state-${variant}`}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}
