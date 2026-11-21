/**
 * git 状态与提交域：工作区快照、变更清单、单文件差异、暂存/取消暂存、提交。
 *
 * 依赖方向：只依赖 core（执行层/常量）与 gitParsing（纯解析）；不 import 其他子域。
 */
import type {
  ChangeFile,
  CommitRequest,
  CommitResult,
  FileDiffRequest,
  GitSnapshot,
  ProjectStatus,
} from "../../../../shared/types";
import {
  bracketValue,
  buildCommitMessageArgs,
  parseChangeStatus,
  parseStatusPorcelainZ,
  toLiteralPathspec,
} from "../gitParsing";
import {
  assertDirectory,
  buildCurrentBranchArgs,
  chunkFilesForGitArgs,
  redactGitOutput,
  runGit,
  runGitProcess,
} from "./core";

/**
 * `git diff -- <:(literal)path>`。
 *
 * why `--` 位于 pathspec 之前：否则以 `-` 开头的文件名会被当成选项
 * （`--output=<path>` 可让 git 向任意路径写文件）。
 * why 还需要 `:(literal)`：`--` 只隔离选项、**不关闭 glob**，裸路径 `data[1].txt`
 * 会被匹配成 `data1.txt`。
 */
export function buildFileDiffArgs(file: string): string[] {
  return ["diff", "--", toLiteralPathspec(file)];
}

/**
 * `git status --porcelain=v1 --branch`：首行是 `## main...origin/main [ahead 1]`，
 * 后续才是变更条目，getProjectSnapshot 依赖「首行为分支行」这一布局。
 * why 显式 v1：porcelain 格式版本变化会改变行结构（v2 是 -z 专用）。
 */
export function buildStatusBranchArgs(): string[] {
  return ["status", "--porcelain=v1", "--branch"];
}

/**
 * `git status --porcelain=v1 -z`。
 * why `-z`：NUL 分隔且路径不转义，含空格/中文/引号的文件名才能原样交给
 * parseStatusPorcelainZ 成对解析（rename 条目带第二个 NUL 段）。
 */
export function buildStatusPorcelainZArgs(): string[] {
  return ["status", "--porcelain=v1", "-z"];
}

/** `git rev-parse --short HEAD`：取当前提交的短哈希（快照与 commit 结果共用）。 */
export function buildShortHeadArgs(): string[] {
  return ["rev-parse", "--short", "HEAD"];
}

/** `git ls-files -co --exclude-standard`：未跟踪且未被忽略的文件清单（只用于计数）。 */
export function buildUntrackedFilesArgs(): string[] {
  return ["ls-files", "-co", "--exclude-standard"];
}

/** `git log -1 --format=%cs`：取最近一次提交的日期（`%cs` 为 committer 短日期）。 */
export function buildLastCommitDateArgs(): string[] {
  return ["log", "-1", "--format=%cs"];
}

/**
 * `git add -- <:(literal)path>...`。
 *
 * why `--` 必须在全部 pathspec 之前：路径名以 `-` 开头时才不会被当选项；
 * why 每个路径都加 `:(literal)`：关闭 glob，`[ ] * ?` 按字面量匹配。
 */
export function buildStageArgs(files: string[]): string[] {
  return ["add", "--", ...files.map(toLiteralPathspec)];
}

/**
 * `git restore --staged -- <:(literal)path>...`。
 * why `--staged`：只回退索引、保留工作区修改；`--` 与 `:(literal)` 的作用同 add。
 */
export function buildUnstageArgs(files: string[]): string[] {
  return ["restore", "--staged", "--", ...files.map(toLiteralPathspec)];
}

/**
 * `git commit -m <message>`。
 *
 * why 单条 `-m` 传原始多行文本（见 buildCommitMessageArgs）：多个 `-m` 会被 git 以
 * 空行连接成段落，把用户输入的列表/代码块换行全部打散（2026-11-07 审查 P1-2）。
 */
export function buildCommitArgs(message: string): string[] {
  return ["commit", ...buildCommitMessageArgs(message)];
}

export async function getFileDiff(input: FileDiffRequest): Promise<string> {
  const projectPath = input.path.trim();
  const file = input.file.trim();
  assertDirectory(projectPath);
  if (!file || file.includes("\0")) {
    throw new Error("文件路径不合法");
  }
  const result = await runGitProcess(projectPath, buildFileDiffArgs(file));
  if (!result.success) {
    throw new Error(result.output || "读取差异失败");
  }
  const diff = result.output.trim();
  return diff.length > 0 ? diff : "该文件没有未暂存的差异。";
}

