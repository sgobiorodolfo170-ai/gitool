import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Account,
  BackupRecord,
  OperationRecord,
  Project,
  RemoteProvider,
  TaskProfile,
  TaskRun,
  WorkspaceEntity,
} from "../../../../shared/types";
import { errorMessage } from "../serviceUtils";

export type SqlRow = Record<string, string | number | bigint | null | Uint8Array>;

export const DATABASE_FILE_NAME = "gitool.sqlite3";

const DEFAULT_WORKSPACE_ID = "default";

/**
 * 存储层公共基座：唯一的连接入口与 schema 归属。
 *
 * 拆分原因：storage.ts 曾同时管理九个数据域（929 行），任何域的改动都
 * 挤在同一个文件里；域模块（workspaces/projects/...）只通过 openDatabase()
 * 取连接，schema、迁移与行映射统一收在本文件，保证建表与迁移只有一份。
 *
 * 依赖方向：域模块 → 本文件，单向；域之间禁止横向 import。
 */

// 模块级连接：首次 openDatabase() 惰性打开，整个进程复用。
// 测试用 initDatabase(dataDir) 注入临时目录、closeDatabase() 释放，
// 二者即测试的完整生命周期钩子，无需 mock electron。
let database: DatabaseSync | null = null;
// 显式注入的数据目录（initDatabase 设置）；null = 走默认路径（主进程原有行为）。
let dataDirectoryOverride: string | null = null;

export function openDatabase(): DatabaseSync {
  if (database) {
    return database;
  }
  const dataDirectory = dataDirectoryOverride ?? defaultDataDirectory();
  mkdirSync(dataDirectory, { recursive: true });
  const connection = new DatabaseSync(join(dataDirectory, DATABASE_FILE_NAME));
  connection.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
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
      alias TEXT,
      webUrl TEXT,
      workspaceId TEXT NOT NULL DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS remote_repository_cache (
      accountId TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      payload TEXT NOT NULL,
      syncedAt TEXT NOT NULL
    );
  `);
  migrationEnsureProjectColumns(connection);
  migrationEnsureWorkspaceColumns(connection);
  migrationDropPathUniqueConstraint(connection);
  seedDefaultWorkspace(connection);
  // 索引统一放在所有迁移之后创建：DROP TABLE 会连带删除其索引，
  // 若在迁移前建索引，迁移过的库会永久丢失索引并退化为全表扫描。
  ensureIndexes(connection);
  database = connection;
  return connection;
}

/**
 * 显式初始化数据库：注入数据目录并立即打开，返回连接。
 *
 * 设计动机：数据目录原 hard-code 自 electron 的 app.getPath("userData")，
 * 导致依赖 electron 的服务层完全不可单测。改为模块级可注入后，测试传
 * mkdtemp 临时目录即可，不传参数则回退默认路径——主进程不显式初始化时
 * 行为与拆分前一致（首次调用惰性打开 userData）。
 * 重复初始化先关旧连接再开新：测试的 beforeEach/afterEach 由此获得
 * 确定性的生命周期，不依赖调用顺序。
 */
export function initDatabase(dataDir?: string): DatabaseSync {
  closeDatabase();
  dataDirectoryOverride = dataDir ?? null;
  return openDatabase();
}

/** 关闭并丢弃当前连接。测试 afterEach 必须先调它再删临时目录（Windows 文件锁）。 */
export function closeDatabase(): void {
  if (!database) {
    return;
  }
  database.close();
  database = null;
}

function defaultDataDirectory(): string {
  // 为什么延迟 require 而非顶层 import { app }：纯 Node 环境（vitest）里
  // electron 包的导出是二进制路径字符串，没有具名导出 app，顶层 import 会让
  // 所有域模块在测试下直接加载失败（"does not provide an export named 'app'"，
  // vite.config.ts 头部有同因注释）。测试通过 initDatabase 注入目录，永远不会
  // 走到这里；主进程首次惰性打开时才解析，行为不变。
  const electron: unknown = require("electron");
  const app = (electron as { app?: { getPath(name: string): string } }).app;
  if (!app) {
    throw new Error("无法获取 electron 应用数据目录，请先调用 initDatabase(dataDir) 注入");
  }
  return app.getPath("userData");
}

function ensureIndexes(connection: DatabaseSync): void {
  // why idx_projects_path：每次 Git 操作（commit/pull/clone…）落审计记录时都要按绝对路径
  // 反查项目归组（operations.resolveProjectIdByPath → projects.findByPath）；无索引时
  // projects 表每次都要全表扫描。按 path 建索引后该反查是索引单点查询。
  // CREATE INDEX IF NOT EXISTS 幂等：新库直接建，老库下次启动补齐，无需数据迁移。
  connection.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspaceId);
    CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
    CREATE INDEX IF NOT EXISTS idx_operation_records_createdAt ON operation_records(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_startedAt ON task_runs(startedAt DESC);
  `);
}

