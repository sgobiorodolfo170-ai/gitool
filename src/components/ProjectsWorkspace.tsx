import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Cloud,
  FolderGit2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import type { GitOperation, Project, ProjectAnalysis, ProjectFilter } from "../types";

import { EmptyProjects, FilterButton, ProjectRow } from "./common";

import { ProjectDetail } from "./ProjectDetail";

export type ProjectsWorkspaceProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject?: Project;
  filter: ProjectFilter;
  search: string;
  tagFilter: string;
  allTags: string[];
  isImporting: boolean;
  onFilterChange: (filter: ProjectFilter) => void;
  onSearchChange: (search: string) => void;
  onTagFilterChange: (tag: string) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateProject: (id: string, patch: Partial<Project>) => void;
  onBulkGitOperation: (operation: GitOperation, ids: string[]) => void | Promise<void>;
  onMoveProject: (project: Project) => void | Promise<void>;
  onInitRepository: () => void | Promise<void>;
  onScanImport: () => void | Promise<void>;
  onImport: () => void;
  onDeleteProject: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  isRefreshing: boolean;
  onRunGitOperation: (operation: GitOperation) => void | Promise<void>;
  activeOperation: GitOperation | null;
  operationOutput: string | null;
  onAnalyzeProject: () => void | Promise<void>;
  isAnalyzing: boolean;
  analysis: ProjectAnalysis | null;
};

export function ProjectsWorkspace({
  projects,
  filteredProjects,
  selectedProject,
  filter,
  search,
  tagFilter,
  allTags,
  isImporting,
  onFilterChange,
  onSearchChange,
  onTagFilterChange,
  onSelect,
  onToggleFavorite,
  onUpdateProject,
  onBulkGitOperation,
  onMoveProject,
  onInitRepository,
  onScanImport,
  onImport,
  onDeleteProject,
  onRefresh,
  isRefreshing,
  onRunGitOperation,
  activeOperation,
  operationOutput,
  onAnalyzeProject,
  isAnalyzing,
  analysis,
}: ProjectsWorkspaceProps) {
  const attentionCount = projects.filter(
    (project) => project.status !== "clean" || project.tags.includes("watching"),
  ).length;
  const favoriteCount = projects.filter((project) => project.favorite).length;
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (typing) {
          (target as HTMLInputElement).blur();
        } else if (search) {
          onSearchChange("");
        }
        setSelectedBulkIds([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [search, onSearchChange]);

  useEffect(() => {
    setSelectedBulkIds([]);
  }, [filter]);

  const toggleBulk = (id: string) => {
    setSelectedBulkIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleAll = () => {
    setSelectedBulkIds((current) =>
      current.length === filteredProjects.length
        ? []
        : filteredProjects.map((project) => project.id),
    );
  };

  const runBulk = (operation: GitOperation) => {
    if (selectedBulkIds.length === 0) return;
    void onBulkGitOperation(operation, selectedBulkIds);
    setSelectedBulkIds([]);
  };

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            项目目录
          </div>
          <h1>我的项目</h1>
          <p>集中查看本地项目、远程关联与工作区状态。</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw size={15} className={isRefreshing ? "spin" : ""} />
            {isRefreshing ? "刷新中..." : "刷新状态"}
          </button>
          <button className="button secondary" onClick={onScanImport}>
            <FolderGit2 size={15} />
            批量导入
          </button>
          <button className="button secondary" onClick={onInitRepository}>
            <Plus size={15} />
            初始化仓库
          </button>
          <button className="button primary" onClick={onImport}>
            <Plus size={16} />
            {isImporting ? "导入中..." : "导入项目"}
          </button>
        </div>
      </div>

      <div className="section-toolbar">
        <div className="filter-tabs">
          <FilterButton active={filter === "all"} onClick={() => onFilterChange("all")}>
            全部 <span>{projects.length}</span>
          </FilterButton>
          <FilterButton active={filter === "favorite"} onClick={() => onFilterChange("favorite")}>
            已收藏 <span>{favoriteCount}</span>
          </FilterButton>
          <FilterButton active={filter === "attention"} onClick={() => onFilterChange("attention")}>
            需要关注 <span>{attentionCount}</span>
          </FilterButton>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索项目、路径或摘要"
          />
          <kbd>/</kbd>
        </label>
      </div>

      {allTags.length > 0 && (
        <div className="tag-filter-bar">
          <span>标签：</span>
          <button
            className={`tag-filter-chip ${tagFilter === "" ? "active" : ""}`}
            onClick={() => onTagFilterChange("")}
          >
            全部
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`tag-filter-chip ${tagFilter === tag ? "active" : ""}`}
              onClick={() => onTagFilterChange(tagFilter === tag ? "" : tag)}
            >
              <Tag size={10} />
              {tag}
            </button>
          ))}
        </div>
      )}

      <section className="project-layout">
        <div className="project-list-panel">
          <div className="panel-heading">
            <div>
              <h2>最近项目</h2>
              <span>{filteredProjects.length} 个结果</span>
            </div>
            <div className="panel-heading-actions">
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={
                    filteredProjects.length > 0 &&
                    selectedBulkIds.length === filteredProjects.length
                  }
                  onChange={toggleAll}
                />
                <span>全选</span>
              </label>
              <button className="bare-button" aria-label="更多项目">
                <MoreHorizontal size={18} />
              </button>
            </div>
          </div>
          <div className="project-list">
            {filteredProjects.length ? (
              filteredProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  selected={project.id === selectedProject?.id}
                  bulkSelected={selectedBulkIds.includes(project.id)}
                  onToggleBulk={() => toggleBulk(project.id)}
                  onSelect={() => onSelect(project.id)}
                  onToggleFavorite={() => onToggleFavorite(project.id)}
                  onDelete={() => onDeleteProject(project.id)}
                />
              ))
            ) : (
              <EmptyProjects onImport={onImport} />
            )}
          </div>
        </div>
        {selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            onToggleFavorite={() => onToggleFavorite(selectedProject.id)}
            onUpdateProject={(patch) => onUpdateProject(selectedProject.id, patch)}
            onMoveProject={() => onMoveProject(selectedProject)}
            onRunGitOperation={onRunGitOperation}
            activeOperation={activeOperation}
            operationOutput={operationOutput}
            onAnalyzeProject={onAnalyzeProject}
            isAnalyzing={isAnalyzing}
            analysis={analysis}
          />
        ) : (
          <div className="detail-panel empty-detail">选择一个项目查看详情</div>
        )}
      </section>

      {selectedBulkIds.length > 0 && (
        <div className="bulk-action-bar">
          <span>已选 {selectedBulkIds.length} 个项目</span>
          <div className="bulk-actions">
            <button className="button secondary compact-button" onClick={() => runBulk("fetch")}>
              <Cloud size={14} />
              批量获取
            </button>
            <button className="button secondary compact-button" onClick={() => runBulk("pull")}>
              <ArrowDownToLine size={14} />
              批量拉取
            </button>
            <button className="button secondary compact-button" onClick={() => runBulk("push")}>
              <ArrowUpRight size={14} />
              批量推送
            </button>
            <button
              className="icon-button danger"
              onClick={() => setSelectedBulkIds([])}
              aria-label="取消选择"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
