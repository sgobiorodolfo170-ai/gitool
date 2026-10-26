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
import { notifyRenderer } from "./events";
import {
  bracketValue,
  buildCommitMessageArgs,
  isValidCommitHash,
  isValidRefName,
  parseBranchLine,
  parseChangeStatus,
  parseCloneProgress,
} from "./gitParsing";
import { getAccount, loadSettings } from "./storage";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

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
  const result = await runGitProcess(projectPath, ["diff", "--", file]);
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

  const changedFiles = stat
    .split(/\r?\n/)
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|")[0].trim())
    .filter(Boolean);

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
    if (uncommittedFiles.length > 0) {
      const names = uncommittedFiles
        .slice(0, 5)
        .map((item) => item.path)
        .join("、");
      const label = operation === "pull" ? "拉取" : "同步";
      return {
        operation,
        success: false,
        output: `工作区有未提交的变更，已阻止${label}以免丢失修改。\n变更文件：${names}${uncommittedFiles.length > 5 ? ` 等 ${uncommittedFiles.length} 个` : ""}\n请先提交或暂存这些更改后重试。`,
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
  const files: ChangeFile[] = [];
  const segments = porcelain.split("\0").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment.length < 3 || segment[2] !== " ") {
      continue;
    }
    const status = segment.slice(0, 2);
    const path = segment.slice(3);
    if (!path) continue;
    files.push({
      path,
      status: parseChangeStatus(status),
      staged: status[0] !== " " && status[0] !== "?",
    });
  }
  return files;
}

export async function stageFiles(projectPath: string, files: string[]): Promise<void> {
  assertDirectory(projectPath);
  if (files.length === 0) {
    throw new Error("请选择要暂存的文件");
  }
  await runGit(projectPath, ["add", "--", ...files]);
}

export async function unstageFiles(projectPath: string, files: string[]): Promise<void> {
  assertDirectory(projectPath);
  if (files.length === 0) {
    throw new Error("请选择要取消暂存的文件");
  }
  await runGit(projectPath, ["restore", "--staged", "--", ...files]);
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
  const output = await runGit(projectPath, [
    "log",
    `-n ${limit}`,
    "--format=%H%x1e%an%x1e%ae%x1e%aI%x1e%s%x1f%b",
  ]).catch(() => "");
  const entries: CommitEntry[] = [];
  for (const record of output.split("\x1f")) {
    if (!record) continue;
    const field = record.split("\x1e");
    if (field.length < 5) continue;
    const [hash, author, email, date, subject, body = ""] = field;
    if (!hash) continue;
    entries.push({
      hash,
      shortHash: hash.slice(0, 7),
      author,
      email,
      date,
      subject: subject.split("\n")[0],
      message: [subject.split("\n")[0], ...body.split("\n")].filter(Boolean).join("\n"),
    });
  }
  return entries;
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

function assertDirectory(target: string): void {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new Error("项目路径不存在");
  }
  if (!stats.isDirectory()) {
    throw new Error("项目路径不是目录");
  }
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
    args.push(
      "--config",
      'credential.helper=!f() { echo username=x-access-token; echo password="$GITOOL_ASKPASS_TOKEN"; }; f',
    );
  }
  args.push(url, targetPath);

  const runId = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emitProgress = (
    percent: number,
    phase: string,
    output: string,
    done: boolean,
    success: boolean,
  ) => {
    notifyRenderer("git:cloneProgress", { runId, percent, phase, output, done, success });
  };

  return new Promise<CloneRepositoryResult>((resolve) => {
    const child = spawn(getActiveGitBinary(), args, {
      cwd: dirname(targetPath),
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GITOOL_ASKPASS_TOKEN: token,
      },
    });
    let accumulated = "";
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
      emitProgress(0, "失败", error.message, true, false);
      if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true });
      }
      resolve({ success: false, output: error.message, path: targetPath });
    });
    child.on("close", (code) => {
      if (code === 0) {
        emitProgress(100, "完成", "克隆完成。", true, true);
        resolve({ success: true, output: "克隆完成。", path: targetPath });
      } else {
        emitProgress(100, "失败", accumulated.slice(-400), true, false);
        if (existsSync(targetPath)) {
          rmSync(targetPath, { recursive: true, force: true });
        }
        resolve({ success: false, output: accumulated.trim() || "克隆失败", path: targetPath });
      }
    });
  });
}

function assertCloneUrl(url: string): void {
  const httpsPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
  const sshPattern = /^[^@\s]+@[^:\s]+:.+$/;
  if (!httpsPattern.test(url) && !sshPattern.test(url)) {
    throw new Error("不支持的克隆地址，仅接受 HTTPS 或 SSH 格式");
  }
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
  let total = 0;
  const visited = new Set<string>();
  const stack = [projectPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let realPath: string;
    try {
      realPath = realpathSync(current);
    } catch {
      continue;
    }
    if (visited.has(realPath)) {
      continue;
    }
    visited.add(realPath);
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const entryPath = join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          if (IGNORED_SIZE_DIRECTORIES.has(entry.name)) {
            continue;
          }
          stack.push(entryPath);
        } else if (entry.isFile()) {
          total += statSync(entryPath).size;
        }
      } catch {
        // 跳过无法访问的条目
      }
    }
  }
  return total;
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
