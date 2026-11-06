import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, initDatabase } from "./database";
import { saveProjects } from "./projects";
import { createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace } from "./workspaces";
import type { Project } from "../../../../shared/types";

const demoProject = (id: string): Project => ({
  id,
  name: "演示项目",
  path: `C:\\work\\${id}`,
  provider: "local",
  branch: "main",
  status: "clean",
  commit: "abc1234",
  favorite: false,
  tags: [],
  files: 1,
  syncLabel: "已同步",
  language: "TypeScript",
  languageColor: "#3178c6",
  summary: "",
  updatedAt: "2026-11-01T00:00:00.000Z",
  diskSizeBytes: 0,
});

describe("workspaces 域（工作区）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-workspaces-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("新库自带种子默认工作区「个人工作区」", () => {
    const workspaces = listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).toBe("default");
    expect(workspaces[0]?.name).toBe("个人工作区");
  });

  it("创建、重命名后列表如实反映", () => {
    const created = createWorkspace({ name: "  工作区B  " });
    // 名称首尾空白被裁剪
    expect(created.name).toBe("工作区B");
    renameWorkspace({ id: created.id, name: "工作区C" });
    const names = listWorkspaces().map((item) => item.name);
    expect(names).toContain("工作区C");
    expect(names).not.toContain("工作区B");
  });

  it("创建或重命名为空名称（含纯空白）被拒绝", () => {
    expect(() => createWorkspace({ name: "   " })).toThrow("工作区名称不能为空");
    const created = createWorkspace({ name: "临时" });
    expect(() => renameWorkspace({ id: created.id, name: " " })).toThrow("工作区名称不能为空");
  });

  it("不能删除最后一个工作区", () => {
    expect(() => deleteWorkspace("default")).toThrow("至少保留一个工作区，无法删除最后一个工作区");
  });

  it("工作区下还有项目时禁止删除，提示项目数量", () => {
    const target = createWorkspace({ name: "待删除" });
    saveProjects(target.id, [demoProject("p-1")]);
    expect(() => deleteWorkspace(target.id)).toThrow("该工作区还有 1 个项目");
  });

  it("无项目的空工作区可以删除", () => {
    const target = createWorkspace({ name: "临时工作区" });
    deleteWorkspace(target.id);
    expect(listWorkspaces().some((item) => item.id === target.id)).toBe(false);
  });

  it("重命名不存在的工作区报「工作区不存在」", () => {
    expect(() => renameWorkspace({ id: "no-such-id", name: "新名字" })).toThrow("工作区不存在");
  });

  it("删除不存在的工作区报「工作区不存在」", () => {
    // 库里已有种子工作区，删除守卫先检查数量再看存在性，需要再造一个才能触达该分支
    createWorkspace({ name: "占位" });
    expect(() => deleteWorkspace("no-such-id")).toThrow("工作区不存在");
  });
});
