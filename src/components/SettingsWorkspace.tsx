import { useEffect, useState } from "react";
import { providerLabels } from "../lib/meta";
import { remoteProviderLabels } from "../lib/meta";
import {
  ArrowDownToLine,
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  Account,
  AppSettings,
  EnvironmentStatus,
  InstallGitResult,
  InstallProgress,
  RemoteProvider,
} from "../types";
import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
} from "../lib/uiPrefs";
import { getDesktopBridge } from "../lib/bridge";

export function AccountsWorkspace({
  accounts,
  accountBusyId,
  onAdd,
  onTest,
  onDelete,
}: {
  accounts: Account[];
  accountBusyId: string | null;
  onAdd: (input: { provider: RemoteProvider; token: string }) => Promise<boolean>;
  onTest: (accountId: string) => Promise<void>;
  onDelete: (accountId: string) => Promise<void>;
}) {
  const [provider, setProvider] = useState<RemoteProvider>("github");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    const saved = await onAdd({ provider, token });
    if (saved) {
      setToken("");
    }
    setIsSaving(false);
  };

  return (
    <div className="accounts-grid">
      <form className="account-form" onSubmit={submit}>
        <div className="panel-heading">
          <div>
            <h2>添加远程账号</h2>
            <span>输入令牌后自动读取用户名</span>
          </div>
          <ShieldCheck size={16} />
        </div>
        <div className="form-body">
          <label>
            托管平台
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as RemoteProvider)}
            >
              <option value="github">GitHub</option>
              <option value="gitee">Gitee</option>
              <option value="gitlab">GitLab</option>
            </select>
          </label>
          <label>
            Personal Access Token
            <div className="secret-input">
              <input
                required
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="令牌不会显示或写入日志"
              />
              <button
                type="button"
                onClick={() => setShowToken((current) => !current)}
                aria-label={showToken ? "隐藏令牌" : "显示令牌"}
              >
                {showToken ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          <div className="credential-note">
            <ShieldCheck size={15} />
            <span>用户名由令牌自动读取；同一平台同一用户名重复添加时会替换旧令牌。</span>
          </div>
          <button className="button primary form-submit" disabled={isSaving || !token.trim()}>
            <Plus size={15} />
            {isSaving ? "保存中..." : "保存账号"}
          </button>
        </div>
      </form>
      <section className="account-list-panel">
        <div className="panel-heading">
          <div>
            <h2>已连接账号</h2>
            <span>{accounts.length} 个本地账号</span>
          </div>
          <span className="secure-label">
            <ShieldCheck size={13} />
            安全存储
          </span>
        </div>
        {accounts.length ? (
          <div className="account-list">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={accountBusyId === account.id}
                onTest={() => onTest(account.id)}
                onDelete={() => onDelete(account.id)}
              />
            ))}
          </div>
        ) : (
          <div className="accounts-empty">
            <KeyRound size={21} />
            <strong>还没有远程账号</strong>
            <span>添加账号后即可测试远程连接。</span>
          </div>
        )}
      </section>
    </div>
  );
}

