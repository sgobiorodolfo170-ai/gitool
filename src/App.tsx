import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Check, Command, GitBranch, Loader2 } from "lucide-react";
import type { AppSettings, AppView, ProjectFilter, RemoteProvider } from "./types";
import { isDesktopRuntime, requireDesktopBridge } from "./lib/bridge";
import { requestSearchFocus } from "./lib/uiEvents";

import { buildNavGroups, workspaceLabel } from "./lib/navigation";
import {
  ACTIVE_WORKSPACE_KEY,
  LAST_IMPORT_DIRECTORY_KEY,
  SETUP_DISMISS_KEY,
} from "./lib/storageKeys";

import { OverviewWorkspace } from "./components/OverviewWorkspace";
import { NoticeViewport } from "./components/NoticeViewport";
import { ConfirmProvider, confirmDialog } from "./components/ConfirmProvider";

import { ProjectsPage } from "./components/ProjectsPage";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { RemoteRepositoriesWorkspace } from "./components/RemoteRepositoriesWorkspace";
import { TasksWorkspace } from "./components/TasksWorkspace";
import { BackupsWorkspace } from "./components/BackupsWorkspace";
import { LogsWorkspace } from "./components/LogsWorkspace";
import { SettingsWorkspace } from "./components/SettingsWorkspace";
import { useProjects } from "./hooks/useProjects";
import { useAccounts } from "./hooks/useAccounts";
import { useImportFlow } from "./hooks/useImportFlow";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { useRemotes } from "./hooks/useRemotes";
import { useEnvironment } from "./hooks/useEnvironment";
import { useNotice } from "./hooks/useNotice";
import { useUpdater } from "./hooks/useUpdater";
import { useFocusTrap } from "./hooks/useFocusTrap";

import { DEFAULT_WORKSPACE_ID, listWorkspaces as listWorkspacesLocal } from "./lib/workspaces";
import { loadProjects } from "./lib/projects";
import { applyFontScale, FONT_SCALE_DEFAULT, loadFontScale, saveFontScale } from "./lib/uiPrefs";

