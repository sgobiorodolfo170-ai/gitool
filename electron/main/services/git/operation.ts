/**
 * git 同步类操作域：fetch / pull / push / sync 的参数拼装与执行。
 *
 * why 从 status.ts 再拆一层：runGitOperation 与 status 的快照/暂存逻辑没有共享状态，
 * 合并会越过 300 行上限；本域只依赖 core 与 status（组装结果后回填快照），
 * status 不反向 import 本文件，无循环。
 */
import type { GitOperation, GitOperationResult, GitSnapshot } from "../../../../shared/types";
import { assertDirectory, runGitProcess } from "./core";
import { getProjectSnapshot, listChangedFiles } from "./status";

/**
 * 可批量执行的同步类操作参数。revert 有独立的交互流程（需要 commit hash），
 * 不在此列，故 dispatcher 对不支持的 operation 返回 undefined，由调用方的
 * 「不支持的 Git 操作」分支兜底。
 *
 * why fetch 带 `--prune`：远端已删除的分支要同步清掉引用，否则分支列表留幽灵项。
 * why pull 带 `--no-rebase`：git 2.27+ 在未配置 pull.rebase 时拒绝合并没有策略的
 * pull，显式声明保持「合并」语义（与旧行为一致）。
 */
export function buildFetchArgs(): string[] {
  return ["fetch", "--prune"];
}

export function buildPullArgs(): string[] {
  return ["pull", "--no-rebase"];
}

export function buildPushArgs(): string[] {
  return ["push"];
}

/**
 * 操作 → 命令序列的映射。
 * why sync 是「fetch 再 pull」而不是一条命令：先刷新远端引用再合并，pull 内部的
 * fetch 不会 prune；两条命令的先后顺序决定合并到的是最新远端提交。
 */
export function buildOperationCommands(operation: GitOperation): string[][] | undefined {
  switch (operation) {
    case "fetch":
      return [buildFetchArgs()];
    case "pull":
      return [buildPullArgs()];
    case "push":
      return [buildPushArgs()];
    case "sync":
      return [buildFetchArgs(), buildPullArgs()];
    default:
      return undefined;
  }
}

export async function runGitOperation(
  projectPath: string,
  operation: GitOperation,
): Promise<GitOperationResult> {
  assertDirectory(projectPath);
  const commands = buildOperationCommands(operation);
  if (!commands) {
    throw new Error("不支持的 Git 操作");
  }

  if (operation === "pull" || operation === "sync") {
    const uncommittedFiles = await listChangedFiles(projectPath);
    // 只阻断「已跟踪文件的未提交修改」。未跟踪文件不会被 pull 覆盖（仅当
    // 远端新增同名文件时 git 自身会拒绝合并并报错，同样拦得住），拿全部
    // 变更做拦截会让常年存在 untracked 文件的仓库永远拉不动（审查 P1-3）。
    const blockingFiles = uncommittedFiles.filter((file) => file.status !== "untracked");
    if (blockingFiles.length > 0) {
      const names = blockingFiles
        .slice(0, 5)
        .map((item) => item.path)
        .join("、");
      const label = operation === "pull" ? "拉取" : "同步";
      return {
        operation,
        success: false,
        output: `工作区有未提交的修改，已阻止${label}以免丢失修改。\n变更文件：${names}${blockingFiles.length > 5 ? ` 等 ${blockingFiles.length} 个` : ""}\n请先提交或暂存这些更改后重试。`,
      };
    }
  }

  const sections: string[] = [];
  let success = true;
  for (const args of commands) {
    const result = await runGitProcess(projectPath, args);
    if (result.output.length > 0) {
      sections.push(result.output);
    }
    if (!result.success) {
      success = false;
      break;
    }
  }

  const output =
    sections.length > 0
      ? sections.join("\n")
      : success
        ? "Git 操作已完成，没有额外输出。"
        : "Git 操作失败。";

  let snapshot: GitSnapshot | undefined;
  try {
    snapshot = await getProjectSnapshot(projectPath);
  } catch {
    snapshot = undefined;
  }

  return { operation, success, output, snapshot };
}
