import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import { app } from "electron";
import type { EnvironmentStatus, InstallGitResult, InstallProgress } from "../../../shared/types";
import { getEnvironmentStatus } from "./environment";
import { notifyRenderer } from "./events";
import { loadSettings, saveSettings } from "./storage";

// Git for Windows 官方 Release 始终发布在此 API 端点。
// 未经认证的请求受 IP 维度限速（60/小时），一次性安装场景足够。
const REPO_LATEST_RELEASE = "https://api.github.com/repos/git-for-windows/git/releases/latest";

// 静默安装后探测 git.exe 的标准位置（按优先级排序）。
// 64-bit 安装包默认装到 C:\Program Files\Git；用户若选 per-user 安装则在 LOCALAPPDATA。
const STANDARD_GIT_PATHS = [
  join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "cmd", "git.exe"),
  join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "cmd", "git.exe"),
  join(process.env["LOCALAPPDATA"] ?? "", "Programs", "Git", "cmd", "git.exe"),
];

type GithubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GithubRelease = {
  tag_name: string;
  assets: GithubAsset[];
};

function emitProgress(phase: InstallProgress["phase"], percent: number, message: string): void {
  notifyRenderer("setup:installProgress", { phase, percent, message });
}

// 从 GitHub Release 选 64-bit 官方安装包（命名规律：Git-x.y.z-64-bit.exe）。
// 排除 PortableGit、.tar.bz2、.zip 等其它制品，确保小白拿到的是向导式安装器。
function pickInstallerAsset(release: GithubRelease): GithubAsset | null {
  const pattern = /^Git-[\d.]+-64-bit\.exe$/;
  return release.assets.find((asset) => pattern.test(asset.name)) ?? null;
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(REPO_LATEST_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub API 返回 ${response.status}`);
    }
    return (await response.json()) as GithubRelease;
  } finally {
    clearTimeout(timer);
  }
}

// 流式下载安装包到临时目录，避免一次性读入内存（安装包约 60MB）。
// 通过 Content-Length 推送百分比，无 Content-Length 时退化为状态消息。
function downloadInstaller(url: string, expectedSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const targetPath = join(app.getPath("temp"), `gitool-git-setup-${Date.now()}.exe`);
    const fileStream = createWriteStream(targetPath);
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，HTTP ${response.statusCode}`));
        return;
      }
      const total = Number(response.headers["content-length"] ?? expectedSize) || expectedSize;
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        emitProgress("downloading", percent, `下载中 ${percent}%`);
      });
      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close((err) => {
          if (err) reject(err);
          else resolve(targetPath);
        });
      });
    });
    request.on("error", reject);
  });
}

// 用 PowerShell Start-Process -Verb RunAs 触发 UAC 提权并静默安装。
// -Wait 保证 PowerShell 进程等子进程结束再退出，spawn 的 close 事件才会触发。
// /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- 是 Inno Setup 的静默参数，
// Git for Windows 安装器基于 Inno Setup，这套参数能完全无界面安装。
function runSilentInstaller(installerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${installerPath}' -ArgumentList '/VERYSILENT','/NORESTART','/SP-','/SUPPRESSMSGBOXES' -Verb RunAs -Wait`,
    ];
    const child = spawn("powershell", args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell 退出码 ${code}`));
    });
  });
}

// 装完后探测 git.exe 路径：先查标准安装路径，再 fallback 到 where.exe。
// where.exe 是新起的子进程，能感知刚刷新的 PATH（即使主进程 PATH 未刷新也能查到）。
function locateGitBinary(): string {
  for (const candidate of STANDARD_GIT_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    const output = execFileSync("where.exe", ["git"], { windowsHide: true, encoding: "utf8" }) as string;
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first && existsSync(first)) return first;
  } catch {
    // where.exe 也没找到，返回空串由调用方处理
  }
  return "";
}

export async function installGit(): Promise<InstallGitResult> {
  // 阶段 1：查询最新版本
  emitProgress("downloading", 0, "查询最新版本");
  let release: GithubRelease;
  try {
    release = await fetchLatestRelease();
  } catch (error) {
    emitProgress("failed", 0, "无法获取最新版本，请检查网络或代理");
    return { success: false, gitPath: "", message: error instanceof Error ? error.message : "获取版本失败" };
  }
  const asset = pickInstallerAsset(release);
  if (!asset) {
    emitProgress("failed", 0, "未找到 64-bit 安装包");
    return { success: false, gitPath: "", message: "未找到适用于 64 位 Windows 的 Git 安装包" };
  }

  // 阶段 2：下载安装包
  let installerPath: string;
  try {
    installerPath = await downloadInstaller(asset.browser_download_url, asset.size);
  } catch (error) {
    emitProgress("failed", 0, "下载安装包失败");
    return { success: false, gitPath: "", message: error instanceof Error ? error.message : "下载失败" };
  }

  // 阶段 3：UAC 提权 + 静默安装
  emitProgress("installing", 0, "正在安装（如弹出 UAC 提示，请点击是）");
  try {
    await runSilentInstaller(installerPath);
  } catch (error) {
    emitProgress("failed", 0, "安装未完成");
    return { success: false, gitPath: "", message: error instanceof Error ? error.message : "安装失败" };
  }

  // 阶段 4：探测 git.exe + 写入 gitPath + 重新体检
  emitProgress("verifying", 50, "验证安装结果");
  const gitPath = locateGitBinary();
  if (!gitPath) {
    emitProgress("failed", 0, "安装完成但未找到 git.exe");
    return { success: false, gitPath: "", message: "安装已完成但未在标准路径找到 git.exe，请手动指定 Git 路径" };
  }
  // 把 gitPath 写入 settings，让运行中的实例立刻使用，无需重启应用。
  const current = loadSettings();
  saveSettings({ ...current, gitPath });
  const environment: EnvironmentStatus = await getEnvironmentStatus();
  if (environment.git_available) {
    emitProgress("done", 100, `安装成功：${environment.git_version ?? ""}`);
    return { success: true, gitPath, message: "Git 安装成功", environment };
  }
  emitProgress("failed", 0, "git.exe 已就位但调用失败");
  return { success: false, gitPath, message: "git.exe 已就位但调用失败，请重启应用再试", environment };
}
