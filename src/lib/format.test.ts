import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, formatCommitDate, formatDayGroup, isDormant } from "./format";
import type { Project } from "../../shared/types";

function project(updatedAt: string): Project {
  return {
    id: "p1",
    name: "demo",
    path: "C:\\work\\demo",
    provider: "local",
    branch: "main",
    status: "clean",
    commit: "abc1234",
    favorite: false,
    tags: [],
    files: 0,
    syncLabel: "",
    language: "",
    languageColor: "",
    summary: "",
    updatedAt,
    diskSizeBytes: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("formatBytes", () => {
  it("小于 1KB 显示字节", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("KB 保留一位小数", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("MB 保留一位小数", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  it("非法输入回退为 0 B，不产出 NaN", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("isDormant", () => {
  it("超过阈值月份视为沉睡", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    expect(isDormant(project("2026-06-01"))).toBe(true);
  });

  it("未超过阈值不算沉睡", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    expect(isDormant(project("2026-09-01"))).toBe(false);
  });

  it("边界：刚好 3 个月前后各一天", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    expect(isDormant(project("2026-07-27"))).toBe(false);
    expect(isDormant(project("2026-07-25"))).toBe(true);
  });

  it("自定义阈值生效", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    expect(isDormant(project("2026-09-01"), 1)).toBe(true);
    expect(isDormant(project("2026-09-01"), 6)).toBe(false);
  });

  it("日期非法时返回 false，不误报", () => {
    expect(isDormant(project(""))).toBe(false);
    expect(isDormant(project("未提交"))).toBe(false);
    expect(isDormant(project("2026-13-45"))).toBe(false);
  });
});

describe("formatCommitDate", () => {
  it("输出中文日期时间", () => {
    const output = formatCommitDate("2026-10-26T19:30:00");
    expect(output).toContain("2026");
    expect(output).toContain("19:30");
  });

  it("非法日期原样返回", () => {
    expect(formatCommitDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDayGroup", () => {
  it("当天返回「今天」", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    expect(formatDayGroup("2026-10-26T08:00:00")).toBe("今天");
  });

  it("非当天返回完整日期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T10:00:00"));
    const output = formatDayGroup("2026-10-20T08:00:00");
    expect(output).toContain("2026");
    expect(output).toContain("10");
    expect(output).toContain("20");
  });

  it("非法日期原样返回", () => {
    expect(formatDayGroup("bad")).toBe("bad");
  });
});
