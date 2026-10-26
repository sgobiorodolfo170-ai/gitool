import { app } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateCheckResult, UpdateProgress } from "../../../shared/types";
import { compareVersions } from "./version";

const REPO_OWNER = "sgobiorodolfo170-ai";
const REPO_NAME = "gitool";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** 更新包下载目录。安装前必须校验路径落在此目录内，避免渲染层传入任意 exe。 */
const UPDATE_DIRECTORY_NAME = "gitool-updates";

type ProgressCallback = (progress: UpdateProgress) => void;

export function getUpdateDirectory(): string {
  return join(tmpdir(), UPDATE_DIRECTORY_NAME);
}

/**
 * 判断路径是否为受信任的更新包。
 *
 * 背景：`updater:install` 的入参来自渲染层，若被 XSS 攻破即可传入任意 exe 路径并提权执行。
 * 这里做两道限制——必须位于下载目录内（resolve 后比较，防止 `..` 穿越）、必须是 .exe。
 */
export function isTrustedInstallerPath(filePath: string): boolean {
  const resolved = resolve(filePath);
  const directory = resolve(getUpdateDirectory());
  const inDirectory = resolved.startsWith(`${directory}\\`) || resolved.startsWith(`${directory}/`);
  return inDirectory && /\.exe$/i.test(resolved);
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Gitool-Updater",
        },
      },
    );
    if (!response.ok) {
      return { hasUpdate: false, version: currentVersion, downloadUrl: "" };
    }
    const body = (await response.json()) as {
      tag_name?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const latestTag = body.tag_name ?? "";
    const asset = body.assets?.find((item) => item.name?.endsWith("-setup.exe"));
    const downloadUrl = asset?.browser_download_url ?? "";
    const hasUpdate = compareVersions(currentVersion, latestTag) < 0;
    return {
      hasUpdate,
      version: latestTag.replace(/^[vV]/, ""),
      downloadUrl,
    };
  } catch {
    return { hasUpdate: false, version: currentVersion, downloadUrl: "" };
  }
}

/**
 * 下载更新包。
 *
 * 用 pipeline 把响应流直接写盘，而不是把整包读进内存再 Buffer.concat：
 * 安装包约 100MB，旧实现的内存峰值会翻倍，且 `writer.write()` 后立即 `close()`
 * 没有等待 `finish`，大文件可能被截断。
 */
export async function downloadUpdate(
  downloadUrl: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const tempDir = getUpdateDirectory();
  mkdirSync(tempDir, { recursive: true });

  const fileName = resolveFileName(downloadUrl);
  const filePath = join(tempDir, fileName);

  const response = await fetch(downloadUrl, {
    headers: { "User-Agent": "Gitool-Updater" },
  });
  if (!response.ok) {
    throw new Error(`下载更新失败：HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("无法读取更新数据流");
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let downloaded = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      onProgress?.({ percent, downloaded, total });
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    counter,
    createWriteStream(filePath),
  );

  onProgress?.({ percent: 100, downloaded, total });
  return filePath;
}

/**
 * 从下载链接推导本地文件名。
 * 用 pathname 而非 split("/")，避免把 `?token=...` 之类的查询串带进文件名。
 */
function resolveFileName(downloadUrl: string): string {
  let candidate = "";
  try {
    candidate = new URL(downloadUrl).pathname.split("/").pop() ?? "";
  } catch {
    candidate = downloadUrl.split("/").pop() ?? "";
  }
  const sanitized = candidate.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : `gitool-setup-${Date.now()}.exe`;
}

export function installUpdate(installerPath: string): void {
  if (!isTrustedInstallerPath(installerPath)) {
    throw new Error("安装包路径不受信任，已拒绝执行");
  }
  spawn("cmd", ["/c", "start", "", "/wait", installerPath], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  app.quit();
}

export { CHECK_INTERVAL_MS };
