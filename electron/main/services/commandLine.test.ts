import { describe, expect, it } from "vitest";
import { splitCommandLine } from "./commandLine";

describe("splitCommandLine", () => {
  it("按空格拆分", () => {
    expect(splitCommandLine("run build")).toEqual(["run", "build"]);
  });

  it("双引号内保留空格", () => {
    expect(splitCommandLine('--path="C:\\Program Files\\x" --watch')).toEqual([
      "--path=C:\\Program Files\\x",
      "--watch",
    ]);
  });

  it("单引号内保留空格", () => {
    expect(splitCommandLine("--name 'my app'")).toEqual(["--name", "my app"]);
  });

  it("反斜杠按字面保留，不当转义符", () => {
    // Windows 路径依赖这一点：若把 \ 当转义符，"C:\a" 会丢掉反斜杠
    expect(splitCommandLine("C:\\work\\repo")).toEqual(["C:\\work\\repo"]);
  });

  it("合并连续空白并忽略首尾空白", () => {
    expect(splitCommandLine("   run    dev   ")).toEqual(["run", "dev"]);
  });

  it("空串返回空数组", () => {
    expect(splitCommandLine("")).toEqual([]);
    expect(splitCommandLine("   ")).toEqual([]);
  });

  it("未闭合引号时按已读内容输出，不抛错", () => {
    expect(splitCommandLine('--msg "unclosed')).toEqual(["--msg", "unclosed"]);
  });
});
