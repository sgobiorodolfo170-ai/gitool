import { describe, expect, it } from "vitest";
import {
  aiSecretSchema,
  appSettingsSchema,
  commitRequestSchema,
  createBranchInputSchema,
  gitOperationSchema,
  parseOrThrow,
  projectSchema,
  remoteRepositorySearchInputSchema,
  taskProfileSchema,
  remoteRepositoryWriteInputSchema,
} from "./schemas";

describe("aiSecretSchema", () => {
  it("空值与超长值拒绝", () => {
    expect(() => aiSecretSchema.parse("")).toThrow();
    expect(() => aiSecretSchema.parse("   ")).toThrow();
    expect(() => aiSecretSchema.parse("k".repeat(4097))).toThrow();
    expect(aiSecretSchema.parse("sk-ant-123")).toBe("sk-ant-123");
  });
});

describe("parseOrThrow", () => {
  it("合法输入原样返回", () => {
    expect(
      parseOrThrow(createBranchInputSchema, { path: "C:\\a", name: "main" }, "创建分支参数"),
    ).toEqual({ path: "C:\\a", name: "main" });
  });

  it("必填字段缺失时抛出中文文案，不带 zod 的路径前缀", () => {
    expect(() =>
      parseOrThrow(createBranchInputSchema, { path: "", name: "main" }, "创建分支参数"),
    ).toThrow("项目路径不能为空");
    // 断言不是 zod 默认的英文 "Too small..." 或 "path: ..."
    try {
      parseOrThrow(createBranchInputSchema, { name: "main" }, "创建分支参数");
    } catch (error) {
      expect((error as Error).message).not.toContain("path");
      expect((error as Error).message).not.toContain("expected");
    }
  });

  it("非对象输入回退到标签文案", () => {
    expect(() => parseOrThrow(createBranchInputSchema, null, "创建分支参数")).toThrow(
      "创建分支参数格式不正确",
    );
  });

  it("纯空白字符串视为空", () => {
    expect(() =>
      parseOrThrow(createBranchInputSchema, { path: "   ", name: "main" }, "创建分支参数"),
    ).toThrow("项目路径不能为空");
  });
});

describe("taskProfileSchema", () => {
  const base = {
    id: "t1",
    projectId: "p1",
    projectPath: "C:\\a",
    name: "构建",
    command: "npm",
    args: "run build",
    workingDirectory: "C:\\a",
    timeoutSeconds: 60,
    createdAt: "2026-10-29",
  };

  it("接受 deploy 类型（回归：曾漏掉导致部署命令存不进去）", () => {
    expect(taskProfileSchema.parse({ ...base, taskType: "deploy" }).taskType).toBe("deploy");
  });

  it("拒绝未知任务类型", () => {
    expect(() => taskProfileSchema.parse({ ...base, taskType: "unknown" })).toThrow();
  });

  it("缺省 args 与 timeoutSeconds 时给默认值", () => {
    const { args, timeoutSeconds, ...rest } = base;
    const parsed = taskProfileSchema.parse({ ...rest, taskType: "build" });
    expect(parsed.args).toBe("");
    expect(parsed.timeoutSeconds).toBe(0);
  });
});

describe("gitOperationSchema", () => {
  it("接受四个同步类操作", () => {
    for (const op of ["fetch", "pull", "push", "sync"]) {
      expect(gitOperationSchema.parse(op)).toBe(op);
    }
  });

  it("拒绝 revert（走独立通道）", () => {
    expect(() => gitOperationSchema.parse("revert")).toThrow("不支持的 Git 操作");
  });
});

describe("projectSchema", () => {
  const base = { id: "p1", name: "demo", path: "C:\\a", provider: "local", status: "clean" };

  it("身份与状态字段齐备即可通过，派生展示字段用默认值补齐", () => {
    const parsed = projectSchema.parse(base);
    expect(parsed.branch).toBe("");
    expect(parsed.status).toBe("clean");
    expect(parsed.favorite).toBe(false);
    expect(parsed.tags).toEqual([]);
    expect(parsed.languageColor).toBe("#8b97a8");
    expect(parsed.diskSizeBytes).toBe(0);
  });

  it("非法状态直接报错，不再静默改写为 clean（P-02 / A-15 收窄）", () => {
    // 旧行为是 .catch("clean")：脏工作区/冲突会被落库成 clean，导致用户误判可安全操作。
    expect(() => projectSchema.parse({ ...base, status: "weird" })).toThrow("项目状态无效");
  });

  it("tags 里的非字符串项直接报错，不再整组清空", () => {
    // 标签里的 watching/favorite 驱动 UI 判定，静默清空等于丢用户数据。
    expect(() => projectSchema.parse({ ...base, tags: [1, 2] })).toThrow();
  });

  it("alias / webUrl 的空白串归一为 undefined", () => {
    const parsed = projectSchema.parse({ ...base, alias: "  ", webUrl: "  " });
    expect(parsed.alias).toBeUndefined();
    expect(parsed.webUrl).toBeUndefined();
  });

  it("alias 前后空格被裁掉", () => {
    expect(projectSchema.parse({ ...base, alias: " 我的项目 " }).alias).toBe("我的项目");
  });

  it("拒绝未知平台", () => {
    expect(() => projectSchema.parse({ ...base, provider: "bitbucket" })).toThrow("项目的平台无效");
  });

  it("剥离未知字段", () => {
    const parsed = projectSchema.parse({ ...base, evil: "x" }) as Record<string, unknown>;
    expect(parsed.evil).toBeUndefined();
  });
});

