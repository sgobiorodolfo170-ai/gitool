import { useMemo } from "react";
import { statusMeta } from "../lib/meta";
import { providerIcons } from "./providerIcons";
import { CircleAlert, Cloud, FolderGit2, Plus, RefreshCw, Star } from "lucide-react";
import type { Project, RemoteRepository } from "../types";

import { MetricCard } from "./common";
import { AttentionPanel } from "./AttentionPanel";
import { RemoteRepositorySearch } from "./RemoteRepositorySearch";

export type OverviewWorkspaceProps = {
  projects: Project[];
  selectedProject?: Project;
  isImporting: boolean;
  isRefreshing: boolean;
  cloningRepositoryId: string | null;
  defaultAccountId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  onImport: () => void;
  onClone: (repository: RemoteRepository) => void | Promise<void>;
  onToggleRemoteFavorite: (repository: RemoteRepository) => void;
};

export function OverviewWorkspace({
  projects,
  selectedProject,
  isImporting,
  isRefreshing,
  cloningRepositoryId,
  defaultAccountId,
  onSelect,
  onRefresh,
  onImport,
  onClone,
  onToggleRemoteFavorite,
}: OverviewWorkspaceProps) {
  const attentionCount = projects.filter(
    (project) => project.status !== "clean" || project.tags.includes("watching"),
  ).length;
  const favoriteCount = projects.filter((project) => project.favorite).length;
  const providerCount = new Set(projects.map((project) => project.provider)).size;
  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [projects],
  );

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            工作区状态
          </div>
          <h1>早上好，Leo</h1>
          <p>这里是你今天的开发现场。</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw size={15} className={isRefreshing ? "spin" : ""} />
            {isRefreshing ? "刷新中..." : "刷新状态"}
          </button>
          <button className="button primary" onClick={onImport}>
            <Plus size={16} />
            {isImporting ? "导入中..." : "导入项目"}
          </button>
        </div>
      </div>

      <section className="metric-grid" aria-label="工作区指标">
        <MetricCard
          label="全部项目"
          value={projects.length.toString()}
          detail="本地已登记"
          icon={<FolderGit2 size={18} />}
          tone="teal"
        />
        <MetricCard
          label="需要关注"
          value={attentionCount.toString().padStart(2, "0")}
          detail="有待处理变更"
          icon={<CircleAlert size={18} />}
          tone="coral"
        />
        <MetricCard
          label="已收藏"
          value={favoriteCount.toString().padStart(2, "0")}
          detail="快速访问项目"
          icon={<Star size={18} />}
          tone="yellow"
        />
        <MetricCard
          label="连接平台"
          value={providerCount.toString()}
          detail="远程与本地"
          icon={<Cloud size={18} />}
          tone="blue"
        />
      </section>

      <RemoteRepositorySearch
        projects={projects}
        onClone={onClone}
        cloningRepositoryId={cloningRepositoryId}
        defaultAccountId={defaultAccountId}
        onToggleFavorite={onToggleRemoteFavorite}
      />

      <AttentionPanel projects={projects} selectedId={selectedProject?.id} onSelect={onSelect} />

      <section className="overview-recent">
        <div className="panel-heading">
          <div>
            <h2>最近更新</h2>
            <span>{recentProjects.length} 个项目</span>
          </div>
          <button className="bare-button" onClick={() => onSelect("")}>
            查看全部
          </button>
        </div>
        {recentProjects.length ? (
          <div className="overview-recent-list">
            {recentProjects.map((project) => {
              const ProviderIcon = providerIcons[project.provider];
              const status = statusMeta[project.status];
              return (
                <button
                  className="overview-recent-item"
                  key={project.id}
                  onClick={() => onSelect(project.id)}
                >
                  <div className="project-type-icon" style={{ color: project.languageColor }}>
                    <ProviderIcon size={16} />
                  </div>
                  <div className="overview-recent-copy">
                    <strong>{project.alias || project.name}</strong>
                    <span>{project.path}</span>
                  </div>
                  <span className={`status-pill ${status.className}`}>
                    <span className="status-dot" />
                    {project.syncLabel}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="accounts-empty">
            <FolderGit2 size={22} />
            <strong>还没有项目</strong>
            <span>点击右上角「导入项目」添加第一个 Git 仓库。</span>
          </div>
        )}
      </section>
    </div>
  );
}
