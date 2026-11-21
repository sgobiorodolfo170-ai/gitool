/**
 * git 域共享执行层（core）。
 *
 * 职责：唯一持有 git 子进程出口（runGit / runGitProcess / runGitProcessRaw）、
 * 统一脱敏出口、凭据环境构造、目录断言与跨子域常量。
 *
 * why 集中一层：调用方必须能一眼区分「内部解析要原文」与「对外展示要脱敏」两条出口，
 * 分散到各子域后会重演 F-03 的漏点（clone 域脱敏了、操作域忘了）。
 *
 * 依赖方向：core 只依赖进程/工具函数与 binary（二进制探测叶子模块），
 * **不得** import repo / status / history / tags / compare / branch / clone / disk，
 * 以杜绝循环依赖。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertDirectory as assertDirectoryShared, redactSecrets } from "../serviceUtils";
import { getActiveGitBinary } from "./binary";

const execFileAsync = promisify(execFile);
/**
 * stdout/stderr 缓冲上限（10MB）。
 * why 导出：revert 走独立的 execFile 出口（需要 --no-edit），必须与统一出口用同一上限，
 * 避免子域里再写一份裸数字导致两处静默分叉。
 */
export const MAX_BUFFER = 10 * 1024 * 1024;

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

/**
 * `git -C <cwd> <args...>`：仓库定位统一走 `-C` 而不是 `cwd` 选项。
 *
 * why `-C` 必须在子命令之前：它是全局选项，放在子命令之后会被当成子命令的
 * 参数（`git status -C x` 报错），整条命令的行为随之改变。抽到一处后，
 * 三个进程出口（runGit / runGitProcess / runGitProcessRaw）不会各写一份前缀。
 */
export function buildGitCwdArgs(cwd: string, args: string[]): string[] {
  return ["-C", cwd, ...args];
}

/** `git branch --show-current`：只输出当前分支名（detached 时为空行）。 */
export function buildCurrentBranchArgs(): string[] {
  return ["branch", "--show-current"];
}

/**
 * 单个 git 进程可携带的 pathspec 上限（分批边界）。
 *
 * why 200：Windows CreateProcessW 命令行约 32K 字符上限，大变更集全量一次 spawn
 * 会失败；add / restore 都是幂等的增量操作，分批执行与一次性执行语义等价。
 */
export const GIT_ARG_CHUNK = 200;

/** 按 GIT_ARG_CHUNK 切片。纯函数，便于对 199/200/201 等边界做单测。 */
export function chunkFilesForGitArgs(files: string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < files.length; start += GIT_ARG_CHUNK) {
    chunks.push(files.slice(start, start + GIT_ARG_CHUNK));
  }
  return chunks;
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
 * git 域「面向渲染层」文本的唯一出口：统一脱敏。
 *
 * why：git 的原始 stderr / 远程地址会被原样带回渲染层（clone 进度、pull/push/fetch/sync
 * 的错误、commit 输出），一旦 URL 内嵌令牌或远端回显 `?access_token=...`，就会进入界面
 * 与操作日志。脱敏只改写要展示的文本，不影响真正用于执行命令的参数。
 *
 * why 集中在这一处：这些入口全部经由 runGitProcess / 克隆回调，集中一层才不会漏——
 * F-03 的成因正是「clone 域做了、操作域忘了」。导出供单测锁定出口行为。
 */
export function redactGitOutput(text: string): string {
  return redactSecrets(text);
}

/** git 域统一「项目路径」文案的目录断言（实现在 serviceUtils）。 */
export function assertDirectory(target: string): void {
  assertDirectoryShared(target, "项目路径");
}

export type GitProcessResult = {
  success: boolean;
  output: string;
};

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(getActiveGitBinary(), buildGitCwdArgs(cwd, args), {
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
}

/**
 * 对外（返回渲染层 / 抛错文案）的 git 进程出口：返回前统一脱敏。
 *
 * why 必须在这里集中一次：pull/push/fetch/sync/commit/diff 的错误与输出都经由本函数，
 * 逐函数处理正是 F-03 的漏点（clone 域做了、操作域忘了）；命令参数与判定条件
 * （`success`）不受影响，脱敏只作用于文本。
 *
 * why 仍然保留 runGitProcessRaw：`git diff --numstat` 要被逐字段解析，先脱敏会把
 * 含 `key=value` 的文件路径改写，导致变更文件与增删行统计错位——「内部解析要原文，
 * 对外展示才脱敏」。
 */
export async function runGitProcess(cwd: string, args: string[]): Promise<GitProcessResult> {
  const result = await runGitProcessRaw(cwd, args);
  return { success: result.success, output: redactGitOutput(result.output) };
}

/** git 进程原始输出（不脱敏），只供需要解析原文的内部调用使用。 */
export async function runGitProcessRaw(cwd: string, args: string[]): Promise<GitProcessResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      getActiveGitBinary(),
      buildGitCwdArgs(cwd, args),
      {
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      },
    );
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return { success: true, output };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const output = [failure.stdout?.trim(), failure.stderr?.trim()].filter(Boolean).join("\n");
    return {
      success: false,
      output: output || failure.message || "Git 命令执行失败",
    };
  }
}

/**
 * 应用级子进程登记/回收出口（供 clone 这类长生命周期子进程使用）。
 *
 * why 从 core 再导出一层：让「进程生命周期」与「git 执行」同处一层，子域不必各自
 * 记住 processCleanup 的物理位置。本导出仅子域内部使用，index.ts 不对外公开。
 */
export { killProcessTree, registerProcessStopper } from "../processCleanup";
