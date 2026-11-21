import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateCheckResult, UpdateProgress } from "../../../shared/types";
import { compareVersions } from "./version";

const REPO_OWNER = "sgobiorodolfo170-ai";
const REPO_NAME = "gitool";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** 更新包下载目录。安装前必须校验路径落在此目录内，避免渲染层传入任意 exe。 */
const UPDATE_DIRECTORY_NAME = "gitool-updates";

/** Release 资产名后缀，用于从 assets 列表中挑出 Windows 安装包。 */
const SETUP_ASSET_SUFFIX = "-setup.exe";

/** 安装包静默安装参数（NSIS）。 */
const INSTALLER_SILENT_FLAG = "/S";

const HASH_ALGORITHM = "sha256";
/** GitHub Release digest 字段的算法前缀，形如 `sha256:<64 位 hex>`。 */
const DIGEST_PREFIX = `${HASH_ALGORITHM}:`;
/** sha256 摘要 = 32 字节 = 64 个十六进制字符。 */
const SHA256_HEX_LENGTH = 64;
const SHA256_HEX_PATTERN = /^[0-9a-f]+$/;

/**
 * 允许执行的安装包文件名白名单。
 *
 * why 需要白名单：路径前缀校验只能约束「目录」，不能约束「文件名」。临时目录是当前用户
 * 可写目录，同用户下的低权限进程可以往合法目录里投放任意 exe；若不加白名单，
 * `updater:install(<任意名字>.exe)` 依旧能把我们的更新目录当作投递点。
 *
 * 两种命名都放行，是因为项目存在两套产物命名：
 * - `gitool-setup-<版本>.exe`：更新源/历史产物的命名（resolveFileName 兜底也是这个形状）；
 * - `Gitool-<版本>-setup.exe`：electron-builder.yml 的 artifactName 模板
 *   `${productName}-${version}-setup.${ext}`，这是真实发布产物的名字。
 * 白名单只认这两类，其余（如 `evil.exe`、`setup.exe`）一律拒绝。
 */
const INSTALLER_FILENAME_PATTERNS: readonly RegExp[] = [
  /^gitool-setup-\d[\w.-]*\.exe$/i,
  /^gitool-\d[\w.-]*-setup\.exe$/i,
];

type ProgressCallback = (progress: UpdateProgress) => void;

/**
 * 本次 check 拿到的 Release 摘要（hex，已去掉 `sha256:` 前缀）。
 * 与 cachedInstallerPath 同生命周期：check 时写入，download 校验通过后才有对应的落盘路径。
 */
let cachedDigest = "";

/**
 * 通过摘要校验的安装包落盘路径。install 只接受它，确保「执行的文件」就是「校验过的文件」。
 */
let cachedInstallerPath = "";

export function getUpdateDirectory(): string {
  return join(app.getPath("temp"), UPDATE_DIRECTORY_NAME);
}

/**
 * 判断文件是否落在给定根目录内。
 *
 * why：直接比较字符串前缀会被 `..` 绕过（`%TEMP%\gitool-updates\..\evil.exe` 前缀仍然匹配），
 * 因此先 resolve 再求相对路径：跨盘时 relative 返回绝对路径、逃出根时以 `..` 开头，两者都判负。
 */
