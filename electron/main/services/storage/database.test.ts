import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, DATABASE_FILE_NAME, initDatabase, openDatabase } from "./database";

/**
 * 连接注入基座冒烟测试：证明「initDatabase 注入临时目录 → 纯 Node 环境跑真实
 * node:sqlite」这条路可行，服务层各域测试都建立在它之上。
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
});
