import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Bell,
  Check,
  Command,
  GitBranch,
  Loader2,
} from "lucide-react";
import type { AppSettings, AppView, ProjectAnalysis, RemoteProvider } from "./types";
import { isDesktopRuntime, requireDesktopBridge } from "./lib/bridge";

import { buildNavGroups, workspaceLabel } from "./lib/navigation";
import {
  ACTIVE_WORKSPACE_KEY,
  LAST_IMPORT_DIRECTORY_KEY,
  SETUP_DISMISS_KEY,
} from "./lib/storageKeys";

import { OverviewWorkspace } from "./components/OverviewWorkspace";

import { ProjectsWorkspace } from "./components/ProjectsWorkspace";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { RemoteRepositoriesWorkspace } from "./components/RemoteRepositoriesWorkspace";
import { TasksWorkspace } from "./components/TasksWorkspace";
import { BackupsWorkspace } from "./components/BackupsWorkspace";
import { LogsWorkspace } from "./components/LogsWorkspace";
import { SettingsWorkspace } from "./components/SettingsWorkspace";
import { ModuleWorkspace } from "./components/ModuleWorkspace";
import { useProjects } from "./hooks/useProjects";
import { useAccounts } from "./hooks/useAccounts";
import { useImportFlow } from "./hooks/useImportFlow";
import { useGitOperations } from "./hooks/useGitOperations";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { useRemotes } from "./hooks/useRemotes";
import { useEnvironment } from "./hooks/useEnvironment";
import { useNotice } from "./hooks/useNotice";
import { useUpdater } from "./hooks/useUpdater";

import { DEFAULT_WORKSPACE_ID, listWorkspaces as listWorkspacesLocal } from "./lib/workspaces";
import { loadProjects } from "./lib/projects";

