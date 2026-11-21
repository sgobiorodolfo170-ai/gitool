/**
 * 克隆域：URL/目标的入口校验、克隆子进程与进度上报。
 *
 * 依赖方向：core（执行层/凭据环境/进程登记）、binary（可执行文件）、gitParsing（进度解析）、
 * credentials/账号存储与事件通道；不 import 其他 git 子域，也无子域 import 本文件
 * （repo.setRemoteUrl 复用 assertNoCredentialInUrl，属单向依赖）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { CloneRepositoryInput, CloneRepositoryResult } from "../../../../shared/types";
import { readCredential } from "../credentials";
import { notifyRenderer } from "../events";
import { parseCloneProgress } from "../gitParsing";
import { getAccount } from "../storage/accounts";
import { getActiveGitBinary } from "./binary";
import {
  buildCredentialEnv,
  killProcessTree,
  redactGitOutput,
  registerProcessStopper,
} from "./core";

/**
 * `git clone --progress -- <url> <target>`。
 *
 * why 顺序固定：`--progress` 必须排在 `--` 之前（它自身是选项）；`--` 必须紧贴两个
 * 位置参数之前，URL 形如 `-xxx`（如 `--upload-pack=...`）时才不会被 git 当选项解析。
 * why url/target 只能是位置参数：token 只走 buildCredentialEnv 的环境变量通道，
 * 一旦混进参数就会出现在进程列表与日志里。
 */
export function buildCloneArgs(url: string, targetPath: string): string[] {
  return ["clone", "--progress", "--", url, targetPath];
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

export async function cloneRepository(input: CloneRepositoryInput): Promise<CloneRepositoryResult> {
  const url = input.url.trim();
  const targetPath = input.targetPath.trim();
  assertCloneUrl(url);
  assertCloneTarget(targetPath);

  mkdirSync(dirname(targetPath), { recursive: true });

  let token = "";
  if (input.accountId) {
    const account = getAccount(input.accountId);
    token = readCredential(account.credentialRef);
  }
  // `--` 隔离选项：URL 形如 `-xxx` 时不会被 git 当选项解析（顺序见 buildCloneArgs）。
  const args = buildCloneArgs(url, targetPath);

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
      output: redactGitOutput(output),
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
      resolve({
        success: false,
        output: redactGitOutput(error.message),
        path: targetPath,
      });
    });
    child.on("close", (code) => {
      unregisterStopper();
      if (code === 0) {
        emitProgress(100, "完成", "克隆完成。", true, true);
        resolve({
          success: true,
          output: redactGitOutput("克隆完成。"),
          path: targetPath,
        });
      } else {
        emitProgress(100, "失败", accumulated.slice(-400), true, false);
        if (existsSync(targetPath)) {
          rmSync(targetPath, { recursive: true, force: true });
        }
        resolve({
          success: false,
          output: redactGitOutput(accumulated.trim() || "克隆失败"),
          path: targetPath,
        });
      }
    });
  });
}
