import { useState } from "react";
import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import type { Account, RemoteProvider } from "../../types";
import { AccountRow } from "./AccountRow";

/**
 * 「账号与令牌」设置页：添加账号表单 + 已连接账号列表。
 * 表单输入（平台/令牌/可见性）归本组件自持；账号数据与增删测回调
 * 由上层（useAccounts 领域 hook）下发。
 * 原 SettingsWorkspace 内嵌组件原样迁移（AccountRow 拆至同目录独立文件）。
 */
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
