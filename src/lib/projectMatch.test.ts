import { describe, expect, it } from "vitest";
import { projectFromSnapshot, remoteProjectMatch } from "./projectMatch";
import type { GitSnapshot, Project, RemoteRepository } from "../../shared/types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "demo",
    path: "C:\\work\\demo",
    provider: "local",
    branch: "main",
    status: "clean",
    commit: "abc1234",
    favorite: true,
    tags: ["work"],
    files: 3,
    syncLabel: "已同步",
    language: "TypeScript",
    languageColor: "#3178c6",
    summary: "示例",
    updatedAt: "2026-10-01",
    diskSizeBytes: 100,
    alias: "我的项目",
    ...overrides,
  };
}

function makeRemote(overrides: Partial<RemoteRepository> = {}): RemoteRepository {
  return {
    id: "1",
    accountId: "acc",
    provider: "github",
    owner: "me",
    name: "demo",
    fullName: "me/demo",
    description: "",
    visibility: "public",
    defaultBranch: "main",
    httpsUrl: "https://github.com/me/demo.git",
    archived: false,
    updatedAt: "2026-10-01",
    ...overrides,
  };
}

describe("remoteProjectMatch", () => {
  it("webUrl 相同即视为同一仓库", () => {
    const project = makeProject({ webUrl: "https://github.com/me/demo" });
    const remote = makeRemote({ webUrl: "https://github.com/me/demo" });
    expect(remoteProjectMatch(project, remote)).toBe(true);
  });

  it("webUrl 不同但同名同平台也算匹配（退化规则）", () => {
    const project = makeProject({ provider: "github", name: "demo" });
    const remote = makeRemote({ name: "demo", provider: "github" });
    expect(remoteProjectMatch(project, remote)).toBe(true);
  });

  it("平台不同则不匹配", () => {
    const project = makeProject({ provider: "gitee", name: "demo" });
    const remote = makeRemote({ provider: "github", name: "demo" });
    expect(remoteProjectMatch(project, remote)).toBe(false);
  });

  it("同名但 webUrl 明确不同时仍按退化规则判定（已知取舍）", () => {
    const project = makeProject({
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/a/demo",
    });
    const remote = makeRemote({
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/b/demo",
    });
    expect(remoteProjectMatch(project, remote)).toBe(true);
  });

  it("名不同则不匹配", () => {
    const project = makeProject({ provider: "github", name: "other" });
    const remote = makeRemote({ provider: "github", name: "demo" });
    expect(remoteProjectMatch(project, remote)).toBe(false);
  });
});

describe("projectFromSnapshot", () => {
  const snapshot: GitSnapshot = {
    branch: "feature/x",
    status: "dirty",
    commit: "def5678",
    files: 9,
    sync_label: "9 个文件未提交",
    updated_at: "2026-10-26",
  };

  it("覆盖快照中存在的字段", () => {
    const next = projectFromSnapshot(makeProject(), snapshot);
    expect(next.branch).toBe("feature/x");
    expect(next.status).toBe("dirty");
    expect(next.commit).toBe("def5678");
    expect(next.files).toBe(9);
    expect(next.syncLabel).toBe("9 个文件未提交");
    expect(next.updatedAt).toBe("2026-10-26");
  });

  it("保留用户数据：收藏、标签、别名、磁盘占用", () => {
    const next = projectFromSnapshot(makeProject(), snapshot);
    expect(next.favorite).toBe(true);
    expect(next.tags).toEqual(["work"]);
    expect(next.alias).toBe("我的项目");
    expect(next.diskSizeBytes).toBe(100);
  });

  it("不修改原对象", () => {
    const original = makeProject();
    projectFromSnapshot(original, snapshot);
    expect(original.branch).toBe("main");
  });
});
