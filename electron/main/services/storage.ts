import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type { Account, AppSettings, BackupRecord, CreateAccountInput, OperationRecord, Project, RemoteProvider, TaskProfile, TaskRun } from "../../../shared/types";
import { deleteCredential, saveCredential } from "./credentials";

type SqlRow = Record<string, string | number | bigint | null | Uint8Array>;

let database: DatabaseSync | null = null;

export function loadProjects(): Project[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, name, path, provider, branch, status, commitHash, favorite, tags, remote,
              files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias
       FROM projects ORDER BY favorite DESC, updatedAt DESC, name ASC`,
    )
    .all() as unknown as SqlRow[];

  return rows.map(rowToProject);
}

export function saveProjects(projects: Project[]): void {
  const connection = openDatabase();
  connection.exec("BEGIN");
  try {
    connection.exec("DELETE FROM projects");
    const statement = connection.prepare(
      `INSERT INTO projects
       (id, name, path, provider, branch, status, commitHash, favorite, tags, remote,
        files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const project of projects) {
      statement.run(
        project.id,
        project.name,
        project.path,
        project.provider,
        project.branch,
        project.status,
        project.commit,
        project.favorite ? 1 : 0,
        JSON.stringify(project.tags),
        project.remote ?? null,
        project.files,
        project.syncLabel,
        project.language,
        project.languageColor,
        project.summary,
        project.updatedAt,
        project.diskSizeBytes ?? 0,
        project.alias ?? null,
      );
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw new Error(`本地数据存储失败：${errorMessage(error)}`);
  }
}

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

export function createAccount(input: CreateAccountInput): Account {
  const token = input.token.trim();
  if (token.length === 0) {
    throw new Error("令牌不能为空");
  }
  if (!isRemoteProvider(input.provider)) {
    throw new Error("不支持的远程平台");
  }

  const now = new Date().toISOString();
  const id = `${input.provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const credentialRef = `account-${id}`;
  saveCredential(credentialRef, token);

  const account: Account = {
    id,
    provider: input.provider,
    username: input.username.trim(),
    displayName: input.displayName.trim().length > 0 ? input.displayName.trim() : "未命名账号",
    authType: input.authType,
    credentialRef,
    status: "unknown",
    scopes: [],
    lastCheckedAt: null,
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
}

function openDatabase(): DatabaseSync {
  if (database) {
    return database;
  }
  const dataDirectory = app.getPath("userData");
  mkdirSync(dataDirectory, { recursive: true });
  const connection = new DatabaseSync(join(dataDirectory, "gitool.sqlite3"));
  connection.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      branch TEXT NOT NULL,
      status TEXT NOT NULL,
      commitHash TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      remote TEXT,
      files INTEGER NOT NULL DEFAULT 0,
      syncLabel TEXT NOT NULL,
      language TEXT NOT NULL,
      languageColor TEXT NOT NULL,
      summary TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      diskSizeBytes INTEGER NOT NULL DEFAULT 0,
      alias TEXT
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      username TEXT NOT NULL,
      displayName TEXT NOT NULL,
      authType TEXT NOT NULL,
      credentialRef TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      lastCheckedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      projectId TEXT NOT NULL,
      projectPath TEXT NOT NULL,
      taskType TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '',
      workingDirectory TEXT NOT NULL,
      timeoutSeconds INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY NOT NULL,
      profileId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      finishedAt TEXT,
      status TEXT NOT NULL,
      exitCode INTEGER,
      output TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY NOT NULL,
      projectId TEXT NOT NULL,
      projectName TEXT NOT NULL,
      sourcePath TEXT NOT NULL,
      archivePath TEXT NOT NULL,
      sizeBytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_records (
      id TEXT PRIMARY KEY NOT NULL,
      operation TEXT NOT NULL,
      projectId TEXT NOT NULL,
      projectPath TEXT NOT NULL,
      detail TEXT NOT NULL,
      result TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  migrationEnsureProjectColumns(connection);
  database = connection;
  return connection;
}

function migrationEnsureProjectColumns(connection: DatabaseSync): void {
  const columns = connection
    .prepare("PRAGMA table_info(projects)")
    .all() as unknown as Array<Record<string, unknown>>;
  if (!columns.some((column) => column.name === "diskSizeBytes")) {
    connection.exec("ALTER TABLE projects ADD COLUMN diskSizeBytes INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((column) => column.name === "alias")) {
    connection.exec("ALTER TABLE projects ADD COLUMN alias TEXT");
  }
}

function rowToProject(row: SqlRow): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    provider: String(row.provider) as Project["provider"],
    branch: String(row.branch),
    status: String(row.status) as Project["status"],
    commit: String(row.commitHash),
    favorite: Number(row.favorite) !== 0,
    tags: parseStringArray(row.tags),
    remote: row.remote === null ? undefined : String(row.remote),
    files: Number(row.files),
    syncLabel: String(row.syncLabel),
    language: String(row.language),
    languageColor: String(row.languageColor),
    summary: String(row.summary),
    updatedAt: String(row.updatedAt),
    diskSizeBytes: Number(row.diskSizeBytes ?? 0),
    alias: row.alias === null || row.alias === undefined ? undefined : String(row.alias),
  };
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

function parseStringArray(value: string | number | bigint | null | Uint8Array | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
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
  const existing = connection.prepare("SELECT id FROM task_profiles WHERE id = ?").get(input.id) as SqlRow | undefined;
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

export function listOperationRecords(): OperationRecord[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, operation, projectId, projectPath, detail, result, createdAt
       FROM operation_records ORDER BY createdAt DESC LIMIT 500`,
    )
    .all() as unknown as SqlRow[];
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
}

export function clearOperationRecords(): void {
  const connection = openDatabase();
  connection.exec("DELETE FROM operation_records");
}

export function exportOperationRecords(directory: string): string {
  const records = listOperationRecords();
  const fileName = `gitool-operations-${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = join(directory, fileName);
  const header = "id,operation,projectId,projectPath,result,createdAt,detail\n";
  const rows = records.map((record) => [
    record.id,
    csvEscape(record.operation),
    record.projectId,
    csvEscape(record.projectPath),
    record.result,
    record.createdAt,
    csvEscape(record.detail),
  ].join(",")).join("\n");
  writeFileSync(filePath, header + rows + "\n", { encoding: "utf8" });
  return filePath;
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function loadSettings(): AppSettings {
  const connection = openDatabase();
  const rows = connection
    .prepare("SELECT key, value FROM settings")
    .all() as unknown as SqlRow[];
  const values = new Map<string, string>();
  for (const row of rows) {
    values.set(String(row.key), String(row.value));
  }
  return {
    gitPath: values.get("gitPath") ?? "",
    defaultProjectDirectory: values.get("defaultProjectDirectory") ?? "",
    defaultBackupDirectory: values.get("defaultBackupDirectory") ?? "",
    backupExcludePatterns: values.get("backupExcludePatterns") ?? "",
    aiApiKey: values.get("aiApiKey") ?? "",
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
    statement.run("aiApiKey", settings.aiApiKey);
    statement.run("aiModel", settings.aiModel);
    statement.run("aiBaseUrl", settings.aiBaseUrl);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw new Error(`保存设置失败：${errorMessage(error)}`);
  }
}
