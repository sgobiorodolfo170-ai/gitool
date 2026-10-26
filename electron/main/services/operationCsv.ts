import type { OperationRecord } from "../../../shared/types";

/**
 * 操作记录导出为 CSV。
 *
 * 从 `storage.ts` 抽出的原因：`storage.ts` 依赖 electron 的 app 模块，
 * 纯格式化逻辑留在里面无法单测。本文件零运行时依赖。
 */

/**
 * CSV 字段转义。
 * 统一给所有字段加双引号并把内部 `"` 翻倍，避免路径中的逗号、换行把列切错。
 */
export function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const CSV_HEADER = "id,operation,projectId,projectPath,result,createdAt,detail";

export function buildOperationRecordsCsv(records: OperationRecord[]): string {
  const rows = records.map((record) =>
    [
      csvEscape(record.id),
      csvEscape(record.operation),
      csvEscape(record.projectId),
      csvEscape(record.projectPath),
      csvEscape(record.result),
      csvEscape(record.createdAt),
      csvEscape(record.detail),
    ].join(","),
  );
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}
