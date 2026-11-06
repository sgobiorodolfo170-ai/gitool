import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../../../../shared/types";
import { closeDatabase, initDatabase, openDatabase } from "./database";
import { loadProjects, saveProjects } from "./projects";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    name: "演示项目",
    path: "C:\\work\\demo",
    provider: "local",
    branch: "main",
    status: "clean",
    commit: "abc1234",
    favorite: false,
    tags: ["前端", "工具"],
    remote: "https://example.com/demo.git",
    files: 42,
    syncLabel: "已同步",
    language: "TypeScript",
    languageColor: "#3178c6",
    summary: "一句话说明",
    updatedAt: "2026-11-01T00:00:00.000Z",
    diskSizeBytes: 1024,
    alias: "demo",
    webUrl: "https://example.com/demo",
    ...overrides,
  };
}

describe("projects 域（saveProjects 串行落库的后端写入路径）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-projects-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("保存后读回：全部字段等价，可空字段 remote/alias/webUrl 缺省时读回为 undefined", () => {
    const full = project();
    saveProjects("ws-a", [full]);
    expect(loadProjects("ws-a")).toEqual([full]);

    const minimal = project({
      id: "p-2",
      remote: undefined,
      alias: undefined,
      webUrl: undefined,
      favorite: true,
    });
    saveProjects("ws-a", [full, minimal]);
    const loaded = loadProjects("ws-a");
    const second = loaded.find((item) => item.id === "p-2");
    expect(second?.remote).toBeUndefined();
    expect(second?.alias).toBeUndefined();
    expect(second?.webUrl).toBeUndefined();
    expect(second?.favorite).toBe(true);
  });

  it("再次保存时列表中已消失的项目被删除（无软删除语义），保留项目原地更新", () => {
    saveProjects("ws-a", [project({ id: "p-1" }), project({ id: "p-2", name: "旧名字" })]);
    saveProjects("ws-a", [project({ id: "p-2", name: "新名字" })]);
    const loaded = loadProjects("ws-a");
    expect(loaded.map((item) => item.id)).toEqual(["p-2"]);
    expect(loaded[0]?.name).toBe("新名字");
  });

  it("排序：收藏优先，其后按 updatedAt 倒序", () => {
    saveProjects("ws-a", [
      project({ id: "p-1", favorite: false, updatedAt: "2026-11-03T00:00:00.000Z" }),
      project({ id: "p-2", favorite: true, updatedAt: "2026-11-01T00:00:00.000Z" }),
      project({ id: "p-3", favorite: false, updatedAt: "2026-11-02T00:00:00.000Z" }),
    ]);
    expect(loadProjects("ws-a").map((item) => item.id)).toEqual(["p-2", "p-1", "p-3"]);
  });

  it("工作区隔离：保存到 ws-a 的项目在 ws-b 不可见", () => {
    saveProjects("ws-a", [project()]);
    expect(loadProjects("ws-b")).toEqual([]);
    expect(loadProjects("ws-a")).toHaveLength(1);
  });

  it("写入中途失败时整体回滚：已有数据不受影响，错误文案统一", () => {
    saveProjects("ws-a", [project({ id: "p-0" })]);
    // tags 为 undefined → JSON.stringify 返回 undefined → 参数绑定抛错 → 事务 ROLLBACK
    expect(() =>
      saveProjects("ws-a", [project({ id: "p-1", tags: undefined as unknown as string[] })]),
    ).toThrow("本地数据存储失败");
    expect(loadProjects("ws-a").map((item) => item.id)).toEqual(["p-0"]);
  });

  it("tags 存了非法 JSON 时容错为空数组，不让单行坏数据拖垮整个列表", () => {
    saveProjects("ws-a", [project()]);
    closeDatabase();
    initDatabase(dataDir);
    openDatabase().prepare("UPDATE projects SET tags = 'not-json' WHERE id = 'p-1'").run();
    const loaded = loadProjects("ws-a");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.tags).toEqual([]);
  });
});
