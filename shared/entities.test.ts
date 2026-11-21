import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE_COLOR,
  DEFAULT_PROJECT_STATUS,
  DEFAULT_TASK_ARGS,
  DEFAULT_TASK_TIMEOUT_SECONDS,
  UNCLONED_LABEL,
  createProject,
  createTaskProfile,
} from "./entities";
import type { Project, TaskProfile } from "./types";
import { projectSchema, taskProfileSchema } from "../electron/main/ipc/schemas";

/**
 * 投影测试：工厂产物必须能被 IPC 写入侧的 schema 原样接受。
 *
 * 为什么测试放在 shared 却 import electron/main/ipc/schemas：
 * 这正是「投影」的含义——工厂在主/渲染两侧共用，但落库前必须过主进程的
 * schema。若工厂默认值与 schema 契约漂移（缺字段、枚举越界），这里立刻红。
 * 反过来，schema 已收窄的业务字段一旦被工厂/调用方写坏，也会在这里暴露，
 * 不再是运行时「静默改写后看似成功」。
 */

const FULL_PROJECT: Project = createProject({
  id: "p1",
  name: "demo",
  path: "C:\\work\\demo",
  provider: "github",
  branch: "main",
  commit: "abc1234",
  favorite: true,
  tags: ["work", "remote"],
  remote: "origin",
  files: 12,
  syncLabel: "已同步",
  language: "TypeScript",
  languageColor: "#3178c6",
  summary: "示例项目",
  updatedAt: "2026-11-21T10:00:00.000Z",
  diskSizeBytes: 2048,
  alias: "我的项目",
  webUrl: "https://github.com/example/demo",
});

describe("createProject", () => {
  it("最小种子产出字段完整的 Project，且原样通过 projectSchema", () => {
    const project = createProject({ id: "p1", name: "demo", path: "C:\\work\\demo" });

    expect(project.status).toBe(DEFAULT_PROJECT_STATUS);
    expect(project.provider).toBe("local");
    expect(project.branch).toBe("main");
    expect(project.favorite).toBe(false);
    expect(project.tags).toEqual([]);
    expect(project.files).toBe(0);
    expect(project.diskSizeBytes).toBe(0);
    expect(project.languageColor).toBe(DEFAULT_LANGUAGE_COLOR);
    // 必填字段不得是 undefined（否则落库时会被 schema 拒绝或产生 undefined 列）
    expect(project.id).toBe("p1");
    expect(project.name).toBe("demo");
    expect(project.path).toBe("C:\\work\\demo");
    expect(projectSchema.safeParse(project).success).toBe(true);
  });

  it("完整字段原样保留，schema 解析结果与工厂产物一致（无字段漂移）", () => {
    expect(projectSchema.safeParse(FULL_PROJECT).success).toBe(true);
    // 关键字段逐一对比：防止 schema 的 catch 把业务字段改写成默认值
    const parsed = projectSchema.parse(FULL_PROJECT);
    expect(parsed).toEqual(FULL_PROJECT);
    expect(parsed.status).toBe("clean");
    expect(parsed.favorite).toBe(true);
    expect(parsed.tags).toEqual(["work", "remote"]);
    expect(parsed.webUrl).toBe("https://github.com/example/demo");
  });

  it("远程收藏占位项目（空消息）仍能过 schema", () => {
    // 真实用例：toggleRemoteFavorite 用「未克隆」文案 + 空摘要构造占位项目
    const stub = createProject({
      id: "fav:github:example/demo",
      name: "demo",
      path: "C:\\stub\\demo",
      provider: "github",
      commit: UNCLONED_LABEL,
      favorite: true,
      tags: ["remote", "favorite"],
      syncLabel: UNCLONED_LABEL,
      language: UNCLONED_LABEL,
      summary: "",
      updatedAt: "2026-11-21T10:00:00.000Z",
      webUrl: undefined,
    });

    expect(projectSchema.safeParse(stub).success).toBe(true);
    expect(stub.summary).toBe("");
    expect(stub.commit).toBe(UNCLONED_LABEL);
    expect(stub.webUrl).toBeUndefined();
  });

  it("空路径被 schema 拒绝：这是改造前后一致的既有契约（本次未放宽）", () => {
    // 锁定事实：远程占位项目用 path: ""，而 projectSchema 的 path 一直是
    // requiredString（本次收窄没有触碰它）。工厂原样透传，不会替它补一个假路径。
    const stub = createProject({ id: "fav:p", name: "demo", path: "", provider: "github" });

    expect(stub.path).toBe("");
    expect(projectSchema.safeParse(stub).success).toBe(false);
  });

  it("缺失可选字段（remote / alias / webUrl）时 schema 通过且不补造值", () => {
    const parsed = projectSchema.parse(
      createProject({ id: "p1", name: "demo", path: "C:\\work\\demo" }),
    );

    expect(parsed.remote).toBeUndefined();
    expect(parsed.alias).toBeUndefined();
    expect(parsed.webUrl).toBeUndefined();
  });

  it("4096 边界内超长字段不被静默截断，超限则在 schema 层拒绝（A-13 cap）", () => {
    // A-13 给 requiredString / looseString 补了 4096 上限：边界内必须原样通过
    //（证明工厂不与 schema 漂移、也不会悄悄截断），超限则必须报错而不是截断落库。
    const boundaryName = "n".repeat(4096);
    const boundarySummary = "s".repeat(4096);
    const project = createProject({
      id: "p1",
      name: boundaryName,
      path: "C:\\work\\demo",
      summary: boundarySummary,
    });

    const parsed = projectSchema.parse(project);
    expect(parsed.name).toBe(boundaryName);
    expect(parsed.summary).toBe(boundarySummary);
    expect(
      projectSchema.safeParse(
        createProject({ id: "p1", name: "n".repeat(4097), path: "C:\\work\\demo" }),
      ).success,
    ).toBe(false);
  });

  it("非法业务字段不再被兜底：status / provider / tags / favorite 均必须报错", () => {
    const base = createProject({ id: "p1", name: "demo", path: "C:\\work\\demo" });

    // 反向测试：证明 schemas.ts 的 .catch() 已从业务字段收窄（旧的坏状态会静默变 clean）
    expect(projectSchema.safeParse({ ...base, status: "weird" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, provider: "bitbucket" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, tags: [1, 2] }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, favorite: "yes" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...base, id: "" }).success).toBe(false);
  });

  it("工厂不校验平台：未知 provider 会被 schema 拒绝而不是被工厂悄悄改成 local", () => {
    // 工厂只负责补默认值，不做静默纠正；漂移必须由 schema 报错暴露。
    const drifted = createProject({
      id: "p1",
      name: "demo",
      path: "C:\\work\\demo",
      provider: "bitbucket" as Project["provider"],
    });

    expect(drifted.provider).toBe("bitbucket");
    expect(projectSchema.safeParse(drifted).success).toBe(false);
  });

  it("派生展示字段仍保留兜底：坏 status 后续不能，坏 languageColor / diskSizeBytes 可以", () => {
    const base = createProject({ id: "p1", name: "demo", path: "C:\\work\\demo" });
    const parsed = projectSchema.parse({
      ...base,
      languageColor: 123,
      diskSizeBytes: "big",
      files: null,
    });

    expect(parsed.languageColor).toBe(DEFAULT_LANGUAGE_COLOR);
    expect(parsed.diskSizeBytes).toBe(0);
    expect(parsed.files).toBe(0);
  });
});