export function AccountRow({
  account,
  busy,
  onTest,
  onDelete,
}: {
  account: Account;
  busy: boolean;
  onTest: () => void;
  onDelete: () => void;
}) {
  const status =
    account.status === "active" ? "已连接" : account.status === "invalid" ? "令牌无效" : "待验证";
  const statusClass =
    account.status === "active"
      ? "status-clean"
      : account.status === "invalid"
        ? "status-dirty"
        : "status-behind";
  return (
    <div className="account-row">
      <div className={`account-provider-icon ${account.provider}`}>
        <span>{remoteProviderLabels[account.provider].slice(0, 1)}</span>
      </div>
      <div className="account-main">
        <div className="account-title">
          <strong>{account.displayName}</strong>
          <span className={`status-pill ${statusClass}`}>
            <span className="status-dot" />
            {status}
          </span>
        </div>
        <p>
          {remoteProviderLabels[account.provider]} · {account.username || "未填写用户名"}
        </p>
        <small>
          Token 已受保护 · {account.scopes.length ? account.scopes.join(", ") : "权限待检测"}
        </small>
      </div>
      <div className="account-actions">
        <button className="button secondary compact-button" onClick={onTest} disabled={busy}>
          {busy ? "检测中..." : "连接测试"}
        </button>
        <button
          className="icon-button danger"
          onClick={onDelete}
          disabled={busy}
          aria-label="删除账号"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

export function SettingsWorkspace({
  environment,
  accounts,
  accountBusyId,
  onAdd,
  onTest,
  onDelete,
  onSettingsChange,
  onRefreshEnvironment,
  onInstallGit,
  installingGit,
  installProgress,
  fontScale,
  onFontScaleChange,
}: {
  environment: EnvironmentStatus | null;
  accounts: Account[];
  accountBusyId: string | null;
  onAdd: (input: { provider: RemoteProvider; token: string }) => Promise<boolean>;
  onTest: (accountId: string) => Promise<void>;
  onDelete: (accountId: string) => Promise<void>;
  onSettingsChange: (settings: AppSettings) => void;
  onRefreshEnvironment: () => Promise<void>;
  onInstallGit: () => Promise<InstallGitResult | null>;
  installingGit: boolean;
  installProgress: InstallProgress | null;
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
}) {
  const bridge = getDesktopBridge();
  const [settings, setSettings] = useState<AppSettings>({
    gitPath: "",
    defaultProjectDirectory: "",
    defaultBackupDirectory: "",
    backupExcludePatterns: "",
    defaultSearchAccountId: "",
    aiApiKeyConfigured: false,
    aiModel: "",
    aiBaseUrl: "",
  });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [hasAiKey, setHasAiKey] = useState(false);

  const load = async () => {
    if (!bridge) return;
    setSettings(await bridge.loadSettings());
    setHasAiKey(await bridge.hasAiApiKey().catch(() => false));
  };

  useEffect(() => {
    void load();
  }, []);

  const pickDirectory = async (key: "defaultProjectDirectory" | "defaultBackupDirectory") => {
    if (!bridge) return;
    const directory = await bridge.selectDirectory(settings[key] || undefined);
    if (directory) setSettings((current) => ({ ...current, [key]: directory }));
  };

  const save = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      if (aiKeyInput.trim()) {
        await bridge.saveAiApiKey(aiKeyInput.trim());
        setHasAiKey(true);
        setAiKeyInput("");
      }
      await bridge.saveSettings({
        ...settings,
        aiApiKeyConfigured: hasAiKey || Boolean(aiKeyInput.trim()),
      });
      onSettingsChange({ ...settings, aiApiKeyConfigured: hasAiKey || Boolean(aiKeyInput.trim()) });
      setNotice("设置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const removeAiKey = async () => {
    if (!bridge) return;
    if (!window.confirm("删除已保存的 AI API Key？")) return;
    await bridge.deleteAiApiKey();
    setHasAiKey(false);
    setSettings((current) => ({ ...current, aiApiKeyConfigured: false }));
    setNotice("AI API Key 已从凭据管理器删除");
  };

  const [activeTab, setActiveTab] = useState<"app" | "accounts" | "ai" | "env">("app");

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
    <div className="module-page">
      <div className="module-hero">
        <div className="module-icon">
          <Settings2 size={21} />
        </div>
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            SYSTEM
          </div>
          <h1>设置</h1>
          <p>配置 Git 路径、默认目录与应用环境信息。</p>
        </div>
      </div>
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === "app" ? "active" : ""}`}
          onClick={() => setActiveTab("app")}
        >
          应用设置
        </button>
        <button
          className={`settings-tab ${activeTab === "accounts" ? "active" : ""}`}
          onClick={() => setActiveTab("accounts")}
        >
          账号与令牌<span className="tab-count">{accounts.length}</span>
        </button>
        <button
          className={`settings-tab ${activeTab === "ai" ? "active" : ""}`}
          onClick={() => setActiveTab("ai")}
        >
          AI 摘要服务
        </button>
        <button
          className={`settings-tab ${activeTab === "env" ? "active" : ""}`}
          onClick={() => setActiveTab("env")}
        >
          环境信息
        </button>
      </div>

      {activeTab === "accounts" && (
        <AccountsWorkspace
          accounts={accounts}
          accountBusyId={accountBusyId}
          onAdd={onAdd}
          onTest={onTest}
          onDelete={onDelete}
        />
      )}

      {activeTab === "app" && (
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
      )}

      {activeTab === "ai" && (
        <form
          className="account-form settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="panel-heading">
            <div>
              <h2>AI 摘要服务</h2>
              <span>OpenAI 兼容接口</span>
            </div>
            <Sparkles size={16} />
          </div>
          <div className="form-body">
            <label>
              API Key（安全存储）
              {hasAiKey || settings.aiApiKeyConfigured ? (
                <span className="status-pill status-clean setting-value">
                  <span className="status-dot" />
                  已配置
                </span>
              ) : (
                <span className="status-pill status-behind setting-value">
                  <span className="status-dot" />
                  未配置
                </span>
              )}
              <div className="secret-input">
                <input
                  type="password"
                  value={aiKeyInput}
                  onChange={(event) => setAiKeyInput(event.target.value)}
                  placeholder={
                    hasAiKey || settings.aiApiKeyConfigured
                      ? "输入新 Key 可覆盖，或留空保留"
                      : "输入 API Key"
                  }
                />
                <button
                  type="button"
                  onClick={removeAiKey}
                  disabled={!hasAiKey && !settings.aiApiKeyConfigured}
                >
                  清除
                </button>
              </div>
              <small className="setting-hint">
                Key 存入 Windows 凭据管理器，不写入 SQLite；也可用环境变量 GITOOL_AI_API_KEY
              </small>
            </label>
            <label>
              模型
              <input
                value={settings.aiModel}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, aiModel: event.target.value }))
                }
                placeholder="例如 gpt-3.5-turbo / deepseek-chat"
              />
            </label>
            <label>
              接口地址（Base URL）
              <input
                value={settings.aiBaseUrl}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, aiBaseUrl: event.target.value }))
                }
                placeholder="例如 https://api.openai.com/v1（可空）"
              />
            </label>
            <button className="button primary form-submit" disabled={busy}>
              {busy ? "保存中..." : "保存设置"}
            </button>
          </div>
        </form>
      )}

      {activeTab === "env" && (
        <section className="account-list-panel settings-form">
          <div className="panel-heading">
            <div>
              <h2>环境信息</h2>
              <span>本地运行环境</span>
            </div>
            <div className="panel-heading-actions">
              <button
                className="bare-button"
                onClick={() => void onRefreshEnvironment()}
                disabled={installingGit}
                aria-label="刷新环境信息"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          <div className="form-body">
            {/* Git 可用性：缺失时显示一键安装按钮 */}
            <label>
              Git 可用性
              <span
                className={`status-pill setting-value ${environment?.git_available ? "status-clean" : "status-conflicted"}`}
              >
                <span className="status-dot" />
                {environment?.git_available ? "可用" : "不可用"}
              </span>
              {!environment?.git_available && (
                <button
                  className="button primary env-install-btn"
                  onClick={() => void onInstallGit()}
                  disabled={installingGit}
                >
                  {installingGit ||
                  (installProgress &&
                    installProgress.phase !== "done" &&
                    installProgress.phase !== "failed") ? (
                    <>
                      <Loader2 size={13} className="spin" />
                      安装中
                    </>
                  ) : (
                    <>
                      <ArrowDownToLine size={13} />
                      一键安装 Git
                    </>
                  )}
                </button>
              )}
            </label>
            <label>
              Git 版本
              <div className="setting-value mono">{environment?.git_version ?? "检测中"}</div>
            </label>
            {/* 数据目录可写性：sqlite + 备份 ZIP 均需写入 */}
            <label>
              数据目录可写
              <span
                className={`status-pill setting-value ${environment?.data_directory_writable ? "status-clean" : "status-conflicted"}`}
              >
                <span className="status-dot" />
                {environment?.data_directory_writable ? "可写" : "不可写"}
              </span>
            </label>
            <label>
              数据目录
              <div className="setting-value mono">
                {environment?.data_directory || "%APPDATA%\\Gitool"}
              </div>
            </label>
            {/* 凭据管理器：PAT / AI Key 依赖它保存 */}
            <label>
              凭据管理器
              <span
                className={`status-pill setting-value ${environment?.keyring_available ? "status-clean" : "status-conflicted"}`}
              >
                <span className="status-dot" />
                {environment?.keyring_available ? "可用" : "不可用"}
              </span>
            </label>
            {/* 网络可达性：影响远程仓库列表、克隆、星标同步 */}
            <label>
              网络可达性
              <div className="env-network-list">
                {(
                  [
                    { key: "github", label: "GitHub" },
                    { key: "gitee", label: "Gitee" },
                    { key: "gitlab", label: "GitLab" },
                  ] as const
                ).map((item) => {
                  const state = environment?.network?.[item.key] ?? "unknown";
                  const cls =
                    state === "reachable"
                      ? "status-clean"
                      : state === "unreachable"
                        ? "status-conflicted"
                        : "status-behind";
                  return (
                    <span key={item.key} className={`status-pill setting-value ${cls}`}>
                      <span className="status-dot" />
                      {item.label} ·{" "}
                      {state === "reachable" ? "可达" : state === "unreachable" ? "不可达" : "未知"}
                    </span>
                  );
                })}
              </div>
            </label>
            <label>
              操作系统
              <div className="setting-value mono">
                {environment?.platform === "web" ? "浏览器预览" : "Windows x64"}
              </div>
            </label>
            {/* 字号缩放：只影响 font-size，不改布局尺寸 */}
            <label>
              前端字号
              <div className="font-scale-control">
                <input
                  type="range"
                  min={FONT_SCALE_MIN}
                  max={FONT_SCALE_MAX}
                  step={FONT_SCALE_STEP}
                  value={fontScale}
                  onChange={(event) => onFontScaleChange(Number(event.target.value))}
                  aria-label="前端字号缩放比例"
                />
                <span className="setting-value mono">{Math.round(fontScale * 100)}%</span>
                <button
                  className="bare-button"
                  onClick={() => onFontScaleChange(FONT_SCALE_DEFAULT)}
                  disabled={fontScale === FONT_SCALE_DEFAULT}
                >
                  重置
                </button>
              </div>
            </label>
            {installProgress && (
              <div
                className={`setup-progress ${installProgress.phase === "failed" ? "failed" : installProgress.phase === "done" ? "done" : ""}`}
              >
                <div className="setup-progress-bar">
                  <div
                    className="setup-progress-fill"
                    style={{ width: `${installProgress.percent}%` }}
                  />
                </div>
                <span className="setup-progress-text">{installProgress.message}</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
