/**
 * 仓库生命周期域：本地项目识别、初始化、目录扫描、远程地址设置、项目搬迁。
 *
 * 依赖方向：core（执行层）、disk（缓存失效）、status（快照）、clone（URL 凭据校验）；
 * 被依赖方均不 import 本文件，无循环。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type {
  InitRepositoryInput,
  LocalProjectInspection,
  MoveProjectInput,
  MoveProjectResult,
  RepositoryDiscoveryItem,
  SetRemoteUrlInput,
} from "../../../../shared/types";
import { isValidRefName } from "../gitParsing";
import { errorMessage } from "../serviceUtils";
import { assertNoCredentialInUrl } from "./clone";
import { assertDirectory, runGit, runGitProcess } from "./core";
import { invalidateDiskSizeCache } from "./disk";
import { getProjectSnapshot } from "./status";

/** `git init -b <branch>`：`-b` 后紧邻分支名（git 2.28+ 的初始分支选项），位置不可调换。 */
export function buildInitArgs(branch: string): string[] {
  return ["init", "-b", branch];
}

/** `git remote`：无参数即列出全部远程名（供 setRemoteUrl 判定 add/set-url）。 */
export function buildRemoteListArgs(): string[] {
  return ["remote"];
}

/**
 * `git remote add <name> <url>`：两个位置参数顺序固定，url 已在上游拒绝 `-` 开头。
 */
export function buildRemoteAddArgs(remote: string, url: string): string[] {
  return ["remote", "add", remote, url];
}

/**
 * `git remote set-url <name> <url>`：与 add 相比只多一个 set-url 子命令，位置参数
 * 顺序必须与 add 保持一致，否则会把 url 写成远程名。
 */
export function buildRemoteSetUrlArgs(remote: string, url: string): string[] {
  return ["remote", "set-url", remote, url];
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
  const result = await runGitProcess(projectPath, buildInitArgs(branch));
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
  const remotesOutput = await runGit(input.path, buildRemoteListArgs()).catch(() => "");
  const hasRemote = remotesOutput.split(/\r?\n/).includes(remote);
  const result = hasRemote
    ? await runGitProcess(input.path, buildRemoteSetUrlArgs(remote, url))
    : await runGitProcess(input.path, buildRemoteAddArgs(remote, url));
  if (!result.success) {
    throw new Error(result.output || "设置远程地址失败");
  }
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
      return {
        success: false,
        targetPath,
        output: `移动失败：${errorMessage(error)}`,
      };
    }
    // 跨盘：rename 不可用，退化为「复制 → 校验 → 删源」
  }

  try {
    cpSync(sourcePath, targetPath, { recursive: true });
  } catch (error) {
    removeQuietly(targetPath);
    return {
      success: false,
      targetPath,
      output: `复制失败：${errorMessage(error)}`,
    };
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
