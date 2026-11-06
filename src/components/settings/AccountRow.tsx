import { Trash2 } from "lucide-react";
import type { Account } from "../../types";
import { remoteProviderLabels } from "../../lib/meta";

/** 已连接账号的单行展示：状态徽标 + 连接测试 / 删除操作。原 SettingsWorkspace 内嵌组件原样迁移。 */
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
