import type { BackupRecord } from "../../../../shared/types";
import { openDatabase, rowToBackup, type SqlRow } from "./database";

/**
 * 备份数据域：备份记录列表与写入。
 * 记录由备份服务在压缩完成后写入；列表按创建时间倒序供 UI 直接展示。
 */

export function listBackups(): BackupRecord[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, projectId, projectName, sourcePath, archivePath, sizeBytes, status, error, createdAt
       FROM backup_records ORDER BY createdAt DESC`,
    )
    .all() as unknown as SqlRow[];
  return rows.map(rowToBackup);
}

export function insertBackup(record: BackupRecord): void {
  const connection = openDatabase();
  connection
    .prepare(
      `INSERT INTO backup_records (id, projectId, projectName, sourcePath, archivePath, sizeBytes, status, error, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.projectId,
      record.projectName,
      record.sourcePath,
      record.archivePath,
      record.sizeBytes,
      record.status,
      record.error ?? null,
      record.createdAt,
    );
}
