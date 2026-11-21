import { execFile, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
  BranchInfo,
  ChangeFile,
  CloneRepositoryInput,
  CloneRepositoryResult,
  CommitEntry,
  CommitRequest,
  CommitResult,
  CompareRequest,
  CompareResult,
  CreateBranchInput,
  CreateTagInput,
  DeleteBranchInput,
  FileDiffRequest,
  GitOperation,
  GitOperationResult,
  GitSnapshot,
  GitTag,
  InitRepositoryInput,
  ListVersionsResult,
  LocalProjectInspection,
  MoveProjectInput,
  MoveProjectResult,
  ProjectStatus,
  ReadmeResult,
  RepositoryDiscoveryItem,
  RevertCommitInput,
  SetRemoteUrlInput,
  SwitchBranchInput,
} from "../../../shared/types";
import { readCredential } from "./credentials";
import { mapLimit } from "./concurrency";
import { killProcessTree, registerProcessStopper } from "./processCleanup";
import {
  assertDirectory as assertDirectoryShared,
  errorMessage,
  redactSecrets,
} from "./serviceUtils";
import { notifyRenderer } from "./events";
import {
  bracketValue,
  buildCommitMessageArgs,
  COMMIT_FIELD_SEP,
  COMMIT_RECORD_SEP,
  isValidCommitHash,
  isValidRefName,
  parseBranchLine,
  parseChangeStatus,
  parseCloneProgress,
  parseCommitHistory,
  parseNumstatPaths,
  parseStatusPorcelainZ,
  toLiteralPathspec,
} from "./gitParsing";
import { getAccount } from "./storage/accounts";
import { loadSettings } from "./storage/settings";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * 克隆凭据的注入键名：用进程级环境变量而不是 `git clone --config`。
 *
 * why 不用 `--config`：`--config credential.helper=...` 的键值会被 git 写进目标仓库的
 * `.git/config`，等于把一段可执行 shell 脚本随仓库一起落盘/分享（A-04 / SEC-06）。
 * `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_<n>` + `GIT_CONFIG_VALUE_<n>` 是 git 2.31+
 * 的进程级配置注入：只在本次 git 进程内生效，不写入任何配置文件。
 *
 * why 必须先清空再注入（F-01）：`credential.helper` 在 git 里是 multivar（多值累加），
 * `GIT_CONFIG_*` 注入的条目是**追加到链尾**。Windows 默认安装的系统级配置
 * `C:/Program Files/Git/etc/gitconfig` 带 `credential.helper=manager`，于是 GCM 稳居链首：
 * 私有 HTTPS 仓库克隆会先唤起 GCM，弹窗或长时间挂起（实测仅注入脚本时
 * `git credential fill` 10s 不返回），而 `GIT_TERMINAL_PROMPT=0` 只抑制 git 自身的
 * 终端提示，抑制不了 GCM，且 GCM 里已有的凭据会顶掉用户所选账号的 token。
 * 因此第 0 条注入空值把继承来的 helper 列表整个重置，第 1 条再注入我们的脚本
 * （实测重置后 92ms 即返回注入的凭据）。
 *
 * why 不用命令行的 `-c credential.helper=`：实测它与 env 注入同处「命令行层」，
 * 空值会把同层的注入脚本一并清掉，git 退化为终端提示并失败（exit 128）。
 *
 * why 不做静默降级：git < 2.31 不认识这组变量，鉴权会失败；此处刻意让失败暴露，
 * 而不是回退到 `--config`——回退等于把「凭据落盘」这个漏洞重新打开。
 */
const GIT_CONFIG_COUNT_ENV = "GIT_CONFIG_COUNT";
const GIT_CONFIG_KEY_0_ENV = "GIT_CONFIG_KEY_0";
const GIT_CONFIG_VALUE_0_ENV = "GIT_CONFIG_VALUE_0";
const GIT_CONFIG_KEY_1_ENV = "GIT_CONFIG_KEY_1";
const GIT_CONFIG_VALUE_1_ENV = "GIT_CONFIG_VALUE_1";
/** 注入的配置条目数量，必须与下面用到的 `*_KEY_<n>` / `*_VALUE_<n>` 对数一致。 */
const INJECTED_CONFIG_COUNT = "2";
const CREDENTIAL_HELPER_CONFIG_KEY = "credential.helper";
/** 空值条目：multivar 语义下空字符串会重置整条 helper 列表（git 文档 credential.helper）。 */
const CREDENTIAL_HELPER_RESET_VALUE = "";

