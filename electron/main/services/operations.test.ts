import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationRecord, Project } from "../../../shared/types";
import { recordOperation, resolveProjectIdByPath } from "./operations";
import { closeDatabase, initDatabase } from "./storage/database";
import { clearOperationRecords, listOperationRecords } from "./storage/operations";
import { saveProjects } from "./storage/projects";

/**
 * operations 编排域单测（架构评审 A-21）。
 *
 * 测试策略：
 * - 用真实 node:sqlite（initDatabase 注入临时目录），验证 findByPath 真的能跨工作区命中；
 * - 用 openDatabase 代理统计 `.prepare` 次数，把「单条 SQL」变成可机器判定的断言；
 * - insertOperationRecord 通过薄包装注入失败，验证「失败不静默」；
 * - git 域整体 mock：本文件测的是编排与落库，不需要真实 git 子进程。
 */

vi.mock("./git", () => ({
  runGitOperation: vi.fn(),
  cloneRepository: vi.fn(),
  commitChanges: vi.fn(),
}));

/** 计数器：代理 openDatabase 后统计各域发起的所有 prepare（含 get/all/run）。 */
const dbProbe = vi.hoisted(() => ({ prepareCalls: 0 }));

vi.mock("./storage/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage/database")>();
  return {
    ...actual,
    openDatabase: () => {
      const connection = actual.openDatabase();
      return new Proxy(connection, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (typeof value !== "function") {
            return value;
          }
          const call = value as (...params: unknown[]) => unknown;
          if (property === "prepare") {
            return (...args: unknown[]) => {
              dbProbe.prepareCalls += 1;
              return call.apply(target, args);
            };
          }
          return call.bind(target);
        },
      });
    },
  };
});

/** 可控的写入失败开关：非 null 时 insertOperationRecord 直接抛错。 */
const opProbe = vi.hoisted(() => ({ failInsertWith: null as Error | null }));

vi.mock("./storage/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage/operations")>();
  return {
    ...actual,
    insertOperationRecord: (record: OperationRecord) => {
      if (opProbe.failInsertWith) {
        throw opProbe.failInsertWith;
      }
      actual.insertOperationRecord(record);
    },
  };
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    name: "演示项目",
    path: "C:\\work\\demo",
    provider: "local",
    branch: "main",
    status: "clean",
    commit: "abc1234",
    favorite: false,
    tags: [],
    files: 0,
    syncLabel: "",
    language: "TypeScript",
    languageColor: "#3178c6",
    summary: "",
    updatedAt: "2026-11-01T00:00:00.000Z",
    diskSizeBytes: 0,
    ...overrides,
  };
}

describe("operations 编排域（A-21：编排下沉 + 反查改单条查询）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-operations-"));
    initDatabase(dataDir);
    clearOperationRecords();
    dbProbe.prepareCalls = 0;
    opProbe.failInsertWith = null;
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("命中：跨工作区按绝对路径反查项目 ID，只发一条 SQL", () => {
    saveProjects("ws-a", [project({ id: "p-a", path: "C:\\work\\a" })]);
    saveProjects("ws-b", [project({ id: "p-b", path: "C:\\work\\b" })]);
    dbProbe.prepareCalls = 0;

    expect(resolveProjectIdByPath("C:\\work\\b")).toBe("p-b");
    // 单条查询证明：旧实现是 listWorkspaces() + 每区 loadProjects()（1+N 次 prepare），
    // 这里无论有几个工作区都只允许 1 次。
    expect(dbProbe.prepareCalls).toBe(1);
  });

  it("未命中：返回空串，同样只发一条 SQL（不再遍历工作区）", () => {
    saveProjects("ws-a", [project({ id: "p-a", path: "C:\\work\\a" })]);
    dbProbe.prepareCalls = 0;

    expect(resolveProjectIdByPath("C:\\work\\missing")).toBe("");
    expect(dbProbe.prepareCalls).toBe(1);
  });

  it("同一路径存在重复历史行时按 updatedAt 取最新，结果确定", () => {
    // 跨工作区重复路径属于脏数据：固定取 updatedAt 最新的一条，避免依赖 SQLite 默认行序
    saveProjects("ws-a", [
      project({ id: "p-old", path: "C:\\work\\dup", updatedAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    saveProjects("ws-b", [
      project({ id: "p-new", path: "C:\\work\\dup", updatedAt: "2026-11-01T00:00:00.000Z" }),
    ]);
    dbProbe.prepareCalls = 0;

    expect(resolveProjectIdByPath("C:\\work\\dup")).toBe("p-new");
    expect(dbProbe.prepareCalls).toBe(1);
  });

  it("recordOperation：URL 凭据、Bearer 头与敏感参数落库前已脱敏", () => {
    recordOperation(
      "clone",
      "C:\\work\\demo",
      "remote: https://alice:secretpw@example.com/repo.git?access_token=ghp_abcdefgh1234 " +
        "Authorization: Bearer tok-9876543210",
      "failed",
    );

    const [record] = listOperationRecords();
    expect(record?.detail).not.toContain("alice");
    expect(record?.detail).not.toContain("secretpw");
    expect(record?.detail).not.toContain("ghp_abcdefgh1234");
    expect(record?.detail).not.toContain("tok-9876543210");
    expect(record?.detail).toContain("https://***@example.com");
    expect(record?.detail).toContain("access_token=***");
    expect(record?.detail).toMatch(/bearer \*\*\*/i);
  });

  it("recordOperation：正文截断到 500 字（超长输出不撑大库）", () => {
    recordOperation("commit", "C:\\work\\demo", "y".repeat(1200), "ok");

    expect(listOperationRecords()[0]?.detail).toHaveLength(500);
  });

  it("recordOperation：脱敏先于截断，边界处不留半截凭据", () => {
    // 凭据紧贴在 500 字边界之前：若先截断，落库内容会留下 "alice:se" 之类残片
    recordOperation(
      "clone",
      "C:\\work\\demo",
      `${"x".repeat(480)} https://alice:secretpw@example.com/repo.git`,
      "ok",
    );

    const detail = listOperationRecords()[0]?.detail ?? "";
    expect(detail).toHaveLength(500);
    expect(detail).not.toContain("alice");
    expect(detail).not.toContain("secretpw");
    expect(detail).toContain("https://***@");
  });

  it("recordOperation：写入成功返回 true，落库一条记录", () => {
    const inserted = recordOperation("clone", "C:\\work\\demo", "Cloning into demo", "ok");

    expect(inserted).toBe(true);
    expect(listOperationRecords()).toHaveLength(1);
  });

  it("recordOperation：写入失败不上抛，console.error 留痕并返回 false", () => {
    opProbe.failInsertWith = new Error("磁盘已满");
    // 审计失败只允许留在日志里，不允许冒泡到 IPC（否则 git 已生效但 UI 报错）
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const inserted = recordOperation(
      "commit",
      "C:\\work\\demo",
      "remote: https://alice:secretpw@example.com/repo.git",
      "failed",
    );

    expect(inserted).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("审计写入失败");
    expect(logged).toContain("operation=commit");
    expect(logged).toContain("path=C:\\work\\demo");
    expect(logged).toContain("磁盘已满");
    // 日志绝不能带 detail 原文（未脱敏的凭据不得进主进程日志）
    expect(logged).not.toContain("alice");
    expect(logged).not.toContain("secretpw");
    expect(listOperationRecords()).toHaveLength(0);

    errorSpy.mockRestore();
  });
});