function App() {
  const [workspace, setWorkspace] = useState<AppView>("overview");
  // 「我的项目」的进入筛选：指标卡跳转时写入，ProjectsPage 挂载时读取。
  // 侧栏进入时重置为 all，避免上一次卡片筛选残留（阶段 D6）。
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [fontScale, setFontScale] = useState(FONT_SCALE_DEFAULT);

  // 三个独立领域 hook：提示、环境体检、应用更新。
  // 提示改为类型化队列（成功/失败/警告/信息），渲染交给 NoticeViewport。
  const { notices, showNotice, dismiss } = useNotice();

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

  // 首启 Git 引导是模态层（阶段 E5）：打开时焦点进入弹窗，Tab 不逃逸；
  // 安装进行中不允许 Escape 关闭，避免打断下载/安装。
  const setupModalRef = useFocusTrap<HTMLDivElement>(showSetupModal, () => {
    if (!installingGit) setShowSetupModal(false);
  });

  const {
    available: updateAvailable,
    progress: updateProgress,
    downloadedPath,
    isDownloading,
    check: checkForUpdate,
    download: handleUpdate,
    install: handleInstallUpdate,
  } = useUpdater(showNotice);

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      await checkForUpdate();
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 字号偏好存在 localStorage，首帧就应用，避免闪一下默认字号
  useEffect(() => {
    const initial = loadFontScale();
    setFontScale(initial);
    applyFontScale(initial);
  }, []);

  const changeFontScale = useCallback((scale: number) => {
    setFontScale(scale);
    saveFontScale(scale);
    applyFontScale(scale);
  }, []);

  const defaultDirectoryHint = () => {
    return (
      appSettings?.defaultProjectDirectory?.trim() ||
      window.localStorage.getItem(LAST_IMPORT_DIRECTORY_KEY) ||
      undefined
    );
  };

  // 详情输出/结构分析 state 已随 Git 操作域下沉 ProjectsPage（治理轮-3④）。
  // App 侧仅保留「清除详情」的转发：useProjects 的 onClearDetail、resetView、
  // openProjectDetail 仍是触发点；ProjectsPage 挂载时经 registerClearDetail
  // 登记真正的清除函数，未挂载时为空操作（状态已随组件销毁）。
  const clearDetailRef = useRef<() => void>(() => {});
  const clearDetail = useCallback(() => clearDetailRef.current(), []);
  const registerClearDetail = useCallback((clear: () => void) => {
    clearDetailRef.current = clear;
  }, []);

  const projectsApi = useProjects({
    activeWorkspaceId,
    onNotice: showNotice,
    onClearDetail: clearDetail,
    defaultDirectoryHint,
  });
  // 筛选/搜索/标签过滤已下沉 ProjectsPage（仅「我的项目」页消费）；
  // 这里只解构 App 与其他页仍要读写的部分
  const {
    projects,
    selectedProject,
    isRefreshing,
    isLoading: projectsLoading,
    loadError: projectsLoadError,
    setSelectedId,
    applyProjects,
    updateProjects,
    getProjects,
    refreshProjects,
    markLoadFailed,
  } = projectsApi;

  const resetView = useCallback(() => {
    setSelectedId("");
    clearDetail();
    // 筛选/搜索/标签过滤与详情输出都由 ProjectsPage 自持，切工作区时页面
    // 卸载即自动复位，无需在此逐项清空（与本轮下沉前的手工清空等价）
    setWorkspace("overview");
  }, [clearDetail, setSelectedId]);

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

  // 跨域联动留在 App：新增账号后默认选中，删除账号后清掉它的仓库缓存
  const addAccount = async (input: { provider: RemoteProvider; token: string }) => {
    const account = await addAccountRaw(input);
    if (!account) return false;
    setSelectedAccountId((current) => current || account.id);
    return true;
  };

  const deleteAccount = async (accountId: string) => {
    const confirmed = await confirmDialog({
      title: "删除账号？",
      description: "删除后，Gitool 将同时删除对应的本地凭据引用。",
      confirmLabel: "删除账号",
      danger: true,
    });
    if (!confirmed) return;
    const removed = await removeAccount(accountId);
    if (!removed) return;
    forgetAccount(
      accountId,
      accounts.filter((account) => account.id !== accountId).map((account) => account.id),
    );
  };

  // 首屏数据链：工作区 / 账号 / 设置 / 项目。
  // why 不再把 environment() 放进来：网络探测在不可达网络下要等满超时才返回，
  // 会让侧栏一直停在「工作区 / 本地模式」占位（GUI 冒烟实测首启 6274ms）。
  // 这里只等待首屏内容真正需要的四份数据，渲染 ASAP；环境结果由下方独立 effect 回填。
  useEffect(() => {
    let cancelled = false;

    if (isDesktopRuntime()) {
      const bridge = requireDesktopBridge();
      void Promise.all([bridge.listWorkspaces(), bridge.loadAccounts(), bridge.loadSettings()])
        .then(async ([loadedWorkspaces, storedAccounts, storedSettings]) => {
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
          setAccounts(storedAccounts);
          setSelectedAccountId(storedAccounts[0]?.id ?? "");
        })
        .catch(() => {
          if (!cancelled) {
            // 首屏读取失败：项目区切到错误态（可重试），而不是停在骨架/空态
            markLoadFailed();
            showNotice("无法读取本地工作区数据", { kind: "error" });
          }
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
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // 环境体检异步回填：与首屏数据链解耦，先渲染主体、结果到达后再补充。
  // why 允许引导弹窗延后：git 缺失提示是「补充信息」，不能为了它挡住首屏；
  // 弹窗迟到只会让用户晚一两秒看到提示，而白屏/占位会让应用显得卡死。
  useEffect(() => {
    let cancelled = false;

    if (isDesktopRuntime()) {
      void requireDesktopBridge()
        .environment()
        .then((status) => {
          if (cancelled) return;
          setEnvironment(status);
          // 首启体检：Git 不可用且用户未勾选「不再提醒」时，弹出引导模态。
          // 设计理由：小白用户不会主动进设置页，必须首启就主动暴露缺失项。
          if (!status.git_available && window.localStorage.getItem(SETUP_DISMISS_KEY) !== "1") {
            setShowSetupModal(true);
          }
        })
        .catch(() => {
          // 体检失败不回滚首屏：设置页保留「检测中」，用户可手动刷新。
        });
    } else {
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
    clearDetail();
    setWorkspace("projects");
  };

  return (
    <ConfirmProvider>
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
            onDelete={async (workspace) => {
              const confirmed = await confirmDialog({
                title: `删除工作区「${workspace.name}」？`,
                description: "若其中有项目将无法删除。",
                confirmLabel: "删除工作区",
                danger: true,
              });
              if (confirmed) await deleteWorkspace(workspace.id);
            }}
          />

          <nav className="sidebar-nav" aria-label="主导航">
            {buildNavGroups({
              projects: projects.length,
              remotes: remoteRepositories.length,
            }).map((group) => (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className={`nav-item ${workspace === item.id ? "active" : ""}`}
                      key={item.id}
                      onClick={() => {
                        // 侧栏进入时回到默认筛选，避免上次指标卡跳转的筛选残留
                        setProjectFilter("all");
                        setWorkspace(item.id);
                      }}
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
            <button
              className="sidebar-version-label"
              onClick={() => void handleCheckUpdate()}
              disabled={isCheckingUpdate}
              title="检查更新"
            >
              v{__APP_VERSION__}
              {isCheckingUpdate && <span className="sidebar-version-checking">检查中…</span>}
            </button>
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
              {/* Ctrl+K 的处理器只在「我的项目」页（ProjectsWorkspace），提示仅在彼处展示；
                现在是真实按钮：点击与快捷键同样聚焦项目搜索框（阶段 D7）。
                早期版本的铃铛按钮无任何行为且红点恒亮，属装饰性误导，已移除 */}
              {workspace === "projects" && (
                <button
                  type="button"
                  className="command-hint"
                  onClick={requestSearchFocus}
                  aria-label="聚焦项目搜索（Ctrl K）"
                >
                  <Command size={13} />
                  <span>快速查找</span>
                  <kbd>Ctrl K</kbd>
                </button>
              )}
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
                isLoading={projectsLoading}
                loadError={projectsLoadError}
                isImporting={isImporting}
                isRefreshing={isRefreshing}
                cloningRepositoryId={cloningRepositoryId}
                defaultAccountId={appSettings?.defaultSearchAccountId ?? ""}
                onSelect={openProjectDetail}
                onRefresh={refreshProjects}
                onImport={importProject}
                onClone={cloneRemoteRepository}
                onToggleRemoteFavorite={toggleRemoteFavorite}
                onOpenProjects={(filter) => {
                  setProjectFilter(filter);
                  setSelectedId("");
                  clearDetail();
                  setWorkspace("projects");
                }}
                onOpenRemotes={() => setWorkspace("remotes")}
              />
            ) : workspace === "projects" ? (
              <ProjectsPage
                projectsApi={projectsApi}
                initialFilter={projectFilter}
                importDomain={{
                  isImporting,
                  importProject,
                  initNewRepository,
                  scanDirectoryForImport,
                }}
                onNotice={showNotice}
                registerClearDetail={registerClearDetail}
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
                onNotice={showNotice}
              />
            ) : workspace === "tasks" ? (
              <TasksWorkspace projects={projects} onNotice={showNotice} />
            ) : workspace === "backups" ? (
              <BackupsWorkspace projects={projects} onNotice={showNotice} />
            ) : workspace === "logs" ? (
              <LogsWorkspace onNotice={showNotice} />
            ) : workspace === "settings" ? (
              <SettingsWorkspace
                onNotice={showNotice}
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
                fontScale={fontScale}
                onFontScaleChange={changeFontScale}
              />
            ) : null}
          </div>
        </main>

        <NoticeViewport notices={notices} onDismiss={dismiss} />

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
              <div
                className="setup-progress-fill"
                style={{ width: `${installProgress.percent}%` }}
              />
            </div>
            <span className="setup-progress-text">{installProgress.message}</span>
          </div>
        )}

        {showSetupModal && environment && !environment.git_available && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-modal-title"
          >
            <div className="modal-panel setup-modal" ref={setupModalRef} tabIndex={-1}>
              <div className="modal-heading">
                <div>
                  <h2 id="setup-modal-title">需要安装 Git 才能使用核心功能</h2>
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
    </ConfirmProvider>
  );
}

export default App;