describe("appSettingsSchema", () => {
  it("空对象也能解析，全部字段给空串", () => {
    const parsed = appSettingsSchema.parse({});
    expect(parsed.gitPath).toBe("");
    expect(parsed.aiApiKeyConfigured).toBe(false);
    expect(parsed.closeToTray).toBe(false);
  });

  it("类型错误的字段退回默认值而不是抛错", () => {
    const parsed = appSettingsSchema.parse({ gitPath: 123, aiApiKeyConfigured: "yes" });
    expect(parsed.gitPath).toBe("");
    expect(parsed.aiApiKeyConfigured).toBe(false);
  });

  it("closeToTray 非布尔值回退 false（缺键/坏数据不破坏关闭行为判定）", () => {
    expect(appSettingsSchema.parse({ closeToTray: "yes" }).closeToTray).toBe(false);
    expect(appSettingsSchema.parse({ closeToTray: 1 }).closeToTray).toBe(false);
    expect(appSettingsSchema.parse({ closeToTray: true }).closeToTray).toBe(true);
  });
});

describe("remoteRepositoryWriteInputSchema", () => {
  const base = { accountId: "a1", name: "repo", description: "", visibility: "public" as const };

  it("接受空可见性（表示不修改）", () => {
    expect(remoteRepositoryWriteInputSchema.parse({ ...base, visibility: "" }).visibility).toBe("");
  });

  it("拒绝非法可见性", () => {
    expect(() => remoteRepositoryWriteInputSchema.parse({ ...base, visibility: "secret" })).toThrow(
      "可见性必须为 public、private 或 internal",
    );
  });

  it("repositoryId 空串归一为 undefined", () => {
    expect(
      remoteRepositoryWriteInputSchema.parse({ ...base, repositoryId: "" }).repositoryId,
    ).toBeUndefined();
  });

  it("init 缺省为 false", () => {
    expect(remoteRepositoryWriteInputSchema.parse(base).init).toBe(false);
  });
});

describe("IPC 字符串/数组长度上限（A-13）", () => {
  const baseProject = { id: "p1", name: "demo", path: "C:\\a", provider: "local", status: "clean" };

  it("超长项目名（5000）拒绝，4096 边界通过", () => {
    expect(() => projectSchema.parse({ ...baseProject, name: "名".repeat(5000) })).toThrow(
      "项目名称过长（最多 4096 字符）",
    );
    expect(projectSchema.parse({ ...baseProject, name: "名".repeat(4096) }).name).toHaveLength(
      4096,
    );
  });

  it("超长 tag 单项拒绝，4096 边界通过", () => {
    expect(() => projectSchema.parse({ ...baseProject, tags: ["t".repeat(4097)] })).toThrow(
      "标签过长（最多 4096 字符）",
    );
    expect(projectSchema.parse({ ...baseProject, tags: ["t".repeat(4096)] }).tags[0]).toHaveLength(
      4096,
    );
  });

  it("tags 总量超过 10000 拒绝，10000 边界通过", () => {
    expect(() => projectSchema.parse({ ...baseProject, tags: new Array(10001).fill("t") })).toThrow(
      "标签数量过多（最多 10000 个）",
    );
    expect(
      projectSchema.parse({ ...baseProject, tags: new Array(10000).fill("t") }).tags,
    ).toHaveLength(10000);
  });

  it("超长搜索词拒绝，4096 边界通过", () => {
    expect(() =>
      remoteRepositorySearchInputSchema.parse({ provider: "github", query: "q".repeat(4097) }),
    ).toThrow("搜索关键词过长（最多 4096 字符）");
    expect(
      remoteRepositorySearchInputSchema.parse({ provider: "github", query: "q".repeat(4096) })
        .query,
    ).toHaveLength(4096);
  });

  it("提交信息按 git 服务层同一口径（2000）拒绝", () => {
    expect(() => commitRequestSchema.parse({ path: "C:\\a", message: "m".repeat(2001) })).toThrow(
      "提交信息过长（最多 2000 字符）",
    );
    expect(
      commitRequestSchema.parse({ path: "C:\\a", message: "m".repeat(2000) }).message,
    ).toHaveLength(2000);
  });

  it("任务命令 / 参数超长拒绝（参数会进子进程命令行）", () => {
    const base = {
      id: "t1",
      projectId: "p1",
      projectPath: "C:\\a",
      taskType: "build" as const,
      name: "构建",
      command: "npm",
      args: "",
      workingDirectory: "C:\\a",
      createdAt: "2026-10-29",
    };
    expect(() => taskProfileSchema.parse({ ...base, command: "c".repeat(4097) })).toThrow(
      "命令过长（最多 4096 字符）",
    );
    expect(() => taskProfileSchema.parse({ ...base, args: "a".repeat(4097) })).toThrow();
    expect(taskProfileSchema.parse(base).command).toBe("npm");
  });
});
