import { useCallback, useState } from "react";
import type { Account, RemoteProvider } from "../../shared/types";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";

/**
 * 远程账号（GitHub / Gitee / GitLab）的增删与连通性测试。
 *
 * 刻意不碰 `selectedAccountId` 和 `remoteRepositories`——那是 useRemotes 的地盘。
 * 跨域联动交给 App 编排（add 之后决定是否选中，remove 之后清缓存），
 * 这样两个 hook 之间没有直接依赖。
 */
export type AccountsApi = {
  accounts: Account[];
  accountBusyId: string | null;
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  /** 成功返回新账号，失败返回 null。 */
  addAccount: (input: { provider: RemoteProvider; token: string }) => Promise<Account | null>;
  testAccount: (accountId: string) => Promise<void>;
  /** 删除账号，成功返回 true；调用方负责清理该账号的远程仓库缓存。 */
  removeAccount: (accountId: string) => Promise<boolean>;
};

export function useAccounts(params: { onNotice: (message: string) => void }): AccountsApi {
  const { onNotice } = params;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBusyId, setAccountBusyId] = useState<string | null>(null);

  const addAccount = useCallback(
    async (input: { provider: RemoteProvider; token: string }): Promise<Account | null> => {
      if (!isDesktopRuntime()) {
        onNotice("账号凭据管理需要使用 Windows 桌面版");
        return null;
      }
      try {
        const account = await requireDesktopBridge().createAccount({
          provider: input.provider,
          token: input.token,
        });
        // 同平台同用户名视为覆盖：先剔除旧记录再插到最前
        setAccounts((current) => {
          const without = current.filter(
            (item) => !(item.provider === account.provider && item.username === account.username),
          );
          return [account, ...without];
        });
        onNotice(`账号「${account.username}」已保存`);
        return account;
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "账号保存失败");
        return null;
      }
    },
    [onNotice],
  );

  const testAccount = useCallback(
    async (accountId: string) => {
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会访问远程平台");
        return;
      }
      setAccountBusyId(accountId);
      try {
        const result = await requireDesktopBridge().testAccount(accountId);
        setAccounts((current) =>
          current.map((account) =>
            account.id === accountId
              ? {
                  ...account,
                  status: result.success ? "active" : "invalid",
                  username: result.username ?? account.username,
                  scopes: result.scopes,
                  lastCheckedAt: new Date().toISOString(),
                }
              : account,
          ),
        );
        onNotice(result.message);
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "账号连接测试失败");
      } finally {
        setAccountBusyId(null);
      }
    },
    [onNotice],
  );

  const removeAccount = useCallback(
    async (accountId: string): Promise<boolean> => {
      if (!isDesktopRuntime()) {
        setAccounts((current) => current.filter((account) => account.id !== accountId));
        return true;
      }
      setAccountBusyId(accountId);
      try {
        await requireDesktopBridge().deleteAccount(accountId);
        setAccounts((current) => current.filter((account) => account.id !== accountId));
        onNotice("账号和对应凭据已删除");
        return true;
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "账号删除失败");
        return false;
      } finally {
        setAccountBusyId(null);
      }
    },
    [onNotice],
  );

  return { accounts, accountBusyId, setAccounts, addAccount, testAccount, removeAccount };
}
