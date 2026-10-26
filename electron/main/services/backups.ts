import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { BackupCreateInput, BackupRecord, BackupRestoreInput } from "../../../shared/types";
import { insertBackup, loadSettings } from "./storage";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export async function createBackup(input: BackupCreateInput): Promise<BackupRecord> {
  const now = new Date().toISOString();
  // 文件名必须精确到秒：曾只截取到日期，同一天对同一项目重复备份会静默覆盖前一个 zip，
  // 而数据库里却插入两条指向同一文件的记录。
  const archiveName = `${sanitizeFileName(input.projectName)}-${formatTimestamp(now)}.zip`;
  const archivePath = join(input.targetDirectory, archiveName);

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
    const patterns = settings.backupExcludePatterns
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (patterns.length > 0) {
      args.push("--exclude", patterns.join(","));
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

export async function restoreBackup(input: BackupRestoreInput): Promise<void> {
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
  return iso.replace(/\.\d+Z$/, "").replace("T", "_").replace(/:/g, "-");
}

function parentOf(target: string): string {
  const normalized = target.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index === -1 ? "." : normalized.slice(0, index);
}

function assertDirectory(target: string): void {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new Error("源路径不存在或无法访问");
  }
  if (!stats.isDirectory()) {
    throw new Error("源路径不是目录");
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}