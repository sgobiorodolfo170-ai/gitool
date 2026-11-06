import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskProfile, TaskRun } from "../../../../shared/types";
import { closeDatabase, initDatabase } from "./database";
import {
  deleteTaskProfile,
  getTaskProfile,
  insertTaskRun,
  listTaskProfiles,
  listTaskRuns,
  saveTaskProfile,
  updateTaskRun,
} from "./tasks";

function profile(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    id: "tp-1",
    projectId: "p-1",
    projectPath: "C:\\work\\demo",
    taskType: "run",
    name: "安装依赖",
    command: "npm install",
    args: "",
    workingDirectory: "C:\\work\\demo",
    timeoutSeconds: 300,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "tr-1",
    profileId: "tp-1",
    projectId: "p-1",
    name: "安装依赖",
    command: "npm install",
    startedAt: "2026-11-01T00:00:00.000Z",
    status: "running",
    output: "",
    ...overrides,
  };
}

describe("tasks 域（任务配置与执行记录）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-tasks-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("保存任务配置后读回等价；同 id 重复保存是更新语义", () => {
    saveTaskProfile(profile());
    expect(listTaskProfiles()).toEqual([profile()]);
    expect(getTaskProfile("tp-1")).toEqual(profile());

    saveTaskProfile(profile({ name: "安装依赖（重试）", timeoutSeconds: 600 }));
    const loaded = getTaskProfile("tp-1");
    expect(loaded?.name).toBe("安装依赖（重试）");
    expect(loaded?.timeoutSeconds).toBe(600);
    expect(listTaskProfiles()).toHaveLength(1);
  });

  it("getTaskProfile 查不到时返回 undefined，不抛错", () => {
    expect(getTaskProfile("no-such-id")).toBeUndefined();
  });

  it("deleteTaskProfile 删除后不再返回", () => {
    saveTaskProfile(profile());
    deleteTaskProfile("tp-1");
    expect(listTaskProfiles()).toEqual([]);
  });

  it("执行记录按开始时间倒序，最多回 200 条", () => {
    for (let i = 1; i <= 3; i++) {
      insertTaskRun(run({ id: `tr-${i}`, startedAt: `2026-11-0${i}T00:00:00.000Z` }));
    }
    expect(listTaskRuns().map((item) => item.id)).toEqual(["tr-3", "tr-2", "tr-1"]);
  });

  it("updateTaskRun 回填结束状态：finishedAt/exitCode 可空字段往返一致", () => {
    insertTaskRun(run());
    updateTaskRun(
      run({ finishedAt: "2026-11-01T00:05:00.000Z", status: "succeeded", exitCode: 0 }),
    );
    const loaded = listTaskRuns()[0];
    expect(loaded?.finishedAt).toBe("2026-11-01T00:05:00.000Z");
    expect(loaded?.status).toBe("succeeded");
    expect(loaded?.exitCode).toBe(0);

    updateTaskRun(
      run({ id: "tr-1", finishedAt: undefined, status: "stopped", exitCode: undefined }),
    );
    const stopped = listTaskRuns()[0];
    expect(stopped?.finishedAt).toBeUndefined();
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.exitCode).toBeUndefined();
  });
});
