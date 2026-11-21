import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  applyFontScale,
  loadFontScale,
  saveFontScale,
} from "./uiPrefs";

const FONT_SCALE_KEY = "gitool.fontScale";

/** 内存版 Storage：Node 环境没有 localStorage，用最小实现替代。 */
class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

let storage: MemoryStorage;
let setProperty: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = new MemoryStorage();
  setProperty = vi.fn();
  // uiPrefs 通过 window.localStorage 读写，通过 document.documentElement 写 CSS 变量，
  // 两个全局对象都用最小 stub 注入，不引入 jsdom。
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("document", { documentElement: { style: { setProperty } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadFontScale", () => {
  it("缺键时回退默认值 1", () => {
    expect(storage.getItem(FONT_SCALE_KEY)).toBeNull();
    expect(loadFontScale()).toBe(FONT_SCALE_DEFAULT);
  });

  it("写入后可读回原值", () => {
    saveFontScale(1.25);
    expect(loadFontScale()).toBe(1.25);
  });

  it("非法值回退默认值（非数字 / 空串 / Infinity）", () => {
    for (const invalid of ["abc", "", "Infinity"]) {
      storage.setItem(FONT_SCALE_KEY, invalid);
      expect(loadFontScale()).toBe(FONT_SCALE_DEFAULT);
    }
  });

  it('真实行为：Number.parseFloat 只取数字前缀，"1.2.3" 解析为 1.2', () => {
    storage.setItem(FONT_SCALE_KEY, "1.2.3");
    expect(loadFontScale()).toBe(1.2);
  });

  it("越界值被钳制到合法区间", () => {
    storage.setItem(FONT_SCALE_KEY, "0.1");
    expect(loadFontScale()).toBe(FONT_SCALE_MIN);
    storage.setItem(FONT_SCALE_KEY, "9");
    expect(loadFontScale()).toBe(FONT_SCALE_MAX);
  });

  it("读取存储抛错时回退默认值（隐私模式容错）", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("storage disabled");
        },
      },
    });
    expect(loadFontScale()).toBe(FONT_SCALE_DEFAULT);
  });
});

describe("saveFontScale", () => {
  it("钳制后以字符串写入存储", () => {
    saveFontScale(1.23);
    expect(storage.getItem(FONT_SCALE_KEY)).toBe("1.23");

    saveFontScale(9);
    expect(storage.getItem(FONT_SCALE_KEY)).toBe("1.8");

    saveFontScale(0);
    expect(storage.getItem(FONT_SCALE_KEY)).toBe("0.9");
  });

  it("非有限数字写入默认值", () => {
    saveFontScale(Number.NaN);
    expect(storage.getItem(FONT_SCALE_KEY)).toBe("1");

    saveFontScale(Number.POSITIVE_INFINITY);
    expect(storage.getItem(FONT_SCALE_KEY)).toBe("1");
  });

  it("写入抛错时静默忽略，不向调用方抛错", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem() {
          throw new Error("quota exceeded");
        },
      },
    });
    expect(() => saveFontScale(1.5)).not.toThrow();
  });
});

describe("applyFontScale", () => {
  it("把钳制后的比例写到根元素的 --font-scale 变量", () => {
    applyFontScale(1.4);
    expect(setProperty).toHaveBeenLastCalledWith("--font-scale", "1.4");

    applyFontScale(5);
    expect(setProperty).toHaveBeenLastCalledWith("--font-scale", "1.8");

    applyFontScale(0.2);
    expect(setProperty).toHaveBeenLastCalledWith("--font-scale", "0.9");
  });

  it("非法输入回退默认比例", () => {
    applyFontScale(Number.NaN);
    expect(setProperty).toHaveBeenLastCalledWith("--font-scale", "1");
  });
});

describe("字号常量", () => {
  it("区间与步长符合实现契约", () => {
    expect(FONT_SCALE_MIN).toBe(0.9);
    expect(FONT_SCALE_MAX).toBe(1.8);
    expect(FONT_SCALE_STEP).toBe(0.1);
    expect(FONT_SCALE_DEFAULT).toBe(1);
  });
});
