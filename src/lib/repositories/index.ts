import type {
  ProjectRepository,
  ShellGateway,
  WorkspaceRepository,
} from "../../../shared/repository";
import { isDesktopRuntime } from "../bridge";
import {
  desktopProjectRepository,
  desktopShellGateway,
  desktopWorkspaceRepository,
} from "./desktop";
import {
  webProjectRepository,
  webShellGateway,
  webWorkspaceRepository,
} from "./web";

/**
 * 传输层组合根（P-10）：按运行环境构造一次 Repository 集合。
 *
 * why 在启动时一次性分派：原先 13 处 `isDesktopRuntime()` 散落在各 hook 内部，
 * 每个调用点各自分叉；集中到这里后，业务代码只看到接口，环境判断只有这一处。
 * 后续若增加第三种运行环境（如测试用 in-memory 实现），只改本文件。
 */

export interface RepositoryBundle {
  projects: ProjectRepository;
  workspaces: WorkspaceRepository;
  shell: ShellGateway;
}

export function createRepositories(): RepositoryBundle {
  if (isDesktopRuntime()) {
    return {
      projects: desktopProjectRepository,
      workspaces: desktopWorkspaceRepository,
      shell: desktopShellGateway,
    };
  }
  return {
    projects: webProjectRepository,
    workspaces: webWorkspaceRepository,
    shell: webShellGateway,
  };
}

export type { ProjectRepository, ShellGateway, WorkspaceRepository };
