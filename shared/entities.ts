import type { Project, ProjectStatus, TaskProfile } from "./types";

/**
 * 实体运行时工厂：Project / TaskProfile 的**构造函数与默认值单点**。
 *
 * 为什么放在 shared/ 而不放进 shared/types.ts：
 * shared/types.ts 是渲染进程、主进程与测试共享的**纯类型叶**——文件里只有
 * `type` / `interface`，编译后不产生任何运行时代码。本文件是运行时值
 * （常量与函数），一旦并入 types.ts，任何只想引用一个类型的模块都会被迫
 * 把这段运行时代码拖进自己的产物/测试依赖图。因此契约层保持零运行时依赖，
 * 默认值与构造逻辑单独成文件。
 *
 * 默认值来源：全部从改造前渲染层 6 处字面量（useRemotes.ts ×3、
 * useImportFlow.ts ×3）中提取，只保留**实际使用过**的值；调用点能覆盖的
 * 字段（如远程收藏的 id、关注项目的 tags）仍在调用点显式传入，工厂只提供
 * 统一的兜底，不改变任何一条既有展示行为。
 */

/** 新项目的初始状态：尚未做过首次扫描，不能凭空断言 dirty（与旧字面量一致）。 */
export const DEFAULT_PROJECT_STATUS: ProjectStatus = "clean";

/** 未克隆 / 未分析时的语言色：GitHub 语言色板没有「未知」，用中性灰蓝占位。 */
export const DEFAULT_LANGUAGE_COLOR = "#8b97a8";

/** 默认分支：远程仓库拿不到 defaultBranch、或本地新建仓库时的兜底分支名。 */
export const DEFAULT_PROJECT_BRANCH = "main";

/** 本地导入的默认平台；远程收藏/克隆由调用方显式传 repository.provider。 */
export const DEFAULT_PROJECT_PROVIDER: Project["provider"] = "local";

/**
 * 「未克隆」文案。旧实现把它分别写进 commit / syncLabel / language 三个字段，
 * 语义相同但复制了三遍；统一成一个常量，避免三处口径漂移。
 */
export const UNCLONED_LABEL = "未克隆";

/** 已克隆、但还没拿到 Git 快照时的 commit 占位（下一次快照会覆盖）。 */
export const UNSCANNED_COMMIT_LABEL = "未扫描";

/** 新建空仓库没有任何提交时 commit 列的文案（仓库存在 ≠ 有 commit）。 */
export const NO_COMMIT_LABEL = "无提交";

/** 刚导入/克隆/扫描完成时的「相对时间」占位，真实时间由下一次快照覆盖。 */
export const JUST_NOW_LABEL = "刚刚";

/** 已克隆/导入但尚未做语言分析时的 language 占位。 */
export const PENDING_ANALYSIS_LABEL = "待分析";

/** 等待首次 Git 快照扫描时的同步文案。 */
export const PENDING_SCAN_LABEL = "待扫描";

/** 克隆完成（拿不到快照的 sync_label 时）的同步文案。 */
export const CLONED_LABEL = "已克隆";

/** 新建仓库初始化完成后的同步文案（此时还没有快照）。 */
export const INITIALIZED_LABEL = "已初始化";

/** 远程关注占位项目的同步文案（与收藏的「未克隆」区分，用户能分辨关注状态）。 */
export const WATCHED_LABEL = "已关注";

/** 远程收藏占位项目：没有仓库描述时的兜底摘要。 */
export const REMOTE_FAVORITE_SUMMARY = "远程收藏项目，尚未克隆到本地。";

/** 远程关注占位项目：没有仓库描述时的兜底摘要。 */
export const REMOTE_WATCH_SUMMARY = "远程关注项目，尚未克隆到本地。";

/** 从远程平台克隆、拿到仓库描述时的兜底摘要。 */
export const CLONED_SUMMARY = "从远程平台克隆的项目。";

/** 单目录导入的本地项目摘要。 */
export const IMPORTED_SUMMARY = "刚导入的本地项目，等待结构分析。";

/** 「初始化新仓库」入口产生的项目摘要。 */
export const INITIALIZED_SUMMARY = "刚初始化的新 Git 仓库。";

/** 目录批量扫描导入产生的项目摘要。 */
export const SCANNED_SUMMARY = "批量扫描导入的本地项目。";

/** 任务默认没有附加参数。 */
export const DEFAULT_TASK_ARGS = "";

/**
 * 任务默认超时 0 = **不限制超时**（见 services/tasks.ts 的 `timeoutSeconds > 0`
 * 才注册定时器）。因此类型错误的超时值不能静默退化成 0，否则有界任务会变成无界。
 */
export const DEFAULT_TASK_TIMEOUT_SECONDS = 0;

/**
 * createProject 的必填种子：只有身份三要素必须由调用方决定。
 * 其余字段可省略走默认值——注意 `Partial<Project>` 允许传 `undefined`，
 * 工厂内部按 `??` 逐字段兜底，不会被显式 undefined 覆盖成缺字段。
 */
export type ProjectSeed = Partial<Project> & Pick<Project, "id" | "name" | "path">;

/**
 * 构造一个字段完整的 Project（类型契约的 19 个字段全部落位）。
 *
 * 为什么逐字段赋值而不是 `{ ...defaults, ...seed }`：
 * 展开会把 seed 里显式的 `undefined` 带回结果，产出缺字段的对象；
 * 逐字段 `??` 才能保证输出始终满足 Project 的全部必填字段。
 */
export function createProject(seed: ProjectSeed): Project {
  return {
    id: seed.id,
    name: seed.name,
    path: seed.path,
    provider: seed.provider ?? DEFAULT_PROJECT_PROVIDER,
    branch: seed.branch ?? DEFAULT_PROJECT_BRANCH,
    status: seed.status ?? DEFAULT_PROJECT_STATUS,
    commit: seed.commit ?? "",
    favorite: seed.favorite ?? false,
    tags: seed.tags ?? [],
    remote: seed.remote,
    files: seed.files ?? 0,
    syncLabel: seed.syncLabel ?? "",
    language: seed.language ?? "",
    languageColor: seed.languageColor ?? DEFAULT_LANGUAGE_COLOR,
    summary: seed.summary ?? "",
    updatedAt: seed.updatedAt ?? "",
    diskSizeBytes: seed.diskSizeBytes ?? 0,
    alias: seed.alias,
    webUrl: seed.webUrl,
  };
}

/**
 * createTaskProfile 的必填种子：任务的身份与执行要素必须由表单/调用方给出，
 * 只有 args / timeoutSeconds 有真实存在的缺省值（来自 TasksWorkspace 的草稿）。
 */
export type TaskProfileSeed = Partial<TaskProfile> &
  Pick<
    TaskProfile,
    | "id"
    | "projectId"
    | "projectPath"
    | "taskType"
    | "name"
    | "command"
    | "workingDirectory"
    | "createdAt"
  >;

/** 构造字段完整的 TaskProfile（类型契约的 10 个字段全部落位）。 */
export function createTaskProfile(seed: TaskProfileSeed): TaskProfile {
  return {
    id: seed.id,
    projectId: seed.projectId,
    projectPath: seed.projectPath,
    taskType: seed.taskType,
    name: seed.name,
    command: seed.command,
    args: seed.args ?? DEFAULT_TASK_ARGS,
    workingDirectory: seed.workingDirectory,
    timeoutSeconds: seed.timeoutSeconds ?? DEFAULT_TASK_TIMEOUT_SECONDS,
    createdAt: seed.createdAt,
  };
}
