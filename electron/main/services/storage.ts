import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppSettings,
  BackupRecord,
  OperationRecord,
  RemoteProvider,
  RemoteRepository,
} from "../../../shared/types";
import { buildOperationRecordsCsv } from "./operationCsv";
import { errorMessage } from "./serviceUtils";
import { openDatabase, type SqlRow } from "./storage/database";

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

function rowToBackup(row: SqlRow): BackupRecord {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    projectName: String(row.projectName),
    sourcePath: String(row.sourcePath),
    archivePath: String(row.archivePath),
    sizeBytes: Number(row.sizeBytes),
    status: String(row.status) as BackupRecord["status"],
    error: row.error === null ? undefined : String(row.error),
    createdAt: String(row.createdAt),
  };
}

function rowToOperationRecord(row: SqlRow): OperationRecord {
  return {
    id: String(row.id),
    operation: String(row.operation),
    projectId: String(row.projectId),
    projectPath: String(row.projectPath),
    detail: String(row.detail),
    result: String(row.result) as OperationRecord["result"],
    createdAt: String(row.createdAt),
  };
}

export function listOperationRecords(limit = 500): OperationRecord[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, operation, projectId, projectPath, detail, result, createdAt
       FROM operation_records ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(limit) as unknown as SqlRow[];
  return rows.map(rowToOperationRecord);
}

export function insertOperationRecord(record: OperationRecord): void {
  const connection = openDatabase();
  connection
    .prepare(
      `INSERT INTO operation_records (id, operation, projectId, projectPath, detail, result, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.operation,
      record.projectId,
      record.projectPath,
      record.detail,
      record.result,
      record.createdAt,
    );
  // 只保留最近 2000 条：界面只读 500 条，历史记录无限增长会拖慢启动与查询。
  connection
    .prepare(
      `DELETE FROM operation_records WHERE id IN (
         SELECT id FROM operation_records ORDER BY createdAt DESC LIMIT -1 OFFSET 2000
       )`,
    )
    .run();
}

export function clearOperationRecords(): void {
  const connection = openDatabase();
  connection.exec("DELETE FROM operation_records");
}

export function exportOperationRecords(directory: string): string {
  // 导出全量（库内保留上限 2000 条）：列表页只读 500 条是 UI 策略，
  // 导出截断会让用户误以为导出了全部历史（2026-11-07 审查 P2-10）。
  const records = listOperationRecords(2000);
  const fileName = `gitool-operations-${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = join(directory, fileName);
  // UTF-8 BOM：无 BOM 时中文 Windows 的 Excel 会按 ANSI 解码导致乱码
  writeFileSync(filePath, "\uFEFF" + buildOperationRecordsCsv(records), { encoding: "utf8" });
  return filePath;
}

export function loadSettings(): AppSettings {
  const connection = openDatabase();
  const rows = connection.prepare("SELECT key, value FROM settings").all() as unknown as SqlRow[];
  const values = new Map<string, string>();
  for (const row of rows) {
    values.set(String(row.key), String(row.value));
  }
  return {
    gitPath: values.get("gitPath") ?? "",
    defaultProjectDirectory: values.get("defaultProjectDirectory") ?? "",
    defaultBackupDirectory: values.get("defaultBackupDirectory") ?? "",
    backupExcludePatterns: values.get("backupExcludePatterns") ?? "",
    defaultSearchAccountId: values.get("defaultSearchAccountId") ?? "",
    aiApiKeyConfigured: values.get("aiApiKeyConfigured") === "1",
    aiModel: values.get("aiModel") ?? "",
    aiBaseUrl: values.get("aiBaseUrl") ?? "",
  };
}

export function saveSettings(settings: AppSettings): void {
  const connection = openDatabase();
  connection.exec("BEGIN");
  try {
    const statement = connection.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    statement.run("gitPath", settings.gitPath);
    statement.run("defaultProjectDirectory", settings.defaultProjectDirectory);
    statement.run("defaultBackupDirectory", settings.defaultBackupDirectory);
    statement.run("backupExcludePatterns", settings.backupExcludePatterns);
    statement.run("defaultSearchAccountId", settings.defaultSearchAccountId);
    statement.run("aiApiKeyConfigured", settings.aiApiKeyConfigured ? "1" : "0");
    statement.run("aiModel", settings.aiModel);
    statement.run("aiBaseUrl", settings.aiBaseUrl);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw new Error(`保存设置失败：${errorMessage(error)}`);
  }
}

export function saveRemoteRepositoryCache(
  accountId: string,
  provider: RemoteProvider,
  repositories: RemoteRepository[],
): void {
  const connection = openDatabase();
  connection
    .prepare(
      `INSERT INTO remote_repository_cache (accountId, provider, payload, syncedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET
        provider = excluded.provider, payload = excluded.payload, syncedAt = excluded.syncedAt`,
    )
    .run(accountId, provider, JSON.stringify(repositories), new Date().toISOString());
}

export function loadRemoteRepositoryCache(accountId: string): RemoteRepository[] | null {
  const connection = openDatabase();
  const row = connection
    .prepare("SELECT payload FROM remote_repository_cache WHERE accountId = ?")
    .get(accountId) as unknown as SqlRow | undefined;
  if (!row || typeof row.payload !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return Array.isArray(parsed) ? (parsed as RemoteRepository[]) : null;
  } catch {
    return null;
  }
}

export function getRemoteRepositoryCacheMeta(accountId: string): { syncedAt: string } | null {
  const connection = openDatabase();
  const row = connection
    .prepare("SELECT syncedAt FROM remote_repository_cache WHERE accountId = ?")
    .get(accountId) as unknown as SqlRow | undefined;
  if (!row || row.syncedAt === null) {
    return null;
  }
  return { syncedAt: String(row.syncedAt) };
}
