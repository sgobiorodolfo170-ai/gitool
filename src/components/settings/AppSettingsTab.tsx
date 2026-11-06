import { Settings2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Account, AppSettings } from "../../types";
import { providerLabels } from "../../lib/meta";
import { getDesktopBridge } from "../../lib/bridge";

/**
 * 「应用设置」tab：默认搜索账号、Git 路径、默认目录与备份排除规则。
 * settings 是跨 tab（应用/AI）共享的保存对象，归 SettingsWorkspace 所有；
 * 目录选择是本 tab 独有的交互，随表单一起下沉到这里。
 */
export function AppSettingsTab({
  settings,
  setSettings,
  accounts,
  busy,
  save,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  accounts: Account[];
  busy: boolean;
  save: () => Promise<void>;
}) {
  const bridge = getDesktopBridge();

  const pickDirectory = async (key: "defaultProjectDirectory" | "defaultBackupDirectory") => {
    if (!bridge) return;
    const directory = await bridge.selectDirectory(settings[key] || undefined);
    if (directory) setSettings((current) => ({ ...current, [key]: directory }));
  };

  const settingsRows = [
    {
      key: "gitPath" as const,
      label: "Git 可执行文件路径",
      value: settings.gitPath,
      placeholder: "留空则使用系统 PATH 中的 git",
      hint: "例如 C:\\Program Files\\Git\\cmd\\git.exe",
    },
    {
      key: "defaultProjectDirectory" as const,
      label: "默认项目目录",
      value: settings.defaultProjectDirectory,
      placeholder: "新建/导入项目时的默认位置",
      hint: "留空则不指定",
    },
    {
      key: "defaultBackupDirectory" as const,
      label: "默认备份目录",
      value: settings.defaultBackupDirectory,
      placeholder: "备份 ZIP 的默认存放位置",
      hint: "留空则每次备份时选择",
    },
  ];

  return (
    <form
      className="account-form settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="panel-heading">
        <div>
          <h2>应用设置</h2>
          <span>保存到本地数据库</span>
        </div>
        <Settings2 size={16} />
      </div>
      <div className="form-body">
        <label>
          默认搜索账号
          <select
            value={settings.defaultSearchAccountId}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                defaultSearchAccountId: event.target.value,
              }))
            }
          >
            <option value="">自动选择</option>
            {accounts.map((account) => (
              <option value={account.id} key={account.id}>
                {providerLabels[account.provider]} · {account.displayName}
                {account.username ? `（${account.username}）` : ""}
              </option>
            ))}
          </select>
          <small className="setting-hint">
            总览页的 GitHub / Gitee 项目搜索将优先使用该账号的令牌
          </small>
        </label>
        {settingsRows.map((row) => (
          <label key={row.key}>
            {row.label}
            <div className="setting-row">
              <input
                value={row.value}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, [row.key]: event.target.value }))
                }
                placeholder={row.placeholder}
              />
              {row.key !== "gitPath" && (
                <button
                  type="button"
                  className="button secondary compact-button"
                  onClick={() => pickDirectory(row.key)}
                >
                  选择
                </button>
              )}
            </div>
            <small className="setting-hint">{row.hint}</small>
          </label>
        ))}
        <label>
          备份排除规则
          <textarea
            className="commit-message"
            value={settings.backupExcludePatterns}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                backupExcludePatterns: event.target.value,
              }))
            }
            placeholder="每行一个，如 node_modules  dist .next（备份时排除的相对路径）"
            rows={3}
          />
        </label>
        <button className="button primary form-submit" disabled={busy}>
          {busy ? "保存中..." : "保存设置"}
        </button>
      </div>
    </form>
  );
}
