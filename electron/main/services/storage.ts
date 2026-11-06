import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Account,
  AppSettings,
  BackupRecord,
  OperationRecord,
  RemoteProvider,
  RemoteRepository,
  TaskProfile,
  TaskRun,
} from "../../../shared/types";
import { deleteCredential, readCredential, saveCredential } from "./credentials";
import { buildOperationRecordsCsv } from "./operationCsv";
import { errorMessage } from "./serviceUtils";
import { openDatabase, parseStringArray, type SqlRow } from "./storage/database";

export function loadAccounts(): Account[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, provider, username, displayName, authType, credentialRef, status, scopes,
              lastCheckedAt, createdAt, updatedAt
       FROM accounts ORDER BY updatedAt DESC`,
    )
    .all() as unknown as SqlRow[];

  return rows.map(rowToAccount);
}

export function getAccount(accountId: string): Account {
  const connection = openDatabase();
  const row = connection
    .prepare(
      `SELECT id, provider, username, displayName, authType, credentialRef, status, scopes,
              lastCheckedAt, createdAt, updatedAt
       FROM accounts WHERE id = ?`,
    )
    .get(accountId) as unknown as SqlRow | undefined;

  if (!row) {
    throw new Error("账号不存在");
  }
  return rowToAccount(row);
}

export function upsertAccount(provider: RemoteProvider, username: string, token: string): Account {
  const trimmedToken = token.trim();
  if (trimmedToken.length === 0) {
    throw new Error("令牌不能为空");
  }
  if (!isRemoteProvider(provider)) {
    throw new Error("不支持的远程平台");
  }

  const existing = findAccountByProviderUsername(provider, username);
  if (existing) {
    const currentToken = readCredential(existing.credentialRef);
    if (currentToken === trimmedToken) {
      return existing;
    }
    saveCredential(existing.credentialRef, trimmedToken);
    const now = new Date().toISOString();
    updateAccount(existing.id, { status: "active", lastCheckedAt: now });
    return getAccount(existing.id);
  }

  const now = new Date().toISOString();
  const id = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const credentialRef = `account-${id}`;
  saveCredential(credentialRef, trimmedToken);

  const account: Account = {
    id,
    provider,
    username,
    displayName: username,
    authType: "pat",
    credentialRef,
    status: "active",
    scopes: [],
    lastCheckedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const connection = openDatabase();
    connection
      .prepare(
        `INSERT INTO accounts
         (id, provider, username, displayName, authType, credentialRef, status, scopes,
          lastCheckedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.id,
        account.provider,
        account.username,
        account.displayName,
        account.authType,
        account.credentialRef,
        account.status,
        JSON.stringify(account.scopes),
        account.lastCheckedAt ?? null,
        account.createdAt,
        account.updatedAt,
      );
  } catch (error) {
    deleteCredential(credentialRef);
    throw new Error(`本地数据存储失败：${errorMessage(error)}`);
  }

  return account;
}

function findAccountByProviderUsername(provider: string, username: string): Account | null {
  const connection = openDatabase();
  const row = connection
    .prepare(
      `SELECT id, provider, username, displayName, authType, credentialRef, status, scopes,
              lastCheckedAt, createdAt, updatedAt
       FROM accounts WHERE provider = ? AND username = ?`,
    )
    .get(provider, username) as unknown as SqlRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function updateAccount(accountId: string, patch: Partial<Account>): void {
  const connection = openDatabase();
  const current = getAccount(accountId);
  const next: Account = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };

  connection
    .prepare(
      `UPDATE accounts SET username = ?, status = ?, scopes = ?, lastCheckedAt = ?, updatedAt = ?
       WHERE id = ?`,
    )
    .run(
      next.username,
      next.status,
      JSON.stringify(next.scopes),
      next.lastCheckedAt ?? null,
      next.updatedAt,
      next.id,
    );
}

export function deleteAccount(accountId: string): void {
  const account = getAccount(accountId);
  deleteCredential(account.credentialRef);
  const connection = openDatabase();
  connection.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  // 同步清掉该账号的仓库缓存，否则删号后仍残留一份完整仓库列表。
  connection.prepare("DELETE FROM remote_repository_cache WHERE accountId = ?").run(accountId);
}

