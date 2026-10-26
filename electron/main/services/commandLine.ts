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