/**
 * credential helper 脚本：从环境变量取 token 后从 stdout 交给 git。
 *
 * `$GITOOL_ASKPASS_TOKEN` 必须保持字面量（单引号 JS 字符串），由 git 调起的 shell
 * 在运行时展开——脚本本身与 git 命令行都不含明文 token（命令行会出现在进程列表里）。
 */
const CREDENTIAL_HELPER_SCRIPT =
  '!f() { echo username=x-access-token; echo password="$GITOOL_ASKPASS_TOKEN"; }; f';
const ASKPASS_TOKEN_ENV = "GITOOL_ASKPASS_TOKEN";
const TERMINAL_PROMPT_ENV = "GIT_TERMINAL_PROMPT";
const TERMINAL_PROMPT_OFF = "0";

// 解析当前应使用的 git 可执行文件路径：优先使用 settings.gitPath，
// 为空时回退到系统 PATH 中的 "git"。
// 设计理由：装完 Git 后 PATH 变更不会传播到运行中的 Electron 进程，
// 显式指向 git.exe 是「免重启」的必要前提。导出供 environment.ts 复用。
export function getActiveGitBinary(): string {
  try {
    const candidate = loadSettings().gitPath.trim();
    return candidate || "git";
  } catch {
    return "git";
  }
}

// 可批量执行的同步类操作。revert 有独立的交互流程（需要 commit hash），
// 不在此表中，故用 Partial 让 runGitOperation 的 "不支持" 分支兜底。
const OPERATION_COMMANDS: Partial<Record<GitOperation, string[][]>> = {
  fetch: [["fetch", "--prune"]],
  pull: [["pull", "--no-rebase"]],
  push: [["push"]],
  sync: [
    ["fetch", "--prune"],
    ["pull", "--no-rebase"],
  ],
};

type GitProcessResult = {
  success: boolean;
  output: string;
};

export async function inspectLocalProject(projectPath: string): Promise<LocalProjectInspection> {
  assertDirectory(projectPath);
  const name = basename(projectPath) || "未命名项目";
  try {
    const snapshot = await getProjectSnapshot(projectPath);
    return { path: projectPath, name, is_git_repository: true, snapshot };
  } catch {
    return { path: projectPath, name, is_git_repository: false };
  }
}

export async function initRepository(input: InitRepositoryInput): Promise<void> {
  const projectPath = input.path.trim();
  if (!isAbsolute(projectPath)) {
    throw new Error("初始化路径必须是绝对路径");
  }
  mkdirSync(projectPath, { recursive: true });
  if (existsSync(join(projectPath, ".git"))) {
    throw new Error("该目录已经是 Git 仓库");
  }
  const branch = input.defaultBranch?.trim() || "main";
  if (!isValidRefName(branch)) {
    throw new Error("默认分支名不合法");
  }
  const args = ["init", "-b", branch];
  const result = await runGitProcess(projectPath, args);
  if (!result.success) {
    throw new Error(result.output || "初始化失败");
  }
}

export async function scanDirectoryForRepositories(
  directory: string,
): Promise<RepositoryDiscoveryItem[]> {
  if (!isAbsolute(directory) || !existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error("目录不存在或不是目录");
  }
  const items: RepositoryDiscoveryItem[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "build"
    ) {
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    items.push({
      path: entryPath,
      name: entry.name,
      isGitRepository: existsSync(join(entryPath, ".git")),
    });
  }
  return items.sort((left, right) => Number(right.isGitRepository) - Number(left.isGitRepository));
}

export async function getFileDiff(input: FileDiffRequest): Promise<string> {
  const projectPath = input.path.trim();
  const file = input.file.trim();
  assertDirectory(projectPath);
  if (!file || file.includes("\0")) {
    throw new Error("文件路径不合法");
  }
  const result = await runGitProcess(projectPath, ["diff", "--", toLiteralPathspec(file)]);
  if (!result.success) {
    throw new Error(result.output || "读取差异失败");
  }
  const diff = result.output.trim();
  return diff.length > 0 ? diff : "该文件没有未暂存的差异。";
}

