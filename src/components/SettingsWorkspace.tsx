import { useState } from "react";
import { Check, Settings2 } from "lucide-react";
import type {
  Account,
  AppSettings,
  EnvironmentStatus,
  InstallGitResult,
  InstallProgress,
  RemoteProvider,
} from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "../hooks/useAsyncData";
import { AccountsWorkspace } from "./settings/AccountsWorkspace";
import { AppSettingsTab } from "./settings/AppSettingsTab";
import { AiSettingsTab } from "./settings/AiSettingsTab";
import { EnvironmentTab } from "./settings/EnvironmentTab";

/** 设置表单的空默认值：useState 初始化与 bridge 缺失（浏览器预览）时共用。 */
const INITIAL_SETTINGS: AppSettings = {
  gitPath: "",
  defaultProjectDirectory: "",
  defaultBackupDirectory: "",
  backupExcludePatterns: "",
  defaultSearchAccountId: "",
  aiApiKeyConfigured: false,
  aiModel: "",
  aiBaseUrl: "",
};

/**
 * 设置页（应用 / 账号与令牌 / AI 摘要服务 / 环境信息）。
 *
 * 为什么这么拆：settings / notice / busy / aiKeyInput / hasAiKey 是应用与 AI
 * 两个 tab 共享同一份 save() 的状态，归本组件所有；账号 tab 的表单输入与
 * 环境 tab 的展示都是 tab 内部关注点，分别下沉到 settings/ 下的独立文件。
 * AccountsWorkspace/AccountRow 原为文件内嵌组件，一并拆至独立文件。
 */
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
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [hasAiKey, setHasAiKey] = useState(false);
  const [activeTab, setActiveTab] = useState<"app" | "accounts" | "ai" | "env">("app");

  // 设置加载：一次拉取设置表单与 AI Key 状态两个值；无刷新入口，仅挂载自动加载。
  // 原实现 loadSettings 无 try/catch，reject 会静默失败（表单停在空默认值且无提示），
  // 现经 onError 提示；hasAiApiKey 自带 catch(() => false) 的兜底语义原样保留。
  useAsyncData<{ settings: AppSettings; hasAiKey: boolean }>({
    loader: async () => {
      if (!bridge) return { settings: INITIAL_SETTINGS, hasAiKey: false };
      return {
        settings: await bridge.loadSettings(),
        hasAiKey: await bridge.hasAiApiKey().catch(() => false),
      };
    },
    onLoaded: ({ settings: loadedSettings, hasAiKey: loadedHasKey }) => {
      setSettings(loadedSettings);
      setHasAiKey(loadedHasKey);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "加载设置失败"),
  });

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

  // 清除 Key 会同时改 hasAiKey/settings/notice 三个共享状态，因此留在父级
  const removeAiKey = async () => {
    if (!bridge) return;
    if (!window.confirm("删除已保存的 AI API Key？")) return;
    await bridge.deleteAiApiKey();
    setHasAiKey(false);
    setSettings((current) => ({ ...current, aiApiKeyConfigured: false }));
    setNotice("AI API Key 已从凭据管理器删除");
  };

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
        <AppSettingsTab
          settings={settings}
          setSettings={setSettings}
          accounts={accounts}
          busy={busy}
          save={save}
        />
      )}

      {activeTab === "ai" && (
        <AiSettingsTab
          settings={settings}
          setSettings={setSettings}
          aiKeyInput={aiKeyInput}
          setAiKeyInput={setAiKeyInput}
          hasAiKey={hasAiKey}
          busy={busy}
          save={save}
          removeAiKey={removeAiKey}
        />
      )}

      {activeTab === "env" && (
        <EnvironmentTab
          environment={environment}
          onRefreshEnvironment={onRefreshEnvironment}
          onInstallGit={onInstallGit}
          installingGit={installingGit}
          installProgress={installProgress}
          fontScale={fontScale}
          onFontScaleChange={onFontScaleChange}
        />
      )}
    </div>
  );
}
