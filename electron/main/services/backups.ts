import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { BackupCreateInput, BackupRecord, BackupRestoreInput } from "../../../shared/types";
import { insertBackup } from "./storage";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export async function createBackup(input: BackupCreateInput): Promise<BackupRecord> {
  const now = new Date().toISOString();
  const archiveName = `${sanitizeFileName(input.projectName)}-${now.replace(/[:.]/g, "-").slice(0, 10)}.zip`;
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
    await execFileAsync(
      "tar",
      ["-a", "-c", "-f", archivePath, "-C", parentDirectory, "--exclude", ".git/*", folderName],
      { windowsHide: true, maxBuffer: MAX_BUFFER },
    );
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

function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function parentOf(target: string): string {
  const normalized = target.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index === -1 ? "." : normalized.slice(0, index);
}

function assertDirectory(target: string): void {
  const stats = statSync(target);
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