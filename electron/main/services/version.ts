/**
 * 语义化版本比较。
 *
 * 抽成独立模块的原因：`updater.ts` 依赖 electron 的 `app`，纯函数留在里面无法单测。
 * 这里刻意做成容错实现——版本号来自 GitHub Release tag，可能带 `v` 前缀、预发布后缀
 * 或非数字段，任何异常都不应让「检查更新」整体失败。
 */

/**
 * 把版本串解析为数字段。
 * - 去掉 `v` / `V` 前缀
 * - 预发布后缀（`-beta.1`、`+build`）直接丢弃，只比较主干
 * - 非数字段按 0 处理（NaN 会让所有比较都为 false，进而静默判定"无更新"）
 */
function parseVersion(value: string): number[] {
  return value
    .trim()
    .replace(/^[vV]/, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((part) => {
      const numeric = Number.parseInt(part, 10);
      return Number.isFinite(numeric) ? numeric : 0;
    });
}

/**
 * 比较两个版本号。
 * @returns 1 表示 current 更新，-1 表示 latest 更新，0 表示相同。
 */
export function compareVersions(current: string, latest: string): number {
  const left = parseVersion(current);
  const right = parseVersion(latest);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}
