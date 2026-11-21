import { ArrowUpRight, HardDrive, FolderGit2, GitBranch, Plus, Star, Trash2 } from "lucide-react";
import { operationLabels } from "../lib/meta";
import { providerLabels } from "../lib/meta";
import { statusMeta } from "../lib/meta";
import { providerIcons } from "./providerIcons";
import type { GitOperation, Project } from "../types";

import { formatBytes, isDormant } from "../lib/format";
import { EmptyState } from "./EmptyState";

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: string;
  /** 有跳转目标时渲染为按钮（阶段 D6）；无目标时保持静态卡片。 */
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-content">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <ArrowUpRight size={15} className="metric-arrow" />
    </>
  );

  // 卡片右上角本来就有箭头，静态卡片会让箭头成为「虚假交互暗示」；
  // 有 onClick 时用真实按钮承载键盘与读屏语义。
  if (onClick) {
    return (
      <button type="button" className="metric-card metric-card-action" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="metric-card">{body}</div>;
}

export function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`filter-button ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function ProjectRow({
  project,
  selected,
  bulkSelected,
  onToggleBulk,
  onSelect,
  onToggleFavorite,
  onDelete,
}: {
  project: Project;
  selected: boolean;
  bulkSelected: boolean;
  onToggleBulk: () => void;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const ProviderIcon = providerIcons[project.provider];
  const status = statusMeta[project.status];
  const dormant = isDormant(project);
  return (
    <div
      className={`project-row ${selected ? "selected" : ""} ${bulkSelected ? "bulk-selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <label className="bulk-check" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={bulkSelected}
          onChange={onToggleBulk}
          aria-label="选择项目"
        />
      </label>
      <div className="project-type-icon" style={{ color: project.languageColor }}>
        <ProviderIcon size={18} />
      </div>
      <div className="project-row-main">
        <div className="project-name-line">
          <strong>{project.alias || project.name}</strong>
          <span className="provider-name">{providerLabels[project.provider]}</span>
        </div>
        <p>{project.path || "未克隆（远程收藏）"}</p>
        <div className="project-row-meta">
          <span className={`status-pill ${status.className}`}>
            <span className="status-dot" />
            {project.syncLabel}
          </span>
          <span>
            <GitBranch size={12} />
            {project.branch}
          </span>
          <span>
            <HardDrive size={12} />
            {project.diskSizeBytes > 0 ? formatBytes(project.diskSizeBytes) : "—"}
          </span>
          {dormant && (
            <span className="status-pill status-behind">
              <span className="status-dot" />
              休眠
            </span>
          )}
        </div>
      </div>
      <button
        className="icon-button danger project-row-delete"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label="从我的项目移除"
      >
        <Trash2 size={16} />
      </button>
      <button
        className={`favorite-button ${project.favorite ? "active" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={project.favorite ? "取消收藏" : "收藏项目"}
      >
        <Star size={16} fill={project.favorite ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/**
 * 项目列表空态（阶段 D5）：区分「确实没有项目」与「当前筛选没有结果」。
 *
 * 旧实现把两者都写成「没有匹配的项目」，0 项目时也在引导用户换搜索词。
 */
export function EmptyProjects({
  hasProjects,
  onImport,
  onResetFilters,
}: {
  hasProjects: boolean;
  onImport: () => void;
  onResetFilters: () => void;
}) {
  if (!hasProjects) {
    return (
      <EmptyState
        icon={<FolderGit2 size={21} />}
        title="还没有项目"
        description="导入一个本地仓库，或从远程仓库克隆。"
        action={
          <button className="button secondary compact" onClick={onImport}>
            <Plus size={15} />
            导入项目
          </button>
        }
      />
    );
  }
  return (
    <EmptyState
      variant="no-match"
      title="没有匹配的项目"
      description="调整筛选条件，或换一个搜索词。"
      action={
        <button className="button secondary compact" onClick={onResetFilters}>
          清除筛选
        </button>
      }
    />
  );
}

export function AnalysisMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function GitOperationButton({
  operation,
  activeOperation,
  onRun,
  icon,
}: {
  operation: GitOperation;
  activeOperation: GitOperation | null;
  onRun: (operation: GitOperation) => void | Promise<void>;
  icon: React.ReactNode;
}) {
  return (
    <button
      className="git-operation-button"
      onClick={() => onRun(operation)}
      disabled={activeOperation !== null}
      title={operationLabels[operation]}
    >
      {icon}
      <span>{activeOperation === operation ? "执行中" : operationLabels[operation]}</span>
    </button>
  );
}

export function DetailStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="detail-stat">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
