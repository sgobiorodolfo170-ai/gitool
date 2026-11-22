/**
 * 工作区常量重导出（P-15 配套）。
 *
 * why 独立文件：DEFAULT_WORKSPACE_ID 是运行时常量，原先定义在
 * src/lib/workspaces.ts（渲染层实现文件）。useBootstrap 与 web 仓库实现
 * 都需要它，若从实现文件 import 会把 localStorage 实现细节拖进依赖图；
 * 放在 shared 层让两侧都只依赖常量本身。
 */

/** 默认工作区 ID：主进程种子与 web 实现共用同一值。 */
export const DEFAULT_WORKSPACE_ID = "default";
