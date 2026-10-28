/**
 * 并发受限的 map，保留结果顺序。
 *
 * 与 electron 侧的 `mapLimit` 区别：这个需要收集返回值（刷新项目状态时
 * 每个项目要拿回新的快照），`mapLimit` 只做副作用遍历。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(runners);
  return results;
}
