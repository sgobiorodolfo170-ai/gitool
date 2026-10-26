import { execFile, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { TaskRun } from "../../../shared/types";
import { splitCommandLine } from "./commandLine";
import { getTaskProfile, updateTaskRun } from "./storage";

const runningTasks = new Map<string, { process: ReturnType<typeof spawn>; output: () => string }>();

/** 用户主动停止的运行 ID。close 事件据此把状态记为 stopped 而非 failed。 */
const stopRequested = new Set<string>();

export async function runTask(profileId: string): Promise<TaskRun> {
  const profile = getTaskProfile(profileId);
  if (!profile) {
    throw new Error("任务配置不存在");
  }
  assertWorkingDirectory(profile.workingDirectory);

  const now = new Date().toISOString();
  const run: TaskRun = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    profileId,
    projectId: profile.projectId,
    name: profile.name,
    command: `${profile.command} ${profile.args}`.trim(),
    startedAt: now,
    status: "running",
    output: "",
  };

  const args = splitCommandLine(profile.args);
  let output = "";
  // Windows 上 npm/pnpm/yarn 等是 .cmd 脚本，必须通过 shell 执行
  const child = spawn(profile.command, args, {
    cwd: profile.workingDirectory,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  runningTasks.set(run.id, { process: child, output: () => output });

  const appendOutput = (chunk: Buffer | string): void => {
    output += chunk.toString();
    if (output.length > 256 * 1024) {
      output = output.slice(-256 * 1024);
    }
  };

  child.stdout?.on("data", (chunk) => {
    appendOutput(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    appendOutput(chunk);
  });

  const timer =
    profile.timeoutSeconds > 0
      ? setTimeout(() => {
          killProcessTree(child);
          runningTasks.delete(run.id);
          run.status = "timedout";
          run.finishedAt = new Date().toISOString();
          run.exitCode = undefined;
          run.output = `${output}\n[任务超时，已终止]`;
          persistRun(run);
        }, profile.timeoutSeconds * 1000)
      : undefined;

  child.on("error", (error) => {
    if (timer) clearTimeout(timer);
    runningTasks.delete(run.id);
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.output = `${output}\n[启动失败] ${error.message}`;
    persistRun(run);
  });

  child.on("close", (code) => {
    if (timer) clearTimeout(timer);
    runningTasks.delete(run.id);
    if (run.status === "running") {
      // 主动停止与自然失败必须区分：TaskRun 定义了 stopped 状态，
      // 旧实现只 kill 不改状态，用户点「停止」后记录显示为 failed。
      if (stopRequested.has(run.id)) {
        run.status = "stopped";
      } else {
        run.status = code === 0 ? "succeeded" : "failed";
      }
    }
    stopRequested.delete(run.id);
    run.exitCode = code ?? undefined;
    run.finishedAt = new Date().toISOString();
    run.output = output;
    persistRun(run);
  });

  return run;
}

function persistRun(run: TaskRun): void {
  try {
    updateTaskRun(run);
  } catch {
    // 持久化失败不影响主流程
  }
}

export function stopTask(runId: string): void {
  const running = runningTasks.get(runId);
  if (!running) {
    return;
  }
  stopRequested.add(runId);
  killProcessTree(running.process);
  runningTasks.delete(runId);
}

/**
 * 终止整个进程树。
 *
 * Windows 上 `child.kill()` 只结束直接子进程：`npm run build` 会派生 node / tsc / vite，
 * 父进程被杀后子进程继续占用端口与文件句柄，用户点「停止」后日志停了、进程还在跑。
 * 因此 Windows 走 `taskkill /T /F`（必须用 execFile 数组参数，不经 shell）。
 */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) {
    try {
      child.kill();
    } catch {
      // 进程已退出
    }
    return;
  }
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
      // 失败（进程已退出 / 权限不足）不影响状态流转，close 事件仍会触发
    });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // 进程已退出
  }
}

export function isTaskRunning(runId: string): boolean {
  return runningTasks.has(runId);
}

export function getRunningTaskOutput(runId: string): string {
  const running = runningTasks.get(runId);
  if (!running) {
    return "";
  }
  return running.output();
}

function assertWorkingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error("任务工作目录不存在或不是目录");
  }
}
