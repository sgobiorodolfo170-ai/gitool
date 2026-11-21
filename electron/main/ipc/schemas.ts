import { z } from "zod";
import type {
  AiSummaryRequest,
  AppSettings,
  BackupCreateInput,
  BackupRestoreInput,
  CloneRepositoryInput,
  CommitRequest,
  CompareRequest,
  CreateAccountInput,
  CreateBranchInput,
  CreateTagInput,
  CreateWorkspaceInput,
  DeleteBranchInput,
  FileDiffRequest,
  GitOperation,
  InitRepositoryInput,
  MoveProjectInput,
  OpenEditorInput,
  Project,
  RemoteRepositorySearchInput,
  RemoteRepositoryWriteInput,
  RenameWorkspaceInput,
  RepositoryInteractionInput,
  RevertCommitInput,
  SetRemoteUrlInput,
  SwitchBranchInput,
  TaskProfile,
} from "../../../shared/types";
import {
  DEFAULT_LANGUAGE_COLOR,
  DEFAULT_TASK_ARGS,
  DEFAULT_TASK_TIMEOUT_SECONDS,
} from "../../../shared/entities";

/**
 * IPC 入参 schema。
 *
 * 设计原则：**行为与改造前的 32 个手写 validator 逐字段等价**，只换实现不换语义。
 * - 必填字符串：trim 后为空即抛错（错误文案保持中文，直接展示给用户）
 * - 可选/带默认值的字段：用 `.catch(...)` 兜底，类型不对时退回默认值而不是抛错
 *
 * 之所以大量用 `.catch()` 而不是 `.default()`：`.default()` 只在值为 `undefined` 时生效，
 * 类型错误仍会抛；而原实现是「类型不对就给默认值」。要保行为一致必须用 `.catch()`。
 *
 * ⚠ 例外（P-02 / A-15）：**实体 schema（projectSchema / taskProfileSchema）已收窄**。
 * 这两个 schema 守的是「落库写入」边界，若对业务字段（id/name/path/provider/status/
 * favorite/tags/taskType…）继续 `.catch()`，字段漂移会被静默改写成默认值（脏工作区
 * 落库成 clean、语言色/超时被替换），结果是「看似成功」的错误数据且没有任何告警。
 * 现在业务字段非法即报错；只对**可再生的派生展示字段**（快照/磁盘扫描会重算的
 * files / diskSizeBytes / branch / commit / languageColor 等）保留兜底，用于容错旧数据。
 */

/**
 * 单个 IPC 字符串入参的统一上限。
 *
 * why 设上限：IPC 是渲染层与主进程之间唯一的公开通道，没有长度限制意味着一次
 * invoke 就能把任意大的字符串塞进主进程（内存放大、日志与错误信息被撑爆）。
 * 路径以外的字符串同样要挡，所以上限定义在基元层而不是各 handler 里重复写。
 */
export const MAX_IPC_STRING = 4096;

/** 字符串数组类入参的总量与单项上限（与改造前 requireStringArray 的口径一致）。 */
const MAX_IPC_ARRAY_ITEMS = 10000;
const MAX_IPC_ITEM_LENGTH = 4096;

/** C0 控制字符 + DEL：标识/引用名里出现即视为非法，正常业务值不可能包含。 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * 字符串数组字段的统一上限（项目标签、暂存文件列表共用）。
 *
 * why 提取成一处：两处以上字段都要求「单项 ≤4096 + 总量 ≤10000」，散落写字面量
 * 迟早漂移；错误文案按字段传入，保持用户看到的提示具体（文件路径/标签）。
 */
const boundedStringArray = (itemLabel: string, listLabel: string) =>
  z
    .array(
      z.string().max(MAX_IPC_ITEM_LENGTH, {
        message: `${itemLabel}过长（最多 ${MAX_IPC_ITEM_LENGTH} 字符）`,
      }),
    )
    .max(MAX_IPC_ARRAY_ITEMS, {
      message: `${listLabel}数量过多（最多 ${MAX_IPC_ARRAY_ITEMS} 个）`,
    });

