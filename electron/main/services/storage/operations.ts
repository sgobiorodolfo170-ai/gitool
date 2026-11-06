import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationRecord } from "../../../../shared/types";
import { buildOperationRecordsCsv } from "../operationCsv";
import { openDatabase, rowToOperationRecord, type SqlRow } from "./database";

/**
 * 操作审计数据域：写入、查询、清空、CSV 导出。
 *
 * 库内保留上限 2000 条（界面只读 500 条，历史无限增长会拖慢启动与查询）；
 * 导出全量（2000）而非列表页的 500 条是刻意的——导出截断会让用户误以为
 * 导出了全部历史（2026-11-07 审查 P2-10）。
 */

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
  const records = listOperationRecords(2000);
  const fileName = `gitool-operations-${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = join(directory, fileName);
  // UTF-8 BOM：无 BOM 时中文 Windows 的 Excel 会按 ANSI 解码导致乱码
  writeFileSync(filePath, "\uFEFF" + buildOperationRecordsCsv(records), { encoding: "utf8" });
  return filePath;
}
