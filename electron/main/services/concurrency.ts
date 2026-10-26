/**
 * 并发受限的批量遍历。
 *
 * 为什么需要：结构分析要 stat 每个文件，串行 await 在万级文件的项目上会慢到不可用；
 * 而 `Promise.all` 一次性发起会瞬间打开上万文件句柄，在 Windows 上直接 EMFILE。
 * 这里用固定数量的 worker 池把并发钳在可控区间。
 */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) {
        return;
      }
      await handler(items[current], current);
    }
  });

  await Promise.all(workers);
}
