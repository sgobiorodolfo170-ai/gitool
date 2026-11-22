import type {
  CreateWorkspaceInput,
  RenameWorkspaceInput,
  WorkspaceEntity,
} from "../../../shared/types";
import type {
  ProjectRepository,
  ShellGateway,
  WorkspaceRepository,
} from "../../../shared/repository";
import {
  DEFAULT_WORKSPACE_ID,
  createWorkspace as createWorkspaceLocal,
  deleteWorkspace as deleteWorkspaceLocal,
  listWorkspaces as listWorkspacesLocal,
  renameWorkspace as renameWorkspaceLocal,
} from "../workspaces";
import { loadProjects, saveProjects } from "../projects";

/**
 * Web/浏览器预览实现：localStorage 存储 + 受限的宿主能力降级。
 *
 * why 保留而不是删除：浏览器预览（`npm run dev:web`）仍是产品目标之一
 * （README 的在线演示入口）。规则校验已统一到 shared/workspaceRules，
 * 这里只做「存储适配」，不再自带业务规则。
 *
 * why selectDirectory 返回 null：web 环境没有系统对话框；旧实现的
 * `window.prompt` 分叉已被移除（P-10 / L-08），调用方收到 null 后自行提示
 * 「请使用桌面版」，与其它宿主能力的降级文案一致。
 */

export const webProjectRepository: ProjectRepository = {
  async loadProjects(workspaceId) {
    return loadProjects(workspaceId);
  },
  async saveProjects(workspaceId, projects) {
    saveProjects(workspaceId, projects);
  },
};

export const webWorkspaceRepository: WorkspaceRepository = {
  async listWorkspaces(): Promise<WorkspaceEntity[]> {
    return listWorkspacesLocal();
  },
  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceEntity> {
    return createWorkspaceLocal(input);
  },
  async renameWorkspace(input: RenameWorkspaceInput): Promise<void> {
    renameWorkspaceLocal(input);
  },
  async deleteWorkspace(id: string): Promise<void> {
    deleteWorkspaceLocal(id);
  },
};

export const webShellGateway: ShellGateway = {
  async selectDirectory(): Promise<string | null> {
    return null;
  },
};

/** Web 实现的默认工作区 ID 与本地实现共享同一常量。 */
export { DEFAULT_WORKSPACE_ID };
