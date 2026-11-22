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

/**
 * 单例缓存（P-10 注入改造的稳定性保证）。
 *
 * why 必须缓存：hook 在每次渲染时调用 createRepositories()，
 * 若每次新建对象，useCallback 的 repos 依赖会每帧变化、回调链整树重建。
 * 环境在进程生命周期内不变，缓存首个构造结果即可。
 */
let cachedBundle: RepositoryBundle | null = null;

export function createRepositories(): RepositoryBundle {
  if (cachedBundle) {
    return cachedBundle;
  }
  cachedBundle = isDesktopRuntime()
    ? {
        projects: desktopProjectRepository,
        workspaces: desktopWorkspaceRepository,
        shell: desktopShellGateway,
      }
    : {
        projects: webProjectRepository,
        workspaces: webWorkspaceRepository,
        shell: webShellGateway,
      };
  return cachedBundle;
}

/** 测试专用：清空单例缓存，让下一测试可重新选择运行环境。 */
export function resetRepositoriesForTest(): void {
  cachedBundle = null;
}

export type { ProjectRepository, ShellGateway, WorkspaceRepository };
