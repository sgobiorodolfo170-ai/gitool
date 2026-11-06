import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OperationRecord } from "../../../../shared/types";
import { closeDatabase, initDatabase, openDatabase } from "./database";
import {
  clearOperationRecords,
  exportOperationRecords,
  insertOperationRecord,
  listOperationRecords,
} from "./operations";

function record(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: "op-1",
    operation: "pull",
    projectId: "p-1",
    projectPath: "C:\\work\\demo",
    detail: "Already up to date.",
    result: "ok",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 绕过 insertOperationRecord 批量造历史数据（保留上限用例需要 2000 条底料）。
 * 整段包进单事务：逐条 insert 每行一次隐式事务落盘，2000 行在 Windows 上会超时。 */
function bulkInsert(count: number, startOffsetDays: number): void {
  const connection = openDatabase();
  connection.exec("BEGIN");
  try {
    const statement = connection.prepare(
      `INSERT INTO operation_records (id, operation, projectId, projectPath, detail, result, createdAt)
       VALUES (?, 'pull', 'p-1', 'C:\\work\\demo', 'x', 'ok', ?)`,
    );
    for (let i = 0; i < count; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + startOffsetDays + i));
      statement.run(`bulk-${i}`, date.toISOString());
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

describe("operations 域（操作审计）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-operations-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("按创建时间倒序返回，limit 参数生效", () => {
    insertOperationRecord(record({ id: "op-1", createdAt: "2026-11-01T00:00:00.000Z" }));
    insertOperationRecord(record({ id: "op-2", createdAt: "2026-11-02T00:00:00.000Z" }));
    insertOperationRecord(record({ id: "op-3", createdAt: "2026-11-03T00:00:00.000Z" }));

    expect(listOperationRecords().map((item) => item.id)).toEqual(["op-3", "op-2", "op-1"]);
    expect(listOperationRecords(2).map((item) => item.id)).toEqual(["op-3", "op-2"]);
  });

  it("库内只保留最近 2000 条：超过上限时最早的记录被裁剪", () => {
    bulkInsert(2000, 0);
    // 第 2001 条写入触发保留上限逻辑
    insertOperationRecord(record({ id: "op-new", createdAt: "2027-01-01T00:00:00.000Z" }));

    const total = Number(
      (
        openDatabase().prepare("SELECT COUNT(*) AS total FROM operation_records").get() as {
          total: number;
        }
      ).total,
    );
    expect(total).toBe(2000);
    // 最早一天的数据被裁掉，新纪录健在
    expect(listOperationRecords(2000).some((item) => item.id === "bulk-0")).toBe(false);
    expect(listOperationRecords(2000).some((item) => item.id === "op-new")).toBe(true);
  });

  it("clearOperationRecords 清空全部记录", () => {
    insertOperationRecord(record({ id: "op-1" }));
    insertOperationRecord(record({ id: "op-2" }));
    clearOperationRecords();
    expect(listOperationRecords()).toEqual([]);
  });

  it("导出 CSV：文件落在指定目录、UTF-8 BOM 开头、内容含全部库内记录", () => {
    insertOperationRecord(record({ id: "op-1", detail: "有逗号,的说明" }));
    insertOperationRecord(record({ id: "op-2", result: "failed", detail: "失败原因" }));

    const exportDir = mkdtempSync(join(tmpdir(), "gitool-export-"));
    try {
      const filePath = exportOperationRecords(exportDir);
      expect(existsSync(filePath)).toBe(true);
      // 文件名含日期段与 .csv 后缀（具体日期随运行日变化，不硬编码）
      expect(filePath).toMatch(/gitool-operations-\d{4}-\d{2}-\d{2}\.csv$/);
      const content = readFileSync(filePath, "utf8");
      expect(content.charCodeAt(0)).toBe(0xfeff);
      expect(content).toContain('"op-1"');
      expect(content).toContain('"op-2"');
      // 导出全量而非列表页的 500 条：表头 + 每条记录一行，以换行结尾。
      // 两条记录 createdAt 相同，行序不保证，按行集合断言。
      const lines = content.split("\n");
      expect(lines).toHaveLength(4); // 表头 + 2 行 + 末尾换行产生的空段
      // 首字符已是 BOM（上方断言），表头自第二个字符起比对
      expect(lines[0]?.slice(1)).toBe("id,operation,projectId,projectPath,result,createdAt,detail");
      const dataLines = lines.slice(1, 3).sort();
      expect(dataLines[0]).toContain('"op-1"');
      expect(dataLines[1]).toContain('"op-2"');
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
    }
  });
});
