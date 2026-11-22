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
      // P-35：index 已在上方判定有界，! 仅做类型收窄（cursor 是模块外可变量，
      // 编译器无法证明 items[index] 非 undefined）。
      results[index] = await worker(items[index]!);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(runners);
  return results;
}
