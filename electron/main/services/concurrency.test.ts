import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
  it("处理全部元素", async () => {
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("并发数不超过上限", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, index) => index), 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("空数组不调用处理函数", async () => {
    let calls = 0;
    await mapLimit([], 8, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("limit 超过元素数时不会创建多余 worker", async () => {
    const seen: number[] = [];
    await mapLimit([1, 2], 100, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2]);
  });

  it("处理函数抛错时整体 reject", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (item) => {
        if (item === 2) {
          throw new Error("boom");
        }
      }),
    ).rejects.toThrow("boom");
  });
});
