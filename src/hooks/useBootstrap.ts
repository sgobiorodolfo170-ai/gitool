import { useEffect } from "react";
import type { Account, AppSettings, Project, WorkspaceEntity } from "../../shared/types";
import { DEFAULT_WORKSPACE_ID } from "../../shared/workspaceRulesConstants";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";
import { resolveActiveWorkspace } from "../../shared/workspaceRules";
import { listWorkspaces as listWorkspacesLocal } from "../lib/workspaces";
import { loadProjects } from "../lib/projects";
import { ACTIVE_WORKSPACE_KEY } from "../lib/storageKeys";

/**
 * 首屏数据链（P-15 / 架构评审 L-04）：统一 desktop 与浏览器两条 bootstrap 分支。
 *
 * why 抽出 App：原先两条分支在 App.tsx 各写一遍（desktop 260-288 / web 289-298），
 * 已经漂移——web 分支不读账号/设置、不设 selectedId，同一初始化语义两种行为。
 * 抽成 hook 后：
 * 1. 工作区选择规则统一走 shared/workspaceRules.resolveActiveWorkspace（单点）；
 * 2. 两条分支的差异收敛为「数据来源」一项（bridge vs localStorage），
 *    其余编排（写状态、错误处理）完全共享；
 * 3. App.tsx 不再持有 40 行 bootstrap effect，职责减一。
 *
 * why 不把 environment() 放进来：网络探测在不可达网络下要等满超时才返回，
 * 会让首屏一直停在占位（GUI 冒烟实测 6274ms）。环境体检由 App 的独立
 * effect 异步回填，不阻塞首屏渲染——该设计在抽出后保持不变。
 */
export interface UseBootstrapParams {
  /** 首屏四份数据就绪后的写入入口（App 持有的各 setter）。 */
  onWorkspacesLoaded: (workspaces: WorkspaceEntity[]) => void;
  onActiveWorkspaceChange: (workspaceId: string) => void;
  onProjectsLoaded: (projects: Project[]) => void;
  onInitialProjectSelect: (projectId: string) => void;
  onAccountsLoaded: (accounts: Account[]) => void;
  onInitialAccountSelect: (accountId: string) => void;
  onSettingsLoaded: (settings: AppSettings) => void;
  /** 首屏读取失败：项目区切错误态（可重试）。 */
  onLoadFailed: () => void;
  onLoadErrorNotice: (message: string) => void;
}

export interface BootstrapResult {
  workspaces: WorkspaceEntity[];
  activeWorkspaceId: string;
  projects: Project[];
}

/** 组装首屏结果（供单测直接覆盖，不依赖 React）。 */
export async function loadDesktopBootstrap(): Promise<BootstrapResult & {
  accounts: Account[];
  settings: AppSettings;
}> {
  const bridge = requireDesktopBridge();
  const [workspaces, accounts, settings] = await Promise.all([
    bridge.listWorkspaces(),
    bridge.loadAccounts(),
    bridge.loadSettings(),
  ]);
  const lastActive = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  const activeWorkspaceId = resolveActiveWorkspace(workspaces, lastActive, DEFAULT_WORKSPACE_ID);
  const projects = await bridge.loadProjects(activeWorkspaceId);
  return { workspaces, activeWorkspaceId, projects, accounts, settings };
}

/** 浏览器分支：只读工作区与项目（无账号/设置——web 预览不展示这两者）。 */
export function loadWebBootstrap(): BootstrapResult {
  const workspaces = listWorkspacesLocal();
  const lastActive = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  const activeWorkspaceId = resolveActiveWorkspace(workspaces, lastActive, DEFAULT_WORKSPACE_ID);
  return { workspaces, activeWorkspaceId, projects: loadProjects(activeWorkspaceId) };
}

export function useBootstrap(params: UseBootstrapParams): void {
  const {
    onWorkspacesLoaded,
    onActiveWorkspaceChange,
    onProjectsLoaded,
    onInitialProjectSelect,
    onAccountsLoaded,
    onInitialAccountSelect,
    onSettingsLoaded,
    onLoadFailed,
    onLoadErrorNotice,
  } = params;

  useEffect(() => {
    let cancelled = false;

    if (isDesktopRuntime()) {
      void loadDesktopBootstrap()
        .then((result) => {
          if (cancelled) return;
          onWorkspacesLoaded(result.workspaces);
          onActiveWorkspaceChange(result.activeWorkspaceId);
          onProjectsLoaded(result.projects);
          onInitialProjectSelect(result.projects[0]?.id ?? "");
          onAccountsLoaded(result.accounts);
          onInitialAccountSelect(result.accounts[0]?.id ?? "");
          onSettingsLoaded(result.settings);
        })
        .catch(() => {
          if (cancelled) return;
          onLoadFailed();
          onLoadErrorNotice("无法读取本地工作区数据");
        });
    } else {
      try {
        const result = loadWebBootstrap();
        onWorkspacesLoaded(result.workspaces);
        onActiveWorkspaceChange(result.activeWorkspaceId);
        onProjectsLoaded(result.projects);
      } catch {
        onLoadFailed();
        onLoadErrorNotice("无法读取工作区数据");
      }
    }

    return () => {
      cancelled = true;
    };
    // why 空依赖：bootstrap 只在挂载时执行一次；回调经 params 传入但语义上是
    // App 的稳定 setter，把它们列入依赖会让首屏链随 App 重渲染重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
