import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { BackupCreateInput, BackupRecord, BackupRestoreInput } from "../../../shared/types";
import { requireAllowedBackupPath } from "./pathPolicy";
import { assertDirectory as assertDirectoryShared, errorMessage } from "./serviceUtils";
import { insertBackup } from "./storage/backups";
import { loadSettings } from "./storage/settings";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 备份必须排除的 git 配置文件（相对备份根目录）。
 *
 * why：`.git/config` 里可能残留明文凭据（`url = https://user:token@host/...` 的
 * 改写结果）以及 `includeIf` / `core.sshCommand` 指向的可执行 helper。备份包常被
 * 复制到网盘、发给同事或上传工单，把这类文件一起打进去等于把凭据外发，
 * 而备份本身只需要提交历史，不需要本机配置。
 *
 * 为什么同时写「带目录前缀」和「裸相对路径」两种形式：tar 在 Windows 上是
 * bsdtar，`--exclude` 模式按成员全名匹配（成员名带被测目录名前缀，如
 * `demo/.git/config`）；而 GNU tar 对含 `/` 的模式另有锚定规则。两种都列出，
 * 才能保证在任一种实现下都真的排掉（多余的模式只是不匹配，不会报错）。
 */
const GIT_CONFIG_EXCLUDES = [
  ".git/config",
  ".git/config.worktree",
  "*/.git/config",
  "*/.git/config.worktree",
] as const;

export async function createBackup(
  input: BackupCreateInput,
  sessionDirectories: readonly string[] = [],
): Promise<BackupRecord> {
  const now = new Date().toISOString();
  // 文件名必须精确到秒：曾只截取到日期，同一天对同一项目重复备份会静默覆盖前一个 zip，
  // 而数据库里却插入两条指向同一文件的记录。
  const archiveName = `${sanitizeFileName(input.projectName)}-${formatTimestamp(now)}.zip`;
  const archivePath = join(input.targetDirectory, archiveName);

  // why 先做语义准入再 assertDirectory：目标目录即使存在且可写，也不能是系统目录。
  // 这是 ipc 白名单之外的第二道门——本函数是导出 API，新增入口（任务调度/自动化）
  // 直接调用时不应重新暴露「把备份写进 C:\Windows\System32」的能力。
  assertAllowedBackupRoot(input.targetDirectory, "备份目录", sessionDirectories);
  assertDirectory(input.sourcePath);
  if (!isDirectoryWritable(input.targetDirectory)) {
    throw new Error("备份目录不存在或不可写");
  }

  const parentDirectory = parentOf(input.sourcePath);
  const folderName = basename(input.sourcePath);

  const record: BackupRecord = {
    id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: input.projectId,
    projectName: input.projectName,
    sourcePath: input.sourcePath,
    archivePath,
    sizeBytes: 0,
    status: "ok",
    createdAt: now,
  };

  try {
    const settings = loadSettings();
    // 不再硬编码排除 .git/*：README 承诺备份含提交历史，恢复后可直接导入。
    // 需要瘦身的用户可在「备份排除规则」里自行添加，规则完全交给用户配置。
    const args = ["-a", "-c", "-f", archivePath, "-C", parentDirectory];
    // 安全排除项先于用户规则加入：用户把「备份排除规则」清空也不能把凭据配置带进包里
    for (const pattern of GIT_CONFIG_EXCLUDES) {
      args.push("--exclude", pattern);
    }
    const patterns = settings.backupExcludePatterns
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    // tar 的 --exclude 每个参数只接受一个模式，必须逐条传：
    // 逗号拼接会被当成「字面量 node_modules,dist」单个模式，排除完全失效
    // （GNU tar 与 Windows bsdtar 行为一致，2026-11-07 审查 P1-1）。
    for (const pattern of patterns) {
      args.push("--exclude", pattern);
    }
    args.push(folderName);
    await execFileAsync("tar", args, { windowsHide: true, maxBuffer: MAX_BUFFER });
    record.sizeBytes = statSync(archivePath).size;
    insertBackup(record);
    return record;
  } catch (error) {
    record.status = "failed";
    record.error = errorMessage(error);
    insertBackup(record);
    throw new Error(`备份失败：${errorMessage(error)}`);
  }
}

export async function restoreBackup(
  input: BackupRestoreInput,
  sessionDirectories: readonly string[] = [],
): Promise<void> {
  // why 归档与目标都要过同一套备份根：归档是「读来源」、目标是「写去向」，
  // 两者都可能是渲染层直接构造的路径。只校验目标会让恢复从任意系统目录解包，
  // 只校验归档会让解包把文件铺进 C:\Windows\System32。
  assertAllowedBackupRoot(input.archivePath, "备份文件", sessionDirectories);
  assertAllowedBackupRoot(input.targetDirectory, "恢复目录", sessionDirectories);
  if (!isArchiveReadable(input.archivePath)) {
    throw new Error("备份文件不存在或不可读");
  }
  if (!isDirectoryWritable(input.targetDirectory)) {
    throw new Error("恢复目录不存在或不可写，请选择空目录");
  }
  if (hasEntries(input.targetDirectory)) {
    throw new Error("恢复目标目录不是空的，请选择空目录");
  }

  try {
    await execFileAsync("tar", ["-xf", input.archivePath, "-C", input.targetDirectory], {
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    throw new Error(`恢复失败：${errorMessage(error)}`);
  }
}

/**
 * 服务层兜底的备份路径语义校验。
 *
 * why 读设置而不复用 ipc 的 defaultBackupDirectory：服务层不能 import ipc（反向依赖会
 * 把 electron 拉进纯 Node 单测），因此在这里自行读一次设置；读取失败按 null 处理，
 * 与 ipc 的退化策略一致——仍保留「主目录 + 会话目录」两道放行面，不因配置损坏而放宽。
 *
 * why 需要 sessionDirectories 参数：允许根里的「会话选择目录」只存在于 ipc 进程状态，
 * 服务层拿不到；调用方必须显式透传，否则用户刚在对话框里选中的新目录会被误拒。
 */
function assertAllowedBackupRoot(
  target: string,
  label: string,
  sessionDirectories: readonly string[],
): void {
  let backupDirectory: string | null = null;
  try {
    backupDirectory = loadSettings().defaultBackupDirectory.trim() || null;
  } catch {
    // 数据库未初始化 / 配置损坏：退化为「主目录 + 会话目录」，与 ipc 行为对齐。
    backupDirectory = null;
  }
  requireAllowedBackupPath(target, { backupDirectory, extraRoots: sessionDirectories }, label);
}

/**
 * 清理文件名中的 Windows 非法字符。
 * 刻意保留中文：旧实现用 `[^A-Za-z0-9_.-]` 白名单，会把「我的项目」整串替换成下划线，
 * 备份文件名失去可读性。
 */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "project";
}

/** ISO 时间戳 → `2026-10-26_19-02-20`，保证同名项目同日多次备份互不覆盖。 */
function formatTimestamp(iso: string): string {
  return iso
    .replace(/\.\d+Z$/, "")
    .replace("T", "_")
    .replace(/:/g, "-");
}

function parentOf(target: string): string {
  const normalized = target.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index === -1 ? "." : normalized.slice(0, index);
}

/** 备份域统一「源路径」文案的目录断言（实现在 serviceUtils）。 */
function assertDirectory(target: string): void {
  assertDirectoryShared(target, "源路径");
}

function isDirectoryWritable(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isArchiveReadable(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function hasEntries(target: string): boolean {
  try {
    return readdirSync(target).length > 0;
  } catch {
    return true;
  }
}
