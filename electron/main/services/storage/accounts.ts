import type { Account, RemoteProvider } from "../../../../shared/types";
import { deleteCredential, readCredential, saveCredential } from "../credentials";
import { errorMessage } from "../serviceUtils";
import { openDatabase, rowToAccount, type SqlRow } from "./database";

/**
 * 远程账号数据域：列表、查询、新增（PAT 入库 + 凭据管理器）、更新、删除。
 *
 * 凭据与库记录的一致性约定：credentialRef 由本域生成（account-<id>），
 * upsertAccount 先写凭据再写库，入库失败时回滚删除凭据，避免悬挂凭据。
 */

export function loadAccounts(): Account[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, provider, username, displayName, authType, credentialRef, status, scopes,
              lastCheckedAt, createdAt, updatedAt
       FROM accounts ORDER BY updatedAt DESC`,
    )
    .all() as unknown as SqlRow[];

  return rows.map(rowToAccount);
}

export function getAccount(accountId: string): Account {
  const connection = openDatabase();
  const row = connection
    .prepare(
      `SELECT id, provider, username, displayName, authType, credentialRef, status, scopes,
              lastCheckedAt, createdAt, updatedAt
       FROM accounts WHERE id = ?`,
    )
    .get(accountId) as unknown as SqlRow | undefined;

  if (!row) {
    throw new Error("账号不存在");
  }
  return rowToAccount(row);
}

export function upsertAccount(provider: RemoteProvider, username: string, token: string): Account {
  const trimmedToken = token.trim();
  if (trimmedToken.length === 0) {
    throw new Error("令牌不能为空");
  }
  if (!isRemoteProvider(provider)) {
    throw new Error("不支持的远程平台");
  }

  const existing = findAccountByProviderUsername(provider, username);
  if (existing) {
    const currentToken = readCredential(existing.credentialRef);
    if (currentToken === trimmedToken) {
      return existing;
    }
    saveCredential(existing.credentialRef, trimmedToken);
    const now = new Date().toISOString();
    updateAccount(existing.id, { status: "active", lastCheckedAt: now });
    return getAccount(existing.id);
  }

  const now = new Date().toISOString();
  const id = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const credentialRef = `account-${id}`;
  saveCredential(credentialRef, trimmedToken);

  const account: Account = {
    id,
    provider,
    username,
    displayName: username,
    authType: "pat",
    credentialRef,
    status: "active",
    scopes: [],
    lastCheckedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const connection = openDatabase();
    connection
      .prepare(
        `INSERT INTO accounts
         (id, provider, username, displayName, authType, credentialRef, status, scopes,
          lastCheckedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.id,
        account.provider,
        account.username,
        account.displayName,
        account.authType,
        account.credentialRef,
        account.status,
        JSON.stringify(account.scopes),
        account.lastCheckedAt ?? null,
        account.createdAt,
        account.updatedAt,
      );
  } catch (error) {
    deleteCredential(credentialRef);
    throw new Error(`本地数据存储失败：${errorMessage(error)}`);
  }

  return account;
}

function findAccountByProviderUsername(provider: string, username: string): Account | null {
  const connection = openDatabase();
  const row = connection
    .prepare(
      `SELECT id, provider, username, displayName, authType, credentialRef, status, scopes,
              lastCheckedAt, createdAt, updatedAt
       FROM accounts WHERE provider = ? AND username = ?`,
    )
    .get(provider, username) as unknown as SqlRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function updateAccount(accountId: string, patch: Partial<Account>): void {
  const connection = openDatabase();
  const current = getAccount(accountId);
  const next: Account = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };

  connection
    .prepare(
      `UPDATE accounts SET username = ?, status = ?, scopes = ?, lastCheckedAt = ?, updatedAt = ?
       WHERE id = ?`,
    )
    .run(
      next.username,
      next.status,
      JSON.stringify(next.scopes),
      next.lastCheckedAt ?? null,
      next.updatedAt,
      next.id,
    );
}

export function deleteAccount(accountId: string): void {
  const account = getAccount(accountId);
  deleteCredential(account.credentialRef);
  const connection = openDatabase();
  connection.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  // 同步清掉该账号的仓库缓存，否则删号后仍残留一份完整仓库列表。
  // 这条级联属账号删除语义的一部分，故内联在此而不从 remoteRepositoryCache
  // 域导入（域间禁止横向依赖）；remote_repository_cache 表结构变更时需同步这里。
  connection.prepare("DELETE FROM remote_repository_cache WHERE accountId = ?").run(accountId);
}

function isRemoteProvider(value: string): value is RemoteProvider {
  return value === "github" || value === "gitee" || value === "gitlab";
}
