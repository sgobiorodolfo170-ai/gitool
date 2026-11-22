import { useCallback, useRef, useState } from "react";
import type { Project, WorkspaceEntity } from "../../shared/types";
import type { ProjectRepository, WorkspaceRepository } from "../../shared/repository";
import { createRepositories } from "../lib/repositories";
import { ACTIVE_WORKSPACE_KEY } from "../lib/storageKeys";

/**
 * 工作区：切换、增删改。
 *
 * 注意：初始加载**不在**这个 hook 里。首启时要并行拉取工作区、环境、账号、
 * 设置和项目列表，那是 App 层的编排职责；hook 只暴露 setter 供其写入。
 *
 * P-10（传输层抽象）：hook 不再用 isDesktopRuntime() 分叉，改为依赖注入的
 * Repository 接口。默认实现由 createRepositories() 按运行环境构造一次；
 * 测试可传入内存实现，无需再 mock window.gitool。
 */
export type WorkspacesApi = {
  workspaces: WorkspaceEntity[];
  setWorkspaces: React.Dispatch<React.SetStateAction<WorkspaceEntity[]>>;
  switchWorkspace: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceEntity | null>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
};

export type WorkspacesParams = {
  /** 由 App 持有：useProjects 需要它做保存分区，提到 App 可避免两个 hook 互相依赖。 */
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  onNotice: (
    message: string,
    options?: { kind?: "success" | "error" | "warning" | "info" },
  ) => void;
  /** 切换工作区后把新项目列表灌进 useProjects。 */
  onProjectsLoaded: (projects: Project[]) => void;
  /** 切工作区时清空筛选、详情与导航位置。 */
  onResetView: () => void;
  /** 可选：测试注入内存实现；生产环境缺省走 createRepositories() 单例。 */
  repositories?: {
    workspaces: WorkspaceRepository;
    projects: ProjectRepository;
  };
};

export function useWorkspaces(params: WorkspacesParams): WorkspacesApi {
  const { activeWorkspaceId, setActiveWorkspaceId, onNotice, onProjectsLoaded, onResetView } =
    params;
  const repos = params.repositories ?? createRepositories();

  const [workspaces, setWorkspaces] = useState<WorkspaceEntity[]>([]);
  // 快速连续切换工作区时，慢的旧请求后返回会把新工作区的项目列表覆盖掉，
  // 用请求序号守卫：只有最新一次切换的结果允许灌入（2026-11-07 审查 P1-5）。
  const switchSeqRef = useRef(0);

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === activeWorkspaceId) return;
      const seq = ++switchSeqRef.current;
      setActiveWorkspaceId(id);
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
      try {
        const stored = await repos.projects.loadProjects(id);
        if (seq !== switchSeqRef.current) return;
        onProjectsLoaded(stored);
      } catch {
        if (seq !== switchSeqRef.current) return;
        onProjectsLoaded([]);
      }
      onResetView();
    },
    [activeWorkspaceId, onProjectsLoaded, onResetView, repos, setActiveWorkspaceId],
  );

  const createWorkspace = useCallback(
    async (name: string): Promise<WorkspaceEntity | null> => {
      try {
        const created = await repos.workspaces.createWorkspace({ name });
        setWorkspaces((current) => [...current, created]);
        onNotice(`工作区「${created.name}」已创建`);
        return created;
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "创建工作区失败", { kind: "error" });
        return null;
      }
    },
    [onNotice, repos],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string) => {
      try {
        await repos.workspaces.renameWorkspace({ id, name });
        setWorkspaces((current) =>
          current.map((item) =>
            item.id === id ? { ...item, name, updatedAt: new Date().toISOString() } : item,
          ),
        );
        onNotice("工作区已重命名");
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "重命名失败", { kind: "error" });
      }
    },
    [onNotice, repos],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      try {
        await repos.workspaces.deleteWorkspace(id);
        setWorkspaces((current) => current.filter((item) => item.id !== id));
        if (activeWorkspaceId === id) {
          const remaining = workspaces.find((item) => item.id !== id);
          if (remaining) {
            await switchWorkspace(remaining.id);
          }
        }
        onNotice("工作区已删除");
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "删除失败", { kind: "error" });
      }
    },
    [activeWorkspaceId, onNotice, repos, switchWorkspace, workspaces],
  );

  return {
    workspaces,
    setWorkspaces,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  };
}
