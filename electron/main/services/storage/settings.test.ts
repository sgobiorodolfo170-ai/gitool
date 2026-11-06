import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../../../../shared/types";
import { closeDatabase, initDatabase } from "./database";
import { loadSettings, saveSettings } from "./settings";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    gitPath: "C:\\Program Files\\Git\\cmd\\git.exe",
    defaultProjectDirectory: "C:\\work",
    defaultBackupDirectory: "D:\\backup",
    backupExcludePatterns: "node_modules\ndist",
    defaultSearchAccountId: "github-1",
    aiApiKeyConfigured: true,
    aiModel: "gpt-x",
    aiBaseUrl: "https://api.example.com",
    ...overrides,
  };
}

describe("settings 域（应用设置）", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gitool-settings-"));
    initDatabase(dataDir);
  });

  afterEach(() => {
    // Windows 文件锁：必须先关连接再删临时目录
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("空库读回全空默认值，不抛错（新装用户首次启动路径）", () => {
    expect(loadSettings()).toEqual({
      gitPath: "",
      defaultProjectDirectory: "",
      defaultBackupDirectory: "",
      backupExcludePatterns: "",
      defaultSearchAccountId: "",
      aiApiKeyConfigured: false,
      aiModel: "",
      aiBaseUrl: "",
    });
  });

  it("保存后读回：全部字段等价，布尔标记 aiApiKeyConfigured 往返一致", () => {
    saveSettings(settings());
    expect(loadSettings()).toEqual(settings());
  });

  it("重复保存是覆盖语义：后写的值生效，不残留旧行", () => {
    saveSettings(settings());
    saveSettings(settings({ gitPath: "D:\\Git\\bin\\git.exe", aiApiKeyConfigured: false }));
    const loaded = loadSettings();
    expect(loaded.gitPath).toBe("D:\\Git\\bin\\git.exe");
    expect(loaded.aiApiKeyConfigured).toBe(false);
    expect(loaded.defaultProjectDirectory).toBe("C:\\work");
  });

  it("saveSettings 只更新表中固定的 8 个键（无多余行）", () => {
    saveSettings(settings());
    // 直接连库校验行数：防止未来有人往 settings 表漏写/多写键
    const connection = initDatabase(dataDir);
    const count = Number(
      (connection.prepare("SELECT COUNT(*) AS total FROM settings").get() as { total: number })
        .total,
    );
    expect(count).toBe(8);
  });
});
