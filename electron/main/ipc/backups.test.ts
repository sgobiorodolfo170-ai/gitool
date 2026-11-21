import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 备份 IPC 通道的路径白名单行为（P1-2 冒烟缺口的回归）。
 *
 * why 需要 handler 级用例：sourcePath 只由 ipc.ts 的 requireAllowedProjectPath 把关，
 * 服务层不重复校验源路径；只在服务层测试无法证明「C:\Windows\System32 作为备份源」
 * 会被拒绝。这里 mock 掉 backups 服务，确保断言只针对「校验是否发生在业务调用之前」，
 * 不触发真实 tar / 备份记录写入。
 *
 * why 不用真实服务：有效临时目录用例若走真实 createBackup 会执行 tar 并写数据库，
 * 慢且依赖宿主 tar 实现；wiring 由断言 mock 参数覆盖，服务层语义由 backups.test.ts 覆盖。
 */

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

// vi.mock 会被提升到 import 之前，收集容器与 mock 函数必须用 vi.hoisted 一并提升。
const { handlerEntries, createBackup, restoreBackup } = vi.hoisted(() => ({
  handlerEntries: [] as Array<{ channel: string; handler: IpcHandler }>,
  createBackup: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: "backup-test" })),
  restoreBackup: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => process.cwd(),
    getVersion: () => "0.0.0",
    isPackaged: false,
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      handlerEntries.push({ channel, handler });
    },
  },
}));

// 让 handler 在通过路径校验后只记录调用参数，不真正执行 tar / 落库。
vi.mock("../services/backups", () => ({ createBackup, restoreBackup }));

import { registerIpcHandlers } from "../ipc";
import { closeDatabase, initDatabase } from "../services/storage/database";

let dataDir = "";
let testRoot = "";

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "gitool-ipc-backups-db-"));
  initDatabase(dataDir);
  testRoot = mkdtempSync(join(tmpdir(), "gitool-ipc-backups-"));
  registerIpcHandlers();
});

afterAll(() => {
  closeDatabase();
  rmSync(testRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

function handlerFor(channel: string): IpcHandler {
  const entry = handlerEntries.find((candidate) => candidate.channel === channel);
  if (!entry) {
    throw new Error(`通道未注册：${channel}`);
  }
  return entry.handler;
}

function system32Path(): string {
  return win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
}

describe("backups:create 路径白名单", () => {
  it("系统关键目录作为源路径被拒（不再是「备份目录不存在或不可写」）", () => {
    expect(() =>
      handlerFor("backups:create")(undefined, {
        projectId: "p1",
        projectName: "demo",
        sourcePath: system32Path(),
        targetDirectory: join(testRoot, "backups"),
      }),
    ).toThrow(/源路径.*不在允许范围内|不在允许范围内.*源路径/);
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("系统关键目录作为备份目标被拒（即使源路径合法）", () => {
    expect(() =>
      handlerFor("backups:create")(undefined, {
        projectId: "p1",
        projectName: "demo",
        sourcePath: testRoot,
        targetDirectory: system32Path(),
      }),
    ).toThrow(/系统关键目录/);
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("正常临时源目录与备份目录通过，并把规范化路径交给服务层", async () => {
    const targetDirectory = join(testRoot, "backups");
    const result = await handlerFor("backups:create")(undefined, {
      projectId: "p1",
      projectName: "demo",
      sourcePath: testRoot,
      targetDirectory,
    });

    expect(createBackup).toHaveBeenCalledTimes(1);
    expect(createBackup).toHaveBeenCalledWith(
      {
        projectId: "p1",
        projectName: "demo",
        sourcePath: win32.resolve(testRoot),
        targetDirectory: win32.resolve(targetDirectory),
      },
      expect.any(Array),
    );
    expect(result).toMatchObject({ id: "backup-test" });
  });
});

describe("backups:restore 路径白名单", () => {
  it("系统关键目录作为恢复目标被拒（不再是「不是空目录」）", () => {
    expect(() =>
      handlerFor("backups:restore")(undefined, {
        archivePath: join(testRoot, "demo.zip"),
        targetDirectory: system32Path(),
      }),
    ).toThrow(/恢复目录.*系统关键目录/);
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it("系统关键目录作为归档路径被拒（archivePath 也过白名单）", () => {
    expect(() =>
      handlerFor("backups:restore")(undefined, {
        archivePath: win32.join(system32Path(), "kernel32.dll"),
        targetDirectory: join(testRoot, "restore"),
      }),
    ).toThrow(/备份文件.*系统关键目录/);
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it("正常临时归档与恢复目录通过，并把规范化路径交给服务层", async () => {
    const archivePath = join(testRoot, "demo.zip");
    const targetDirectory = join(testRoot, "restore");

    await handlerFor("backups:restore")(undefined, { archivePath, targetDirectory });

    expect(restoreBackup).toHaveBeenCalledTimes(1);
    expect(restoreBackup).toHaveBeenCalledWith(
      {
        archivePath: win32.resolve(archivePath),
        targetDirectory: win32.resolve(targetDirectory),
      },
      expect.any(Array),
    );
  });
});