export async function setRemoteUrl(input: SetRemoteUrlInput): Promise<void> {
  assertDirectory(input.path);
  const url = input.url.trim();
  const remote = input.remote?.trim() || "origin";
  if (!/^[a-zA-Z0-9_.-]+$/.test(remote)) {
    throw new Error("远程名称不合法");
  }
  const httpsPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
  const sshPattern = /^[^@\s]+@[^:\s]+:.+$/;
  if (!httpsPattern.test(url) && !sshPattern.test(url)) {
    throw new Error("远程地址仅支持 HTTPS 或 SSH 格式");
  }
  // 与 assertCloneUrl 同理：形似选项的值不能靠 git 选项表兜底拒绝
  if (url.startsWith("-")) {
    throw new Error("远程地址不能以 - 开头");
  }
  // 内嵌凭据会被 git 写入 .git/config，并随错误输出/日志外泄（A-03）
  assertNoCredentialInUrl(url, "远程地址");
  const remotesOutput = await runGit(input.path, ["remote"]).catch(() => "");
  const hasRemote = remotesOutput.split(/\r?\n/).includes(remote);
  const result = hasRemote
    ? await runGitProcess(input.path, ["remote", "set-url", remote, url])
    : await runGitProcess(input.path, ["remote", "add", remote, url]);
  if (!result.success) {
    throw new Error(result.output || "设置远程地址失败");
  }
}

export async function listTags(projectPath: string): Promise<GitTag[]> {
  assertDirectory(projectPath);
  const output = await runGit(projectPath, [
    "for-each-ref",
    "refs/tags",
    "--sort=-creatordate",
    "--format=%(refname:short)\n%(objectname:short)\n%(creatordate:iso8601-strict)\n%(contents:subject)",
  ]).catch(() => "");
  const lines = output.split(/\r?\n/);
  const tags: GitTag[] = [];
  for (let index = 0; index + 3 < lines.length; index += 4) {
    const name = lines[index].trim();
    const shortCommit = lines[index + 1].trim();
    const createdAt = lines[index + 2].trim();
    const message = lines[index + 3].trim();
    if (!name) continue;
    tags.push({
      name,
      commit: shortCommit,
      shortCommit,
      createdAt,
      message: message || undefined,
    });
  }
  return tags;
}

export async function createTag(input: CreateTagInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!isValidRefName(name)) {
    throw new Error("标签名只能包含字母、数字、点、下划线、斜杠和连字符");
  }
  const message = input.message?.trim() ?? "";
  const result =
    message.length > 0
      ? await runGitProcess(input.path, ["tag", "-a", name, "-m", message])
      : await runGitProcess(input.path, ["tag", name]);
  if (!result.success) {
    throw new Error(result.output || "创建标签失败");
  }
}

export async function deleteTag(projectPath: string, name: string): Promise<void> {
  assertDirectory(projectPath);
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("标签名不能为空");
  }
  // 删除是不可逆操作，必须与创建用同一套白名单，避免 `-d` 之后被注入选项。
  if (!isValidRefName(trimmed)) {
    throw new Error("标签名不合法");
  }
  const result = await runGitProcess(projectPath, ["tag", "-d", trimmed]);
  if (!result.success) {
    throw new Error(result.output || "删除标签失败");
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

export async function compareVersions(input: CompareRequest): Promise<CompareResult> {
  assertDirectory(input.path);
  const base = input.base.trim();
  const head = input.head.trim();
  if (!base || !head) {
    throw new Error("请提供对比的基线版本和目标版本");
  }
  // 版本标识来自渲染层，必须白名单校验：`git diff` 会把以 `-` 开头的参数当选项，
  // 例如 `--output=<path>` 可让 git 向任意路径写文件（参数注入，非 shell 注入）。
  if (!isValidRefName(base) || !isValidRefName(head)) {
    throw new Error("版本标识不合法，只能包含字母、数字、点、下划线、斜杠和连字符");
  }
  const range = `${base}..${head}`;
  const [statResult, numStatResult] = await Promise.all([
    runGitProcess(input.path, ["diff", "--stat", range]),
    runGitProcess(input.path, ["diff", "--numstat", range]),
  ]);
  if (!statResult.success) {
    throw new Error(statResult.output || "对比失败");
  }
  const stat = statResult.output.trim();

  // 变更文件清单从 numstat 提取（机器可读），--stat 输出仅用于展示：
  // 从 --stat 人读格式解析文件名会被 `|` 分隔、`{old => new}` 重命名与
  // 超长路径截断破坏（2026-11-07 审查 P2-4）。
  const changedFiles = numStatResult.success ? parseNumstatPaths(numStatResult.output) : [];

  let insertions = 0;
  let deletions = 0;
  if (numStatResult.success) {
    for (const line of numStatResult.output.split(/\r?\n/)) {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const added = Number(parts[0]);
        const removed = Number(parts[1]);
        if (Number.isFinite(added)) insertions += added;
        if (Number.isFinite(removed)) deletions += removed;
      }
    }
  }

  return {
    success: true,
    output: stat,
    changedFiles,
    insertions,
    deletions,
  };
}

