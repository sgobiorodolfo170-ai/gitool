import type { AppSettings, RemoteProvider, RemoteRepository } from "../../../shared/types";
import { errorMessage } from "./serviceUtils";
import { openDatabase, type SqlRow } from "./storage/database";

export function loadSettings(): AppSettings {
  const connection = openDatabase();
  const rows = connection.prepare("SELECT key, value FROM settings").all() as unknown as SqlRow[];
  const values = new Map<string, string>();
  for (const row of rows) {
    values.set(String(row.key), String(row.value));
  }
  return {
    gitPath: values.get("gitPath") ?? "",
    defaultProjectDirectory: values.get("defaultProjectDirectory") ?? "",
    defaultBackupDirectory: values.get("defaultBackupDirectory") ?? "",
    backupExcludePatterns: values.get("backupExcludePatterns") ?? "",
    defaultSearchAccountId: values.get("defaultSearchAccountId") ?? "",
    aiApiKeyConfigured: values.get("aiApiKeyConfigured") === "1",
    aiModel: values.get("aiModel") ?? "",
    aiBaseUrl: values.get("aiBaseUrl") ?? "",
  };
}

export function saveSettings(settings: AppSettings): void {
  const connection = openDatabase();
  connection.exec("BEGIN");
  try {
    const statement = connection.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    statement.run("gitPath", settings.gitPath);
    statement.run("defaultProjectDirectory", settings.defaultProjectDirectory);
    statement.run("defaultBackupDirectory", settings.defaultBackupDirectory);
    statement.run("backupExcludePatterns", settings.backupExcludePatterns);
    statement.run("defaultSearchAccountId", settings.defaultSearchAccountId);
    statement.run("aiApiKeyConfigured", settings.aiApiKeyConfigured ? "1" : "0");
    statement.run("aiModel", settings.aiModel);
    statement.run("aiBaseUrl", settings.aiBaseUrl);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw new Error(`保存设置失败：${errorMessage(error)}`);
  }
}

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
