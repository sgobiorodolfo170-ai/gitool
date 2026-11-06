import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackupRecord } from "../../../../shared/types";
import { closeDatabase, initDatabase } from "./database";
import { insertBackup, listBackups } from "./backups";

function backup(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    id: "bk-1",
    projectId: "p-1",
    projectName: "演示项目",
    sourcePath: "C:\\work\\demo",
    archivePath: "D:\\backup\\demo-20261107.tar.gz",
    sizeBytes: 2048,
    status: "success",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("backups 域（备份记录）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-backups-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("写入后按创建时间倒序读回，error 可空字段往返一致", () => {
    insertBackup(backup({ id: "bk-1", createdAt: "2026-11-01T00:00:00.000Z" }));
    insertBackup(
      backup({
        id: "bk-2",
        status: "failed",
        error: "磁盘空间不足",
        createdAt: "2026-11-02T00:00:00.000Z",
      }),
    );
    const loaded = listBackups();
    expect(loaded.map((item) => item.id)).toEqual(["bk-2", "bk-1"]);
    expect(loaded[0]?.error).toBe("磁盘空间不足");
    expect(loaded[1]?.error).toBeUndefined();
  });
});
