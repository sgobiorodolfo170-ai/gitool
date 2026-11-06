import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Cloud,
  FolderGit2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import type { GitOperation, Project, ProjectAnalysis, ProjectFilter } from "../types";

import { useSplitWidth } from "../hooks/useSplitWidth";
import type { GitOperationsApi } from "../hooks/useGitOperations";
import type { ImportFlowApi } from "../hooks/useImportFlow";
import type { ProjectsApi } from "../hooks/useProjects";
import { EmptyProjects, FilterButton, ProjectRow } from "./common";

import { ProjectDetail } from "./ProjectDetail";

/**
 * 领域对象（治理轮-3 编排下沉）：本组件的 props 契约。
 * 原先 28 个逐字面 props 按「列表/筛选/导入/Git 操作」四域收敛，
 * 类型定义放在消费方（本文件），ProjectsPage 负责装配。
 */

/** 项目域：useProjects 的领域对象（列表/选中/收藏/删除/移动/刷新）。 */
export type ProjectDomain = ProjectsApi;

/** 筛选域：filter/search/tagFilter 状态与派生列表，仅本页消费，ProjectsPage 自持。 */
export type FilterDomain = {
  filter: ProjectFilter;
  search: string;
  tagFilter: string;
  allTags: string[];
  filteredProjects: Project[];
  setFilter: (filter: ProjectFilter) => void;
  setSearch: (value: string) => void;
  setTagFilter: (value: string) => void;
};

/** 导入域：useImportFlow 中本页消费的入口与进行中标记。 */
export type ImportDomain = Pick<
  ImportFlowApi,
  "isImporting" | "importProject" | "initNewRepository" | "scanDirectoryForImport"
>;

/** Git 操作域：useGitOperations 返回值 + 详情输出/结构分析状态（ProjectsPage 自持）。 */
export type GitDomain = GitOperationsApi & {
  operationOutput: string | null;
  analysis: ProjectAnalysis | null;
};

export type ProjectsWorkspaceProps = {
  /** 项目域：列表/选中/收藏/删除/移动/刷新。 */
  projectsApi: ProjectDomain;
  /** 筛选域：筛选/搜索/标签过滤状态与派生列表。 */
  filterDomain: FilterDomain;
  /** 导入域：本页的导入/初始化/扫描入口。 */
  importDomain: ImportDomain;
  /** Git 操作域：单个/批量 Git 操作与结构分析编排。 */
  gitDomain: GitDomain;
  /** 选中项目：置选中项并清空右侧详情的输出/分析（跨域组合，由 ProjectsPage 提供）。 */
  onSelect: (id: string) => void;
};

export function ProjectsWorkspace({
  projectsApi,
  filterDomain,
  importDomain,
  gitDomain,
  onSelect,
}: ProjectsWorkspaceProps) {
  const { projects, selectedProject } = projectsApi;
  const { filter, search, tagFilter, allTags, filteredProjects } = filterDomain;
  const { setFilter, setSearch, setTagFilter } = filterDomain;
  const { isImporting, importProject, initNewRepository, scanDirectoryForImport } = importDomain;
  const {
    runGitOperation,
    runBulkGitOperation,
    analyzeProject,
    activeOperation,
    bulkRunning,
    isAnalyzing,
    operationOutput,
    analysis,
  } = gitDomain;
  const { isRefreshing, refreshProjects } = projectsApi;

  const attentionCount = projects.filter(
    (project) => project.status !== "clean" || project.tags.includes("watching"),
  ).length;
  const favoriteCount = projects.filter((project) => project.favorite).length;
  // 列表/详情分栏宽度：存 localStorage，拖拽分隔条调整，双击恢复默认
  const split = useSplitWidth("gitool.projects.split", 58);
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
          setSearch("");
        }
        setSelectedBulkIds([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [search, setSearch]);

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
    if (selectedBulkIds.length === 0 || bulkRunning) return;
    void runBulkGitOperation(operation, selectedBulkIds);
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
          <button className="button secondary" onClick={() => void refreshProjects()} disabled={isRefreshing}>
            <RefreshCw size={15} className={isRefreshing ? "spin" : ""} />
            {isRefreshing ? "刷新中..." : "刷新状态"}
          </button>
          <button className="button secondary" onClick={() => void scanDirectoryForImport()}>
            <FolderGit2 size={15} />
            批量导入
          </button>
          <button className="button secondary" onClick={() => void initNewRepository()}>
            <Plus size={15} />
            初始化仓库
          </button>
          <button className="button primary" onClick={() => void importProject()}>
            <Plus size={16} />
            {isImporting ? "导入中..." : "导入项目"}
          </button>
        </div>
      </div>

      <div className="section-toolbar">
        <div className="filter-tabs">
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
            全部 <span>{projects.length}</span>
          </FilterButton>
          <FilterButton active={filter === "favorite"} onClick={() => setFilter("favorite")}>
            已收藏 <span>{favoriteCount}</span>
          </FilterButton>
          <FilterButton active={filter === "attention"} onClick={() => setFilter("attention")}>
            需要关注 <span>{attentionCount}</span>
          </FilterButton>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
            onClick={() => setTagFilter("")}
          >
            全部
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`tag-filter-chip ${tagFilter === tag ? "active" : ""}`}
              onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
            >
              <Tag size={10} />
              {tag}
            </button>
          ))}
        </div>
      )}

      <section
        className="project-layout"
        ref={split.containerRef}
        style={{ "--project-list-width": `${split.percent}%` } as React.CSSProperties}
      >
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
                  onToggleFavorite={() => projectsApi.toggleFavorite(project.id)}
                  onDelete={() => projectsApi.deleteProjectFromList(project.id)}
                />
              ))
            ) : (
              <EmptyProjects onImport={() => void importProject()} />
            )}
          </div>
        </div>
        <div
          className="project-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(split.percent)}
          aria-label="调整项目列表宽度，双击恢复默认"
          title="拖动调整宽度，双击恢复默认"
          {...split.splitterHandlers}
        />
        {selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            onToggleFavorite={() => projectsApi.toggleFavorite(selectedProject.id)}
            onUpdateProject={(patch) =>
              projectsApi.updateProjects((prev) =>
                prev.map((project) =>
                  project.id === selectedProject.id ? { ...project, ...patch } : project,
                ),
              )
            }
            onMoveProject={() => void projectsApi.moveProject(selectedProject)}
            onRunGitOperation={runGitOperation}
            activeOperation={activeOperation}
            externalBusy={activeOperation !== null || bulkRunning}
            operationOutput={operationOutput}
            onAnalyzeProject={() => void analyzeProject()}
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
            <button
              className="button secondary compact-button"
              onClick={() => runBulk("fetch")}
              disabled={bulkRunning}
            >
              <Cloud size={14} />
              批量获取
            </button>
            <button
              className="button secondary compact-button"
              onClick={() => runBulk("pull")}
              disabled={bulkRunning}
            >
              <ArrowDownToLine size={14} />
              批量拉取
            </button>
            <button
              className="button secondary compact-button"
              onClick={() => runBulk("push")}
              disabled={bulkRunning}
            >
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
