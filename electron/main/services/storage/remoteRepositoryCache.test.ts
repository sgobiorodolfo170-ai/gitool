import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemoteRepository } from "../../../../shared/types";
import { closeDatabase, initDatabase } from "./database";
import {
  getRemoteRepositoryCacheMeta,
  loadRemoteRepositoryCache,
  saveRemoteRepositoryCache,
} from "./remoteRepositoryCache";

function repository(overrides: Partial<RemoteRepository> = {}): RemoteRepository {
  return {
    id: "repo-1",
    accountId: "acc-1",
    provider: "github",
    owner: "user",
    name: "demo",
    fullName: "user/demo",
    description: "演示仓库",
    visibility: "public",
    defaultBranch: "main",
    httpsUrl: "https://example.com/user/demo.git",
    archived: false,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("remoteRepositoryCache 域（远程仓库缓存）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-cache-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("保存后读回等价；同账号重复保存是整体覆盖语义", () => {
    saveRemoteRepositoryCache("acc-1", "github", [repository()]);
    expect(loadRemoteRepositoryCache("acc-1")).toEqual([repository()]);

    saveRemoteRepositoryCache("acc-1", "github", [repository({ id: "repo-2", name: "other" })]);
    const loaded = loadRemoteRepositoryCache("acc-1");
    expect(loaded).toHaveLength(1);
    expect(loaded?.[0]?.name).toBe("other");
  });

  it("无缓存的账号返回 null（调用方据此决定回退拉取）", () => {
    expect(loadRemoteRepositoryCache("no-such-account")).toBeNull();
    expect(getRemoteRepositoryCacheMeta("no-such-account")).toBeNull();
  });

  it("缓存 meta 返回最近同步时间", () => {
    saveRemoteRepositoryCache("acc-1", "gitee", [repository()]);
    const meta = getRemoteRepositoryCacheMeta("acc-1");
    expect(meta?.syncedAt).toEqual(expect.any(String));
  });

  it("payload 存了非法 JSON 时容错返回 null，不让坏缓存拖垮读取", () => {
    saveRemoteRepositoryCache("acc-1", "github", [repository()]);
    closeDatabase();
    initDatabase(dataDir);
    const connection = initDatabase(dataDir);
    connection.prepare("UPDATE remote_repository_cache SET payload = 'not-json'").run();
    expect(loadRemoteRepositoryCache("acc-1")).toBeNull();
  });
});
