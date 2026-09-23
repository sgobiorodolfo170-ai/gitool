import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type { Account, CreateAccountInput, Project, RemoteProvider } from "../../../shared/types";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
