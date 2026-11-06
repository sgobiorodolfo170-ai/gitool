import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, DATABASE_FILE_NAME, initDatabase, openDatabase } from "./database";

/**
 * 连接注入基座与 schema 迁移测试：证明「initDatabase 注入临时目录 → 纯 Node
 * 环境跑真实 node:sqlite」可行，服务层各域测试都建立在它之上；迁移用例则
 * 守护老库升级路径（真实用户数据会经过的代码）。
 *
 * ⚠ 测试约定：不要把 DatabaseSync 实例直接传给 expect()（如 not.toBe(另一连接)）。
 * vitest 的相等检查在两个对象非 Object.is 全等时会结构性遍历对象内部，
 * 而已关闭连接的内部访问器会抛 "database is not open"，把断言错误吞掉。
 * 连接身份比较一律用 `a === b` 布尔值。
 */

describe("数据库连接注入", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-database-"));
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("initDatabase 注入数据目录：sqlite 文件落在指定目录，而非 electron userData", () => {
    initDatabase(dataDir);
    expect(existsSync(join(dataDir, DATABASE_FILE_NAME))).toBe(true);
  });

  it("重复 openDatabase 复用同一连接，进程内保持单例", () => {
    const first = initDatabase(dataDir);
    expect(openDatabase() === first).toBe(true);
    expect(openDatabase() === first).toBe(true);
  });

  it("closeDatabase 释放连接后再打开是新连接，测试生命周期可复位", () => {
    const first = initDatabase(dataDir);
    closeDatabase();
    expect(openDatabase() === first).toBe(false);
  });

  it("重复 initDatabase 先关旧连接并切换到新目录", () => {
    const first = initDatabase(dataDir);
    const secondDir = mkdtempSync(join(tmpdir(), "gitool-database-"));
    try {
      const second = initDatabase(secondDir);
      expect(second === first).toBe(false);
      expect(existsSync(join(secondDir, DATABASE_FILE_NAME))).toBe(true);
    } finally {
      closeDatabase();
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("新库种子默认工作区：首次打开即存在「个人工作区」", () => {
    initDatabase(dataDir);
    const row = openDatabase().prepare("SELECT id, name FROM workspaces").get() as {
      id: string;
      name: string;
    };
    expect(row).toEqual({ id: "default", name: "个人工作区" });
  });
});

describe("老库迁移（path UNIQUE 约束重建）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-database-migration-"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("早期 UNIQUE path 库升级后：数据保留、约束消失、新增列补齐默认值", () => {
    // 造一个 2026-10 早期版本的库：path 唯一约束 + 缺 diskSizeBytes/alias/webUrl/workspaceId
    const legacy = new DatabaseSync(join(dataDir, DATABASE_FILE_NAME));
    legacy.exec(`
      CREATE TABLE projects (
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
        updatedAt TEXT NOT NULL
      );
      INSERT INTO projects (id, name, path, provider, branch, status, commitHash, favorite, tags, remote, files, syncLabel, language, languageColor, summary, updatedAt)
      VALUES ('p1', '演示项目', 'C:\\work\\demo', 'local', 'main', 'clean', 'abc', 1, '["前端"]', NULL, 3, '已同步', 'TypeScript', '#3178c6', '说明', '2026-10-01T00:00:00.000Z');
    `);
    legacy.close();

    initDatabase(dataDir);
    const connection = openDatabase();

    // 数据原样保留，新列补默认值
    const row = connection
      .prepare("SELECT name, path, diskSizeBytes, alias, webUrl, workspaceId FROM projects")
      .get() as Record<string, string | number>;
    expect(row).toEqual({
      name: "演示项目",
      path: "C:\\work\\demo",
      diskSizeBytes: 0,
      alias: null,
      webUrl: null,
      workspaceId: "default",
    });

    // UNIQUE 约束已消失：同 path 第二条记录可以写入
    connection
      .prepare(
        `INSERT INTO projects (id, name, path, provider, branch, status, commitHash, tags, syncLabel, language, languageColor, summary, updatedAt)
         VALUES ('p2', '同名路径', 'C:\\work\\demo', 'local', 'main', 'clean', 'def', '[]', '已同步', 'TypeScript', '#3178c6', '说明', '2026-10-02T00:00:00.000Z')`,
      )
      .run();
    expect(
      Number(
        (connection.prepare("SELECT COUNT(*) AS total FROM projects").get() as { total: number })
          .total,
      ),
    ).toBe(2);
  });
});
