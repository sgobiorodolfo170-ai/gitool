import type { RemoteProvider, RemoteRepository } from "../../../shared/types";
import { openDatabase, type SqlRow } from "./storage/database";

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
