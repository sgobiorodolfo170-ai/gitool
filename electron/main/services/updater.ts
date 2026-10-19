import { app } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { UpdateCheckResult, UpdateProgress } from "../../../shared/types";

const REPO_OWNER = "sgobiorodolfo170-ai";
const REPO_NAME = "gitool";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

type ProgressCallback = (progress: UpdateProgress) => void;

function compareVersions(current: string, latest: string): number {
  const pa = current.replace(/^v/, "").split(".").map(Number);
  const pb = latest.replace(/^v/, "").split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
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
    const asset = body.assets?.find((a) => a.name?.endsWith("-setup.exe"));
    const downloadUrl = asset?.browser_download_url ?? "";
    const hasUpdate = compareVersions(currentVersion, latestTag) < 0;
    return {
      hasUpdate,
      version: latestTag.replace(/^v/, ""),
      downloadUrl,
    };
  } catch {
    return { hasUpdate: false, version: currentVersion, downloadUrl: "" };
  }
}

export async function downloadUpdate(
  downloadUrl: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const tempDir = join(tmpdir(), "gitool-updates");
  mkdirSync(tempDir, { recursive: true });
  const fileName = downloadUrl.split("/").pop() || "gitool-setup.exe";
  const filePath = join(tempDir, fileName);

  const response = await fetch(downloadUrl, {
    headers: { "User-Agent": "Gitool-Updater" },
  });

  if (!response.ok) {
    throw new Error(`下载更新失败：HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法读取更新数据流");
  }

  const writer = createWriteStream(filePath);
  let downloaded = 0;
  const chunks: Buffer[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(Buffer.from(value));
      downloaded += value.byteLength;
      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      onProgress?.({ percent, downloaded, total });
    }
  }

  writer.write(Buffer.concat(chunks));
  writer.close();
  onProgress?.({ percent: 100, downloaded, total });
  return filePath;
}

export function installUpdate(installerPath: string): void {
  spawn("cmd", ["/c", "start", "", "/wait", installerPath], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  app.quit();
}

export { CHECK_INTERVAL_MS };
