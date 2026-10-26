import { describe, expect, it } from "vitest";
import type { OperationRecord } from "../../../shared/types";
import { buildOperationRecordsCsv, csvEscape } from "./operationCsv";

function record(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: "op-1",
    operation: "pull",
    projectId: "",
    projectPath: "C:\\work\\demo",
    detail: "Already up to date.",
    result: "ok",
    createdAt: "2026-10-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("给字段加双引号", () => {
    expect(csvEscape("abc")).toBe('"abc"');
  });

  it("内部双引号翻倍", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("保留逗号与换行，由引号包裹保证列不被切错", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });
});

describe("buildOperationRecordsCsv", () => {
  it("输出表头 + 每条记录一行，并以换行结尾", () => {
    const csv = buildOperationRecordsCsv([record()]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,operation,projectId,projectPath,result,createdAt,detail");
    expect(lines[1]).toBe(
      '"op-1","pull","","C:\\work\\demo","ok","2026-10-26T10:00:00.000Z","Already up to date."',
    );
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("无记录时只输出表头", () => {
    expect(buildOperationRecordsCsv([])).toBe(
      "id,operation,projectId,projectPath,result,createdAt,detail\n",
    );
  });

  it("路径含逗号时列数仍然正确", () => {
    const csv = buildOperationRecordsCsv([record({ projectPath: "C:\\a,b\\c" })]);
    const row = csv.split("\n")[1];
    // 逗号在引号内，简单计数会偏多，这里验证引号配对完整
    expect(row).toContain('"C:\\a,b\\c"');
    expect((row.match(/"/g) ?? []).length).toBe(14);
  });

  it("失败记录如实写入 result", () => {
    const csv = buildOperationRecordsCsv([record({ result: "failed" })]);
    expect(csv).toContain('"failed"');
  });
});
