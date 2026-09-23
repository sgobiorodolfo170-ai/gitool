import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import type {
  EnvironmentStatus,
  GitOperation,
  GitOperationResult,
  GitSnapshot,
  LocalProjectInspection,
  ProjectStatus,
} from "../../../shared/types";

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