function migrationEnsureWorkspaceColumns(connection: DatabaseSync): void {
  // P-35：行形状断言统一走 asSqlRow，替代 as unknown as
  const columns = connection.prepare("PRAGMA table_info(projects)").all().map(asSqlRow);
  if (!columns.some((column) => column.name === "workspaceId")) {
    connection.exec(
      `ALTER TABLE projects ADD COLUMN workspaceId TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`,
    );
  }
}

function seedDefaultWorkspace(connection: DatabaseSync): void {
  const count = asSqlRow(connection.prepare("SELECT COUNT(*) AS total FROM workspaces").get());
  if (Number(count.total) > 0) {
    return;
  }
  const now = new Date().toISOString();
  connection
    .prepare(`INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`)
    .run(DEFAULT_WORKSPACE_ID, "个人工作区", now, now);
}

function migrationEnsureProjectColumns(connection: DatabaseSync): void {
  const columns = connection.prepare("PRAGMA table_info(projects)").all().map(asSqlRow);
  if (!columns.some((column) => column.name === "diskSizeBytes")) {
    connection.exec("ALTER TABLE projects ADD COLUMN diskSizeBytes INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((column) => column.name === "alias")) {
    connection.exec("ALTER TABLE projects ADD COLUMN alias TEXT");
  }
  if (!columns.some((column) => column.name === "webUrl")) {
    connection.exec("ALTER TABLE projects ADD COLUMN webUrl TEXT");
  }
}

function migrationDropPathUniqueConstraint(connection: DatabaseSync): void {
  const rawRow = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'")
    .get();
  const row = rawRow === undefined ? undefined : asSqlRow(rawRow);
  if (!row || typeof row.sql !== "string") return;
  if (!row.sql.includes("path TEXT NOT NULL UNIQUE")) return;
  // 整段包进事务：重建表涉及 CREATE / INSERT / DROP / RENAME 四步，
  // 中途失败会留下半成品表，用户数据将无法读取。
  connection.exec("BEGIN");
  try {
    connection.exec(`
    CREATE TABLE projects_migration (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
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
      alias TEXT,
      webUrl TEXT,
      workspaceId TEXT NOT NULL DEFAULT 'default'
    );
    INSERT INTO projects_migration (id, name, path, provider, branch, status, commitHash, favorite, tags, remote, files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias, webUrl, workspaceId)
    SELECT id, name, path, provider, branch, status, commitHash, favorite, tags, remote, files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias, webUrl, workspaceId FROM projects;
    DROP TABLE projects;
    ALTER TABLE projects_migration RENAME TO projects;
  `);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw new Error(`数据库迁移失败：${errorMessage(error)}`);
  }
}

/** 把 SQLite 存的 JSON 字符串数组安全还原为 string[]，坏数据一律归空而非抛错。 */
export function parseStringArray(
  value: string | number | bigint | null | Uint8Array | undefined,
): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** 行 → 领域对象映射统一收在此处：与建表列一一对应，schema 变更时同步修改。 */

/**
 * 行形状运行时断言（P-35 第三阶段）：替代各域模块的 `.all() as unknown as SqlRow[]`。
 *
 * why 需要运行时收口：node:sqlite 的 all()/get() 返回 unknown。原先的
 * `as unknown as SqlRow[]` 把「驱动返回异常形状」的故障全部吞掉——列名写错时
 * row.xxx 得到 undefined，String(undefined) 静默落成字符串 "undefined" 进库/上屏。
 * 这里做最小形状校验：非 null 对象、非数组；列级类型由 assertText/IntegerColumn 负责。
 */
export function asSqlRow(value: unknown): SqlRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("数据库行形状异常：期望对象行，收到 " + Object.prototype.toString.call(value));
  }
  return value as SqlRow;
}

/**
 * 必填 TEXT 列断言：列缺失（undefined）或类型异常时抛出带列名的错误。
 * 列缺失是 schema/查询写错的信号，必须 fail-fast，而不是落成 "undefined"。
 */
export function assertTextColumn(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`数据库列 ${column} 期望 TEXT，实际为 ${value === undefined ? "缺失" : typeof value}`);
  }
  return value;
}

/** 必填 INTEGER 列断言：SQLite 整数在 node:sqlite 中为 number/bigint，统一转 number。 */
export function assertIntegerColumn(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`数据库列 ${column} 期望 INTEGER，实际为 ${value === undefined ? "缺失" : typeof value}`);
  }
  return Number(value);
}

/** 可空 TEXT 列：NULL 或缺失返回 undefined，存在则必须为 string。 */
export function optionalTextColumn(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return assertTextColumn(row, column);
}

/** 可空 TEXT 列（保留 null 语义，用于 lastCheckedAt 这类三态字段）。 */
export function nullableTextColumn(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  return assertTextColumn(row, column);
}

