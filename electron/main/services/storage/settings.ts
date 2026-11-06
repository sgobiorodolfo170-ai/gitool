import type { AppSettings } from "../../../../shared/types";
import { errorMessage } from "../serviceUtils";
import { openDatabase, type SqlRow } from "./database";

/**
 * 应用设置数据域：settings 键值对的读写。
 *
 * loadSettings 对缺失的键一律回退空默认值（新库/半旧库均可读）；
 * saveSettings 整体事务 upsert，失败回滚并抛「保存设置失败」。
 */

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
