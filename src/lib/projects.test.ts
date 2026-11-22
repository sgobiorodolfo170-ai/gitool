import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProjects, saveProjects } from "./projects";
import type { Project } from "../../shared/types";

/**
 * Node 测试环境没有 localStorage（Node 22 默认不启用 webstorage），
 * 这里用内存 Map 复刻 Storage 的最小语义，通过 vi.stubGlobal 注入，
 * afterEach 统一还原，避免污染其它测试文件。
 */
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

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "demo",
    path: "C:\\work\\demo",
    provider: "local",
    branch: "main",
    status: "clean",
    commit: "abc1234",
    favorite: false,
    tags: [],
    files: 0,
    syncLabel: "",
    language: "TypeScript",
    languageColor: "#3178c6",
    summary: "",
    updatedAt: "2026-10-01",
    diskSizeBytes: 0,
    ...overrides,
  };
}

/** 项目数据按工作区分键存放：gitool.projects.<workspaceId>。 */
function storageKey(workspaceId: string): string {
  return `gitool.projects.${workspaceId}`;
}

describe("loadProjects", () => {
  it("键不存在时返回空数组，且不写入任何数据", () => {
    expect(loadProjects("ws-1")).toEqual([]);
    expect(storage.getItem(storageKey("ws-1"))).toBeNull();
  });

  it("非法 JSON 回退为空数组，不抛错", () => {
    storage.setItem(storageKey("ws-1"), "{ not json ");
    expect(loadProjects("ws-1")).toEqual([]);
  });

  it("合法 JSON 但不是数组时回退为空数组（对象/字符串/数字/null/布尔）", () => {
    // 逐个验证：实现只做 Array.isArray 判定，非数组一律兜底，不做类型纠正
    const nonArrays: unknown[] = [{ id: "p1" }, "text", 42, null, true];
    for (const value of nonArrays) {
      storage.setItem(storageKey("ws-1"), JSON.stringify(value));
      expect(loadProjects("ws-1")).toEqual([]);
    }
  });

  it("合法数组原样返回并保持顺序", () => {
    const projects = [makeProject({ id: "p1" }), makeProject({ id: "p2", name: "second" })];
    storage.setItem(storageKey("ws-1"), JSON.stringify(projects));
    expect(loadProjects("ws-1").map((project) => project.id)).toEqual(["p1", "p2"]);
  });

  it("真实行为：数组内元素不做结构校验，null 原样返回（脏数据会泄漏给调用方）", () => {
    const dirty = JSON.stringify([null, makeProject({ id: "p2" })]);
    storage.setItem(storageKey("ws-1"), dirty);
    const loaded = loadProjects("ws-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toBeNull();
  });

  it("真实行为：缺字段的对象原样返回，不补默认值", () => {
    const partial = [{ id: "p1", name: "only-two-fields" }];
    storage.setItem(storageKey("ws-1"), JSON.stringify(partial));
    const [first] = loadProjects("ws-1");
    expect(first).toEqual({ id: "p1", name: "only-two-fields" });
    expect(first!.branch).toBeUndefined();
    expect(first!.favorite).toBeUndefined();
  });

  it("只读取对应工作区的键，互不干扰", () => {
    storage.setItem(storageKey("ws-1"), JSON.stringify([makeProject({ id: "a" })]));
    storage.setItem(storageKey("ws-2"), JSON.stringify([]));
    expect(loadProjects("ws-1").map((project) => project.id)).toEqual(["a"]);
    expect(loadProjects("ws-2")).toEqual([]);
    expect(loadProjects("ws-3")).toEqual([]);
  });
});

describe("saveProjects", () => {
  it("写入后可被 loadProjects 读回", () => {
    const projects = [makeProject({ id: "p1", favorite: true, tags: ["work"] })];
    saveProjects("ws-1", projects);
    expect(loadProjects("ws-1")).toEqual(projects);
  });

  it("覆盖写入同一工作区，不残留旧数据", () => {
    saveProjects("ws-1", [makeProject({ id: "old" })]);
    saveProjects("ws-1", [makeProject({ id: "new" })]);
    expect(loadProjects("ws-1").map((project) => project.id)).toEqual(["new"]);
  });
});

describe("历史数据迁移（gitool.projects → gitool.projects.default）", () => {
  it("default 工作区：把旧键内容复制到新键并删除旧键", () => {
    const legacy = [makeProject({ id: "legacy" })];
    storage.setItem("gitool.projects", JSON.stringify(legacy));
    expect(loadProjects("default").map((project) => project.id)).toEqual(["legacy"]);
    expect(storage.getItem(storageKey("default"))).toBe(JSON.stringify(legacy));
    expect(storage.getItem("gitool.projects")).toBeNull();
  });

  it("default 工作区：新键已存在时以新键为准，仅清理旧键", () => {
    storage.setItem("gitool.projects", JSON.stringify([makeProject({ id: "legacy" })]));
    storage.setItem(storageKey("default"), JSON.stringify([makeProject({ id: "current" })]));
    expect(loadProjects("default").map((project) => project.id)).toEqual(["current"]);
    expect(storage.getItem("gitool.projects")).toBeNull();
  });

  it("非 default 工作区不触发旧键迁移，旧键保持原样", () => {
    const legacy = JSON.stringify([makeProject({ id: "legacy" })]);
    storage.setItem("gitool.projects", legacy);
    expect(loadProjects("ws-1")).toEqual([]);
    expect(storage.getItem("gitool.projects")).toBe(legacy);
    expect(storage.getItem(storageKey("default"))).toBeNull();
  });
});
