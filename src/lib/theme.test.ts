import { describe, expect, it } from "vitest";
import {
  loadTheme,
  parseTheme,
  resolveTheme,
  saveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    dump: () => Object.fromEntries(data),
  };
}

describe("theme 解析", () => {
  it("接受三种合法偏好", () => {
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("非法/缺失值回退到 system", () => {
    for (const value of [null, undefined, "", "blue", 1, {}]) {
      expect(parseTheme(value)).toBe("system");
    }
  });

  it("system 跟随系统，light/dark 覆盖系统", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("theme 持久化", () => {
  it("无存储值时返回 system", () => {
    expect(loadTheme(memoryStorage())).toBe("system");
  });

  it("读出已保存的合法值", () => {
    expect(loadTheme(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
  });

  it("读出损坏值时回退 system", () => {
    expect(loadTheme(memoryStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("system");
  });

  it("保存前归一化非法值", () => {
    const storage = memoryStorage();
    saveTheme(storage, "neon" as ThemePreference);

    expect(storage.dump()[THEME_STORAGE_KEY]).toBe("system");
  });

  it("存储抛错时不向上抛", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };

    expect(loadTheme(broken)).toBe("system");
    expect(() => saveTheme(broken, "dark")).not.toThrow();
  });
});