export async function getProjectSnapshot(projectPath: string): Promise<GitSnapshot> {
  assertDirectory(projectPath);

  const [branchOutput, statusOutput] = await Promise.all([
    runGit(projectPath, buildCurrentBranchArgs()),
    runGit(projectPath, buildStatusBranchArgs()),
  ]);
  const branch = branchOutput.length > 0 ? branchOutput : "HEAD detached";

  const lines = statusOutput.split(/\r?\n/).filter((line) => line.length > 0);
  const branchLine = lines[0] ?? "";
  const changedFiles = lines.slice(1).length;
  const hasConflict = lines.slice(1).some((line) => {
    const first = line[0];
    const second = line[1];
    return first === "U" || second === "U" || line.startsWith("AA ") || line.startsWith("DD ");
  });

  let status: ProjectStatus = "clean";
  let syncLabel = "未关联远程";
  if (hasConflict) {
    status = "conflicted";
    syncLabel = "存在冲突";
  } else if (changedFiles > 0) {
    status = "dirty";
    syncLabel = `${changedFiles} 个文件未提交`;
  } else if (branchLine.includes("[ahead") && branchLine.includes("behind")) {
    status = "conflicted";
    syncLabel = "本地与远程分叉";
  } else {
    const ahead = bracketValue(branchLine, "ahead");
    const behind = bracketValue(branchLine, "behind");
    if (ahead) {
      status = "ahead";
      syncLabel = `领先 ${ahead} 个提交`;
    } else if (behind) {
      status = "behind";
      syncLabel = `落后 ${behind} 个提交`;
    } else if (branchLine.includes("...")) {
      status = "clean";
      syncLabel = "已同步";
    }
  }

  const [commit, files, updatedAt] = await Promise.all([
    runGit(projectPath, buildShortHeadArgs()).catch(() => "无提交"),
    runGit(projectPath, buildUntrackedFilesArgs())
      .then((output) => output.split(/\r?\n/).filter((line) => line.length > 0).length)
      .catch(() => 0),
    runGit(projectPath, buildLastCommitDateArgs()).catch(() => "未提交"),
  ]);

  return {
    branch,
    status,
    commit,
    files,
    sync_label: syncLabel,
    updated_at: updatedAt,
  };
}

export async function listChangedFiles(projectPath: string): Promise<ChangeFile[]> {
  assertDirectory(projectPath);
  const porcelain = await runGit(projectPath, buildStatusPorcelainZArgs()).catch(() => "");
  if (!porcelain) {
    return [];
  }
  // 成对解析在 parseStatusPorcelainZ（rename/copy 条目带第二个 \0 段）
  return parseStatusPorcelainZ(porcelain).map((entry) => ({
    path: entry.path,
    status: parseChangeStatus(entry.status),
    staged: entry.staged,
  }));
}

export async function stageFiles(projectPath: string, files: string[]): Promise<void> {
  assertDirectory(projectPath);
  if (files.length === 0) {
    throw new Error("请选择要暂存的文件");
  }
  for (const chunk of chunkFilesForGitArgs(files)) {
    await runGit(projectPath, buildStageArgs(chunk));
  }
}

export async function unstageFiles(projectPath: string, files: string[]): Promise<void> {
  assertDirectory(projectPath);
  if (files.length === 0) {
    throw new Error("请选择要取消暂存的文件");
  }
  for (const chunk of chunkFilesForGitArgs(files)) {
    await runGit(projectPath, buildUnstageArgs(chunk));
  }
}

export async function commitChanges(request: CommitRequest): Promise<CommitResult> {
  assertDirectory(request.path);
  const message = request.message.trim();
  if (message.length === 0) {
    throw new Error("提交信息不能为空");
  }
  if (message.length > 2000) {
    throw new Error("提交信息过长（最多 2000 字符）");
  }
  const args = buildCommitArgs(message);
  const result = await runGitProcess(request.path, args);
  // why 再显式过一次 redactGitOutput：runGitProcess 的出口已统一脱敏（幂等），但
  // commit 结果同样是「返回值直出渲染层」的入口，这里把 F-03 的约束在调用点写明，
  // 避免日后 commit 改走其他执行路径（如自定义 execFile）时悄悄绕过脱敏。
  if (!result.success) {
    return {
      success: false,
      output: redactGitOutput(result.output || "提交失败"),
    };
  }
  const hash = await runGit(request.path, buildShortHeadArgs()).catch(() => undefined);
  return {
    success: true,
    commitHash: hash,
    output: redactGitOutput(result.output),
  };
}
