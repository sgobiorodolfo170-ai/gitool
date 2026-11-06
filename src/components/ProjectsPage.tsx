import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectAnalysis, ProjectFilter } from "../types";
import { useGitOperations } from "../hooks/useGitOperations";
import type { ProjectsApi } from "../hooks/useProjects";
import {
  ProjectsWorkspace,
  type FilterDomain,
  type GitDomain,
  type ImportDomain,
} from "./ProjectsWorkspace";

/**
 * 「我的项目」页编排层（Workspace 级，治理轮-3 编排下沉）。
 *
 * 为什么下沉：App 原是 8 个领域 hook 的编排中心，其中 Git 操作域
 * （useGitOperations + operationOutput/analysis）与筛选/搜索/标签过滤
 * 只被本页消费，却挂在 App，造成 ProjectsWorkspace 28 个 props 逐层穿透。
 * 本组件承接这两块：
 * - 筛选域：state 与派生列表（原 useProjects 内的 useMemo 逐字迁入）；
 *   切工作区时本页随路由卸载，筛选自动复位（原 resetView 手工清空的等价实现）。
 * - Git 操作域：详情输出/结构分析 state（原 App 的两个 useState 迁入）。
 *   useGitOperations 注释里「状态留在 App 以避免 hook 间循环依赖」的约束
 *   随之下沉解除；删除项目后的清除动作经 registerClearDetail 反向登记给 App。
 *
 * 项目列表与选中项留在 App（跨页消费：总览卡片/侧栏徽标/任务与备份下拉/
 * 远程克隆与导入跳转），经 projectsApi 领域对象传入。
 */
export function ProjectsPage({
  projectsApi,
  importDomain,
  onNotice,
  registerClearDetail,
}: {
  projectsApi: ProjectsApi;
  importDomain: ImportDomain;
  onNotice: (message: string) => void;
  /** 把本页的清除详情函数登记给 App（删除项目后 useProjects 要清右侧详情）。 */
  registerClearDetail: (clear: () => void) => void;
}) {
  // —— 筛选域（自 useProjects 逐字迁入，仅本页消费）——
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const allTags = useMemo(
    () => [...new Set(projectsApi.projects.flatMap((project) => project.tags))].sort(),
    [projectsApi.projects],
  );

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projectsApi.projects.filter((project) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "favorite" && project.favorite) ||
        (filter === "attention" &&
          (project.status !== "clean" || project.tags.includes("watching")));
      const matchesTag = !tagFilter || project.tags.includes(tagFilter);
      const matchesSearch =
        !query ||
        `${project.name} ${project.path} ${project.summary} ${project.tags.join(" ")}`
          .toLowerCase()
          .includes(query);
      return matchesFilter && matchesTag && matchesSearch;
    });
  }, [filter, projectsApi.projects, search, tagFilter]);

  const filterDomain: FilterDomain = {
    filter,
    search,
    tagFilter,
    allTags,
    filteredProjects,
    setFilter,
    setSearch,
    setTagFilter,
  };

  // —— Git 操作域（自 App 迁入；operationOutput/analysis 只被右侧详情消费）——
  const [operationOutput, setOperationOutput] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);

  const clearDetail = useCallback(() => {
    setOperationOutput(null);
    setAnalysis(null);
  }, []);

  const gitOperations = useGitOperations({
    selectedProject: projectsApi.selectedProject,
    getProjects: projectsApi.getProjects,
    updateProjects: projectsApi.updateProjects,
    onNotice,
    setOperationOutput,
    setAnalysis,
  });
  const gitDomain: GitDomain = { ...gitOperations, operationOutput, analysis };

  // 登记清除详情给 App：删除项目（useProjects.onClearDetail）、resetView、
  // openProjectDetail 这些 App 侧触发点仍要能清掉本页持有的输出/分析。
  // 卸载时退回空函数：届时状态已随组件销毁，无需也无法清除。
  useEffect(() => {
    registerClearDetail(clearDetail);
    return () => registerClearDetail(() => {});
  }, [clearDetail, registerClearDetail]);

  return (
    <ProjectsWorkspace
      projectsApi={projectsApi}
      filterDomain={filterDomain}
      importDomain={importDomain}
      gitDomain={gitDomain}
      onSelect={(id) => {
        projectsApi.setSelectedId(id);
        clearDetail();
      }}
    />
  );
}
