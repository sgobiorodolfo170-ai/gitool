import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { TaskRun } from "../../../shared/types";
import { quoteWindowsArg, splitCommandLine } from "./commandLine";
import { killProcessTree, registerProcessStopper } from "./processCleanup";
import { errorMessage } from "./serviceUtils";
import { getTaskProfile, insertTaskRun, updateTaskRun } from "./storage/tasks";

/** 子进程输出保留上限：只留最近 256KB，避免长跑任务把主进程内存吃满。 */
const MAX_OUTPUT_LENGTH = 256 * 1024;

/**
 * 允许执行的命令白名单。
 *
 * why 白名单：任务执行器是「产品设计内的能力」，对用户自己输入的命令不算漏洞；
 * 但风险在于：渲染层被攻破后可借 saveProfile + run 持久化一条恶意命令到 DB，
 * 即使本次会话结束、重启后仍可被再次触发。白名单把可执行面收窄到已知安全的命令。
 */
const ALLOWED_TASK_COMMANDS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "cargo",
  "go",
  "mvn",
  "gradle",
  "dotnet",
  "docker",
  "python",
  "node",
  "py",
]);

/**
 * 命令元字符拒绝模式。
 *
 * why 拒元字符：`shell:true` 使 `& | > ^` 等元字符不限于「命令 + 参数」，
 * `profile.command` 可写 `npm run build & powershell -enc <base64>`。
 * 白名单 + 元字符拒绝双保险，防止「命令合法但参数恶意」的绕过。
 */
const META_CHARACTERS = /[&|<>^()`]/;

/**
 * 断言命令在白名单内且不含元字符。
 */
function assertAllowedCommand(command: string, label = "命令"): void {
  if (!command || typeof command !== "string") {
    throw new Error(`${label}不能为空`);
  }
  if (!ALLOWED_TASK_COMMANDS.has(command)) {
    throw new Error(`不允许执行该命令：${command}`);
  }
  if (META_CHARACTERS.test(command)) {
    throw new Error(`${label}中包含不允许的字符`);
  }
}

const runningTasks = new Map<string, { process: ReturnType<typeof spawn>; output: () => string }>();

/** 用户主动停止的运行 ID。close 事件据此把状态记为 stopped 而非 failed。 */
const stopRequested = new Set<string>();

export async function runTask(profileId: string): Promise<TaskRun> {
  const profile = getTaskProfile(profileId);
  if (!profile) {
    throw new Error("任务配置不存在");
  }
  assertAllowedCommand(profile.command);
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

  // why 先落库再 spawn（A-22 单点生命周期）：旧实现由 IPC 在 runTask 返回后才 insert，
  // 而 spawn 已经在 runTask 内启动——进程若瞬间结束，close 回调的 UPDATE 会打到
  // 不存在的行（更新丢失），库里那条记录永远停在 running。把 insert 提前到 spawn 之前，
  // 之后所有终态回调更新的都是确定存在的行。insert 失败直接上抛：让用户看到
  // 「任务未启动」比留下一条永不完成的 running 记录更可信。
  insertTaskRun(run);

  const parsedArgs = splitCommandLine(profile.args);
  // Windows 下走 shell:true：Node 只把 command 与 args 空格拼接后交给 cmd.exe，
  // 不会替参数加引号。必须在此手工转义，否则含空格的参数会被重新拆开、
  // 含 & | 的参数会被 cmd 解释成新命令（2026-11-07 审查 P1-4）。
  const args = process.platform === "win32" ? parsedArgs.map(quoteWindowsArg) : parsedArgs;
  let output = "";
  // Windows 上 npm/pnpm/yarn 等是 .cmd 脚本，必须通过 shell 执行
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(profile.command, args, {
      cwd: profile.workingDirectory,
      windowsHide: true,
      shell: process.platform === "win32",
    });
  } catch (error) {
    // spawn 同步抛错（参数非法、cwd 在检查后被删等）：running 行已落库，必须立刻定稿，
    // 否则界面会留一条永不结束的 running 记录（A-22）。
    const summary = errorMessage(error);
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.output = `[启动失败] ${summary}`;
    persistRun(run);
    throw new Error(`任务启动失败：${summary}`);
  }
  runningTasks.set(run.id, { process: child, output: () => output });
  // 应用退出时的统一回收：标记 stopRequested 让 close 事件把状态记为
  // stopped（而非 failed），再杀整棵进程树。自然结束由 close 注销。
  const unregisterStopper = registerProcessStopper(() => {
    stopRequested.add(run.id);
    killProcessTree(child);
  });

  const appendOutput = (chunk: Buffer | string): void => {
    output += chunk.toString();
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(-MAX_OUTPUT_LENGTH);
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
    unregisterStopper();
    runningTasks.delete(run.id);
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.output = `${output}\n[启动失败] ${error.message}`;
    persistRun(run);
  });

  child.on("close", (code) => {
    if (timer) clearTimeout(timer);
    unregisterStopper();
    runningTasks.delete(run.id);
    // 超时路径已在定时器回调里定稿（含 [任务超时，已终止] 标注）：
    // 这里无条件回填会抹掉标注并重复持久化（2026-11-07 审查 P2-1）。
    if (run.status !== "running") {
      stopRequested.delete(run.id);
      return;
    }
    // 主动停止与自然失败必须区分：TaskRun 定义了 stopped 状态，
    // 旧实现只 kill 不改状态，用户点「停止」后记录显示为 failed。
    if (stopRequested.has(run.id)) {
      run.status = "stopped";
    } else {
      run.status = code === 0 ? "succeeded" : "failed";
    }
    stopRequested.delete(run.id);
    run.exitCode = code ?? undefined;
    run.finishedAt = new Date().toISOString();
    run.output = output;
    persistRun(run);
  });

  return run;
}

/**
 * 运行记录定稿落库（close / error / timeout / 启动失败四条终态路径共用）。
 *
 * why 不再静默吞错（A-22）：旧实现 `catch {}` 让一次 UPDATE 失败彻底消失，
 * 库里那条记录永远停在 running——用户既看不到失败原因，也无法判断任务是否还在跑。
 * 现在的策略是「降级写 failed」：
 * 1. 正常 UPDATE；失败则
 * 2. 用同一行再写一次 status=failed + 错误摘要（output 末尾追加 `[记录写入失败] …`），
 *    保证记录离开 running 且原因可查。降级语义是「本次记录写入失败」，不是任务结果；
 * 3. 降级仍失败时只能记日志——persistRun 运行在子进程事件回调里，再抛会变成
 *    主进程未捕获异常（可能直接崩掉应用），日志是唯一安全的最后出口。
 *
 * why 不向 IPC 调用方上抛：终态回调发生时 tasks:run 早已返回，异常没有接收者；
 * 而任务本身的执行结果已由 run.status 表达，记录写入失败不该改写它。
 */
function persistRun(run: TaskRun): void {
  try {
    updateTaskRun(run);
  } catch (error) {
    const summary = errorMessage(error);
    try {
      updateTaskRun({
        ...run,
        status: "failed",
        finishedAt: run.finishedAt ?? new Date().toISOString(),
        output: `${run.output}\n[记录写入失败] ${summary}`.slice(-MAX_OUTPUT_LENGTH),
      });
    } catch (fallbackError) {
      console.error(`[tasks] 运行记录写入失败且降级写入失败：${summary}`, fallbackError);
    }
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
