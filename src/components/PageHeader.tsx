import type { ReactNode } from "react";

/**
 * 统一页面头（阶段 D1）。
 *
 * 为什么统一：总览/项目/远程用 `page-heading`（中文 eyebrow、无图标），
 * 任务/备份/日志/设置用 `module-hero`（44px 图标、英文 eyebrow），同一
 * 产品出现两套“页面从哪开始”的语法。这里合并为一种结构，icon 可选。
 *
 * eyebrow 统一中文：英文大写装饰（TASK RUNNER / SYSTEM / RECOVERY）在
 * 10px 字号下既难读也不承载信息，属于 Quiet Precision 要移除的“无功能装饰”。
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-main">
        {icon && <div className="page-icon">{icon}</div>}
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            {eyebrow}
          </div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