function rowToAccount(row: SqlRow): Account {
  return {
    id: String(row.id),
    provider: String(row.provider) as RemoteProvider,
    username: String(row.username),
    displayName: String(row.displayName),
    authType: String(row.authType) as Account["authType"],
    credentialRef: String(row.credentialRef),
    status: String(row.status) as Account["status"],
    scopes: parseStringArray(row.scopes),
    lastCheckedAt: row.lastCheckedAt === null ? null : String(row.lastCheckedAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function isRemoteProvider(value: string): value is RemoteProvider {
  return value === "github" || value === "gitee" || value === "gitlab";
}

export function listTaskProfiles(): TaskProfile[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, projectId, projectPath, taskType, name, command, args, workingDirectory, timeoutSeconds, createdAt
       FROM task_profiles ORDER BY createdAt DESC`,
    )
    .all() as unknown as SqlRow[];
  return rows.map(rowToTaskProfile);
}

export function getTaskProfile(profileId: string): TaskProfile | undefined {
  const connection = openDatabase();
  const row = connection
    .prepare(`SELECT * FROM task_profiles WHERE id = ?`)
    .get(profileId) as unknown as SqlRow | undefined;
  return row ? rowToTaskProfile(row) : undefined;
}

export function saveTaskProfile(input: TaskProfile): TaskProfile {
  const connection = openDatabase();
  const existing = connection.prepare("SELECT id FROM task_profiles WHERE id = ?").get(input.id) as
    SqlRow | undefined;
  if (existing) {
    connection
      .prepare(
        `UPDATE task_profiles SET projectId = ?, projectPath = ?, taskType = ?, name = ?, command = ?,
         args = ?, workingDirectory = ?, timeoutSeconds = ? WHERE id = ?`,
      )
      .run(
        input.projectId,
        input.projectPath,
        input.taskType,
        input.name,
        input.command,
        input.args,
        input.workingDirectory,
        input.timeoutSeconds,
        input.id,
      );
  } else {
    connection
      .prepare(
        `INSERT INTO task_profiles
         (id, projectId, projectPath, taskType, name, command, args, workingDirectory, timeoutSeconds, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.projectPath,
        input.taskType,
        input.name,
        input.command,
        input.args,
        input.workingDirectory,
        input.timeoutSeconds,
        input.createdAt,
      );
  }
  return input;
}

export function deleteTaskProfile(profileId: string): void {
  const connection = openDatabase();
  connection.prepare("DELETE FROM task_profiles WHERE id = ?").run(profileId);
}

export function listTaskRuns(): TaskRun[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, profileId, projectId, name, command, startedAt, finishedAt, status, exitCode, output
       FROM task_runs ORDER BY startedAt DESC LIMIT 200`,
    )
    .all() as unknown as SqlRow[];
  return rows.map(rowToTaskRun);
}

export function insertTaskRun(run: TaskRun): void {
  const connection = openDatabase();
  connection
    .prepare(
      `INSERT INTO task_runs (id, profileId, projectId, name, command, startedAt, finishedAt, status, exitCode, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.profileId,
      run.projectId,
      run.name,
      run.command,
      run.startedAt,
      run.finishedAt ?? null,
      run.status,
      run.exitCode ?? null,
      run.output,
    );
}

export function updateTaskRun(run: TaskRun): void {
  const connection = openDatabase();
  connection
    .prepare(
      `UPDATE task_runs SET finishedAt = ?, status = ?, exitCode = ?, output = ? WHERE id = ?`,
    )
    .run(run.finishedAt ?? null, run.status, run.exitCode ?? null, run.output, run.id);
}

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

function rowToTaskProfile(row: SqlRow): TaskProfile {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    projectPath: String(row.projectPath),
    taskType: String(row.taskType) as TaskProfile["taskType"],
    name: String(row.name),
    command: String(row.command),
    args: String(row.args),
    workingDirectory: String(row.workingDirectory),
    timeoutSeconds: Number(row.timeoutSeconds),
    createdAt: String(row.createdAt),
  };
}

function rowToTaskRun(row: SqlRow): TaskRun {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    projectId: String(row.projectId),
    name: String(row.name),
    command: String(row.command),
    startedAt: String(row.startedAt),
    finishedAt: row.finishedAt === null ? undefined : String(row.finishedAt),
    status: String(row.status) as TaskRun["status"],
    exitCode: row.exitCode === null ? undefined : Number(row.exitCode),
    output: String(row.output),
  };
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
