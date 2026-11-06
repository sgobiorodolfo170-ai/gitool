import { describe, expect, it } from "vitest";
import { quoteWindowsArg, splitCommandLine } from "./commandLine";

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

describe("quoteWindowsArg", () => {
  it("普通参数不加引号", () => {
    expect(quoteWindowsArg("run")).toBe("run");
    expect(quoteWindowsArg("--watch")).toBe("--watch");
    expect(quoteWindowsArg("C:\\work\\repo")).toBe("C:\\work\\repo");
  });

  it("含空格的参数用双引号包裹", () => {
    expect(quoteWindowsArg("hello world")).toBe('"hello world"');
    expect(quoteWindowsArg("--title=hello world")).toBe('"--title=hello world"');
  });

  it("空参数输出空引号，不会从参数列表里消失", () => {
    expect(quoteWindowsArg("")).toBe('""');
  });

  it("含 cmd 元字符的参数加引号，防止被 shell 重新解释", () => {
    // 关键回归（2026-11-07 审查 P1-4）：shell:true 时 Node 仅用空格拼接
    // command 与 args 交给 cmd.exe，含 & 的参数会被解释成第二条命令。
    expect(quoteWindowsArg("a&calc")).toBe('"a&calc"');
    expect(quoteWindowsArg("a|b")).toBe('"a|b"');
    expect(quoteWindowsArg("a<b>c")).toBe('"a<b>c"');
    expect(quoteWindowsArg("a^b")).toBe('"a^b"');
  });

  it("内部引号按 CommandLineToArgvW 约定转义", () => {
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("结尾反斜杠只在需要加引号时才双写", () => {
    // 无空格/引号的路径不加引号：此时反斜杠按字面解析，无需处理
    expect(quoteWindowsArg("C:\\a\\")).toBe("C:\\a\\");
    // 含空格才触发加引号，此时结尾的 \ 必须双写：
    // 按 MSVCRT 解析规则，"C:\my dir\" 里的 \" 会被当成转义引号吞掉收尾引号
    expect(quoteWindowsArg("C:\\my dir\\")).toBe('"C:\\my dir\\\\"');
  });
});
