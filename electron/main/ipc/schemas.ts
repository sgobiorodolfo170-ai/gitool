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
  OperationRecord,
  Project,
  RemoteRepositorySearchInput,
  RemoteRepositoryWriteInput,
  RenameWorkspaceInput,
  RepositoryInteractionInput,
  RevertCommitInput,
  SetRemoteUrlInput,
  SwitchBranchInput,
  TaskProfile,
  TaskRun,
} from "../../../shared/types";

/**
 * IPC 入参 schema。
 *
 * 设计原则：**行为与改造前的 32 个手写 validator 逐字段等价**，只换实现不换语义。
 * - 必填字符串：trim 后为空即抛错（错误文案保持中文，直接展示给用户）
 * - 可选/带默认值的字段：用 `.catch(...)` 兜底，类型不对时退回默认值而不是抛错
 *
 * 之所以大量用 `.catch()` 而不是 `.default()`：`.default()` 只在值为 `undefined` 时生效，
 * 类型错误仍会抛；而原实现是「类型不对就给默认值」。要保行为一致必须用 `.catch()`。
 */

/** 必填字符串：非空且不是纯空白，返回原值（不 trim，与原 requireString 一致）。 */
const requiredString = (label: string) =>
  z.string().refine((value) => value.trim().length > 0, { message: `${label}不能为空` });

/** 可选字符串：空串/类型错误都归为 undefined。 */
const optionalTrimmed = z
  .string()
  .optional()
  .catch(undefined)
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const looseString = (fallback = "") => z.string().catch(fallback);

export const appSettingsSchema = z.object({
  gitPath: looseString(),
  defaultProjectDirectory: looseString(),
  defaultBackupDirectory: looseString(),
  backupExcludePatterns: looseString(),
  defaultSearchAccountId: looseString(),
  aiApiKeyConfigured: z.boolean().catch(false),
  aiModel: looseString(),
  aiBaseUrl: looseString(),
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
  message: z.string().optional().catch(undefined),
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
  args: looseString(),
  workingDirectory: requiredString("任务工作目录"),
  timeoutSeconds: z.number().catch(0),
  createdAt: requiredString("创建时间"),
}) satisfies z.ZodType<TaskProfile>;

export const taskRunSchema = z.object({
  id: requiredString("运行 ID"),
  profileId: looseString(),
  projectId: looseString(),
  name: looseString(),
  command: looseString(),
  startedAt: requiredString("开始时间"),
  finishedAt: z.string().optional().catch(undefined),
  status: z.enum(["running", "succeeded", "failed", "stopped", "timedout"], {
    message: "任务状态无效",
  }),
  exitCode: z.number().optional().catch(undefined),
  output: looseString(),
}) satisfies z.ZodType<TaskRun>;

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

export const operationRecordSchema = z.object({
  id: requiredString("记录 ID"),
  operation: requiredString("操作类型"),
  projectId: looseString(),
  projectPath: looseString(),
  detail: looseString(),
  result: z.enum(["ok", "failed"]).catch("ok"),
  createdAt: requiredString("记录时间"),
}) satisfies z.ZodType<OperationRecord>;

/** 同步类 Git 操作。刻意不含 revert——撤销提交走独立通道，需要 commit hash。 */
export const gitOperationSchema = z.enum(["fetch", "pull", "push", "sync"], {
  message: "不支持的 Git 操作",
}) satisfies z.ZodType<GitOperation>;

export const projectSchema = z.object({
  id: requiredString("项目 ID"),
  name: requiredString("项目名称"),
  path: requiredString("项目路径"),
  provider: z.enum(["local", "github", "gitee", "gitlab"], { message: "项目的平台无效" }),
  branch: looseString(),
  // 非法状态退回 clean：项目状态是派生值，不值得为它拒绝整条记录
  status: z.enum(["clean", "dirty", "ahead", "behind", "conflicted"]).catch("clean"),
  commit: looseString(),
  favorite: z.boolean().catch(false),
  tags: z.array(z.string()).catch([]),
  remote: z.string().optional().catch(undefined),
  files: z.number().catch(0),
  syncLabel: looseString(),
  language: looseString(),
  languageColor: looseString("#8b97a8"),
  summary: looseString(),
  updatedAt: looseString(),
  diskSizeBytes: z.number().catch(0),
  alias: optionalTrimmed,
  webUrl: optionalTrimmed,
}) satisfies z.ZodType<Project>;

export const projectsSchema = z.array(projectSchema) satisfies z.ZodType<Project[]>;

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
    .optional()
    .catch(undefined)
    .transform((value) => (value === "" ? undefined : value)),
}) satisfies z.ZodType<CloneRepositoryInput>;

export const commitRequestSchema = z.object({
  path: requiredString("项目路径"),
  message: requiredString("提交信息"),
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
