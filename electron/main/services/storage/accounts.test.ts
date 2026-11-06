import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../../../../shared/types";
import { closeDatabase, initDatabase } from "./database";
import { getAccount, loadAccounts, updateAccount } from "./accounts";

/**
 * accounts 域的纯库部分（load/get/update）。
 *
 * ⚠ 刻意不测 upsertAccount/deleteAccount：它们会写/删 Windows 凭据管理器
 * （@napi-rs/keyring），单测不允许产生真机副作用。凭据层可注入后再补齐。
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
});
