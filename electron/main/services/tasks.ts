import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { TaskRun } from "../../../shared/types";
import { getTaskProfile } from "./storage";

const runningTasks = new Map<string, { process: ReturnType<typeof spawn>; output: () => string }>();

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
  const child = spawn(profile.command, args, {
    cwd: profile.workingDirectory,
    windowsHide: true,
    shell: false,
  });
  runningTasks.set(run.id, { process: child, output: () => output });

  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const timer = profile.timeoutSeconds > 0
    ? setTimeout(() => {
        runningTasks.delete(run.id);
        run.status = "timedout";
        run.finishedAt = new Date().toISOString();
        run.exitCode = undefined;
        run.output = `${output}\n[任务超时，已终止]`;
      }, profile.timeoutSeconds * 1000)
    : undefined;

  child.on("error", (error) => {
    if (timer) clearTimeout(timer);
    runningTasks.delete(run.id);
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.output = `${output}\n[启动失败] ${error.message}`;
  });

  child.on("close", (code) => {
    if (timer) clearTimeout(timer);
    runningTasks.delete(run.id);
    if (run.status === "running") {
      run.status = code === 0 ? "succeeded" : "failed";
    }
    run.exitCode = code ?? undefined;
    run.finishedAt = new Date().toISOString();
    run.output = output;
  });

  return run;
}

export function stopTask(runId: string): void {
  const running = runningTasks.get(runId);
  if (!running) {
    return;
  }
  try {
    running.process.kill();
  } catch {
    // 进程已退出则忽略
  }
  runningTasks.delete(runId);
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

export function splitCommandLine(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  for (const char of input) {
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
      continue;
    }
    if (char === " ") {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

function assertWorkingDirectory(target: string): void {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error("任务工作目录不存在或不是目录");
  }
}