/**
 * 必填字符串：非空且不是纯空白，返回原值（不 trim，与原 requireString 一致）。
 *
 * why 默认 max：A-13 复验发现 27 个通道的必填字符串没有上限，「类型/长度校验」
 * 只在路径/ID 等少数基元上成立。这里给所有 requiredString 一个 4096 的安全边界，
 * 个别字段（如提交信息）通过第二个参数按业务规则收紧。
 */
const requiredString = (label: string, max = MAX_IPC_STRING) =>
  z
    .string()
    .max(max, { message: `${label}过长（最多 ${max} 字符）` })
    .refine((value) => value.trim().length > 0, { message: `${label}不能为空` });

/**
 * 可选字符串：空串/类型错误/超长都归为 undefined。
 * why 同样加 max：可选字段也是 IPC 载荷的一部分，超长值与非法类型一样按「未提供」处理。
 */
const optionalTrimmed = z
  .string()
  .max(MAX_IPC_STRING)
  .optional()
  .catch(undefined)
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

/** 宽松字符串：类型错误/超长退回 fallback（展示、设置等可容错字段专用）。 */
const looseString = (fallback = "") => z.string().max(MAX_IPC_STRING).catch(fallback);

/**
 * 路径类入参：只负责「非空 + 长度」这一层类型校验，**不承担语义校验**。
 *
 * why 不做 UNC/相对路径/允许根判断：这些规则由 services/pathPolicy.ts 单点维护，
 * 若 schema 里再写一遍，两边迟早漂移，且会让「新目录尚未登记」的正常流程被误拒。
 * why trim：渲染层从剪贴板带进来的前导/尾随空白对路径没有语义，先归一化再交给
 * pathPolicy 解析，避免同一个目录因一个空格被判成不同路径。
 * why 拒控制字符：控制字符在 Windows 路径里没有合法含义，放行只会把解析歧义
 * 留到 fs/git 层；这是类型层约束，不涉及路径语义。
 */
export const localPathSchema = z
  .string()
  .trim()
  .min(1, { message: "路径不能为空" })
  .max(MAX_IPC_STRING, { message: `路径过长（最多 ${MAX_IPC_STRING} 字符）` })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "路径包含非法控制字符" });

/**
 * 标识类入参（工作区/账号/项目/任务/运行的 ID）。
 *
 * why 收紧到 200：这些值只用于内存查找与数据库主键，正常形态是 UUID 或短串；
 * 200 足以覆盖现有全部 ID，同时挡住超大载荷。控制字符会让日志/命令行解析错乱，
 * 且合法 ID 里不可能出现，直接拒绝而不是静默清洗。
 */
export const idSchema = z
  .string()
  .trim()
  .min(1, { message: "标识不能为空" })
  .max(200, { message: "标识过长（最多 200 字符）" })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "标识包含非法控制字符" });

/**
 * Git 引用名（标签名）类入参。
 *
 * why 不复用 idSchema：引用名会原样进入 git 命令行参数，必须遵守 git ref 的基本
 * 约束——非空、不过长、不含控制字符、不以空白开头、不含 `..`（`..` 既可能构造
 * 路径穿越语义，也常被用来拼接可疑引用）。
 * why 不 trim：引用名必须与仓库里真实存在的名字逐字符一致，静默 trim 会让
 * 「删除某个标签」删到另一个标签（或校验通过但 git 找不到）——风险大于收益。
 */
export const refNameSchema = z
  .string()
  .min(1, { message: "名称不能为空" })
  .max(255, { message: "名称过长（最多 255 字符）" })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "名称包含非法控制字符" })
  .refine((value) => !value.includes(".."), { message: "名称不能包含「..」" })
  .refine((value) => !/^\s/.test(value), { message: "名称不能以空白开头" });

