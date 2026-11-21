import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProfile, TaskRun } from "../../../shared/types";
import { isTaskRunning, runTask } from "./tasks";
import { closeDatabase, initDatabase } from "./storage/database";
import { listTaskRuns, saveTaskProfile } from "./storage/tasks";

/**
 * 任务运行生命周期单测（架构评审 A-22）。
 *
 * 测试策略：
 * - 真实 node:sqlite + 临时目录（验证 running/failed 记录真的落到 task_runs）；
 * - mock 子进程与进程回收：runTask 的时序（insert → spawn → close）可以精确控制，
 *   不依赖真实进程的启动速度与平台 shell 差异；
 * - mock 只做「薄包装 + 探针」，写入仍走真实 storage 模块，避免测试自己骗自己。
 */

/** 顺序/状态探针 + 可控失败开关。 */
const harness = vi.hoisted(() => ({
  /** 子进程与落库事件顺序（insert / spawn）；用来断言 insert 发生在 spawn 之前。 */
  events: [] as string[],
  /** 假子进程句柄，测试里手动 emit("close")。 */
  children: [] as { emit: (event: string, ...args: unknown[]) => boolean }[],
  /** spawn 被调用瞬间的 task_runs 状态快照。 */
  statusAtSpawn: "",
  /** 假 spawn 返回前执行一次状态快照（顺序探针）。 */
  onSpawn: null as null | (() => void),
  /** 剩余要失败的 updateTaskRun 次数（1 = 首次失败、降级成功）。 */
  failUpdates: 0,
  /** insertTaskRun 是否直接抛错。 */
  failInsertWith: null as Error | null,
  /** spawn 是否同步抛错。 */
  spawnThrowsWith: null as Error | null,
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
  }
  return {
    spawn: () => {
      if (harness.spawnThrowsWith) {
        harness.events.push("spawn-threw");
        throw harness.spawnThrowsWith;
      }
      harness.events.push("spawn");
      // 顺序探针：此刻若 insert 还没执行，下面读到的 task_runs 里不会有 running 行
      harness.onSpawn?.();
      const child = new FakeChild();
      harness.children.push(child);
      return child;
    },
  };
});

vi.mock("./processCleanup", () => ({
  killProcessTree: vi.fn(),
  // 本测试不验证进程树回收，注册即返回空注销函数
  registerProcessStopper: () => () => {},
}));

vi.mock("./storage/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage/tasks")>();
  return {
    ...actual,
    insertTaskRun: (run: TaskRun) => {
      if (harness.failInsertWith) {
        throw harness.failInsertWith;
      }
      harness.events.push("insert");
      actual.insertTaskRun(run);
    },
    updateTaskRun: (run: TaskRun) => {
      if (harness.failUpdates > 0) {
        harness.failUpdates -= 1;
        throw new Error("磁盘写入模拟失败");
      }
      actual.updateTaskRun(run);
    },
  };
});

function profile(workingDirectory: string, overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    id: "tp-1",
    projectId: "p-1",
    projectPath: workingDirectory,
    taskType: "run",
    name: "演示任务",
    command: "node",
    args: "",
    workingDirectory,
    timeoutSeconds: 0,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("tasks 运行生命周期（A-22：insert 先于 spawn，persistRun 不得静默）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-task-runs-"));
    initDatabase(dataDir);
    saveTaskProfile(profile(dataDir));

    harness.events.length = 0;
    harness.children.length = 0;
    harness.statusAtSpawn = "";
    harness.failUpdates = 0;
    harness.failInsertWith = null;
    harness.spawnThrowsWith = null;

    // 每次 spawn 时把库里 task_runs 的实时状态记下来：只有 insert 已经执行，
    // 这里才能看到 running 行（顺序探针，不需要依赖时间窗口）
    harness.onSpawn = () => {
      harness.statusAtSpawn = listTaskRuns()
        .map((row) => row.status)
        .join(",");
    };
  });

  afterEach(() => {
    harness.onSpawn = null;
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("inserts running record before spawn", async () => {
    const run = await runTask("tp-1");

    expect(harness.events.slice(0, 2)).toEqual(["insert", "spawn"]);
    expect(harness.statusAtSpawn).toBe("running");
    expect(listTaskRuns()[0]).toMatchObject({ id: run.id, status: "running" });

    harness.children[0]?.emit("close", 0);
    expect(isTaskRunning(run.id)).toBe(false);
    expect(listTaskRuns()[0]).toMatchObject({ id: run.id, status: "succeeded" });
  });

  it("writes failed record on persist error", async () => {
    const run = await runTask("tp-1");
    // 首次 UPDATE 抛错 → 触发降级写入；降级写入必须让记录离开 running 且带错误摘要
    harness.failUpdates = 1;
    harness.children[0]?.emit("close", 0);

    const [row] = listTaskRuns();
    expect(row).toMatchObject({ id: run.id, status: "failed" });
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.output).toContain("[记录写入失败] 磁盘写入模拟失败");
  });

  it("running 记录 insert 失败时直接上抛，且不会启动子进程", async () => {
    harness.failInsertWith = new Error("task_runs 写入失败");

    await expect(runTask("tp-1")).rejects.toThrow(/task_runs 写入失败/);
    expect(harness.events).toEqual([]);
    expect(listTaskRuns()).toHaveLength(0);
  });

  it("spawn 同步抛错时把已落库的 running 行定稿为 failed", async () => {
    harness.spawnThrowsWith = new Error("spawn EINVAL");

    await expect(runTask("tp-1")).rejects.toThrow(/任务启动失败：spawn EINVAL/);
    expect(listTaskRuns()[0]).toMatchObject({ status: "failed" });
    expect(listTaskRuns()[0]?.output).toContain("[启动失败] spawn EINVAL");
  });
});

// 说明：本文件用 mock 子进程替代真实进程，故覆盖了平台差异（Windows shell:true 与
// POSIX 直启的差异已在 commandLine.test.ts 单独验证），不需要 skipIf 分支。