function isWithinDirectory(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function isInstallerFileName(fileName: string): boolean {
  return INSTALLER_FILENAME_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * 可信安装包根目录。临时下载目录为主，userData 下的同名子目录为备（后续把下载目录
 * 迁到 userData/tmp 时无需再改这里的判定）。
 */
function trustedInstallerRoots(): string[] {
  return [getUpdateDirectory(), join(app.getPath("userData"), UPDATE_DIRECTORY_NAME)];
}

/**
 * 判断路径是否为受信任的更新包（只做静态判定，不做 IO）。
 *
 * 背景：`updater:install` 的入参来自渲染层，若被 XSS 攻破即可传入任意 exe 路径并执行。
 * 这里做三道限制——文件名必须命中白名单、必须 resolve 后落在可信根内（防 `..` 穿越）、
 * 必须是 .exe（白名单已包含）。
 */
export function isTrustedInstallerPath(filePath: string): boolean {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return false;
  }
  const resolved = resolve(filePath);
  if (!isInstallerFileName(basename(resolved))) {
    return false;
  }
  return trustedInstallerRoots().some((root) => isWithinDirectory(resolved, resolve(root)));
}

/**
 * 解析 Release 的 digest 字段。
 *
 * why 严格校验格式：digest 是唯一的完整性锚点，若接受任意字符串（如被注入的前缀、截断的 hex），
 * 后续比较会退化成「永远不等」或「永远相等」。无法解析时返回 null，调用方按「缺失」处理（拒装）。
 */
function parseSha256Digest(rawDigest: unknown): string | null {
  if (typeof rawDigest !== "string") {
    return null;
  }
  const normalized = rawDigest.trim().toLowerCase();
  if (!normalized.startsWith(DIGEST_PREFIX)) {
    return null;
  }
  const hex = normalized.slice(DIGEST_PREFIX.length);
  if (hex.length !== SHA256_HEX_LENGTH || !SHA256_HEX_PATTERN.test(hex)) {
    return null;
  }
  return hex;
}

/**
 * 流式计算文件 sha256，避免把上百 MB 安装包整包读进内存。
 * 用 for await 逐块喂给 hash，内存占用只与单块大小相关。
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash(HASH_ALGORITHM);
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  // fetch 必须带超时：挂起的连接会让 30 分钟轮询任务持续堆叠（审查 P2-17）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Gitool-Updater",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return { hasUpdate: false, version: currentVersion, downloadUrl: "" };
    }
    const body = (await response.json()) as {
      tag_name?: string;
      assets?: Array<{ name?: string; browser_download_url?: string; digest?: string | null }>;
    };
    const latestTag = body.tag_name ?? "";
    const asset = body.assets?.find((item) => item.name?.endsWith(SETUP_ASSET_SUFFIX));
    const downloadUrl = asset?.browser_download_url ?? "";
    // 旧实现丢弃了 digest（审查 P-03 / A-02），下载链路因此没有任何完整性锚点。
    cachedDigest = parseSha256Digest(asset?.digest) ?? "";
    const hasUpdate = compareVersions(currentVersion, latestTag) < 0;
    return {
      hasUpdate,
      version: latestTag.replace(/^[vV]/, ""),
      downloadUrl,
    };
  } catch {
    return { hasUpdate: false, version: currentVersion, downloadUrl: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 下载更新包并校验完整性。
 *
 * 用 pipeline 把响应流直接写盘，而不是把整包读进内存再 Buffer.concat：
 * 安装包约 100MB，旧实现的内存峰值会翻倍，且 `writer.write()` 后立即 `close()`
 * 没有等待 `finish`，大文件可能被截断。
 *
 * 安全默认（A-02）：上游未提供可用 digest 时直接拒装——没有摘要就无法证明下载内容
 * 就是发布产物，宁可让用户手动更新，也不能把任意二进制当作安装包执行。
 */
export async function downloadUpdate(
  downloadUrl: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const tempDir = getUpdateDirectory();
  mkdirSync(tempDir, { recursive: true });

  const fileName = resolveFileName(downloadUrl);
  const filePath = join(tempDir, fileName);

  // 新一次下载开始即作废上次的已验证路径，避免「下了一半的旧文件」被安装。
  cachedInstallerPath = "";
  if (!cachedDigest) {
    throw new Error(
      "上游 Release 未提供 sha256 摘要，无法校验更新包完整性，已按安全默认拒绝安装；" +
        "请前往发布页手动下载并核对摘要",
    );
  }
  const expectedDigest = cachedDigest;

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

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(filePath),
    );
  } catch (error) {
    // why：中途断流/磁盘写失败会留下半包文件（大文件尤其常见），既占空间又会污染下次
    // 同名下载的进度判断。清理时用 catch 吞掉 rm 自身的失败并保留原始错误——
    // 否则「删除失败」会顶掉真正的原因（网络中断/磁盘满），把排障方向带偏。
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }

  const actualDigest = await sha256File(filePath);
  if (actualDigest !== expectedDigest) {
    // 不一致说明下载内容被替换/损坏：删包，不给后续 install 留任何可执行物。
    await rm(filePath, { force: true });
    throw new Error(
      `更新包摘要校验失败（期望 sha256:${expectedDigest.slice(0, 12)}…，` +
        `实际 sha256:${actualDigest.slice(0, 12)}…），已删除下载文件并拒绝安装`,
    );
  }

  cachedInstallerPath = resolve(filePath);
  onProgress?.({ percent: 100, downloaded, total });
  return filePath;
}