export async function getProjectSnapshot(projectPath: string): Promise<GitSnapshot> {
  assertDirectory(projectPath);

  const [branchOutput, statusOutput] = await Promise.all([
    runGit(projectPath, ["branch", "--show-current"]),
    runGit(projectPath, ["status", "--porcelain=v1", "--branch"]),
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
    runGit(projectPath, ["rev-parse", "--short", "HEAD"]).catch(() => "无提交"),
    runGit(projectPath, ["ls-files", "-co", "--exclude-standard"])
      .then((output) => output.split(/\r?\n/).filter((line) => line.length > 0).length)
      .catch(() => 0),
    runGit(projectPath, ["log", "-1", "--format=%cs"]).catch(() => "未提交"),
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

export async function runGitOperation(
  projectPath: string,
  operation: GitOperation,
): Promise<GitOperationResult> {
  assertDirectory(projectPath);
  const commands = OPERATION_COMMANDS[operation];
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

export async function listChangedFiles(projectPath: string): Promise<ChangeFile[]> {
  assertDirectory(projectPath);
  const porcelain = await runGit(projectPath, ["status", "--porcelain=v1", "-z"]).catch(() => "");
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

// Windows CreateProcessW 命令行约 32K 字符上限：大变更集全量一次 spawn 会失败，
// 分批执行（add 幂等且增量，分批安全）。
const GIT_ARG_CHUNK = 200;

export async function stageFiles(projectPath: string, files: string[]): Promise<void> {
  assertDirectory(projectPath);
  if (files.length === 0) {
    throw new Error("请选择要暂存的文件");
  }
  for (let start = 0; start < files.length; start += GIT_ARG_CHUNK) {
    const chunk = files.slice(start, start + GIT_ARG_CHUNK);
    await runGit(projectPath, ["add", "--", ...chunk.map(toLiteralPathspec)]);
  }
}

export async function unstageFiles(projectPath: string, files: string[]): Promise<void> {
  assertDirectory(projectPath);
  if (files.length === 0) {
    throw new Error("请选择要取消暂存的文件");
  }
  for (let start = 0; start < files.length; start += GIT_ARG_CHUNK) {
    const chunk = files.slice(start, start + GIT_ARG_CHUNK);
    await runGit(projectPath, ["restore", "--staged", "--", ...chunk.map(toLiteralPathspec)]);
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
  const args = ["commit", ...buildCommitMessageArgs(message)];
  const result = await runGitProcess(request.path, args);
  if (!result.success) {
    return {
      success: false,
      output: result.output || "提交失败",
    };
  }
  const hash = await runGit(request.path, ["rev-parse", "--short", "HEAD"]).catch(() => undefined);
  return { success: true, commitHash: hash, output: result.output };
}

export async function listBranches(projectPath: string): Promise<BranchInfo[]> {
  assertDirectory(projectPath);
  const output = await runGit(projectPath, ["branch", "-vv"]).catch(() => "");
  const branches: BranchInfo[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const parsed = parseBranchLine(raw);
    if (parsed) {
      branches.push(parsed);
    }
  }
  return branches;
}

export async function createBranch(input: CreateBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!isValidRefName(name)) {
    throw new Error("分支名只能包含字母、数字、点、下划线、斜杠和连字符");
  }
  await runGit(input.path, ["checkout", "-b", name]);
}

export async function switchBranch(input: SwitchBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!isValidRefName(name)) {
    throw new Error("分支名不合法");
  }
  const result = await runGitProcess(input.path, ["checkout", name]);
  if (!result.success) {
    throw new Error(result.output || "切换分支失败");
  }
}

export async function deleteBranch(input: DeleteBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!name) {
    throw new Error("分支名不能为空");
  }
  if (!isValidRefName(name)) {
    throw new Error("分支名不合法");
  }
  const current = await runGit(input.path, ["branch", "--show-current"]).catch(() => "");
  if (current === name) {
    throw new Error("不能删除当前所在分支，请先切换到其他分支");
  }
  const result = await runGitProcess(input.path, ["branch", "-D", name]);
  if (!result.success) {
    throw new Error(result.output || "删除分支失败");
  }
}

export async function listCommitHistory(projectPath: string, limit = 50): Promise<CommitEntry[]> {
  assertDirectory(projectPath);
  // 记录分隔符 \x1e 必须放在格式串**末尾**（记录尾语义）；旧实现把它放在
  // %s 与 %b 之间、靠记录间的换行切分，第 2 条起 hash 会被上一条 body 污染。
  // 解析逻辑抽在 parseCommitHistory，零依赖可单测（2026-11-07 审查 P0-1）。
  const output = await runGit(projectPath, [
    "log",
    `-n ${limit}`,
    `--format=%H${COMMIT_FIELD_SEP}%an${COMMIT_FIELD_SEP}%ae${COMMIT_FIELD_SEP}%aI${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`,
  ]).catch(() => "");
  return parseCommitHistory(output).map((record) => ({
    hash: record.hash,
    shortHash: record.hash.slice(0, 7),
    author: record.author,
    email: record.email,
    date: record.date,
    subject: record.subject.split("\n")[0],
    message: [record.subject.split("\n")[0], ...record.body.split("\n")].filter(Boolean).join("\n"),
  }));
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
  return { operation: "revert", success: result.success, output: result.output, snapshot };
}

async function commitRevertProcess(
  projectPath: string,
  hash: string,
): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      getActiveGitBinary(),
      ["-C", projectPath, "revert", "--no-edit", hash],
      {
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      },
    );
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { success: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = [failure.stdout?.trim(), failure.stderr?.trim()].filter(Boolean).join("\n");
    return { success: false, output: output || failure.message || "回退提交失败" };
  }
}

/** git 域统一「项目路径」文案的目录断言（实现在 serviceUtils）。 */
function assertDirectory(target: string): void {
  assertDirectoryShared(target, "项目路径");
}

export async function cloneRepository(input: CloneRepositoryInput): Promise<CloneRepositoryResult> {
  const url = input.url.trim();
  const targetPath = input.targetPath.trim();
  assertCloneUrl(url);
  assertCloneTarget(targetPath);

  mkdirSync(dirname(targetPath), { recursive: true });

  const args = ["clone", "--progress"];
  let token = "";
  if (input.accountId) {
    const account = getAccount(input.accountId);
    token = readCredential(account.credentialRef);
  }
  // `--` 隔离选项：URL 形如 `-xxx` 时不会被 git 当选项解析
  args.push("--", url, targetPath);

  const runId = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emitProgress = (
    percent: number,
    phase: string,
    output: string,
    done: boolean,
    success: boolean,
  ) => {
    // 进度文本来自 git 的 stderr/远程响应，可能夹带内嵌凭据的 URL，
    // 统一在推给渲染层前脱敏（真实执行参数不受影响）。
    notifyRenderer("git:cloneProgress", {
      runId,
      percent,
      phase,
      output: redactCloneOutput(output),
      done,
      success,
    });
  };

  return new Promise<CloneRepositoryResult>((resolve) => {
    const child = spawn(getActiveGitBinary(), args, {
      cwd: dirname(targetPath),
      windowsHide: true,
      // 凭据只经环境变量进入子进程：不进命令行（进程列表可见），也不进仓库配置
      env: { ...process.env, ...buildCredentialEnv(token) },
    });
    let accumulated = "";
    // 应用退出时的统一回收：克隆是长生命周期子进程，退出前杀掉整棵进程树，
    // close 事件随后把半成品目录清掉并把 Promise 收口。自然结束由 close/error 注销。
    const unregisterStopper = registerProcessStopper(() => killProcessTree(child));
    child.stdout?.on("data", (chunk) => {
      accumulated += chunk.toString();
      emitProgress(
        parseCloneProgress(accumulated),
        "拉取对象",
        accumulated.slice(-400),
        false,
        false,
      );
    });
    child.stderr?.on("data", (chunk) => {
      accumulated += chunk.toString();
      emitProgress(
        parseCloneProgress(accumulated),
        "拉取对象",
        accumulated.slice(-400),
        false,
        false,
      );
    });
    child.on("error", (error) => {
      unregisterStopper();
      emitProgress(0, "失败", error.message, true, false);
      if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true });
      }
      resolve({ success: false, output: redactCloneOutput(error.message), path: targetPath });
    });
    child.on("close", (code) => {
      unregisterStopper();
      if (code === 0) {
        emitProgress(100, "完成", "克隆完成。", true, true);
        resolve({ success: true, output: redactCloneOutput("克隆完成。"), path: targetPath });
      } else {
        emitProgress(100, "失败", accumulated.slice(-400), true, false);
        if (existsSync(targetPath)) {
          rmSync(targetPath, { recursive: true, force: true });
        }
        resolve({
          success: false,
          output: redactCloneOutput(accumulated.trim() || "克隆失败"),
          path: targetPath,
        });
      }
    });
  });
}

