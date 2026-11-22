import type { Project, WorkspaceEntity } from "../../../shared/types";
import type {
  CreateWorkspaceInput,
  RenameWorkspaceInput,
} from "../../../shared/types";
import type {
  ProjectRepository,
  ShellGateway,
  WorkspaceRepository,
} from "../../../shared/repository";
import { requireDesktopBridge } from "../bridge";

/**
 * 桌面实现：全部转发到 preload bridge（唯一传输通道）。
 *
 * why 不直接 `import { getDesktopBridge }`：本模块只在桌面运行时被构造
 * （见 index.ts 的 createRepositories），此时 bridge 必然存在；用
 * requireDesktopBridge 让「bridge 缺失」在构造/调用点立刻暴露为明确错误，
 * 而不是静默降级成空数据。
 */

export const desktopProjectRepository: ProjectRepository = {
  loadProjects(workspaceId) {
    return requireDesktopBridge().loadProjects(workspaceId);
  },
  saveProjects(workspaceId, projects) {
    return requireDesktopBridge().saveProjects(workspaceId, projects);
  },
};

export const desktopWorkspaceRepository: WorkspaceRepository = {
  listWorkspaces() {
    return requireDesktopBridge().listWorkspaces();
  },
  createWorkspace(input: CreateWorkspaceInput) {
    return requireDesktopBridge().createWorkspace(input);
  },
  renameWorkspace(input: RenameWorkspaceInput) {
    return requireDesktopBridge().renameWorkspace(input);
  },
  deleteWorkspace(id) {
    return requireDesktopBridge().deleteWorkspace(id);
  },
};

export const desktopShellGateway: ShellGateway = {
  selectDirectory(defaultPath) {
    return requireDesktopBridge().selectDirectory(defaultPath);
  },
};

/** 仅供类型检查：桌面实现覆盖的实体形状与 shared 契约一致。 */
export type DesktopEntities = {
  project: Project;
  workspace: WorkspaceEntity;
};
