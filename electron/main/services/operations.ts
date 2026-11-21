import type {
  CloneRepositoryInput,
  CloneRepositoryResult,
  CommitRequest,
  CommitResult,
  GitOperation,
  GitOperationResult,
} from "../../../shared/types";
import { cloneRepository, commitChanges, runGitOperation } from "./git";
import { errorMessage, redactSecrets } from "./serviceUtils";
import { insertOperationRecord } from "./storage/operations";
import { findByPath } from "./storage/projects";

/**
 * 操作编排域：「执行 Git 动作 → 落审计记录」的唯一入口。
 *
 * why 从 ipc.ts 下沉（2026-11-21 架构评审 A-21）：IPC 层原先直接 import
 * storage/operations、storage/projects、storage/workspaces 并自己实现编排，
 * 既把 handler 撑长，也让「换存储 / 换归组策略」必须改通信层。
 * 现在 handler 只做「校验入参 → 调本模块 → 返回结果」。
 */

/** 操作日志正文上限：超过 500 字的输出对排障无增益，只会撑大库与 CSV。 */
const MAX_DETAIL_LENGTH = 500;

/**
 * 执行一次同步类 Git 操作，并把结果写成审计记录。
 *
 * 审计写入失败只留 console.error 痕迹（recordOperation 返回 false），
 * 不影响这里的返回值：git 动作已经生效，不能因为旁路记录失败让 UI 误报操作失败。
 */
export async function recordGitOperation(
  projectPath: string,
  operation: GitOperation,
): Promise<GitOperationResult> {
  const result = await runGitOperation(projectPath, operation);
  recordOperation(operation, projectPath, result.output, result.success ? "ok" : "failed");
  return result;
}

/** clone → 审计：项目路径取实际落盘目标路径（与旧 IPC 行为一致）。 */
export async function recordClone(input: CloneRepositoryInput): Promise<CloneRepositoryResult> {
  const result = await cloneRepository(input);
  recordOperation("clone", input.targetPath, result.output, result.success ? "ok" : "failed");
  return result;
}

/** commit → 审计：与 clone/git 操作共用同一条落库路径，保证日志字段形状一致。 */
export async function recordCommit(input: CommitRequest): Promise<CommitResult> {
  const result = await commitChanges(input);
  recordOperation("commit", input.path, result.output, result.success ? "ok" : "failed");
  return result;
}

/**
 * 写一条操作审计记录，返回是否落库成功（调用方可忽略）。
 *
 * why 失败不上抛（A-21 修订）：git 动作在写审计**之前**就已生效（commit/pull/clone 都是
 * 先执行再记录）。审计写库失败若上抛，IPC 会返回错误、UI 显示「提交失败」，而仓库其实
 * 已提交——用户会重复提交或误判仓库状态。审计是旁路能力，不得改变业务语义，故只返回 false。
 *
 * why 仍然不静默：审计缺失必须留可观测痕迹，否则事后无从排查。日志只带
 * operation / projectPath / 错误摘要——**绝不打 detail**：detail 直到落库前才脱敏，
 * 在这里打原文等于把凭据写进主进程日志（A-03 的出口清单同样包含日志）。
 *
 * 落库前必须脱敏再截断（顺序不可颠倒）：令牌被截成半截后可能不再满足
 * 「前缀 + 长串」形态，先整体替换成 *** 再截 500 字才不会留下半截凭据（审查 A-03）。
 */
export function recordOperation(
  operation: string,
  path: string,
  detail: string,
  result: "ok" | "failed",
): boolean {
  try {
    insertOperationRecord({
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operation,
      // 按路径反查项目 ID（尽力而为）：日志在界面按项目归组展示，
      // 恒为空串会让归组永远失效（2026-11-07 审查 P2-21）
      projectId: resolveProjectIdByPath(path),
      projectPath: path,
      detail: redactSecrets(detail).slice(0, MAX_DETAIL_LENGTH),
      result,
      createdAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error(
      `[operations] 审计写入失败 operation=${operation} path=${path} err=${errorMessage(error)}`,
    );
    return false;
  }
}

/**
 * 按绝对路径反查项目 ID，用于操作日志归组；未命中返回空串。
 *
 * why 单条查询（架构评审 A-21）：旧实现遍历 listWorkspaces() 后逐区 loadProjects()，
 * 是 1+N 次全表读，工作区越多日志写入越慢；现在交给 storage/projects.findByPath，
 * 用 `WHERE path = ?` 一条 SQL 命中，且命中 database.ts 的 `idx_projects_path`（索引单点查询）。
 *
 * why 失败只降级不回滚：反查结果只是日志的「装饰信息」，DB 短暂不可用不应阻断审计写入；
 * 但降级必须留痕（console.error），禁止空 catch——否则「归组失效」会被当成数据问题反复排查。
 */
export function resolveProjectIdByPath(path: string): string {
  try {
    return findByPath(path)?.id ?? "";
  } catch (error) {
    console.error(`[operations] 按路径反查项目失败：${errorMessage(error)}`);
    return "";
  }
}