/**
 * 构造克隆子进程的凭据相关环境变量。
 *
 * token 单独走 `GITOOL_ASKPASS_TOKEN`，helper 脚本从该变量读取，脚本与命令行都不含明文；
 * 配置项经 `GIT_CONFIG_*` 只在进程内注入：第 0 条空值重置继承来的 helper 列表
 * （Windows 系统级 `manager` 必须清掉，见上方 F-01 说明），第 1 条注入我们的脚本。
 * 无 token 时不注入这两条，避免给匿名克隆挂一个没有 token 的 helper。
 *
 * 导出供单测直接复刻真实子进程环境（`git credential fill` 走完整 helper 链路）。
 */
export function buildCredentialEnv(token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    [TERMINAL_PROMPT_ENV]: TERMINAL_PROMPT_OFF,
    [ASKPASS_TOKEN_ENV]: token,
  };
  if (token.length > 0) {
    env[GIT_CONFIG_COUNT_ENV] = INJECTED_CONFIG_COUNT;
    env[GIT_CONFIG_KEY_0_ENV] = CREDENTIAL_HELPER_CONFIG_KEY;
    env[GIT_CONFIG_VALUE_0_ENV] = CREDENTIAL_HELPER_RESET_VALUE;
    env[GIT_CONFIG_KEY_1_ENV] = CREDENTIAL_HELPER_CONFIG_KEY;
    env[GIT_CONFIG_VALUE_1_ENV] = CREDENTIAL_HELPER_SCRIPT;
  }
  return env;
}

