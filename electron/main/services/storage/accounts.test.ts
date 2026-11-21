import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, RemoteRepository } from "../../../../shared/types";
import { closeDatabase, initDatabase } from "./database";
import { deleteAccount, getAccount, loadAccounts, updateAccount } from "./accounts";
import { loadRemoteRepositoryCache, saveRemoteRepositoryCache } from "./remoteRepositoryCache";

// deleteAccount 会经凭据层删除 Windows 凭据管理器条目（@napi-rs/keyring）。
// 单测不允许产生真机副作用，故把 credentials 模块整体替换为内存假实现；
// vi.mock 会被提升到 import 之前，accounts.ts 拿到的是这里的桩函数。
vi.mock("../credentials", () => ({
  deleteCredential: vi.fn(),
  readCredential: vi.fn(() => ""),
  saveCredential: vi.fn(),
  probeKeyring: vi.fn(() => true),
}));

/**
 * accounts 域的库层测试（load/get/update/delete）。
 *
 * ⚠ upsertAccount/deleteAccount 会写/删 Windows 凭据管理器，测试里以 vi.mock 的
 * 内存假实现替代（见文件顶部），从而可在无真机副作用的前提下覆盖 deleteAccount
 * 的级联删缓存语义；真实凭据读写仍待凭据层可注入后补齐。
 */

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "github-1",
    provider: "github",
    username: "demo",
    displayName: "demo",
    authType: "pat",
    credentialRef: "account-github-1",
    status: "active",
    scopes: ["repo"],
    lastCheckedAt: "2026-11-01T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function repository(overrides: Partial<RemoteRepository> = {}): RemoteRepository {
  return {
    id: "repo-1",
    accountId: "github-1",
    provider: "github",
    owner: "demo",
    name: "demo",
    fullName: "demo/demo",
    description: "演示仓库",
    visibility: "public",
    defaultBranch: "main",
    httpsUrl: "https://example.com/demo/demo.git",
    archived: false,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 直接数缓存表行数：load 返回 null 也可能只是 payload 坏了，计数才能证明行被物理删除。 */
function countCacheRows(accountId: string): number {
  const row = initDatabase(dataDir)
    .prepare("SELECT COUNT(*) AS total FROM remote_repository_cache WHERE accountId = ?")
    .get(accountId) as { total: number };
  return Number(row.total);
}

function insertDirectly(item: Account): void {
  initDatabase(dataDir)
    .prepare(
      `INSERT INTO accounts
       (id, provider, username, displayName, authType, credentialRef, status, scopes,
        lastCheckedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id,
      item.provider,
      item.username,
      item.displayName,
      item.authType,
      item.credentialRef,
      item.status,
      JSON.stringify(item.scopes),
      item.lastCheckedAt ?? null,
      item.createdAt,
      item.updatedAt,
    );
}

let dataDir: string;

describe("accounts 域（远程账号·纯库部分）", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-accounts-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("按更新时间倒序列出账号；lastCheckedAt 为 NULL 时读回 null", () => {
    insertDirectly(account({ id: "github-1", updatedAt: "2026-11-01T00:00:00.000Z" }));
    insertDirectly(
      account({
        id: "gitee-1",
        provider: "gitee",
        credentialRef: "account-gitee-1",
        lastCheckedAt: null,
        scopes: [],
        updatedAt: "2026-11-02T00:00:00.000Z",
      }),
    );
    const loaded = loadAccounts();
    expect(loaded.map((item) => item.id)).toEqual(["gitee-1", "github-1"]);
    expect(loaded[0]?.lastCheckedAt).toBeNull();
    expect(loaded[0]?.scopes).toEqual([]);
  });

  it("getAccount 精确命中；不存在时抛「账号不存在」", () => {
    insertDirectly(account());
    expect(getAccount("github-1").username).toBe("demo");
    expect(() => getAccount("no-such-id")).toThrow("账号不存在");
  });

  it("updateAccount 合并 patch 并刷新 updatedAt（显式传入的 updatedAt 优先）", () => {
    insertDirectly(account());
    updateAccount("github-1", { status: "expired", lastCheckedAt: "2026-11-07T00:00:00.000Z" });
    const loaded = getAccount("github-1");
    expect(loaded.status).toBe("expired");
    expect(loaded.lastCheckedAt).toBe("2026-11-07T00:00:00.000Z");
    // updatedAt 未显式传入时自动刷新为当前时间（只断言确实变化，不锚定具体时刻）
    expect(loaded.updatedAt).not.toBe("2026-11-01T00:00:00.000Z");

    updateAccount("github-1", { status: "active", updatedAt: "2026-11-08T00:00:00.000Z" });
    expect(getAccount("github-1").updatedAt).toBe("2026-11-08T00:00:00.000Z");
  });

  it("删除账号后其仓库缓存被清空，且只影响该账号", () => {
    insertDirectly(account({ id: "github-1", credentialRef: "account-github-1" }));
    insertDirectly(
      account({
        id: "gitee-1",
        provider: "gitee",
        credentialRef: "account-gitee-1",
        updatedAt: "2026-11-02T00:00:00.000Z",
      }),
    );
    saveRemoteRepositoryCache("github-1", "github", [repository()]);
    saveRemoteRepositoryCache("gitee-1", "gitee", [
      repository({ id: "repo-2", accountId: "gitee-1", provider: "gitee" }),
    ]);

    deleteAccount("github-1");

    // 被删账号：缓存行数归 0，读接口回到 null，账号本身也不再存在
    expect(countCacheRows("github-1")).toBe(0);
    expect(loadRemoteRepositoryCache("github-1")).toBeNull();
    expect(() => getAccount("github-1")).toThrow("账号不存在");
    // 其他账号的缓存必须原样保留（级联删除按 accountId 精确命中）
    expect(countCacheRows("gitee-1")).toBe(1);
    expect(loadRemoteRepositoryCache("gitee-1")?.[0]?.id).toBe("repo-2");
  });
});
