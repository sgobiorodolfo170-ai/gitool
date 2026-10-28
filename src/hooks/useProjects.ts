import { useCallback, useMemo, useRef, useState } from "react";
import type { Project, ProjectFilter } from "../../shared/types";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";
import { mapWithConcurrency } from "../lib/concurrency";
import { projectFromSnapshot } from "../lib/projectMatch";
import { saveProjects } from "../lib/projects";

/**
 * 项目列表：加载、持久化、筛选、收藏、刷新、移动。
 *
 * 这是整个渲染层最核心的一块状态。抽成 hook 后，`App` 只需要把
 * `activeWorkspaceId` 和几个回调传进来，不必再持有 8 个 state + 900 行 handler。
 *
 * 保存策略（两处关键设计，改动时勿破坏）：
 * 1. `projectsRef` 保存同步副本——连续两次更新必须基于最新值计算，不能等 React 重渲染。
 * 2. `saveQueueRef` 串行化落库——并发保存时后发起的请求可能先返回，旧快照会覆盖新快照。
 */
export type ProjectsApi = {
  projects: Project[];
  selectedProject: Project | undefined;
  filteredProjects: Project[];
  allTags: string[];
  selectedId: string;
  filter: ProjectFilter;
  search: string;
  tagFilter: string;
  isRefreshing: boolean;
  setSelectedId: (id: string) => void;
  setFilter: (filter: ProjectFilter) => void;
  setSearch: (value: string) => void;
  setTagFilter: (value: string) => void;
  /** 直接替换整个列表（切换工作区、首次加载时用）。 */
  applyProjects: (next: Project[]) => void;
  /** 基于最新列表做不可变更新，并串行落库。 */
  updateProjects: (updater: (prev: Project[]) => Project[]) => void;
  toggleFavorite: (projectId: string) => void;
  deleteProjectFromList: (projectId: string) => void;
  refreshProjects: () => Promise<void>;
  moveProject: (project: Project) => Promise<void>;
};

export type ProjectsParams = {
  activeWorkspaceId: string;
  onNotice: (message: string) => void;
  /** 项目被删除或切换时清空右侧详情（operationOutput / analysis 属于 Git 操作域）。 */
  onClearDetail: () => void;
  /** 移动项目时的默认目录提示。 */
  defaultDirectoryHint: () => string | undefined;
};

export function useProjects(params: ProjectsParams): ProjectsApi {
  const { activeWorkspaceId, onNotice, onClearDetail, defaultDirectoryHint } = params;

  const [projects, setProjects] = useState<Project[]>([]);
  const projectsRef = useRef<Project[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const applyProjects = useCallback((next: Project[]) => {
    projectsRef.current = next;
    setProjects(next);
  }, []);

  const persistProjects = useCallback(
    (workspaceId: string, next: Project[]) => {
      if (!isDesktopRuntime()) {
        saveProjects(workspaceId, next);
        return;
      }
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => requireDesktopBridge().saveProjects(workspaceId, next))
        .catch((error) => {
          onNotice(error instanceof Error ? error.message : "项目数据保存失败");
        });
    },
    [onNotice],
  );

  const updateProjects = useCallback(
    (updater: (prev: Project[]) => Project[]) => {
      const next = updater(projectsRef.current);
      applyProjects(next);
      persistProjects(activeWorkspaceId, next);
    },
    [activeWorkspaceId, applyProjects, persistProjects],
  );

  const selectedProject = projects.find((project) => project.id === selectedId) ?? projects[0];

  const allTags = useMemo(
    () => [...new Set(projects.flatMap((project) => project.tags))].sort(),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
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
  }, [filter, projects, search, tagFilter]);

  const toggleFavorite = useCallback(
    (projectId: string) => {
      const target = projectsRef.current.find((project) => project.id === projectId);
      // 未克隆的远程收藏条目（path 为空）再次点收藏视为取消收藏，直接从列表移除
      if (target && target.path === "" && target.favorite) {
        updateProjects((prev) => prev.filter((project) => project.id !== projectId));
        return;
      }
      updateProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, favorite: !project.favorite } : project,
        ),
      );
    },
    [updateProjects],
  );

  const deleteProjectFromList = useCallback(
    (projectId: string) => {
      const target = projectsRef.current.find((project) => project.id === projectId);
      if (!target) return;
      const message =
        target.path === ""
          ? `确定移除「${target.alias || target.name}」？这是未克隆的远程收藏条目。`
          : `确定从我的项目中移除「${target.alias || target.name}」？\n项目目录不会被删除，后续可重新导入。`;
      if (!window.confirm(message)) return;

      const wasSelected = selectedId === projectId;
      const next = projectsRef.current.filter((project) => project.id !== projectId);
      applyProjects(next);
      persistProjects(activeWorkspaceId, next);
      if (wasSelected) {
        setSelectedId(next[0]?.id ?? "");
      }
      onClearDetail();
      onNotice("已从我的项目移除");
    },
    [activeWorkspaceId, applyProjects, onClearDetail, onNotice, persistProjects, selectedId],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览使用演示数据，桌面版会读取真实 Git 状态");
        return;
      }
      const bridge = requireDesktopBridge();
      const refreshed = await mapWithConcurrency(projectsRef.current, 4, async (project) => {
        try {
          const snapshot = await bridge.getProjectSnapshot(project.path);
          const disk = await bridge.getDiskSize(project.path).catch(() => 0);
          return { ...projectFromSnapshot(project, snapshot), diskSizeBytes: disk };
        } catch {
          return project;
        }
      });
      updateProjects(() => refreshed);
      onNotice("项目状态已刷新");
    } finally {
      setIsRefreshing(false);
    }
  }, [onNotice, updateProjects]);

  const moveProject = useCallback(
    async (sourceProject: Project) => {
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不支持移动项目");
        return;
      }
      if (
        !window.confirm("移动项目会复制整个目录（含 .git）到新位置，并更新本地记录。确定继续吗？")
      ) {
        return;
      }
      const bridge = requireDesktopBridge();
      const targetDirectory = await bridge.selectDirectory(defaultDirectoryHint());
      if (!targetDirectory) return;
      try {
        const result = await bridge.moveProject({
          sourcePath: sourceProject.path,
          targetDirectory,
        });
        if (result.success) {
          updateProjects((prev) =>
            prev.map((project) =>
              project.id === sourceProject.id ? { ...project, path: result.targetPath } : project,
            ),
          );
          onNotice("项目已移动，记录已更新");
        } else {
          onNotice(`移动失败：${result.output}`);
        }
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "移动失败");
      }
    },
    [defaultDirectoryHint, onNotice, updateProjects],
  );

  return {
    projects,
    selectedProject,
    filteredProjects,
    allTags,
    selectedId,
    filter,
    search,
    tagFilter,
    isRefreshing,
    setSelectedId,
    setFilter,
    setSearch,
    setTagFilter,
    applyProjects,
    updateProjects,
    toggleFavorite,
    deleteProjectFromList,
    refreshProjects,
    moveProject,
  };
}
