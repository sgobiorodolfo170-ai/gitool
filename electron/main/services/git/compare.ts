/**
 * 版本对比域：两个版本之间的 diff 统计与变更清单。
 *
 * 依赖方向：只依赖 core 与 gitParsing；不 import 其他子域。
 */
import type { CompareRequest, CompareResult } from "../../../../shared/types";
import { isValidRefName, parseNumstatPaths } from "../gitParsing";
import { assertDirectory, runGitProcess, runGitProcessRaw } from "./core";

/**
 * 对比范围 `base..head`（两点语法：只比较两端之间的差异）。
 * why 不用三点 `...`：三点是「head 相对 merge-base」的口径，会改变统计与变更清单。
 */
function compareRange(base: string, head: string): string {
  return `${base}..${head}`;
}

/**
 * `git diff --stat <base>..<head>`：人读统计文本，走脱敏出口展示给渲染层。
 * why 仅用于展示：文件名含 `|`、重命名 `{old => new}` 与超长路径截断都会让人读
 * 格式解析不出可靠路径，变更清单另取 `--numstat`。
 */
export function buildDiffStatArgs(base: string, head: string): string[] {
  return ["diff", "--stat", compareRange(base, head)];
}

/**
 * `git diff --numstat <base>..<head>`。
 *
 * why 必须带 `--numstat`：每行 `added<TAB>removed<TAB>path` 是机器可读格式，供
 * parseNumstatPaths 与增删行累加逐字段解析（`--stat` 的人读格式做不到）。
 * why 走 raw 出口：脱敏会把含 `key=value` 的路径改写，统计就会错位。
 */
export function buildDiffNumstatArgs(base: string, head: string): string[] {
  return ["diff", "--numstat", compareRange(base, head)];
}

export async function compareVersions(input: CompareRequest): Promise<CompareResult> {
  assertDirectory(input.path);
  const base = input.base.trim();
  const head = input.head.trim();
  if (!base || !head) {
    throw new Error("请提供对比的基线版本和目标版本");
  }
  // 版本标识来自渲染层，必须白名单校验：`git diff` 会把以 `-` 开头的参数当选项，
  // 例如 `--output=<path>` 可让 git 向任意路径写文件（参数注入，非 shell 注入）。
  if (!isValidRefName(base) || !isValidRefName(head)) {
    throw new Error("版本标识不合法，只能包含字母、数字、点、下划线、斜杠和连字符");
  }
  const [statResult, numStatResult] = await Promise.all([
    runGitProcess(input.path, buildDiffStatArgs(base, head)),
    // why 用 raw 出口：--numstat 每一行要被 parseNumstatPaths / 数值累加逐字段解析，
    // 先脱敏会把含 `key=value` 的文件路径改写，统计结果就错了。这里只做内部计算，
    // 面向渲染层的 stat 文本已在上面走了脱敏出口。
    runGitProcessRaw(input.path, buildDiffNumstatArgs(base, head)),
  ]);
  if (!statResult.success) {
    throw new Error(statResult.output || "对比失败");
  }
  const stat = statResult.output.trim();

  // 变更文件清单从 numstat 提取（机器可读），--stat 输出仅用于展示：
  // 从 --stat 人读格式解析文件名会被 `|` 分隔、`{old => new}` 重命名与
  // 超长路径截断破坏（2026-11-07 审查 P2-4）。
  const changedFiles = numStatResult.success ? parseNumstatPaths(numStatResult.output) : [];

  let insertions = 0;
  let deletions = 0;
  if (numStatResult.success) {
    for (const line of numStatResult.output.split(/\r?\n/)) {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const added = Number(parts[0]);
        const removed = Number(parts[1]);
        if (Number.isFinite(added)) insertions += added;
        if (Number.isFinite(removed)) deletions += removed;
      }
    }
  }

  return {
    success: true,
    output: stat,
    changedFiles,
    insertions,
    deletions,
  };
}