/**
 * 克隆域「面向渲染层」文本的唯一出口：统一脱敏。
 *
 * why：克隆进度与失败信息会把 git 的原始 stderr / 远程地址原样带回渲染层，
 * 一旦 URL 内嵌令牌或远端回显令牌，就会进入界面与日志。脱敏只改写要展示的文本，
 * 不影响真正用于执行命令的参数。导出供单测锁定「所有克隆出口都经过此函数」。
 */
export function redactCloneOutput(text: string): string {
  return redactSecrets(text);
}

/**
 * 拒绝 URL 中内嵌的凭据（`scheme://user:pass@host`）。
 *
 * why：内嵌凭据的 URL 会被 git 写入 `.git/config` 的 remote 行，并随错误输出、
 * 操作日志与截图外泄；正确做法是使用凭据存储/令牌选择器。
 * 解析失败时不在本函数报错——格式白名单由调用方负责，保持其原有错误语义。
 */
export function assertNoCredentialInUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(
      `${label}不能包含内嵌的账号或令牌，请改用账号凭据或令牌选择器，不要把 token 写进地址`,
    );
  }
}

function assertCloneUrl(url: string): void {
  const httpsPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
  const sshPattern = /^[^@\s]+@[^:\s]+:.+$/;
  if (!httpsPattern.test(url) && !sshPattern.test(url)) {
    throw new Error("不支持的克隆地址，仅接受 HTTPS 或 SSH 格式");
  }
  // 形似 git 选项的 URL（如 `--upload-pack=...`）不该靠 git 的选项表兜底拒绝
  if (url.startsWith("-")) {
    throw new Error("克隆地址不能以 - 开头");
  }
  // 克隆成功后 git 会把该 URL 写进 .git/config 的 remote，必须先拦住内嵌凭据
  assertNoCredentialInUrl(url, "克隆地址");
}

