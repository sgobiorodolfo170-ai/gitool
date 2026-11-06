import { Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../../types";

/**
 * 「AI 摘要服务」设置 tab：API Key（凭据管理器存取）、模型与接口地址。
 * settings / hasAiKey / aiKeyInput 是与应用设置 tab 共享同一份 save 的状态，
 * 归 SettingsWorkspace 所有；removeAiKey 会同时改 hasAiKey/notice/settings
 * 三个共享状态，因此留在父级、经 props 传入。
 */
export function AiSettingsTab({
  settings,
  setSettings,
  aiKeyInput,
  setAiKeyInput,
  hasAiKey,
  busy,
  save,
  removeAiKey,
}: {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  aiKeyInput: string;
  setAiKeyInput: (value: string) => void;
  hasAiKey: boolean;
  busy: boolean;
  save: () => Promise<void>;
  removeAiKey: () => Promise<void>;
}) {
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
  );
}
