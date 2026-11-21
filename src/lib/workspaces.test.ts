import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  projectStorageKey,
  renameWorkspace,
} from "./workspaces";
import type { WorkspaceEntity } from "../types";

const WORKSPACE_KEY = "gitool.workspaces";

/**
 * Node 环境无 localStorage，用内存 Map 复刻 Storage 最小语义并通过
 * vi.stubGlobal 注入；afterEach 还原，保证各测试文件互不影响。
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

function makeWorkspace(overrides: Partial<WorkspaceEntity> = {}): WorkspaceEntity {
  return {
    id: "ws-a",
    name: "工作区 A",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function readStoredWorkspaces(): WorkspaceEntity[] {
  return JSON.parse(storage.getItem(WORKSPACE_KEY) ?? "null") as WorkspaceEntity[];
}

describe("listWorkspaces", () => {
  it("首次读取自动种下默认工作区并落盘", () => {
    const list = listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: DEFAULT_WORKSPACE_ID, name: "个人工作区" });
    expect(readStoredWorkspaces()).toHaveLength(1);
    expect(readStoredWorkspaces()[0].id).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("已有数组原样返回，不重写存储", () => {
    const stored = [makeWorkspace({ id: "ws-a" }), makeWorkspace({ id: "ws-b", name: "B" })];
    const raw = JSON.stringify(stored);
    storage.setItem(WORKSPACE_KEY, raw);
    expect(listWorkspaces()).toEqual(stored);
    expect(storage.getItem(WORKSPACE_KEY)).toBe(raw);
  });

  it("非法 JSON：容忍并回退为默认工作区（会重写损坏数据）", () => {
    storage.setItem(WORKSPACE_KEY, "{{ broken");
    const list = listWorkspaces();
    expect(list.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(readStoredWorkspaces()).toHaveLength(1);
  });

  it("合法 JSON 但非数组：容忍并回退为默认工作区", () => {
    storage.setItem(WORKSPACE_KEY, JSON.stringify({ id: "ws-a" }));
    expect(listWorkspaces().map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(readStoredWorkspaces()).toHaveLength(1);
  });

  it("真实行为：数组内元素不做结构校验，null 原样返回", () => {
    storage.setItem(WORKSPACE_KEY, JSON.stringify([null]));
    const list = listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0]).toBeNull();
  });
});

describe("createWorkspace", () => {
  it("名称 trim 后创建，并持久化到列表末尾", () => {
    const created = createWorkspace({ name: "  团队  " });
    expect(created.name).toBe("团队");
    expect(created.id).toMatch(/^ws-/);
    expect(created.createdAt).toBe(created.updatedAt);

    const stored = readStoredWorkspaces();
    expect(stored.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, created.id]);
  });

  it("空名称与纯空白名称都抛错，且不落盘", () => {
    expect(() => createWorkspace({ name: "" })).toThrow("工作区名称不能为空");
    expect(() => createWorkspace({ name: " \t\n " })).toThrow("工作区名称不能为空");
    expect(storage.getItem(WORKSPACE_KEY)).toBeNull();
  });
});

describe("renameWorkspace", () => {
  it("改名并刷新 updatedAt，其余字段保持不变", () => {
    const stored = [makeWorkspace({ id: "ws-a" })];
    storage.setItem(WORKSPACE_KEY, JSON.stringify(stored));

    renameWorkspace({ id: "ws-a", name: "  新名字  " });

    const [renamed] = readStoredWorkspaces();
    expect(renamed.name).toBe("新名字");
    expect(renamed.id).toBe("ws-a");
    expect(renamed.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(renamed.updatedAt).not.toBe(renamed.createdAt);
  });

  it("空名称抛错，且不改动存储", () => {
    const raw = JSON.stringify([makeWorkspace({ id: "ws-a" })]);
    storage.setItem(WORKSPACE_KEY, raw);
    expect(() => renameWorkspace({ id: "ws-a", name: "  " })).toThrow("工作区名称不能为空");
    expect(storage.getItem(WORKSPACE_KEY)).toBe(raw);
  });

  it("工作区不存在时抛错", () => {
    storage.setItem(WORKSPACE_KEY, JSON.stringify([makeWorkspace({ id: "ws-a" })]));
    expect(() => renameWorkspace({ id: "missing", name: "新的" })).toThrow("工作区不存在");
  });
});

describe("deleteWorkspace", () => {
  it("只剩一个工作区时拒绝删除（守卫优先于存在性判断）", () => {
    listWorkspaces(); // 种下唯一的默认工作区
    expect(() => deleteWorkspace(DEFAULT_WORKSPACE_ID)).toThrow(
      "至少保留一个工作区，无法删除最后一个工作区",
    );
  });

  it("多个工作区但 id 不存在时抛错", () => {
    storage.setItem(
      WORKSPACE_KEY,
      JSON.stringify([makeWorkspace({ id: "ws-a" }), makeWorkspace({ id: "ws-b" })]),
    );
    expect(() => deleteWorkspace("missing")).toThrow("工作区不存在");
  });

  it("工作区仍有项目时拒绝删除，文案带项目数量，且存储不被改动", () => {
    storage.setItem(
      WORKSPACE_KEY,
      JSON.stringify([makeWorkspace({ id: "ws-a" }), makeWorkspace({ id: "ws-b" })]),
    );
    const projects = JSON.stringify([{ id: "p1" }, { id: "p2" }, { id: "p3" }]);
    storage.setItem(projectStorageKey("ws-b"), projects);

    expect(() => deleteWorkspace("ws-b")).toThrow(
      "该工作区还有 3 个项目，请先清空或移动项目后再删除",
    );
    expect(readStoredWorkspaces().map((workspace) => workspace.id)).toEqual(["ws-a", "ws-b"]);
    expect(storage.getItem(projectStorageKey("ws-b"))).toBe(projects);
  });

  it("项目列表为空数组时允许删除，并清理项目键", () => {
    storage.setItem(
      WORKSPACE_KEY,
      JSON.stringify([makeWorkspace({ id: "ws-a" }), makeWorkspace({ id: "ws-b" })]),
    );
    storage.setItem(projectStorageKey("ws-b"), "[]");

    deleteWorkspace("ws-b");

    expect(readStoredWorkspaces().map((workspace) => workspace.id)).toEqual(["ws-a"]);
    expect(storage.getItem(projectStorageKey("ws-b"))).toBeNull();
  });

  it("项目数据损坏时容忍（视为无项目），删除照常完成", () => {
    storage.setItem(
      WORKSPACE_KEY,
      JSON.stringify([makeWorkspace({ id: "ws-a" }), makeWorkspace({ id: "ws-b" })]),
    );
    storage.setItem(projectStorageKey("ws-b"), "{ corrupted");

    expect(() => deleteWorkspace("ws-b")).not.toThrow();
    expect(readStoredWorkspaces().map((workspace) => workspace.id)).toEqual(["ws-a"]);
    expect(storage.getItem(projectStorageKey("ws-b"))).toBeNull();
  });
});

describe("projectStorageKey", () => {
  it("按工作区 id 拼出项目存储键", () => {
    expect(projectStorageKey("ws-a")).toBe("gitool.projects.ws-a");
    expect(projectStorageKey(DEFAULT_WORKSPACE_ID)).toBe("gitool.projects.default");
  });
});
