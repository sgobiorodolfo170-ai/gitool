import type { RemoteProvider, RemoteRepository } from "../../../../shared/types";
import { openDatabase, type SqlRow } from "./database";

/**
 * 远程仓库缓存数据域：每个账号一份仓库列表快照（payload 为 JSON）。
 *
 * 缓存语义：同步成功后整体覆盖（upsert）；读不到或解析失败一律返回 null，
 * 由调用方决定回退策略（重新拉取远端）。
 *
 * 表所有权：缓存表只归本域所有，删号时的级联清理也必须由本域执行（见
 * deleteByAccount）；accounts 域只调用本域接口，不直写本表。
 */

export function saveRemoteRepositoryCache(
  accountId: string,
  provider: RemoteProvider,
  repositories: RemoteRepository[],
): void {
  const connection = openDatabase();
  connection
    .prepare(
      `INSERT INTO remote_repository_cache (accountId, provider, payload, syncedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET
        provider = excluded.provider, payload = excluded.payload, syncedAt = excluded.syncedAt`,
    )
    .run(accountId, provider, JSON.stringify(repositories), new Date().toISOString());
}

export function loadRemoteRepositoryCache(accountId: string): RemoteRepository[] | null {
  const connection = openDatabase();
  const row = connection
    .prepare("SELECT payload FROM remote_repository_cache WHERE accountId = ?")
    .get(accountId) as unknown as SqlRow | undefined;
  if (!row || typeof row.payload !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.payload);
    return Array.isArray(parsed) ? (parsed as RemoteRepository[]) : null;
  } catch {
    return null;
  }
}

/**
 * 删除某账号的整份仓库缓存（不存在时静默无操作）。
 *
 * 为什么放在本域：缓存表只由 remoteRepositoryCache 域读写，删号级联清缓存是该域的
 * 不变量（账号一旦不存在，其缓存就是无主垃圾数据）；由 accounts 域直接 DELETE
 * 会让同一张表出现第二个 owner，DDL 变更时容易漏改。调用方（accounts 域）只需
 * 依赖本函数名，表结构演进被隔离在本文件内。
 */
export function deleteByAccount(accountId: string): void {
  const connection = openDatabase();
  connection.prepare("DELETE FROM remote_repository_cache WHERE accountId = ?").run(accountId);
}

export function getRemoteRepositoryCacheMeta(accountId: string): { syncedAt: string } | null {
  const connection = openDatabase();
  const row = connection
    .prepare("SELECT syncedAt FROM remote_repository_cache WHERE accountId = ?")
    .get(accountId) as unknown as SqlRow | undefined;
  if (!row || row.syncedAt === null) {
    return null;
  }
  return { syncedAt: String(row.syncedAt) };
}
