import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "./backups";

/**
 * 备份服务层的路径语义兜底（P1-2 回归）。
 *
 * why 服务层也要有测试：ipc.ts 的白名单只保护「渲染层 → IPC」这一条入口；
 * createBackup / restoreBackup 是导出函数，任何新增入口（任务调度、CLI、自动化）
 * 都能直接调用。这里的用例证明「不经过 ipc 也拒绝系统目录」。
 *
 * why 用临时目录作为允许根：服务层自己只能看到 os.homedir() + 设置里的默认备份目录，
 * 测试不能假设 %TEMP% 一定在主目录下（受 CI 账号与 8.3 短名影响），因此显式通过
 * 第二个参数传会话目录，模拟 ipc 透传 sessionSelectedDirectories 的方式。
 */

let testRoot = "";
let backupRoot = "";
let sourceRoot = "";
let restoreRoot = "";

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "gitool-backup-service-"));
  backupRoot = join(testRoot, "backups");
  sourceRoot = join(testRoot, "source");
  restoreRoot = join(testRoot, "restore");
  mkdirSync(backupRoot);
  mkdirSync(sourceRoot);
  mkdirSync(restoreRoot);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("createBackup 服务层路径兜底", () => {
  it("拒绝把备份写进系统关键目录（不再落到「目录不可写」检查）", async () => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const system32 = win32.join(systemRoot, "System32");

    await expect(
      createBackup(
        {
          projectId: "p1",
          projectName: "demo",
          sourcePath: sourceRoot,
          targetDirectory: system32,
        },
        [testRoot],
      ),
    ).rejects.toThrow(/系统关键目录|不在允许范围内/);
  });

  it("拒绝允许根之外的备份目录，且在触碰 tar 之前失败", async () => {
    await expect(
      createBackup(
        {
          projectId: "p1",
          projectName: "demo",
          sourcePath: sourceRoot,
          targetDirectory: "C:\\srv\\backups",
        },
        [testRoot],
      ),
    ).rejects.toThrow(/备份目录不在允许范围内/);
  });

  it("正常临时备份目录通过准入（后续源路径检查失败而非目录被拒）", async () => {
    // why 用不存在的源目录探测：目标目录先过准入，再 assertDirectory(source) 报
    // 「源路径不存在或无法访问」——错误停在源路径检查，恰好证明目标放行成功，
    // 同时完全避免真实 tar 与数据库写入。
    await expect(
      createBackup(
        {
          projectId: "p1",
          projectName: "demo",
          sourcePath: join(testRoot, "missing-source"),
          targetDirectory: backupRoot,
        },
        [testRoot],
      ),
    ).rejects.toThrow("源路径不存在或无法访问");
  });
});

describe("restoreBackup 服务层路径兜底", () => {
  it("系统目录作为恢复目标被拒（不再是「不是空目录」）", async () => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const system32 = win32.join(systemRoot, "System32");
    const archivePath = join(backupRoot, "demo.zip");
    writeFileSync(archivePath, "placeholder");

    await expect(
      restoreBackup({ archivePath, targetDirectory: system32 }, [testRoot]),
    ).rejects.toThrow(/系统关键目录|不在允许范围内/);
  });

  it("拒绝从系统关键目录解包（archivePath 同样过白名单）", async () => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const archivePath = win32.join(systemRoot, "System32", "kernel32.dll");

    await expect(
      restoreBackup({ archivePath, targetDirectory: restoreRoot }, [testRoot]),
    ).rejects.toThrow(/备份文件.*系统关键目录|备份文件不在允许范围内/);
  });

  it("拒绝允许根之外的归档文件（不触碰 tar）", async () => {
    await expect(
      restoreBackup(
        {
          archivePath: "C:\\srv\\backups\\demo.zip",
          targetDirectory: restoreRoot,
        },
        [testRoot],
      ),
    ).rejects.toThrow(/备份文件不在允许范围内/);
  });

  it("正常临时归档与恢复目录通过准入（后续只报文件不存在）", async () => {
    // 归档不存在 → 说明两道路径准入都放行了，错误来自 isArchiveReadable。
    await expect(
      restoreBackup(
        {
          archivePath: join(backupRoot, "missing.zip"),
          targetDirectory: restoreRoot,
        },
        [testRoot],
      ),
    ).rejects.toThrow("备份文件不存在或不可读");
  });
});
