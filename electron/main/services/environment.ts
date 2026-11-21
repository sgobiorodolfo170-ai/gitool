import { execFile } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { EnvironmentStatus, NetworkState } from "../../../shared/types";
import { probeKeyring } from "./credentials";
import { getActiveGitBinary } from "./git";

const execFileAsync = promisify(execFile);

/**
 * 单次网络探测的统一超时上限（毫秒）。
 *
 * why 2.5s 而不是 5s：体检只回答「这台机器现在能不能连上三大平台」，
 * 用于设置页展示与远程页的引导，不需要等待慢速网络完整握手。
 * 实测国内网络下 gitee/gitlab 常被墙，探测会一直挂到超时；
 * 超时值直接等于首启等待时间，因此取 2.5s 作为「够用且可接受」的折中。
 * 超过该值一律判为不可达（reachable=false），由 UI 提示用户而非继续等待。
 */
const NETWORK_PROBE_TIMEOUT_MS = 2500;

/** 三平台探测目标：只取 HTTPS 根/版本端点，任意 HTTP 状态码都算可达。 */
const PROBE_TARGETS = {
  github: "https://api.github.com",
  gitee: "https://gitee.com/api/v5/version",
  gitlab: "https://gitlab.com/api/v4/version",
} as const satisfies Record<keyof EnvironmentStatus["network"], string>;

/**
 * 可注入的 fetch 签名（只用到 GET + AbortSignal）。
 *
 * why 允许多传一个入参而不是读全局 fetch：单元测试需要用桩函数模拟
 * 「三个目标同时挂住」与「超时」两种时序，不能依赖真实网络；
 * 生产调用点不传该参数，行为与直接调用全局 fetch 一致。
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<unknown>;

/**
 * 单平台 API 可达性探测。
 *
 * 判定语义：任意 HTTP 状态码均视为可达（证明 DNS + TLS 链路通），
 * 仅网络层错误（超时 / DNS 失败 / 连接拒绝）视为不可达。
 * 超时通过 AbortController 触发：先 abort 让 fetch 尽快退出，再返回 false，
 * 不向调用方抛出（体检不应因为网络异常而整体失败）。
 */
export async function probeReachability(
  url: string,
  timeoutMs: number = NETWORK_PROBE_TIMEOUT_MS,
  fetchImpl: FetchLike = fetch,
): Promise<NetworkState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(url, { method: "GET", signal: controller.signal });
    return "reachable";
  } catch {
    return "unreachable";
  } finally {
    // 成功/失败都要清定时器：旧实现在成功分支才 clearTimeout，
    // 失败时定时器仍会到点触发一次 abort（对已结束的请求无害但属资源泄漏）。
    clearTimeout(timer);
  }
}

/**
 * 三平台并发探测。
 *
 * why 并发而不是串行：三项互不依赖，串行会把三个超时相加（最坏 3 × 2.5s）；
 * 并发后总耗时 = 最慢一项（最坏 2.5s），直接决定 environment() 的上限。
 */
export async function probeNetwork(
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = NETWORK_PROBE_TIMEOUT_MS,
): Promise<EnvironmentStatus["network"]> {
  const [github, gitee, gitlab] = await Promise.all([
    probeReachability(PROBE_TARGETS.github, timeoutMs, fetchImpl),
    probeReachability(PROBE_TARGETS.gitee, timeoutMs, fetchImpl),
    probeReachability(PROBE_TARGETS.gitlab, timeoutMs, fetchImpl),
  ]);
  return { github, gitee, gitlab };
}

function probeDataDirectory(): { path: string; writable: boolean } {
  // 数据目录 = Electron userData（%APPDATA%\Gitool）。
  // 探测：写一个随机探针文件后立即删除；flag:wx 保证不会覆盖已有文件。
  const dataDirectory = app.getPath("userData");
  try {
    mkdirSync(dataDirectory, { recursive: true });
    const probeFile = join(
      dataDirectory,
      `.probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    writeFileSync(probeFile, "probe", { flag: "wx" });
    unlinkSync(probeFile);
    return { path: dataDirectory, writable: true };
  } catch {
    return { path: dataDirectory, writable: false };
  }
}

/**
 * Git 可用性探测（`git --version`）。
 *
 * why 单独成函数：需要与网络探测并发执行，函数边界让「取二进制 → 执行」
 * 成为一个可独立 await 的任务；失败（不存在 / 不可执行 / 超时）一律视为
 * 不可用，由 UI 引导一键安装。
 */
async function probeGit(): Promise<{ available: boolean; version: string | null }> {
  // Git 探测：使用 settings.gitPath（若配置）否则系统 PATH 中的 git。
  const binary = getActiveGitBinary();
  try {
    const { stdout } = await execFileAsync(binary, ["--version"], { windowsHide: true });
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false, version: null };
  }
}

/**
 * 汇总本机运行环境体检结果。
 *
 * 时序设计：git 探测（子进程，几十到几百毫秒）与网络探测（最坏 2.5s）
 * 并发执行，总耗时取两者较大值；目录可写与 keyring 是同步小操作（毫秒级），
 * 在等待异步结果前完成。旧实现先 await git 再 await 网络，白等了 git 的耗时。
 *
 * 返回字段与共享类型 EnvironmentStatus 严格一致（UI 契约不变）。
 */
export async function getEnvironmentStatus(): Promise<EnvironmentStatus> {
  const gitProbe = probeGit();
  const networkProbe = probeNetwork();
  // 同步项先做：不做 IO 等待，且不受上面的 Promise 影响。
  const dataDir = probeDataDirectory();
  const keyringAvailable = probeKeyring();

  const [git, network] = await Promise.all([gitProbe, networkProbe]);

  return {
    git_available: git.available,
    git_version: git.version,
    platform: process.platform,
    data_directory: dataDir.path,
    data_directory_writable: dataDir.writable,
    network,
    keyring_available: keyringAvailable,
  };
}