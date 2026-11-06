/**
 * 命令行参数拆分。
 *
 * 从 `tasks.ts` 抽出的原因：`tasks.ts` 依赖 `storage.ts`（进而依赖 electron 的 app），
 * 纯函数留在里面无法在 Node 测试环境单测。本文件零运行时依赖。
 *
 * 支持：空格分隔、单/双引号包裹（引号内保留空格）。
 * 不支持：反斜杠转义（`--path="C:\a b"` 这类由引号处理的场景已覆盖；
 * Windows 路径里的 `\` 若被当转义符反而会破坏路径）。
 */
export function splitCommandLine(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (const char of input) {
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

/**
 * Windows 命令行参数转义（配合 spawn 的 shell:true 使用）。
 *
 * 为什么需要：shell:true 时 Node 不会替参数加引号，而是把 command 与 args
 * 用空格拼接后整体交给 cmd.exe——splitCommandLine 拆出的带空格参数会被
 * 重新拆开，含 & | < > ^ 的参数会被 cmd 解释成新命令（2026-11-07 审查 P1-4）。
 *
 * 规则遵循 CommandLineToArgvW / MSVCRT 运行时的解析约定：
 * 含空白、引号或 cmd 元字符的参数用双引号包裹；引号前若有连续反斜杠，
 * 反斜杠数量翻倍并给引号本身补一个 \；参数内部其余位置的反斜杠按字面保留。
 */
export function quoteWindowsArg(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (!/[\s"&|<>^]/.test(arg)) {
    return arg;
  }
  let quoted = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      // 反斜杠后跟引号：反斜杠翻倍 + 引号本身转义
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      quoted += "\\".repeat(backslashes) + char;
    }
    backslashes = 0;
  }
  // 收尾：累积的反斜杠翻倍后闭合引号，否则 "C:\a\" 的 \" 会吞掉收尾引号
  quoted += "\\".repeat(backslashes * 2) + '"';
  return quoted;
}
