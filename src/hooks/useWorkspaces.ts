import { useCallback, useState } from "react";
import type { Project, WorkspaceEntity } from "../../shared/types";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";
import { loadProjects } from "../lib/projects";
import { ACTIVE_WORKSPACE_KEY } from "../lib/storageKeys";
import {
  createWorkspace as createWorkspaceLocal,
  deleteWorkspace as deleteWorkspaceLocal,
  renameWorkspace as renameWorkspaceLocal,
} from "../lib/workspaces";

/**
 * 工作区：切换、增删改。
 *
 * 注意：初始加载**不在**这个 hook 里。首启时要并行拉取工作区、环境、账号、
 * 设置和项目列表，那是 App 层的编排职责；hook 只暴露 setter 供其写入。
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
  onNotice: (message: string) => void;
  /** 切换工作区后把新项目列表灌进 useProjects。 */
  onProjectsLoaded: (projects: Project[]) => void;
  /** 切工作区时清空筛选、详情与导航位置。 */
  onResetView: () => void;
};

export function useWorkspaces(params: WorkspacesParams): WorkspacesApi {
  const { activeWorkspaceId, setActiveWorkspaceId, onNotice, onProjectsLoaded, onResetView } =
    params;

  const [workspaces, setWorkspaces] = useState<WorkspaceEntity[]>([]);

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === activeWorkspaceId) return;
      setActiveWorkspaceId(id);
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
      try {
        const stored = isDesktopRuntime()
          ? await requireDesktopBridge().loadProjects(id)
          : loadProjects(id);
        onProjectsLoaded(stored);
      } catch {
        onProjectsLoaded([]);
      }
      onResetView();
    },
    [activeWorkspaceId, onProjectsLoaded, onResetView, setActiveWorkspaceId],
  );

  const createWorkspace = useCallback(
    async (name: string): Promise<WorkspaceEntity | null> => {
      try {
        const created = isDesktopRuntime()
          ? await requireDesktopBridge().createWorkspace({ name })
          : createWorkspaceLocal({ name });
        setWorkspaces((current) => [...current, created]);
        onNotice(`工作区「${created.name}」已创建`);
        return created;
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "创建工作区失败");
        return null;
      }
    },
    [onNotice],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string) => {
      try {
        if (isDesktopRuntime()) {
          await requireDesktopBridge().renameWorkspace({ id, name });
        } else {
          renameWorkspaceLocal({ id, name });
        }
        setWorkspaces((current) =>
          current.map((item) =>
            item.id === id ? { ...item, name, updatedAt: new Date().toISOString() } : item,
          ),
        );
        onNotice("工作区已重命名");
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "重命名失败");
      }
    },
    [onNotice],
  );

  const deleteWorkspace = useCallback(
    async (id: string) => {
      try {
        if (isDesktopRuntime()) {
          await requireDesktopBridge().deleteWorkspace(id);
        } else {
          deleteWorkspaceLocal(id);
        }
        setWorkspaces((current) => current.filter((item) => item.id !== id));
        if (activeWorkspaceId === id) {
          const remaining = workspaces.find((item) => item.id !== id);
          if (remaining) {
            await switchWorkspace(remaining.id);
          }
        }
        onNotice("工作区已删除");
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "删除失败");
      }
    },
    [activeWorkspaceId, onNotice, switchWorkspace, workspaces],
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
