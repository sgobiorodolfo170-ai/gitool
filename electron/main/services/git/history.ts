/**
 * 历史域：提交历史、版本列表（提交 + 分支 + 标签）与回退提交。
 *
 * 依赖方向：core（执行层）、branch（分支列表）、tags（标签列表）、status（回退后回填快照）；
 * 这些模块均不 import 本文件，无循环。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CommitEntry,
  GitOperationResult,
  GitSnapshot,
  ListVersionsResult,
  RevertCommitInput,
} from "../../../../shared/types";
import {
  COMMIT_FIELD_SEP,
  COMMIT_RECORD_SEP,
  isValidCommitHash,
  parseCommitHistory,
} from "../gitParsing";
import { redactSecrets } from "../serviceUtils";
import { getActiveGitBinary } from "./binary";
import { listBranches } from "./branch";
import { assertDirectory, buildGitCwdArgs, MAX_BUFFER, runGit } from "./core";
import { getProjectSnapshot } from "./status";
import { listTags } from "./tags";

const execFileAsync = promisify(execFile);

/**
 * `git log -n <limit> --format=<H<US>an<US>ae<US>aI<US>s<US>b<RS>>`。
 *
 * why 记录分隔符 `\x1e` 必须在格式串**末尾**：放在 %s 与 %b 之间时，记录之间的
 * 换行会把上一条 body 粘到下一条 hash 上，第 2 条起 hash 全部损坏（P0-1）。
 * why 字段顺序不可改：必须与 parseCommitHistory 的解构顺序一一对应。
 * why `-n <limit>` 保持「带空格的一整个参数」：git 的 -n 用 strtol 解析、会跳过
 * 前导空格，实测 `git log "-n 3"` 与 `git log -n 3` 等价（此处锁定现状，不顺手改）。
 */
export function buildCommitHistoryArgs(limit: number): string[] {
  return [
    "log",
    `-n ${limit}`,
    `--format=%H${COMMIT_FIELD_SEP}%an${COMMIT_FIELD_SEP}%ae${COMMIT_FIELD_SEP}%aI${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`,
  ];
}

/**
 * `git -C <projectPath> revert --no-edit <hash>`。
 *
 * why `--no-edit`：不弹交互式编辑器，直接复用原提交信息生成 revert 提交。
 */
export function buildRevertArgs(projectPath: string, hash: string): string[] {
  return buildGitCwdArgs(projectPath, ["revert", "--no-edit", hash]);
}

export async function listCommitHistory(projectPath: string, limit = 50): Promise<CommitEntry[]> {
  assertDirectory(projectPath);
  // 格式串（字段顺序、记录尾分隔符 \x1e）与解析逻辑的对应关系见
  // buildCommitHistoryArgs；解析抽在 parseCommitHistory，零依赖可单测（P0-1）。
  const output = await runGit(projectPath, buildCommitHistoryArgs(limit)).catch(() => "");
  return parseCommitHistory(output).map((record) => {
    // P-35：split("\n")[0] 在 noUncheckedIndexedAccess 下可能为 undefined；
    // 空主题按空串处理（与 parseCommitHistory 的 subject ?? "" 兜底一致）。
    const firstLine = record.subject.split("\n")[0] ?? "";
    return {
      hash: record.hash,
      shortHash: record.hash.slice(0, 7),
      author: record.author,
      email: record.email,
      date: record.date,
      subject: firstLine,
      message: [firstLine, ...record.body.split("\n")].filter(Boolean).join("\n"),
    };
  });
}

export async function revertCommit(input: RevertCommitInput): Promise<GitOperationResult> {
  assertDirectory(input.path);
  const hash = input.hash.trim();
  if (!isValidCommitHash(hash)) {
    throw new Error("提交哈希不合法");
  }
  const result = await commitRevertProcess(input.path, hash);
  let snapshot: GitSnapshot | undefined;
  try {
    snapshot = await getProjectSnapshot(input.path);
  } catch {
    snapshot = undefined;
  }
  // 必须如实回填 "revert"：曾硬编码为 "pull"，导致操作记录与界面把「撤销提交」显示成「拉取更新」。
  return {
    operation: "revert",
    success: result.success,
    output: result.output,
    snapshot,
  };
}

async function commitRevertProcess(
  projectPath: string,
  hash: string,
): Promise<{ success: boolean; output: string }> {
  // why 单独脱敏：revert 需要自定义 execFile（带 --no-edit），不走 runGitProcess 的
  // 统一出口；返回给渲染层的文本若不在此处过一遍 redactSecrets，就会绕过 F-03。
  try {
    const { stdout, stderr } = await execFileAsync(
      getActiveGitBinary(),
      buildRevertArgs(projectPath, hash),
      {
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      },
    );
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { success: true, output: redactSecrets(output) };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const output = [failure.stdout?.trim(), failure.stderr?.trim()].filter(Boolean).join("\n");
    return {
      success: false,
      output: redactSecrets(output || failure.message || "回退提交失败"),
    };
  }
}

export async function listVersions(projectPath: string): Promise<ListVersionsResult> {
  assertDirectory(projectPath);
  const [commits, branches, tags] = await Promise.all([
    listCommitHistory(projectPath, 100),
    listBranches(projectPath),
    listTags(projectPath),
  ]);
  return { commits, branches, tags };
}