function App() {
  const [workspace, setWorkspace] = useState<AppView>("overview");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [operationOutput, setOperationOutput] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);

  // 三个独立领域 hook：提示、环境体检、应用更新。
  // 保留原有变量名做别名，避免一次性改动上百处引用；后续可逐步换成 hook 的原始命名。
  const { notice, showNotice, clearNotice } = useNotice();
  const setNotice = useCallback(
    (message: string | null) => {
      if (message === null) {
        clearNotice();
      } else {
        showNotice(message);
      }
    },
    [clearNotice, showNotice],
  );

  const {
    environment,
    installProgress,
    installingGit,
    showSetupModal,
    setEnvironment,
    setShowSetupModal,
    refreshEnvironment,
    installGit,
  } = useEnvironment(showNotice);

  const {
    available: updateAvailable,
    progress: updateProgress,
    downloadedPath,
    isDownloading,
    download: handleUpdate,
    install: handleInstallUpdate,
  } = useUpdater(showNotice);

  const defaultDirectoryHint = () => {
    return (
      appSettings?.defaultProjectDirectory?.trim() ||
      window.localStorage.getItem(LAST_IMPORT_DIRECTORY_KEY) ||
      undefined
    );
  };

  const clearDetail = useCallback(() => {
    setOperationOutput(null);
    setAnalysis(null);
  }, []);

  const {
    projects,
    selectedProject,
    filteredProjects,
    allTags,
    filter,
    search,
    tagFilter,
    isRefreshing,
    setSelectedId,
    setFilter,
    setSearch,
    setTagFilter,
    applyProjects,
    updateProjects,
    getProjects,
    toggleFavorite,
    deleteProjectFromList,
    refreshProjects,
    moveProject,
  } = useProjects({
    activeWorkspaceId,
    onNotice: showNotice,
    onClearDetail: clearDetail,
    defaultDirectoryHint,
  });

  const resetView = useCallback(() => {
    setSelectedId("");
    setFilter("all");
    setSearch("");
    setTagFilter("");
    clearDetail();
    setWorkspace("overview");
  }, [clearDetail]);

  const {
    workspaces,
    setWorkspaces,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useWorkspaces({
    activeWorkspaceId,
    setActiveWorkspaceId,
    onNotice: showNotice,
    onProjectsLoaded: applyProjects,
    onResetView: resetView,
  });

  const {
    repositories: remoteRepositories,
    syncTime: remoteSyncTime,
    selectedAccountId,
    search: remoteSearch,
    isLoading: isLoadingRemotes,
    cloningRepositoryId,
    cloneProgress,
    setSelectedAccountId,
    setSearch: setRemoteSearch,
    setRepositories: setRemoteRepositories,
    forgetAccount,
    loadRemoteRepositories,
    cloneRemoteRepository,
    mutateRemoteRepository,
    toggleRemoteFavorite,
    toggleRemoteWatch,
  } = useRemotes({
    getProjects,
    updateProjects,
    onNotice: showNotice,
    onCloned: (projectId) => {
      setSelectedId(projectId);
      setWorkspace("projects");
    },
  });

  const {
    accounts,
    accountBusyId,
    setAccounts,
    addAccount: addAccountRaw,
    testAccount,
    removeAccount,
  } = useAccounts({ onNotice: showNotice });

  const { isImporting, importProject, initNewRepository, scanDirectoryForImport } = useImportFlow({
    onNotice: showNotice,
    defaultDirectoryHint,
    getProjects,
    addProjects: (items) => updateProjects((prev) => [...items, ...prev]),
    onImported: (projectId) => {
      setSelectedId(projectId);
      setWorkspace("projects");
    },
  });

  const { activeOperation, isAnalyzing, runGitOperation, runBulkGitOperation, analyzeProject } =
    useGitOperations({
      selectedProject,
      getProjects,
      updateProjects,
      onNotice: showNotice,
      setOperationOutput,
      setAnalysis,
    });

  // 跨域联动留在 App：新增账号后默认选中，删除账号后清掉它的仓库缓存
  const addAccount = async (input: { provider: RemoteProvider; token: string }) => {
    const account = await addAccountRaw(input);
    if (!account) return false;
    setSelectedAccountId((current) => current || account.id);
    return true;
  };

  const deleteAccount = async (accountId: string) => {
    if (!window.confirm("删除账号后，Gitool 将同时删除对应的本地凭据引用。继续吗？")) return;
    const removed = await removeAccount(accountId);
    if (!removed) return;
    forgetAccount(
      accountId,
      accounts.filter((account) => account.id !== accountId).map((account) => account.id),
    );
  };

  useEffect(() => {
    let cancelled = false;

    if (isDesktopRuntime()) {
      const bridge = requireDesktopBridge();
      void Promise.all([
        bridge.listWorkspaces(),
        bridge.environment(),
        bridge.loadAccounts(),
        bridge.loadSettings(),
      ])
        .then(async ([loadedWorkspaces, environmentStatus, storedAccounts, storedSettings]) => {
          if (cancelled) return;
          setWorkspaces(loadedWorkspaces);
          setAppSettings(storedSettings);
          const lastActive = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
          const workspaceId = loadedWorkspaces.some((item) => item.id === lastActive)
            ? lastActive!
            : (loadedWorkspaces[0]?.id ?? DEFAULT_WORKSPACE_ID);
          setActiveWorkspaceId(workspaceId);
          const storedProjects = await bridge.loadProjects(workspaceId);
          if (cancelled) return;
          applyProjects(storedProjects);
          setSelectedId(storedProjects[0]?.id ?? "");
          setEnvironment(environmentStatus);
          setAccounts(storedAccounts);
          setSelectedAccountId(storedAccounts[0]?.id ?? "");
          // 首启体检：Git 不可用且用户未勾选「不再提醒」时，弹出引导模态。
          // 设计理由：小白用户不会主动进设置页，必须首启就主动暴露缺失项。
          if (
            !environmentStatus.git_available &&
            window.localStorage.getItem(SETUP_DISMISS_KEY) !== "1"
          ) {
            setShowSetupModal(true);
          }
        })
        .catch(() => {
          if (!cancelled) setNotice("无法读取本地工作区数据");
        });
    } else {
      const loadedWorkspaces = listWorkspacesLocal();
      const lastActive = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      const workspaceId = loadedWorkspaces.some((item) => item.id === lastActive)
        ? lastActive!
        : (loadedWorkspaces[0]?.id ?? DEFAULT_WORKSPACE_ID);
      setWorkspaces(loadedWorkspaces);
      setActiveWorkspaceId(workspaceId);
      applyProjects(loadProjects(workspaceId));
      setEnvironment({
        git_available: true,
        git_version: "浏览器预览",
        platform: "web",
        data_directory: "",
        data_directory_writable: true,
        network: { github: "unknown", gitee: "unknown", gitlab: "unknown" },
        keyring_available: false,
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const openProjectDetail = (id: string) => {
    setSelectedId(id);
    setOperationOutput(null);
    setAnalysis(null);
    setWorkspace("projects");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <GitBranch size={18} strokeWidth={2.5} />
          </div>
          <div>
            <strong>Gitool</strong>
            <span>Developer workspace</span>
          </div>
        </div>

        <WorkspaceSwitcher
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          onSwitch={switchWorkspace}
          onCreate={createWorkspace}
          onRename={renameWorkspace}
          onDelete={(workspace) => {
            if (window.confirm(`删除工作区「${workspace.name}」？若其中有项目将无法删除。`)) {
              void deleteWorkspace(workspace.id);
            }
          }}
        />

        <nav className="sidebar-nav" aria-label="主导航">
          {buildNavGroups({
            projects: projects.length,
            remotes: remoteRepositories.length,
            tasks: projects.filter((project) => project.tags.includes("building")).length,
          }).map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={`nav-item ${workspace === item.id ? "active" : ""}`}
                    key={item.id}
                    onClick={() => setWorkspace(item.id)}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                    {item.count && <em>{item.count}</em>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-version">
          v{__APP_VERSION__}
          {updateAvailable && !isDownloading && !downloadedPath && (
            <button className="sidebar-update-btn" onClick={() => void handleUpdate()}>
              → v{updateAvailable.version} 更新
            </button>
          )}
          {isDownloading && updateProgress && (
            <span className="sidebar-update-progress">
              <span
                className="sidebar-update-progress-bar"
                style={{ width: `${updateProgress.percent}%` }}
              />
              <span className="sidebar-update-progress-text">{updateProgress.percent}%</span>
            </span>
          )}
          {downloadedPath && (
            <button className="sidebar-update-btn install" onClick={handleInstallUpdate}>
              重启安装
            </button>
          )}
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Gitool</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{workspaceLabel(workspace)}</strong>
          </div>
          <div className="topbar-actions">
            <div className="command-hint">
              <Command size={13} />
              <span>快速查找</span>
              <kbd>⌘ K</kbd>
            </div>
            <button className="icon-button" aria-label="通知">
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
            <div className="top-avatar">L</div>
          </div>
        </header>

        {environment && !environment.git_available && (
          <div className="env-banner">
            <AlertTriangle size={14} />
            <span>未检测到 Git，仓库克隆、提交、拉取等功能不可用。</span>
            <button
              className="button primary compact-button"
              onClick={() => void installGit()}
              disabled={installingGit}
            >
              {installingGit ? (
                <>
                  <Loader2 size={13} className="spin" />
                  安装中
                </>
              ) : (
                <>
                  <ArrowDownToLine size={13} />
                  一键安装
                </>
              )}
            </button>
            <button
              className="button secondary compact-button"
              onClick={() => setWorkspace("settings")}
            >
              查看详情
            </button>
          </div>
        )}

        <div className="content-scroll">
          {workspace === "overview" ? (
            <OverviewWorkspace
              projects={projects}
              selectedProject={selectedProject}
              isImporting={isImporting}
              isRefreshing={isRefreshing}
              cloningRepositoryId={cloningRepositoryId}
              defaultAccountId={appSettings?.defaultSearchAccountId ?? ""}
              onSelect={openProjectDetail}
              onRefresh={refreshProjects}
              onImport={importProject}
              onClone={cloneRemoteRepository}
              onToggleRemoteFavorite={toggleRemoteFavorite}
            />
          ) : workspace === "projects" ? (
            <ProjectsWorkspace
              projects={projects}
              filteredProjects={filteredProjects}
              selectedProject={selectedProject}
              filter={filter}
              search={search}
              tagFilter={tagFilter}
              allTags={allTags}
              isImporting={isImporting}
              onFilterChange={setFilter}
              onSearchChange={setSearch}
              onTagFilterChange={setTagFilter}
              onSelect={(id) => {
                setSelectedId(id);
                setOperationOutput(null);
                setAnalysis(null);
              }}
              onToggleFavorite={toggleFavorite}
              onUpdateProject={(projectId, patch) =>
                updateProjects((prev) =>
                  prev.map((project) =>
                    project.id === projectId ? { ...project, ...patch } : project,
                  ),
                )
              }
              onBulkGitOperation={runBulkGitOperation}
              onMoveProject={moveProject}
              onInitRepository={initNewRepository}
              onScanImport={scanDirectoryForImport}
              onImport={importProject}
              onDeleteProject={deleteProjectFromList}
              onRefresh={refreshProjects}
              isRefreshing={isRefreshing}
              onRunGitOperation={runGitOperation}
              activeOperation={activeOperation}
              operationOutput={operationOutput}
              onAnalyzeProject={analyzeProject}
              isAnalyzing={isAnalyzing}
              analysis={analysis}
            />
          ) : workspace === "remotes" ? (
            <RemoteRepositoriesWorkspace
              accounts={accounts}
              repositories={remoteRepositories}
              projects={projects}
              selectedAccountId={selectedAccountId}
              syncTime={remoteSyncTime}
              search={remoteSearch}
              isLoading={isLoadingRemotes}
              cloningRepositoryId={cloningRepositoryId}
              cloneProgress={cloneProgress}
              onAccountChange={(accountId) => {
                setSelectedAccountId(accountId);
                setRemoteRepositories([]);
                void loadRemoteRepositories(accountId, { silent: true });
              }}
              onSearchChange={setRemoteSearch}
              onRefresh={() => loadRemoteRepositories()}
              onClone={cloneRemoteRepository}
              onMutate={mutateRemoteRepository}
              onToggleFavorite={toggleRemoteFavorite}
              onToggleWatch={toggleRemoteWatch}
            />
          ) : workspace === "tasks" ? (
            <TasksWorkspace projects={projects} />
          ) : workspace === "backups" ? (
            <BackupsWorkspace projects={projects} />
          ) : workspace === "logs" ? (
            <LogsWorkspace />
          ) : workspace === "settings" ? (
            <SettingsWorkspace
              environment={environment}
              accounts={accounts}
              accountBusyId={accountBusyId}
              onAdd={addAccount}
              onTest={testAccount}
              onDelete={deleteAccount}
              onSettingsChange={(next) => setAppSettings(next)}
              onRefreshEnvironment={refreshEnvironment}
              onInstallGit={installGit}
              installingGit={installingGit}
              installProgress={installProgress}
            />
          ) : (
            <ModuleWorkspace workspace={workspace} onImport={importProject} />
          )}
        </div>
      </main>

      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}

      {/* 浮动进度块：仅当安装进行中/刚结束、且模态未打开时显示。避免与模态内的进度条重复。 */}
      {installProgress && !showSetupModal && (
        <div
          className={`setup-progress-float ${installProgress.phase === "failed" ? "failed" : installProgress.phase === "done" ? "done" : ""}`}
        >
          <div className="setup-progress-header">
            {installProgress.phase === "done" ? (
              <Check size={13} />
            ) : installProgress.phase === "failed" ? (
              <AlertTriangle size={13} />
            ) : (
              <Loader2 size={13} className="spin" />
            )}
            <span>
              {installProgress.phase === "downloading"
                ? "下载 Git 安装包"
                : installProgress.phase === "installing"
                  ? "正在安装（如见 UAC 提示请允许）"
                  : installProgress.phase === "verifying"
                    ? "验证安装"
                    : installProgress.phase === "done"
                      ? "安装完成"
                      : "安装未完成"}
            </span>
          </div>
          <div className="setup-progress-bar">
            <div className="setup-progress-fill" style={{ width: `${installProgress.percent}%` }} />
          </div>
          <span className="setup-progress-text">{installProgress.message}</span>
        </div>
      )}

      {showSetupModal && environment && !environment.git_available && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel setup-modal">
            <div className="modal-heading">
              <div>
                <h2>需要安装 Git 才能使用核心功能</h2>
                <span>未检测到系统 Git，应用可为你一键下载并安装</span>
              </div>
              <AlertTriangle size={18} />
            </div>
            <div className="form-body">
              <p className="setup-intro">
                Gitool 的克隆、提交、分支、拉取、推送等操作依赖 Git 命令行工具，当前系统未检测到
                Git。 点击下方按钮将自动从官方（git-for-windows）下载 64
                位安装包，并以管理员权限静默安装， 完成后无需重启即可使用。
              </p>
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
              {installProgress?.phase === "failed" && (
                <p className="form-error">
                  安装未完成。可关闭后重试，或在「设置 → 环境信息」手动指定已存在的 git.exe 路径。
                </p>
              )}
              <div className="setup-actions">
                <button
                  className="button primary"
                  onClick={() => void installGit()}
                  disabled={
                    installingGit ||
                    installProgress?.phase === "downloading" ||
                    installProgress?.phase === "installing" ||
                    installProgress?.phase === "verifying"
                  }
                >
                  {installingGit ||
                  (installProgress &&
                    installProgress.phase !== "done" &&
                    installProgress.phase !== "failed") ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      正在安装...
                    </>
                  ) : (
                    <>
                      <ArrowDownToLine size={14} />
                      一键安装 Git
                    </>
                  )}
                </button>
                <button
                  className="button secondary"
                  onClick={() => setShowSetupModal(false)}
                  disabled={installingGit}
                >
                  稍后再说
                </button>
                <label className="checkbox-row setup-dismiss">
                  <input
                    type="checkbox"
                    onChange={(event) => {
                      if (event.target.checked) {
                        window.localStorage.setItem(SETUP_DISMISS_KEY, "1");
                      } else {
                        window.localStorage.removeItem(SETUP_DISMISS_KEY);
                      }
                    }}
                  />
                  不再提醒（环境信息页仍可手动安装）
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
