import type { Project, WorkspaceEntity } from "./types";
import type { CreateWorkspaceInput, RenameWorkspaceInput } from "./types";

/**
 * 传输层抽象（P-10 / 架构评审 L-08）。
 *
 * why 需要接口：业务 hook 原先在内部用 `isDesktopRuntime()` 分叉——桌面走
 * bridge、浏览器走 localStorage——业务编排、环境判断与传输实现耦在同一个
 * 函数里。新增能力就要再写一次双分支，且两份实现无共享测试。
 *
 * 现在的依赖方向：hooks 只依赖本接口；desktop/web 两个实现（src/lib/repositories/）
 * 在启动时按环境构造一次，由调用方注入。浏览器预览的 `window.prompt` 等
 * 专用 API 也被封装在 web 实现内部，不再泄漏进业务 hook。
 *
 * why 接口放 shared/：与 types.ts 同级、但本文件是纯类型（无运行时值），
 * 双端都能引用；实现留在渲染层（src/lib/repositories/），主进程不感知。
 */

/** 项目数据仓库：按工作区分区读写项目列表。 */
export interface ProjectRepository {
  loadProjects(workspaceId: string): Promise<Project[]>;
  saveProjects(workspaceId: string, projects: Project[]): Promise<void>;
}

/** 工作区仓库：增删改查工作区实体。 */
export interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceEntity[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceEntity>;
  renameWorkspace(input: RenameWorkspaceInput): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
}

/**
 * 环境网关：目录选择等需要宿主能力的动作。
 *
 * why 单独一个接口而不是塞进 WorkspaceRepository：目录选择不属于任何数据域，
 * 且 web 实现的降级方式（提示不支持 / window.prompt）与数据存储无关。
 */
export interface ShellGateway {
  /** 打开系统目录选择框；用户取消返回 null。web 环境返回 null 并由调用方提示。 */
  selectDirectory(defaultPath?: string): Promise<string | null>;
}
