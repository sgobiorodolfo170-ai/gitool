import { execFile } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { EnvironmentStatus, NetworkState } from "../../../shared/types";
import { probeKeyring } from "./credentials";
import { getActiveGitBinary } from "./git";

const execFileAsync = promisify(execFile);

// 单平台 API 可达性探测：任意 HTTP 状态码均视为可达（证明 DNS + TLS 链路通），
// 仅网络层错误（超时 / DNS 失败 / 连接拒绝）视为不可达。
// 5s 超时上限，避免体检被慢网络或不可达网络拖死。
async function probeEndpoint(url: string): Promise<NetworkState> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    return "reachable";
  } catch {
    return "unreachable";
  }
}

async function probeNetwork(): Promise<EnvironmentStatus["network"]> {
  // 三平台并发探测，单次体检总耗时上限约 5s（并发后取最慢一项）。
  const [github, gitee, gitlab] = await Promise.all([
    probeEndpoint("https://api.github.com"),
    probeEndpoint("https://gitee.com/api/v5/version"),
    probeEndpoint("https://gitlab.com/api/v4/version"),
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

export async function getEnvironmentStatus(): Promise<EnvironmentStatus> {
  // Git 探测：使用 settings.gitPath（若配置）否则系统 PATH 中的 git。
  // 失败（不存在 / 不可执行 / 超时）一律视为不可用，由 UI 引导一键安装。
  const binary = getActiveGitBinary();
  let gitAvailable = false;
  let gitVersion: string | null = null;
  try {
    const { stdout } = await execFileAsync(binary, ["--version"], { windowsHide: true });
    gitAvailable = true;
    gitVersion = stdout.trim();
  } catch {
    gitAvailable = false;
    gitVersion = null;
  }

  const dataDir = probeDataDirectory();
  const network = await probeNetwork();
  const keyringAvailable = probeKeyring();

  return {
    git_available: gitAvailable,
    git_version: gitVersion,
    platform: process.platform,
    data_directory: dataDir.path,
    data_directory_writable: dataDir.writable,
    network,
    keyring_available: keyringAvailable,
  };
}
