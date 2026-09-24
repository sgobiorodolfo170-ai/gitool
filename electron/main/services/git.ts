import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
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
  CreateBranchInput,
  DeleteBranchInput,
  EnvironmentStatus,
  GitOperation,
  GitOperationResult,
  GitSnapshot,
  LocalProjectInspection,
  MoveProjectInput,
  MoveProjectResult,
  ProjectStatus,
  ReadmeResult,
  RevertCommitInput,
  SwitchBranchInput,
} from "../../../shared/types";
import { readCredential } from "./credentials";
import { getAccount } from "./storage";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

const OPERATION_COMMANDS: Record<GitOperation, string[][]> = {
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

export async function getEnvironmentStatus(): Promise<EnvironmentStatus> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"], { windowsHide: true });
    return {
      git_available: true,
      git_version: stdout.trim(),
      platform: process.platform,
    };
  } catch {
    return {
      git_available: false,
      git_version: null,
      platform: process.platform,
    };
  }
}

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

export async function getProjectSnapshot(projectPath: string): Promise<GitSnapshot> {
  assertDirectory(projectPath);

  const branchOutput = await runGit(projectPath, ["branch", "--show-current"]);
  const branch = branchOutput.length > 0 ? branchOutput : "HEAD detached";

  const statusOutput = await runGit(projectPath, ["status", "--porcelain=v1", "--branch"]);
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

  const commit = await runGit(projectPath, ["rev-parse", "--short", "HEAD"]).catch(() => "无提交");
  const files = await runGit(projectPath, ["ls-files", "-co", "--exclude-standard"])
    .then((output) => output.split(/\r?\n/).filter((line) => line.length > 0).length)
    .catch(() => 0);
  const updatedAt = await runGit(projectPath, ["log", "-1", "--format=%cs"]).catch(() => "未提交");

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
      const names = uncommittedFiles.slice(0, 5).map((item) => item.path).join("、");
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
  const messageLines = message.split(/\r?\n/).filter((line) => line.length > 0);
  const args = ["commit"];
  for (const line of messageLines) {
    args.push("-m", line);
  }
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
    if (!raw.trim()) continue;
    const current = raw.trim().startsWith("*");
    const line = current ? raw.trim().slice(1).trim() : raw.trim();
    const match = line.match(/^([^\s]+)/);
    if (!match) continue;
    const name = match[1];
    const tracking = line.match(/\[([^\]]+)\]/);
    const aheadMatch = tracking?.[1]?.match(/ahead (\d+)/);
    const behindMatch = tracking?.[1]?.match(/behind (\d+)/);
    const remotePart = tracking?.[1]?.split(":")[0];
    branches.push({
      name,
      current,
      remote: tracking ? remotePart ?? undefined : undefined,
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0,
    });
  }
  return branches;
}

export async function createBranch(input: CreateBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(name)) {
    throw new Error("分支名只能包含字母、数字、点、下划线、斜杠和连字符");
  }
  await runGit(input.path, ["checkout", "-b", name]);
}

export async function switchBranch(input: SwitchBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(name)) {
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
  const output = await runGit(
    projectPath,
    ["log", `-n ${limit}`, '--format=%H%x1e%an%x1e%ae%x1e%aI%x1e%s%x1f%b'],
  ).catch(() => "");
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
  if (!/^[0-9a-f]{7,40}$/.test(hash)) {
    throw new Error("提交哈希不合法");
  }
  const result = await commitRevertProcess(input.path, hash);
  let snapshot: GitSnapshot | undefined;
  try {
    snapshot = await getProjectSnapshot(input.path);
  } catch {
    snapshot = undefined;
  }
  return { operation: "pull", success: result.success, output: result.output, snapshot };
}

async function commitRevertProcess(projectPath: string, hash: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", projectPath, "revert", "--no-edit", hash], {
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { success: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = [failure.stdout?.trim(), failure.stderr?.trim()].filter(Boolean).join("\n");
    return { success: false, output: output || failure.message || "回退提交失败" };
  }
}

function parseChangeStatus(status: string): ChangeFile["status"] {
  const combined = status.trim();
  if (combined.includes("U") || combined === "AA" || combined === "DD") {
    return "conflicted";
  }
  if (status[0] === "R" || status[1] === "R") {
    return "renamed";
  }
  if (status[0] === "D" || status[1] === "D") {
    return "deleted";
  }
  if (status[1] === "?" || status[1] === "!") {
    return "untracked";
  }
  if (status[1] === "A" || status[0] === "A") {
    return "added";
  }
  return "modified";
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

export async function cloneRepository(
  input: CloneRepositoryInput,
): Promise<CloneRepositoryResult> {
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

  try {
    await execFileAsync("git", args, {
      cwd: dirname(targetPath),
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GITOOL_ASKPASS_TOKEN: token,
      },
    });
    return { success: true, output: "克隆完成。", path: targetPath };
  } catch (error) {
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
    return {
      success: false,
      output: gitErrorOutput(error),
      path: targetPath,
    };
  }
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
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
}

async function runGitProcess(cwd: string, args: string[]): Promise<GitProcessResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
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

function bracketValue(branchLine: string, key: string): string | null {
  const marker = `${key} `;
  const start = branchLine.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const value = branchLine
    .slice(start + marker.length)
    .split(/[,\]]/)[0]
    .trim();
  return value.length > 0 ? value : null;
}

export async function getDiskSize(projectPath: string): Promise<number> {
  assertDirectory(projectPath);
  let total = 0;
  const visited = new Set<string>();
  const stack = [projectPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let realPath;
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
          const stats = statSync(entryPath);
          total += stats.size;
        }
      } catch {
        // 跳过无法访问的条目
      }
    }
  }
  return total;
}

const IGNORED_SIZE_DIRECTORIES = new Set([".git", "node_modules", "target", "dist", "build", ".next", ".venv", "__pycache__"]);

const README_FILE_NAMES = ["README.md", "README.MD", "readme.md", "README.markdown", "readme.txt", "README"];

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
  if (!isAbsolute(targetDirectory) || !existsSync(targetDirectory) || !statSync(targetDirectory).isDirectory()) {
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

  try {
    cpSync(sourcePath, targetPath, { recursive: true });
    const sourceCount = countFiles(sourcePath);
    const targetCount = countFiles(targetPath);
    if (sourceCount !== targetCount) {
      rmSync(targetPath, { recursive: true, force: true });
      throw new Error(`复制校验失败：源目录 ${sourceCount} 个文件，目标 ${targetCount} 个文件`);
    }
    return { success: true, targetPath, output: `项目已移动到 ${targetPath}` };
  } catch (error) {
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
    return { success: false, targetPath, output: errorMessage(error) };
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

function gitErrorOutput(error: unknown): string {
  const failure = error as { stdout?: string; stderr?: string; message?: string };
  const detail = [failure.stdout, failure.stderr].filter((item): item is string => Boolean(item)).join("\n").trim();
  return detail.length > 0 ? detail : failure.message ?? "克隆失败";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