export function rowToProject(row: SqlRow): Project {
  return {
    id: assertTextColumn(row, "id"),
    name: assertTextColumn(row, "name"),
    path: assertTextColumn(row, "path"),
    provider: assertTextColumn(row, "provider") as Project["provider"],
    branch: assertTextColumn(row, "branch"),
    status: assertTextColumn(row, "status") as Project["status"],
    commit: assertTextColumn(row, "commitHash"),
    favorite: assertIntegerColumn(row, "favorite") !== 0,
    tags: parseStringArray(row.tags),
    remote: optionalTextColumn(row, "remote"),
    files: assertIntegerColumn(row, "files"),
    syncLabel: assertTextColumn(row, "syncLabel"),
    language: assertTextColumn(row, "language"),
    languageColor: assertTextColumn(row, "languageColor"),
    summary: assertTextColumn(row, "summary"),
    updatedAt: assertTextColumn(row, "updatedAt"),
    // 迁移后补的列：旧库行可能为 NULL，保持 0 兜底（与迁移前行为一致）
    diskSizeBytes: row.diskSizeBytes == null ? 0 : assertIntegerColumn(row, "diskSizeBytes"),
    alias: optionalTextColumn(row, "alias"),
    webUrl: optionalTextColumn(row, "webUrl"),
  };
}

export function rowToWorkspace(row: SqlRow): WorkspaceEntity {
  return {
    id: assertTextColumn(row, "id"),
    name: assertTextColumn(row, "name"),
    createdAt: assertTextColumn(row, "createdAt"),
    updatedAt: assertTextColumn(row, "updatedAt"),
  };
}

export function rowToAccount(row: SqlRow): Account {
  return {
    id: assertTextColumn(row, "id"),
    provider: assertTextColumn(row, "provider") as RemoteProvider,
    username: assertTextColumn(row, "username"),
    displayName: assertTextColumn(row, "displayName"),
    authType: assertTextColumn(row, "authType") as Account["authType"],
    credentialRef: assertTextColumn(row, "credentialRef"),
    status: assertTextColumn(row, "status") as Account["status"],
    scopes: parseStringArray(row.scopes),
    lastCheckedAt: nullableTextColumn(row, "lastCheckedAt"),
    createdAt: assertTextColumn(row, "createdAt"),
    updatedAt: assertTextColumn(row, "updatedAt"),
  };
}

export function rowToTaskProfile(row: SqlRow): TaskProfile {
  return {
    id: assertTextColumn(row, "id"),
    projectId: assertTextColumn(row, "projectId"),
    projectPath: assertTextColumn(row, "projectPath"),
    taskType: assertTextColumn(row, "taskType") as TaskProfile["taskType"],
    name: assertTextColumn(row, "name"),
    command: assertTextColumn(row, "command"),
    args: assertTextColumn(row, "args"),
    workingDirectory: assertTextColumn(row, "workingDirectory"),
    timeoutSeconds: assertIntegerColumn(row, "timeoutSeconds"),
    createdAt: assertTextColumn(row, "createdAt"),
  };
}

export function rowToTaskRun(row: SqlRow): TaskRun {
  return {
    id: assertTextColumn(row, "id"),
    profileId: assertTextColumn(row, "profileId"),
    projectId: assertTextColumn(row, "projectId"),
    name: assertTextColumn(row, "name"),
    command: assertTextColumn(row, "command"),
    startedAt: assertTextColumn(row, "startedAt"),
    finishedAt: optionalTextColumn(row, "finishedAt"),
    status: assertTextColumn(row, "status") as TaskRun["status"],
    exitCode: row.exitCode == null ? undefined : assertIntegerColumn(row, "exitCode"),
    output: assertTextColumn(row, "output"),
  };
}

export function rowToBackup(row: SqlRow): BackupRecord {
  return {
    id: assertTextColumn(row, "id"),
    projectId: assertTextColumn(row, "projectId"),
    projectName: assertTextColumn(row, "projectName"),
    sourcePath: assertTextColumn(row, "sourcePath"),
    archivePath: assertTextColumn(row, "archivePath"),
    sizeBytes: assertIntegerColumn(row, "sizeBytes"),
    status: assertTextColumn(row, "status") as BackupRecord["status"],
    error: optionalTextColumn(row, "error"),
    createdAt: assertTextColumn(row, "createdAt"),
  };
}

export function rowToOperationRecord(row: SqlRow): OperationRecord {
  return {
    id: assertTextColumn(row, "id"),
    operation: assertTextColumn(row, "operation"),
    projectId: assertTextColumn(row, "projectId"),
    projectPath: assertTextColumn(row, "projectPath"),
    detail: assertTextColumn(row, "detail"),
    result: assertTextColumn(row, "result") as OperationRecord["result"],
    createdAt: assertTextColumn(row, "createdAt"),
  };
}
