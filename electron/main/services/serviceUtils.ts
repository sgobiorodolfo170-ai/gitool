import { statSync } from "node:fs";

/**
 * 主进程服务层公共小工具（零 electron 依赖）。
 *
 * 下沉原因：errorMessage 曾在 6 个服务文件里逐字重复；assertDirectory 在
 * 3 个文件重复且健壮性各不相同——openers 的版本没有 try/catch，目录不存在
 * 时会把原始 ENOENT 英文异常直接抛给渲染层（2026-11-07 审查 P2-12）。
 */

/** 把任意抛出的值转成可展示的字符串。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 断言目标是存在的目录，否则抛带中文文案的错误。
 * label 用于区分域：git 域传「项目路径」、备份域传「源路径」等。
 */
export function assertDirectory(target: string, label = "路径"): void {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new Error(`${label}不存在或无法访问`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label}不是目录`);
  }
}