function assertCloneTarget(targetPath: string): void {
  if (!isAbsolute(targetPath)) {
    throw new Error("克隆目标必须是绝对路径");
  }
  if (existsSync(targetPath)) {
    const stats = statSync(targetPath);
    if (!stats.isDirectory()) {
      throw new Error("克隆目标不是目录");
    }
    if (readdirSync(targetPath).length > 0) {
      throw new Error("克隆目标目录不是空的，请选择空目录");
    }
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(getActiveGitBinary(), ["-C", cwd, ...args], {
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
}

async function runGitProcess(cwd: string, args: string[]): Promise<GitProcessResult> {
  try {
    const { stdout, stderr } = await execFileAsync(getActiveGitBinary(), ["-C", cwd, ...args], {
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { success: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = [failure.stdout?.trim(), failure.stderr?.trim()].filter(Boolean).join("\n");
    return {
      success: false,
      output: output || failure.message || "Git 命令执行失败",
    };
  }
}

const diskSizeCache = new Map<string, { value: number; at: number }>();
const DISK_SIZE_CACHE_TTL_MS = 60 * 1000;

export async function getDiskSize(projectPath: string): Promise<number> {
  assertDirectory(projectPath);
  const cached = diskSizeCache.get(projectPath);
  if (cached && Date.now() - cached.at < DISK_SIZE_CACHE_TTL_MS) {
    return cached.value;
  }
  const size = await computeDiskSize(projectPath);
  diskSizeCache.set(projectPath, { value: size, at: Date.now() });
  return size;
}

export function invalidateDiskSizeCache(projectPath: string): void {
  diskSizeCache.delete(projectPath);
}

async function computeDiskSize(projectPath: string): Promise<number> {
  // 与 analysis.ts 相同的并发纪律：全异步 + worker 池。旧实现用
  // readdirSync/statSync 同步遍历，大项目上会把主进程事件循环（全部 IPC）
  // 卡住数秒（2026-11-07 审查 P1-5）。层内并发、层间串行，
  // visited 去重语义与旧实现保持一致。
  const visited = new Set<string>();
  const pending: string[] = [projectPath];
  let total = 0;

  while (pending.length > 0) {
    const directories = pending.splice(0, pending.length);
    await mapLimit(directories, DIRECTORY_SCAN_CONCURRENCY, async (directory) => {
      let realPath: string;
      try {
        realPath = realpathSync(directory);
      } catch {
        return;
      }
      if (visited.has(realPath)) {
        return;
      }
      visited.add(realPath);
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      const subdirectories: string[] = [];
      await mapLimit(entries, FILE_STAT_CONCURRENCY, async (entry) => {
        if (entry.isSymbolicLink()) {
          return;
        }
        const entryPath = join(directory, entry.name);
        try {
          if (entry.isDirectory()) {
            if (IGNORED_SIZE_DIRECTORIES.has(entry.name)) {
              return;
            }
            subdirectories.push(entryPath);
          } else if (entry.isFile()) {
            // 必须先 await 存变量再累加：`total += (await stat(...)).size` 的
            // 复合赋值会先读取 total 旧值再求值右侧，并发 worker 会互相覆盖
            // （lost update，实测同一目录会少算 99% 的体积）
            const fileStats = await stat(entryPath);
            total += fileStats.size;
          }
        } catch {
          // 跳过无法访问的条目
        }
      });
      pending.push(...subdirectories);
    });
  }
  return total;
}

const DIRECTORY_SCAN_CONCURRENCY = 8;
const FILE_STAT_CONCURRENCY = 64;

const IGNORED_SIZE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
]);

const README_FILE_NAMES = [
  "README.md",
  "README.MD",
  "readme.md",
  "README.markdown",
  "readme.txt",
  "README",
];

export async function readProjectReadme(projectPath: string): Promise<ReadmeResult> {
  assertDirectory(projectPath);
  for (const fileName of README_FILE_NAMES) {
    const candidate = join(projectPath, fileName);
    if (!existsSync(candidate)) {
      continue;
    }
    const stats = statSync(candidate);
    if (!stats.isFile() || stats.size > 512 * 1024) {
      continue;
    }
    try {
      const content = readFileSync(candidate, { encoding: "utf8" });
      return { found: true, content, fileName };
    } catch {
      continue;
    }
  }
  return { found: false, content: "", fileName: "" };
}

export async function moveProject(input: MoveProjectInput): Promise<MoveProjectResult> {
  const sourcePath = input.sourcePath.trim();
  const targetDirectory = input.targetDirectory.trim();
  assertDirectory(sourcePath);
  if (
    !isAbsolute(targetDirectory) ||
    !existsSync(targetDirectory) ||
    !statSync(targetDirectory).isDirectory()
  ) {
    throw new Error("目标目录不存在或不是目录");
  }
  const sourceName = basename(sourcePath);
  const targetPath = join(targetDirectory, sourceName);
  if (existsSync(targetPath)) {
    throw new Error("目标位置已存在同名目录，请选择其他目录");
  }
  if (realpathSync(sourcePath) === realpathSync(targetDirectory)) {
    throw new Error("目标目录不能是项目所在目录");
  }

  // 同盘移动优先用 rename：瞬间完成、不占额外磁盘。
  // 旧实现只有 cpSync 且从不删除源目录，名为「移动」实为「复制」，
  // 用户点一次就多出一份完整副本（含 node_modules），旧目录永久残留。
  try {
    renameSync(sourcePath, targetPath);
    // 旧路径的磁盘体积/分析缓存立即失效，只靠 TTL 兜底会显示 60s 的脏数据
    invalidateDiskSizeCache(sourcePath);
    return { success: true, targetPath, output: `项目已移动到 ${targetPath}` };
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      return { success: false, targetPath, output: `移动失败：${errorMessage(error)}` };
    }
    // 跨盘：rename 不可用，退化为「复制 → 校验 → 删源」
  }

  try {
    cpSync(sourcePath, targetPath, { recursive: true });
  } catch (error) {
    removeQuietly(targetPath);
    return { success: false, targetPath, output: `复制失败：${errorMessage(error)}` };
  }

  const sourceCount = countFiles(sourcePath);
  const targetCount = countFiles(targetPath);
  if (sourceCount !== targetCount) {
    removeQuietly(targetPath);
    return {
      success: false,
      targetPath,
      output: `复制校验失败：源目录 ${sourceCount} 个文件，目标 ${targetCount} 个文件，已回滚`,
    };
  }

  try {
    rmSync(sourcePath, { recursive: true, force: true });
  } catch (error) {
    // 副本已完整落盘，不能回滚（否则用户两头空）。如实告知并保留新副本。
    return {
      success: false,
      targetPath,
      output: `已复制到 ${targetPath}，但删除源目录失败：${errorMessage(error)}。请手动删除 ${sourcePath}`,
    };
  }

  invalidateDiskSizeCache(sourcePath);
  return { success: true, targetPath, output: `项目已移动到 ${targetPath}` };
}

/** 跨盘时 rename 会抛 EXDEV（Windows 上也可能表现为 EPERM）。 */
function isCrossDeviceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EXDEV" || code === "EPERM";
}

function removeQuietly(target: string): void {
  try {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  } catch {
    // 清理失败不应掩盖原始错误
  }
}

function countFiles(directory: string): number {
  let count = 0;
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}
