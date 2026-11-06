import { describe, expect, it } from "vitest";
import { projectFromSnapshot, remoteMatchKeys, remoteProjectMatch } from "./projectMatch";
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

/** 复刻 UI 侧用法（RemoteRepositoriesWorkspace/RemoteRepositorySearch）：项目键入 Set，仓库键查询命中。 */
function uiKeyHit(projects: Project[], repository: RemoteRepository): boolean {
  const set = new Set<string>();
  for (const project of projects) {
    for (const key of remoteMatchKeys(project)) set.add(key);
  }
  return remoteMatchKeys(repository).some((key) => set.has(key));
}

describe("remoteMatchKeys", () => {
  it("有 webUrl 时产出 name 键与 web 键", () => {
    expect(
      remoteMatchKeys({ provider: "github", name: "demo", webUrl: "https://github.com/me/demo" }),
    ).toEqual(["name:github:demo", "web:https://github.com/me/demo"]);
  });

  it("无 webUrl 时只产出 name 键", () => {
    expect(remoteMatchKeys({ provider: "github", name: "demo" })).toEqual(["name:github:demo"]);
  });
});

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

  it("同名不同 owner（双方 webUrl 不同）仍按退化规则匹配（已知取舍，三处统一后行为一致）", () => {
    const project = makeProject({
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/me/demo",
    });
    const remote = makeRemote({
      owner: "other",
      fullName: "other/demo",
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/other/demo",
    });
    expect(remoteProjectMatch(project, remote)).toBe(true);
    // UI 键集合视角同样命中：口径统一后不会出现「匹配函数说同仓库、星标图标却不亮」
    expect(uiKeyHit([project], remote)).toBe(true);
  });

  it("克隆后本地目录改名：name 失配但 webUrl 相同仍匹配（原键实现会丢星标的场景）", () => {
    const project = makeProject({
      provider: "github",
      name: "demo-work",
      webUrl: "https://github.com/me/demo",
    });
    const remote = makeRemote({
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/me/demo",
    });
    expect(remoteProjectMatch(project, remote)).toBe(true);
    expect(uiKeyHit([project], remote)).toBe(true);
  });

  it("克隆后改名且未保存 webUrl：name 失配则不匹配（诚实边界，不硬凑）", () => {
    const project = makeProject({ provider: "github", name: "demo-work" });
    const remote = makeRemote({ provider: "github", name: "demo" });
    expect(remoteProjectMatch(project, remote)).toBe(false);
    expect(uiKeyHit([project], remote)).toBe(false);
  });

  it("仅项目侧缺 webUrl：退化为平台+名称", () => {
    const project = makeProject({ provider: "github", name: "demo" });
    const remote = makeRemote({
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/me/demo",
    });
    expect(remoteProjectMatch(project, remote)).toBe(true);
    expect(uiKeyHit([project], remote)).toBe(true);
  });

  it("仅仓库侧缺 webUrl：退化为平台+名称", () => {
    const project = makeProject({
      provider: "github",
      name: "demo",
      webUrl: "https://github.com/me/demo",
    });
    const remote = makeRemote({ provider: "github", name: "demo" });
    expect(remoteProjectMatch(project, remote)).toBe(true);
    expect(uiKeyHit([project], remote)).toBe(true);
  });

  it("remoteProjectMatch 与 UI 键集合命中在组合矩阵下等价（语义单一事实源的守护）", () => {
    const providers = ["github", "gitee"] as const;
    const names = ["demo", "other"];
    const webUrls = [
      undefined,
      "https://github.com/me/demo",
      "https://github.com/other/demo",
    ];
    let combinations = 0;
    for (const provider of providers) {
      for (const projectName of names) {
        for (const projectWeb of webUrls) {
          for (const repoName of names) {
            for (const repoWeb of webUrls) {
              const project = makeProject({ provider, name: projectName, webUrl: projectWeb });
              const remote = makeRemote({ provider, name: repoName, webUrl: repoWeb });
              expect(uiKeyHit([project], remote)).toBe(remoteProjectMatch(project, remote));
              combinations += 1;
            }
          }
        }
      }
    }
    expect(combinations).toBe(72);
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