const FULL_PROFILE: TaskProfile = createTaskProfile({
  id: "task-1",
  projectId: "p1",
  projectPath: "C:\\work\\demo",
  taskType: "build",
  name: "demo 1",
  command: "npm",
  args: "run build",
  workingDirectory: "C:\\work\\demo",
  timeoutSeconds: 120,
  createdAt: "2026-11-21T10:00:00.000Z",
});

describe("createTaskProfile", () => {
  it("产出字段完整的 TaskProfile 并通过 taskProfileSchema", () => {
    expect(taskProfileSchema.safeParse(FULL_PROFILE).success).toBe(true);
    expect(taskProfileSchema.parse(FULL_PROFILE)).toEqual(FULL_PROFILE);
  });

  it("缺省 args / timeoutSeconds 时给出真实默认值（空消息 + 不限制超时）", () => {
    const profile = createTaskProfile({
      id: "task-2",
      projectId: "p1",
      projectPath: "C:\\work\\demo",
      taskType: "run",
      name: "demo",
      command: "npm",
      workingDirectory: "C:\\work\\demo",
      createdAt: "2026-11-21T10:00:00.000Z",
    });

    expect(profile.args).toBe(DEFAULT_TASK_ARGS);
    expect(profile.timeoutSeconds).toBe(DEFAULT_TASK_TIMEOUT_SECONDS);
    expect(taskProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("参数在 4096 边界内不被截断，超限则在 schema 层拒绝（A-13 cap）", () => {
    // 参数会原样进入子进程命令行：边界内必须原样保留，超限则报错，
    // 避免把超长命令行交给 spawn。
    const boundaryArgs = "--flag=" + "a".repeat(4096 - "--flag=".length);
    const profile = createTaskProfile({
      ...FULL_PROFILE,
      args: boundaryArgs,
    });

    expect(taskProfileSchema.parse(profile).args).toBe(boundaryArgs);
    expect(taskProfileSchema.safeParse({ ...FULL_PROFILE, args: `${boundaryArgs}a` }).success).toBe(
      false,
    );
  });

  it("非法业务字段必须报错：未知任务类型、空命令、非数字超时、非字符串参数", () => {
    expect(taskProfileSchema.safeParse({ ...FULL_PROFILE, taskType: "unknown" }).success).toBe(
      false,
    );
    expect(taskProfileSchema.safeParse({ ...FULL_PROFILE, command: "" }).success).toBe(false);
    // 收窄后只对「缺省」兜底，类型漂移必须报错（0 代表不限制超时，静默退化会变成无界任务）
    expect(taskProfileSchema.safeParse({ ...FULL_PROFILE, timeoutSeconds: "120" }).success).toBe(
      false,
    );
    expect(taskProfileSchema.safeParse({ ...FULL_PROFILE, args: ["run", "build"] }).success).toBe(
      false,
    );
  });
});
