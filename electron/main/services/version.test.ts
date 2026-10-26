import { describe, expect, it } from "vitest";
import { compareVersions } from "./version";

describe("compareVersions", () => {
  it("按段比较主版本", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("比较次版本与修订号", () => {
    expect(compareVersions("0.2.0", "0.3.0")).toBe(-1);
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
  });

  it("忽略 v 前缀", () => {
    expect(compareVersions("v0.2.0", "0.3.0")).toBe(-1);
    expect(compareVersions("0.2.0", "V0.2.0")).toBe(0);
  });

  it("段数不同时缺失段按 0 处理", () => {
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.0.0", "1")).toBe(0);
  });

  it("预发布后缀不影响主干比较", () => {
    expect(compareVersions("1.0.0", "1.1.0-beta.1")).toBe(-1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(0);
  });

  it("非数字段按 0 处理，不产生 NaN 导致的误判", () => {
    // 旧实现用 Number() 解析，NaN 参与比较全为 false，会静默判定「无更新」
    expect(compareVersions("1.0.0", "1.0.abc")).toBe(0);
    expect(compareVersions("1.0.0", "2.0.abc")).toBe(-1);
  });

  it("空串不会抛错", () => {
    expect(compareVersions("", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "")).toBe(1);
  });
});