/**
 * 外链入参（shell:openExternal）。
 *
 * why 单独一套而不是复用 localPathSchema：外链会被交给 Windows 的默认浏览器
 * 协议处理器，只允许 http/https 协议能避免 `file:`、`ms-*:` 等本地/命令协议被
 * 顺带拉起；长度上限则挡住超大字符串被塞进 shell 调用。
 * why 保留原错误文案：非 http(s) 时仍提示「只允许打开 HTTP 或 HTTPS 链接」，
 * 不把内部 schema 术语暴露给用户。
 */
export const externalUrlSchema = z
  .string()
  .trim()
  .min(1, { message: "链接不能为空" })
  .max(2048, { message: "链接过长（最多 2048 字符）" })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "链接包含非法控制字符" })
  .refine((value) => /^https?:\/\//i.test(value), { message: "只允许打开 HTTP 或 HTTPS 链接" });

/**
 * 文件列表类入参（git stage/unstage）。
 *
 * why 总量 + 单项双上限：数组长度决定一次 IPC 的载荷规模，单项长度决定单条命令
 * 参数的大小；只限一头都还能被渲染层放大成内存/命令行压力。
 * why 允许空字符串项：改造前只校验类型与长度，空项由 git 自身报错；这里保持
 * 不变，避免把「文件列表不合法」的判定范围扩大到业务层。
 */
export const fileListSchema = boundedStringArray("文件路径", "文件");

export const appSettingsSchema = z.object({
  gitPath: looseString(),
  defaultProjectDirectory: looseString(),
  defaultBackupDirectory: looseString(),
  backupExcludePatterns: looseString(),
  defaultSearchAccountId: looseString(),
  aiApiKeyConfigured: z.boolean().catch(false),
  aiModel: looseString(),
  aiBaseUrl: looseString(),
  closeToTray: z.boolean().catch(false),
}) satisfies z.ZodType<AppSettings>;

export const aiSummaryRequestSchema = z.object({
  projectName: requiredString("项目名称"),
  context: looseString(),
}) satisfies z.ZodType<AiSummaryRequest>;

export const moveProjectInputSchema = z.object({
  sourcePath: requiredString("源路径"),
  targetDirectory: requiredString("目标目录"),
}) satisfies z.ZodType<MoveProjectInput>;

export const initRepositoryInputSchema = z.object({
  path: requiredString("初始化路径"),
  defaultBranch: optionalTrimmed,
}) satisfies z.ZodType<InitRepositoryInput>;

export const fileDiffRequestSchema = z.object({
  path: requiredString("项目路径"),
  file: requiredString("文件路径"),
}) satisfies z.ZodType<FileDiffRequest>;

export const setRemoteUrlInputSchema = z.object({
  path: requiredString("项目路径"),
  url: requiredString("远程地址"),
  remote: optionalTrimmed,
}) satisfies z.ZodType<SetRemoteUrlInput>;

export const createTagInputSchema = z.object({
  path: requiredString("项目路径"),
  name: requiredString("标签名"),
  // why 显式 max：附注是可选的自由文本，但同样来自 IPC，不能成为无上限载荷。
  message: z.string().max(MAX_IPC_STRING).optional(),
}) satisfies z.ZodType<CreateTagInput>;

export const compareRequestSchema = z.object({
  path: requiredString("项目路径"),
  base: requiredString("基线版本"),
  head: requiredString("目标版本"),
}) satisfies z.ZodType<CompareRequest>;

export const openEditorInputSchema = z.object({
  path: requiredString("项目路径"),
  editor: z.enum(["vscode", "cursor"], { message: "不支持的编辑器类型" }),
  newWindow: z.boolean().catch(false),
}) satisfies z.ZodType<OpenEditorInput>;

export const taskProfileSchema = z.object({
  id: requiredString("任务 ID"),
  projectId: requiredString("项目 ID"),
  projectPath: requiredString("任务工作目录"),
  // 必须与 shared/types.ts 的 TaskType 一致：曾漏掉 deploy，
  // 导致自动检测出的部署命令一律保存失败。
  taskType: z.enum(["build", "run", "package", "deploy"], { message: "任务类型无效" }),
  name: requiredString("任务名称"),
  command: requiredString("命令"),
  // 参数会原样拼进子进程命令行：缺省就是「无附加参数」，类型漂移必须报错，
  // 不能像展示字段那样静默替换成空串；超长同样报错，避免把超长命令行交给 spawn。
  args: z.string().max(MAX_IPC_STRING).default(DEFAULT_TASK_ARGS),
  workingDirectory: requiredString("任务工作目录"),
  // 0 = 不限制超时（services/tasks.ts 只在 >0 时注册定时器）。只对「缺省」兜底，
  // 类型错误若静默变 0，有界任务会变成无界。
  timeoutSeconds: z.number().default(DEFAULT_TASK_TIMEOUT_SECONDS),
  createdAt: requiredString("创建时间"),
}) satisfies z.ZodType<TaskProfile>;

export const backupCreateInputSchema = z.object({
  projectId: requiredString("项目 ID"),
  projectName: requiredString("项目名称"),
  sourcePath: requiredString("源路径"),
  targetDirectory: requiredString("备份目录"),
}) satisfies z.ZodType<BackupCreateInput>;

export const backupRestoreInputSchema = z.object({
  archivePath: requiredString("备份文件"),
  targetDirectory: requiredString("恢复目录"),
}) satisfies z.ZodType<BackupRestoreInput>;

/** AI API Key：密钥类入参必须有长度上限，防止把任意大文本塞进凭据管理器。 */
export const aiSecretSchema = requiredString("AI API Key").refine((value) => value.length <= 4096, {
  message: "AI API Key 过长（最多 4096 字符）",
}) satisfies z.ZodType<string>;

/** 同步类 Git 操作。刻意不含 revert——撤销提交走独立通道，需要 commit hash。 */
export const gitOperationSchema = z.enum(["fetch", "pull", "push", "sync"], {
  message: "不支持的 Git 操作",
}) satisfies z.ZodType<GitOperation>;

export const projectSchema = z.object({
  id: requiredString("项目 ID"),
  name: requiredString("项目名称"),
  path: requiredString("项目路径"),
  provider: z.enum(["local", "github", "gitee", "gitlab"], { message: "项目的平台无效" }),
  // 以下字符串/数字是快照与结构分析会重算的派生展示字段：旧数据缺失或类型不符时
  // 退回默认值只是容错展示，不影响项目身份，下一次扫描会被真实值覆盖。
  branch: looseString(),
  // 状态不是可再生展示字段：静默退回 clean 会把「有冲突/有改动」写成「干净」，
  // 用户据此判断可否安全操作，属于数据损坏（P-02），因此非法值直接报错。
  status: z.enum(["clean", "dirty", "ahead", "behind", "conflicted"], { message: "项目状态无效" }),
  commit: looseString(),
  // 收藏与标签是用户数据（watching/favorite 驱动 UI 判定）：缺省给默认值，
  // 但类型/内容非法必须报错，不能整组清空。
  favorite: z.boolean().default(false),
  // why 双上限：tags 是 projects:save 里最容易放大载荷的字段（每项 + 项数），
  // 与 fileListSchema 共用同一口径，避免一次整表保存把主进程内存撑爆。
  tags: boundedStringArray("标签", "标签").default([]),
  // 远程名是可选元数据，坏值退化为「未配置远程」不影响项目身份（保留容错）。
  remote: z.string().max(MAX_IPC_STRING).optional().catch(undefined),
  files: z.number().catch(0),
  syncLabel: looseString(),
  language: looseString(),
  languageColor: looseString(DEFAULT_LANGUAGE_COLOR),
  summary: looseString(),
  updatedAt: looseString(),
  diskSizeBytes: z.number().catch(0),
  alias: optionalTrimmed,
  webUrl: optionalTrimmed,
}) satisfies z.ZodType<Project>;

export const projectsSchema = z.array(projectSchema).max(MAX_IPC_ARRAY_ITEMS, {
  message: `项目数量过多（最多 ${MAX_IPC_ARRAY_ITEMS} 个）`,
}) satisfies z.ZodType<Project[]>;

export const createWorkspaceInputSchema = z.object({
  name: requiredString("工作区名称"),
}) satisfies z.ZodType<CreateWorkspaceInput>;

export const renameWorkspaceInputSchema = z.object({
  id: requiredString("工作区 ID"),
  name: requiredString("工作区名称"),
}) satisfies z.ZodType<RenameWorkspaceInput>;

export const createAccountInputSchema = z.object({
  provider: z.enum(["github", "gitee", "gitlab"], { message: "不支持的远程平台" }),
  token: requiredString("令牌"),
}) satisfies z.ZodType<CreateAccountInput>;

export const cloneRepositoryInputSchema = z.object({
  url: requiredString("克隆地址"),
  targetPath: requiredString("克隆目标目录"),
  accountId: z
    .string()
    .max(200, { message: "ID 过长（最多 200 字符）" })
    .optional()
    .catch(undefined)
    .transform((value) => (value === "" ? undefined : value)),
}) satisfies z.ZodType<CloneRepositoryInput>;

export const commitRequestSchema = z.object({
  path: requiredString("项目路径"),
  // why 2000：与 services/git/status.ts 的提交前校验保持同一口径，
  // 让超长提交信息在 IPC 边界就失败，而不是等 git 服务层再抛。
  message: requiredString("提交信息", 2000),
}) satisfies z.ZodType<CommitRequest>;

export const createBranchInputSchema = z.object({
  path: requiredString("项目路径"),
  name: requiredString("分支名"),
}) satisfies z.ZodType<CreateBranchInput>;

export const switchBranchInputSchema = z.object({
  path: requiredString("项目路径"),
  name: requiredString("分支名"),
}) satisfies z.ZodType<SwitchBranchInput>;

export const deleteBranchInputSchema = z.object({
  path: requiredString("项目路径"),
  name: requiredString("分支名"),
}) satisfies z.ZodType<DeleteBranchInput>;

export const revertCommitInputSchema = z.object({
  path: requiredString("项目路径"),
  hash: requiredString("提交哈希"),
}) satisfies z.ZodType<RevertCommitInput>;

export const remoteRepositorySearchInputSchema = z.object({
  provider: z.enum(["github", "gitee"], { message: "仅支持搜索 GitHub 与 Gitee 平台" }),
  query: requiredString("搜索关键词"),
  accountId: z
    .string()
    .max(200, { message: "ID 过长（最多 200 字符）" })
    .optional()
    .catch(undefined)
    .transform((value) => (value && value.length > 0 ? value : undefined)),
}) satisfies z.ZodType<RemoteRepositorySearchInput>;

export const repositoryInteractionInputSchema = z.object({
  accountId: requiredString("账号 ID"),
  owner: requiredString("仓库所有者"),
  name: requiredString("仓库名称"),
  action: z.enum(["star", "unstar", "watch", "unwatch"], { message: "不支持的操作类型" }),
}) satisfies z.ZodType<RepositoryInteractionInput>;

export const remoteRepositoryWriteInputSchema = z.object({
  accountId: requiredString("账号 ID"),
  repositoryId: z
    .string()
    .max(200, { message: "ID 过长（最多 200 字符）" })
    .optional()
    .catch(undefined)
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  name: requiredString("仓库名称"),
  description: looseString(),
  visibility: z.enum(["", "public", "private", "internal"], {
    message: "可见性必须为 public、private 或 internal",
  }),
  init: z.boolean().catch(false),
}) satisfies z.ZodType<RemoteRepositoryWriteInput>;

/**
 * 统一解析入口。
 *
 * 只把 zod 的第一条错误抛出去，并把 `path` 前缀剥掉——用户看到的应该是
 * 「项目路径不能为空」，而不是「items[0].path: 项目路径不能为空」。
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const first = result.error.issues[0];
  const message = first?.message ?? "";
  // zod 的类型错误是英文（"Invalid input: expected object..."），
  // 这类底层错误不该直接抛给用户，统一换成中文标签文案。
  if (!message || message.startsWith("Invalid input")) {
    throw new Error(`${label}格式不正确`);
  }
  throw new Error(message);
}