/**
 * 从下载链接推导本地文件名。
 * 用 pathname 而非 split("/")，避免把 `?token=...` 之类的查询串带进文件名。
 *
 * why 回退：非法字符（空格、中文、`%` 编码等）会被清洗成 `_`，可能得到不命中安装白名单的名字；
 * 安装侧是 fail-closed 的，届时下载能成功却永远装不上，用户就彻底失去自动更新能力。
 * 落盘名只是本地别名，不参与信任判定——完整性由 digest 校验、可执行性由
 * cachedInstallerPath 身份校验共同保证，因此回退成标准产物名不会引入新的信任面。
 */
function resolveFileName(downloadUrl: string): string {
  let candidate = "";
  try {
    candidate = new URL(downloadUrl).pathname.split("/").pop() ?? "";
  } catch {
    candidate = downloadUrl.split("/").pop() ?? "";
  }
  const sanitized = candidate.replace(/[^A-Za-z0-9._-]/g, "_");
  if (sanitized.length > 0 && isInstallerFileName(sanitized)) {
    return sanitized;
  }
  return standardInstallerFileName();
}

/**
 * 标准产物名（带时间戳保证同目录多版本不互相覆盖）。
 * 形状必须命中 INSTALLER_FILENAME_PATTERNS 的第一条，否则 install 会拒绝。
 */
function standardInstallerFileName(): string {
  return `gitool-setup-${Date.now()}.exe`;
}

/**
 * 启动安装程序并退出应用。
 *
 * why 不再经过 `cmd /c start`：命令行拼接会把文件名里的 `&`、`^`、`|` 等元字符解释成
 * 命令分隔符，等于给渲染层留了一条命令注入通道。直接 spawn 安装包本身 + `shell: false`
 * 后，参数按 argv 传递、不经过任何 shell 解析，注入面消失。
 *
 * why 用 "spawn" 事件而不是直接 resolve：spawn 同步返回不代表进程真的起来了
 * （ENOENT/EACCES 走异步 "error" 事件）。只有收到 "spawn" 才算拉起成功，
 * 此时再 unref 让安装进程脱离主进程存活，然后退出应用。
 */
export async function installUpdate(installerPath: string): Promise<void> {
  const resolved = resolve(installerPath);
  if (!isTrustedInstallerPath(resolved)) {
    throw new Error("安装包路径不受信任，已拒绝执行");
  }
  if (!existsSync(resolved)) {
    throw new Error(`安装包不存在，已拒绝执行：${basename(resolved)}`);
  }
  // 只执行本次下载并通过摘要校验的那个文件，避免渲染层把可信目录里的其他 exe 当安装包提交。
  if (!cachedInstallerPath || resolve(cachedInstallerPath) !== resolved) {
    throw new Error("安装包与本次校验通过的下载记录不匹配，已拒绝执行");
  }

  const spawnTask = new Promise<void>((resolveSpawn, rejectSpawn) => {
    const child = spawn(resolved, [INSTALLER_SILENT_FLAG], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("spawn", () => {
      child.unref();
      resolveSpawn();
    });
    // error 不得静默：转成可读错误 reject 给调用方，避免「点了安装但什么都没发生」。
    child.once("error", (error: Error) => {
      rejectSpawn(new Error(`启动安装程序失败：${error.message}`));
    });
  });

  // 防御性兜底：ipc.ts 的 updater:install handler 目前没有 await 本函数（不在本次改动范围），
  // 未附加处理器的话 reject 会变成主进程未处理拒绝。这里只记录日志，错误仍会返回给 await 的调用方。
  spawnTask.catch((error: unknown) => {
    console.error("[updater] 安装程序启动失败", error);
  });

  await spawnTask;
  app.quit();
}

export { CHECK_INTERVAL_MS };
