import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Blocks,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cloud,
  Code2,
  Command,
  HardDrive,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  MoreHorizontal,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type { Account, BackupRecord, BranchInfo, ChangeFile, CommitEntry, EnvironmentStatus, GitOperation, GitSnapshot, OperationRecord, Project, ProjectAnalysis, ProjectFilter, ProjectStatus, RemoteProvider, RemoteRepository, TaskProfile, TaskRun, Workspace } from "./types";
import { getDesktopBridge, isDesktopRuntime, requireDesktopBridge } from "./lib/bridge";
import { loadProjects, saveProjects } from "./lib/projects";

type NavItem = {
  id: Workspace;
  label: string;
  icon: typeof LayoutDashboard;
  count?: string;
};

const statusMeta: Record<ProjectStatus, { label: string; className: string }> = {
  clean: { label: "已同步", className: "status-clean" },
  ahead: { label: "领先远程", className: "status-ahead" },
  behind: { label: "落后远程", className: "status-behind" },
  dirty: { label: "有未提交修改", className: "status-dirty" },
  conflicted: { label: "存在冲突", className: "status-conflicted" },
};

const providerLabels: Record<Project["provider"], string> = {
  local: "本地",
  github: "GitHub",
  gitee: "Gitee",
  gitlab: "GitLab",
};

const providerIcons: Record<Project["provider"], typeof Github> = {
  local: FolderGit2,
  github: Github,
  gitee: Cloud,
  gitlab: Blocks,
};

const operationLabels: Record<GitOperation, string> = {
  fetch: "获取远程更新",
  pull: "拉取更新",
  push: "推送更新",
  sync: "同步项目",
};

const remoteProviderLabels: Record<RemoteProvider, string> = {
  github: "GitHub",
  gitee: "Gitee",
  gitlab: "GitLab",
};

function buildNavGroups(counts: { projects: number; remotes: number; accounts: number; tasks: number }): { label: string; items: NavItem[] }[] {
  return [
    {
      label: "工作区",
      items: [
        { id: "overview", label: "总览", icon: LayoutDashboard },
        { id: "projects", label: "我的项目", icon: FolderGit2, count: counts.projects > 0 ? String(counts.projects) : undefined },
        { id: "remotes", label: "远程仓库", icon: Cloud, count: counts.remotes > 0 ? String(counts.remotes) : undefined },
      ],
    },
    {
      label: "工具",
      items: [
        { id: "accounts", label: "账号与令牌", icon: KeyRound, count: counts.accounts > 0 ? String(counts.accounts) : undefined },
        { id: "tasks", label: "任务中心", icon: ListTodo, count: counts.tasks > 0 ? String(counts.tasks) : undefined },
        { id: "backups", label: "备份中心", icon: Archive },
        { id: "logs", label: "操作记录", icon: Clock3 },
        { id: "settings", label: "设置", icon: Settings2 },
      ],
    },
  ];
}

const LAST_IMPORT_DIRECTORY_KEY = "gitool.lastImportDirectory";

function App() {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  const [projects, setProjects] = useState<Project[]>(() => isDesktopRuntime() ? [] : loadProjects());
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeOperation, setActiveOperation] = useState<GitOperation | null>(null);
  const [operationOutput, setOperationOutput] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBusyId, setAccountBusyId] = useState<string | null>(null);
  const [remoteRepositories, setRemoteRepositories] = useState<RemoteRepository[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [remoteSearch, setRemoteSearch] = useState("");
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(false);
  const [cloningRepositoryId, setCloningRepositoryId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (isDesktopRuntime()) {
      const bridge = requireDesktopBridge();
      void Promise.all([
        bridge.loadProjects(),
        bridge.environment(),
        bridge.loadAccounts(),
      ]).then(([storedProjects, environmentStatus, storedAccounts]) => {
        if (cancelled) return;
        setProjects(storedProjects);
        setSelectedId(storedProjects[0]?.id ?? "");
        setEnvironment(environmentStatus);
        setAccounts(storedAccounts);
        setSelectedAccountId(storedAccounts[0]?.id ?? "");
      }).catch(() => {
        if (!cancelled) setNotice("无法读取本地工作区数据");
      });
    } else {
      setEnvironment({ git_available: true, git_version: "浏览器预览", platform: "web" });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProject = projects.find((project) => project.id === selectedId) ?? projects[0];
  const allTags = useMemo(() => [...new Set(projects.flatMap((project) => project.tags))].sort(), [projects]);
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "favorite" && project.favorite) ||
        (filter === "attention" && project.status !== "clean");
      const matchesTag = !tagFilter || project.tags.includes(tagFilter);
      const matchesSearch = !query || `${project.name} ${project.path} ${project.summary} ${project.tags.join(" ")}`.toLowerCase().includes(query);
      return matchesFilter && matchesTag && matchesSearch;
    });
  }, [filter, projects, search, tagFilter]);

  const updateProjects = (nextProjects: Project[]) => {
    setProjects(nextProjects);
    if (isDesktopRuntime()) {
      void requireDesktopBridge().saveProjects(nextProjects);
    } else {
      saveProjects(nextProjects);
    }
  };

  const toggleFavorite = (projectId: string) => {
    updateProjects(projects.map((project) => (project.id === projectId ? { ...project, favorite: !project.favorite } : project)));
  };

  const addAccount = async (input: { provider: RemoteProvider; displayName: string; username: string; token: string }) => {
    if (!isDesktopRuntime()) {
      setNotice("账号凭据管理需要使用 Windows 桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return false;
    }

    try {
      const account = await requireDesktopBridge().createAccount({
        provider: input.provider,
        displayName: input.displayName,
        username: input.username,
        authType: "pat",
        token: input.token,
      });
      setAccounts((current) => [account, ...current]);
      setNotice("账号已保存到本地凭据配置");
      window.setTimeout(() => setNotice(null), 3000);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "账号保存失败");
      return false;
    }
  };

  const testAccount = async (accountId: string) => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会访问远程平台");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    setAccountBusyId(accountId);
    try {
      const result = await requireDesktopBridge().testAccount(accountId);
      setAccounts((current) => current.map((account) => account.id === accountId ? {
        ...account,
        status: result.success ? "active" : "invalid",
        username: result.username ?? account.username,
        scopes: result.scopes,
        lastCheckedAt: new Date().toISOString(),
      } : account));
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "账号连接测试失败");
    } finally {
      setAccountBusyId(null);
      window.setTimeout(() => setNotice(null), 3200);
    }
  };

  const deleteAccount = async (accountId: string) => {
    if (!window.confirm("删除账号后，Gitool 将同时删除对应的本地凭据引用。继续吗？")) return;
    if (!isDesktopRuntime()) {
      setAccounts((current) => current.filter((account) => account.id !== accountId));
      return;
    }
    setAccountBusyId(accountId);
    try {
      await requireDesktopBridge().deleteAccount(accountId);
      setAccounts((current) => current.filter((account) => account.id !== accountId));
      setRemoteRepositories((current) => current.filter((repository) => repository.accountId !== accountId));
      setSelectedAccountId((current) => current === accountId ? "" : current);
      setNotice("账号和对应凭据已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "账号删除失败");
    } finally {
      setAccountBusyId(null);
      window.setTimeout(() => setNotice(null), 3200);
    }
  };

  const loadRemoteRepositories = async (accountId = selectedAccountId) => {
    if (!accountId) {
      setNotice("请先添加并选择一个远程账号");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会访问远程平台，请使用 Windows 桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }

    setIsLoadingRemotes(true);
    try {
      const repositories = await requireDesktopBridge().loadRemoteRepositories(accountId);
      setRemoteRepositories(repositories);
      setNotice(`已同步 ${repositories.length} 个远程仓库`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "远程仓库同步失败");
    } finally {
      setIsLoadingRemotes(false);
      window.setTimeout(() => setNotice(null), 3200);
    }
  };

  const cloneRemoteRepository = async (repository: RemoteRepository) => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会执行克隆，请使用 Windows 桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    const bridge = requireDesktopBridge();
    const defaultDirectory = window.localStorage.getItem(LAST_IMPORT_DIRECTORY_KEY) ?? undefined;
    const parentDirectory = await bridge.selectDirectory(defaultDirectory);
    if (!parentDirectory) {
      return;
    }
    const targetPath = `${parentDirectory}\\${repository.name}`;
    setCloningRepositoryId(repository.id);
    try {
      const result = await bridge.cloneRepository({
        url: repository.httpsUrl,
        targetPath,
        accountId: repository.accountId,
      });
      if (result.success) {
        const inspected = await bridge.inspectProject(targetPath);
        const snapshot = inspected.snapshot;
        const diskSizeBytes = await bridge.getDiskSize(targetPath).catch(() => 0);
        window.localStorage.setItem(LAST_IMPORT_DIRECTORY_KEY, parentDirectory);
        const newProject: Project = {
          id: `${repository.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
          name: inspected.name,
          path: targetPath,
          provider: repository.provider,
          branch: snapshot?.branch ?? repository.defaultBranch,
          status: snapshot?.status ?? "clean",
          commit: snapshot?.commit ?? "未扫描",
          favorite: false,
          tags: ["cloned"],
          files: snapshot?.files ?? 0,
          syncLabel: snapshot?.sync_label ?? "已克隆",
          language: "待分析",
          languageColor: "#8b97a8",
          summary: repository.description || "从远程平台克隆的项目。",
          updatedAt: snapshot?.updated_at ?? "刚刚",
          diskSizeBytes,
        };
        updateProjects([newProject, ...projects]);
        setSelectedId(newProject.id);
        setWorkspace("projects");
        setNotice("仓库克隆完成，已加入我的项目");
      } else {
        setNotice(`克隆失败：${result.output.slice(0, 200)}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "克隆失败，请查看日志");
    } finally {
      setCloningRepositoryId(null);
      window.setTimeout(() => setNotice(null), 4000);
    }
  };

  const mutateRemoteRepository = async (
    action: "create" | "update" | "delete",
    input: { accountId: string; repositoryId?: string; name: string; description: string; visibility: "public" | "private" | "internal" | ""; init: boolean },
  ) => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会修改远程仓库，请使用 Windows 桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return false;
    }
    if (action === "delete") {
      const confirmed = window.confirm("删除远程仓库是不可逆操作，仓库及其历史将被永久删除。确定继续吗？");
      if (!confirmed) return false;
    }
    try {
      const bridge = requireDesktopBridge();
      const result =
        action === "create"
          ? await bridge.createRemoteRepository({ ...input, repositoryId: undefined })
          : action === "update"
            ? await bridge.updateRemoteRepository(input)
            : await bridge.deleteRemoteRepository(input.accountId, input.repositoryId!);
      setNotice(result.message);
      if (action === "create" || action === "update") {
        await loadRemoteRepositories(input.accountId);
      } else {
        setRemoteRepositories((current) => current.filter((repository) => repository.accountId !== input.accountId || repository.id !== input.repositoryId));
      }
      return result.success;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "远程仓库操作失败");
      return false;
    } finally {
      window.setTimeout(() => setNotice(null), 4000);
    }
  };

  const runGitOperation = async (operation: GitOperation) => {
    if (!selectedProject) return;
    setOperationOutput(null);
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会执行 Git 命令，请使用桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }

    setActiveOperation(operation);
    try {
      const result = await requireDesktopBridge().runGitOperation(selectedProject.path, operation);
      setOperationOutput(result.output);
      if (result.snapshot) {
        updateProjects(projects.map((project) => (
          project.id === selectedProject.id ? projectFromSnapshot(project, result.snapshot!) : project
        )));
      }
      setNotice(result.success ? `${operationLabels[operation]}完成` : `${operationLabels[operation]}失败`);
    } catch (error) {
      setOperationOutput(error instanceof Error ? error.message : "Git 操作失败，请查看日志");
      setNotice(`${operationLabels[operation]}失败`);
    } finally {
      setActiveOperation(null);
      window.setTimeout(() => setNotice(null), 3200);
    }
  };

  const runBulkGitOperation = async (operation: GitOperation, ids: string[]) => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会执行 Git 命令，请使用桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    const bridge = requireDesktopBridge();
    let successCount = 0;
    let failureCount = 0;
    const updated: Project[] = [];
    for (const project of projects) {
      if (!ids.includes(project.id)) continue;
      try {
        const result = await bridge.runGitOperation(project.path, operation);
        if (result.success) {
          successCount += 1;
          updated.push(result.snapshot ? projectFromSnapshot(project, result.snapshot!) : project);
        } else {
          failureCount += 1;
          updated.push(project);
        }
      } catch {
        failureCount += 1;
        updated.push(project);
      }
    }
    updateProjects(projects.map((project) => updated.find((item) => item.id === project.id) ?? project));
    setNotice(`批量${operationLabels[operation]}完成：成功 ${successCount}，失败 ${failureCount}`);
    window.setTimeout(() => setNotice(null), 4000);
  };

  const analyzeProject = async () => {
    if (!selectedProject) return;
    setAnalysis(null);
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不会扫描本地文件，请使用桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }

    setIsAnalyzing(true);
    try {
      const result = await requireDesktopBridge().analyzeProject(selectedProject.path);
      setAnalysis(result);
      setNotice("项目结构分析完成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "项目结构分析失败");
    } finally {
      setIsAnalyzing(false);
      window.setTimeout(() => setNotice(null), 3200);
    }
  };

  const importProject = async () => {
    const bridge = getDesktopBridge();
    const lastDirectory = window.localStorage.getItem(LAST_IMPORT_DIRECTORY_KEY) ?? undefined;
    const path = bridge
      ? await bridge.selectDirectory(lastDirectory)
      : window.prompt("输入本地 Git 仓库路径", "D:/Projects/new-project");
    if (!path) return;
    setIsImporting(true);
    try {
      let projectName = path.split(/[\\/]/).filter(Boolean).pop() ?? "新项目";
      let isGitRepository = true;
      let importedSnapshot: GitSnapshot | undefined;
      if (bridge) {
        const inspected = await bridge.inspectProject(path);
        projectName = inspected.name;
        isGitRepository = inspected.is_git_repository;
        importedSnapshot = inspected.snapshot;
      }
      if (!isGitRepository) {
        setNotice("这个目录还不是 Git 仓库");
        return;
      }
      let diskSizeBytes = 0;
      if (bridge) {
        diskSizeBytes = await bridge.getDiskSize(path).catch(() => 0);
      }
      const newProject: Project = {
        id: `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        name: projectName,
        path,
        provider: "local",
        branch: "main",
        status: "clean",
        language: "待分析",
        languageColor: "#8b97a8",
        summary: "刚导入的本地项目，等待结构分析。",
        updatedAt: "刚刚",
        commit: "未扫描",
        favorite: false,
        tags: ["new"],
        files: 0,
        syncLabel: "待扫描",
        diskSizeBytes,
      };
      if (importedSnapshot) Object.assign(newProject, projectFromSnapshot(newProject, importedSnapshot));
      window.localStorage.setItem(LAST_IMPORT_DIRECTORY_KEY, path);
      updateProjects([newProject, ...projects]);
      setSelectedId(newProject.id);
      setWorkspace("projects");
      setNotice("项目已导入");
    } catch {
      setNotice("无法读取这个目录，请确认路径存在且可访问");
    } finally {
      setIsImporting(false);
    }
  };

  const refreshProjects = async () => {
    setIsRefreshing(true);
    try {
      if (!isDesktopRuntime()) {
        setNotice("浏览器预览使用演示数据，桌面版会读取真实 Git 状态");
        return;
      }
      const bridge = requireDesktopBridge();
      const refreshed = await Promise.all(projects.map(async (project) => {
        try {
          const snapshot = await bridge.getProjectSnapshot(project.path);
          const disk = await bridge.getDiskSize(project.path).catch(() => 0);
          return { ...projectFromSnapshot(project, snapshot), diskSizeBytes: disk };
        } catch {
          return project;
        }
      }));
      updateProjects(refreshed);
      setNotice("项目状态已刷新");
    } finally {
      setIsRefreshing(false);
      window.setTimeout(() => setNotice(null), 3000);
    }
  };

  const moveProject = async (sourceProject: Project) => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不支持移动项目");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    if (!window.confirm("移动项目会复制整个目录（含 .git）到新位置，并更新本地记录。确定继续吗？")) return;
    const bridge = requireDesktopBridge();
    const targetDirectory = await bridge.selectDirectory();
    if (!targetDirectory) return;
    try {
      const result = await bridge.moveProject({ sourcePath: sourceProject.path, targetDirectory });
      if (result.success) {
        updateProjects(projects.map((project) => project.id === sourceProject.id ? { ...project, path: result.targetPath } : project));
        setNotice("项目已移动，记录已更新");
      } else {
        setNotice(`移动失败：${result.output}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "移动失败");
    } finally {
      window.setTimeout(() => setNotice(null), 4000);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><GitBranch size={18} strokeWidth={2.5} /></div>
          <div>
            <strong>Gitool</strong>
            <span>Developer workspace</span>
          </div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">L</div>
          <div className="workspace-copy">
            <span>个人工作区</span>
            <small>本地模式</small>
          </div>
          <ChevronDown size={15} />
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {buildNavGroups({ projects: projects.length, remotes: remoteRepositories.length, accounts: accounts.length, tasks: projects.filter((project) => project.tags.includes("building")).length }).map((group) => (
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

        <div className="sidebar-bottom">
          <div className="sync-card">
            <div className="sync-card-top">
              <span className="online-dot" />
              <span>本地环境正常</span>
              <ShieldCheck size={15} />
            </div>
            <p>{environment?.git_version ?? "正在检测 Git"} · {environment?.platform === "web" ? "浏览器预览" : "Windows x64"}</p>
          </div>
          <button className="nav-item settings-item" onClick={() => setWorkspace("settings")}>
            <Settings2 size={17} />
            <span>设置</span>
          </button>
          <div className="profile-row">
            <div className="profile-avatar">L</div>
            <div className="profile-copy"><strong>Local workspace</strong><span>离线优先</span></div>
            <MoreHorizontal size={17} />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Gitool</span><span className="breadcrumb-slash">/</span><strong>{workspaceLabel(workspace)}</strong></div>
          <div className="topbar-actions">
            <div className="command-hint"><Command size={13} /><span>快速查找</span><kbd>⌘ K</kbd></div>
            <button className="icon-button" aria-label="通知"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="top-avatar">L</div>
          </div>
        </header>

        <div className="content-scroll">
          {workspace === "overview" || workspace === "projects" ? (
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
              onSelect={(id) => { setSelectedId(id); setOperationOutput(null); setAnalysis(null); }}
              onToggleFavorite={toggleFavorite}
              onUpdateProject={(projectId, patch) => updateProjects(projects.map((project) => project.id === projectId ? { ...project, ...patch } : project))}
              onBulkGitOperation={runBulkGitOperation}
              onMoveProject={moveProject}
              onImport={importProject}
              onRefresh={refreshProjects}
              isRefreshing={isRefreshing}
              onRunGitOperation={runGitOperation}
              activeOperation={activeOperation}
              operationOutput={operationOutput}
              onAnalyzeProject={analyzeProject}
              isAnalyzing={isAnalyzing}
              analysis={analysis}
              workspace={workspace}
            />
          ) : workspace === "accounts" ? (
            <AccountsWorkspace accounts={accounts} accountBusyId={accountBusyId} onAdd={addAccount} onTest={testAccount} onDelete={deleteAccount} />
          ) : workspace === "remotes" ? (
            <RemoteRepositoriesWorkspace accounts={accounts} repositories={remoteRepositories} selectedAccountId={selectedAccountId} search={remoteSearch} isLoading={isLoadingRemotes} cloningRepositoryId={cloningRepositoryId} onAccountChange={setSelectedAccountId} onSearchChange={setRemoteSearch} onRefresh={() => loadRemoteRepositories()} onClone={cloneRemoteRepository} onMutate={mutateRemoteRepository} />
          ) : workspace === "tasks" ? (
            <TasksWorkspace projects={projects} />
          ) : workspace === "backups" ? (
            <BackupsWorkspace projects={projects} />
          ) : workspace === "logs" ? (
            <LogsWorkspace />
          ) : workspace === "settings" ? (
            <SettingsWorkspace environment={environment} />
          ) : (
            <ModuleWorkspace workspace={workspace} onImport={importProject} />
          )}
        </div>
      </main>

      {notice && <div className="toast"><Check size={16} />{notice}</div>}
    </div>
  );
}

function projectFromSnapshot(project: Project, snapshot: GitSnapshot): Project {
  return {
    ...project,
    branch: snapshot.branch,
    status: snapshot.status,
    commit: snapshot.commit,
    files: snapshot.files,
    syncLabel: snapshot.sync_label,
    updatedAt: snapshot.updated_at,
  };
}

function workspaceLabel(workspace: Workspace) {
  const labels: Record<Workspace, string> = {
    overview: "总览",
    projects: "我的项目",
    remotes: "远程仓库",
    accounts: "账号与令牌",
    tasks: "任务中心",
    backups: "备份中心",
    logs: "设置与记录",
    settings: "设置",
  };
  return labels[workspace];
}

type ProjectsWorkspaceProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject?: Project;
  filter: ProjectFilter;
  search: string;
  tagFilter: string;
  allTags: string[];
  isImporting: boolean;
  workspace: Workspace;
  onFilterChange: (filter: ProjectFilter) => void;
  onSearchChange: (search: string) => void;
  onTagFilterChange: (tag: string) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateProject: (id: string, patch: Partial<Project>) => void;
  onBulkGitOperation: (operation: GitOperation, ids: string[]) => void | Promise<void>;
  onMoveProject: (project: Project) => void | Promise<void>;
  onImport: () => void;
  onRefresh: () => void | Promise<void>;
  isRefreshing: boolean;
  onRunGitOperation: (operation: GitOperation) => void | Promise<void>;
  activeOperation: GitOperation | null;
  operationOutput: string | null;
  onAnalyzeProject: () => void | Promise<void>;
  isAnalyzing: boolean;
  analysis: ProjectAnalysis | null;
};

function ProjectsWorkspace({
  projects,
  filteredProjects,
  selectedProject,
  filter,
  search,
  tagFilter,
  allTags,
  isImporting,
  workspace,
  onFilterChange,
  onSearchChange,
  onTagFilterChange,
  onSelect,
  onToggleFavorite,
  onUpdateProject,
  onBulkGitOperation,
  onMoveProject,
  onImport,
  onRefresh,
  isRefreshing,
  onRunGitOperation,
  activeOperation,
  operationOutput,
  onAnalyzeProject,
  isAnalyzing,
  analysis,
}: ProjectsWorkspaceProps) {
  const attentionCount = projects.filter((project) => project.status !== "clean").length;
  const favoriteCount = projects.filter((project) => project.favorite).length;
  const providerCount = new Set(projects.map((project) => project.provider)).size;
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (typing) {
          (target as HTMLInputElement).blur();
        } else if (search) {
          onSearchChange("");
        }
        setSelectedBulkIds([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [search, onSearchChange]);

  useEffect(() => {
    setSelectedBulkIds([]);
  }, [filter, workspace]);

  const toggleBulk = (id: string) => {
    setSelectedBulkIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleAll = () => {
    setSelectedBulkIds((current) => current.length === filteredProjects.length ? [] : filteredProjects.map((project) => project.id));
  };

  const runBulk = (operation: GitOperation) => {
    if (selectedBulkIds.length === 0) return;
    void onBulkGitOperation(operation, selectedBulkIds);
    setSelectedBulkIds([]);
  };

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" />{workspace === "overview" ? "工作区状态" : "项目目录"}</div>
          <h1>{workspace === "overview" ? "早上好，Leo" : "我的项目"}</h1>
          <p>{workspace === "overview" ? "这里是你今天的开发现场。" : "集中查看本地项目、远程关联与工作区状态。"}</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" onClick={onRefresh} disabled={isRefreshing}><RefreshCw size={15} className={isRefreshing ? "spin" : ""} />{isRefreshing ? "刷新中..." : "刷新状态"}</button>
          <button className="button primary" onClick={onImport}><Plus size={16} />{isImporting ? "导入中..." : "导入项目"}</button>
        </div>
      </div>

      <section className="metric-grid" aria-label="工作区指标">
        <MetricCard label="全部项目" value={projects.length.toString()} detail="本地已登记" icon={<FolderGit2 size={18} />} tone="teal" />
        <MetricCard label="需要关注" value={attentionCount.toString().padStart(2, "0")} detail="有待处理变更" icon={<CircleAlert size={18} />} tone="coral" />
        <MetricCard label="已收藏" value={favoriteCount.toString().padStart(2, "0")} detail="快速访问项目" icon={<Star size={18} />} tone="yellow" />
        <MetricCard label="连接平台" value={providerCount.toString()} detail="远程与本地" icon={<Cloud size={18} />} tone="blue" />
      </section>

      {workspace === "overview" && <AttentionPanel projects={projects} selectedId={selectedProject?.id} onSelect={onSelect} />}

      <div className="section-toolbar">
        <div className="filter-tabs">
          <FilterButton active={filter === "all"} onClick={() => onFilterChange("all")}>全部 <span>{projects.length}</span></FilterButton>
          <FilterButton active={filter === "favorite"} onClick={() => onFilterChange("favorite")}>已收藏 <span>{favoriteCount}</span></FilterButton>
          <FilterButton active={filter === "attention"} onClick={() => onFilterChange("attention")}>需要关注 <span>{attentionCount}</span></FilterButton>
        </div>
        <label className="search-box"><Search size={16} /><input ref={searchRef} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索项目、路径或摘要" /><kbd>/</kbd></label>
      </div>

      {allTags.length > 0 && <div className="tag-filter-bar"><span>标签：</span><button className={`tag-filter-chip ${tagFilter === "" ? "active" : ""}`} onClick={() => onTagFilterChange("")}>全部</button>{allTags.map((tag) => <button key={tag} className={`tag-filter-chip ${tagFilter === tag ? "active" : ""}`} onClick={() => onTagFilterChange(tagFilter === tag ? "" : tag)}><Tag size={10} />{tag}</button>)}</div>}

      <section className="project-layout">
        <div className="project-list-panel">
          <div className="panel-heading"><div><h2>最近项目</h2><span>{filteredProjects.length} 个结果</span></div><div className="panel-heading-actions"><label className="select-all"><input type="checkbox" checked={filteredProjects.length > 0 && selectedBulkIds.length === filteredProjects.length} onChange={toggleAll} /><span>全选</span></label><button className="bare-button" aria-label="更多项目"><MoreHorizontal size={18} /></button></div></div>
          <div className="project-list">
            {filteredProjects.length ? filteredProjects.map((project) => (
              <ProjectRow key={project.id} project={project} selected={project.id === selectedProject?.id} bulkSelected={selectedBulkIds.includes(project.id)} onToggleBulk={() => toggleBulk(project.id)} onSelect={() => onSelect(project.id)} onToggleFavorite={() => onToggleFavorite(project.id)} />
            )) : <EmptyProjects onImport={onImport} />}
          </div>
        </div>
        {selectedProject ? <ProjectDetail project={selectedProject} onToggleFavorite={() => onToggleFavorite(selectedProject.id)} onUpdateProject={(patch) => onUpdateProject(selectedProject.id, patch)} onMoveProject={() => onMoveProject(selectedProject)} onRunGitOperation={onRunGitOperation} activeOperation={activeOperation} operationOutput={operationOutput} onAnalyzeProject={onAnalyzeProject} isAnalyzing={isAnalyzing} analysis={analysis} /> : <div className="detail-panel empty-detail">选择一个项目查看详情</div>}
      </section>

      {selectedBulkIds.length > 0 && <div className="bulk-action-bar">
        <span>已选 {selectedBulkIds.length} 个项目</span>
        <div className="bulk-actions">
          <button className="button secondary compact-button" onClick={() => runBulk("fetch")}><Cloud size={14} />批量获取</button>
          <button className="button secondary compact-button" onClick={() => runBulk("pull")}><ArrowDownToLine size={14} />批量拉取</button>
          <button className="button secondary compact-button" onClick={() => runBulk("push")}><ArrowUpRight size={14} />批量推送</button>
          <button className="icon-button danger" onClick={() => setSelectedBulkIds([])} aria-label="取消选择"><X size={16} /></button>
        </div>
      </div>}
    </div>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><ArrowUpRight size={15} className="metric-arrow" /></div>;
}

function AttentionPanel({ projects, selectedId, onSelect }: { projects: Project[]; selectedId?: string; onSelect: (id: string) => void }) {
  const attention = projects.filter((project) => project.status !== "clean");
  if (attention.length === 0) {
    return null;
  }
  return <section className="attention-panel">
    <div className="panel-heading"><div><h2>需要关注</h2><span>未提交 / 领先 / 落后 / 冲突 项目</span></div><span className="secure-label"><CircleAlert size={13} />{attention.length} 项</span></div>
    <div className="attention-list">
      {attention.map((project) => {
        const status = statusMeta[project.status];
        return <button className={`attention-row ${project.id === selectedId ? "selected" : ""}`} key={project.id} onClick={() => onSelect(project.id)}>
          <span className={`status-pill ${status.className}`}><span className="status-dot" />{status.label}</span>
          <strong>{project.name}</strong>
          <span className="attention-path">{project.path}</span>
          <span className="attention-sync">{project.syncLabel}</span>
        </button>;
      })}
    </div>
  </section>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`filter-button ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function ProjectRow({ project, selected, bulkSelected, onToggleBulk, onSelect, onToggleFavorite }: { project: Project; selected: boolean; bulkSelected: boolean; onToggleBulk: () => void; onSelect: () => void; onToggleFavorite: () => void }) {
  const ProviderIcon = providerIcons[project.provider];
  const status = statusMeta[project.status];
  const dormant = isDormant(project);
  return <div className={`project-row ${selected ? "selected" : ""} ${bulkSelected ? "bulk-selected" : ""}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}>
    <label className="bulk-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={bulkSelected} onChange={onToggleBulk} aria-label="选择项目" /></label>
    <div className="project-type-icon" style={{ color: project.languageColor }}><ProviderIcon size={18} /></div>
    <div className="project-row-main"><div className="project-name-line"><strong>{project.alias || project.name}</strong><span className="provider-name">{providerLabels[project.provider]}</span></div><p>{project.path}</p><div className="project-row-meta"><span className={`status-pill ${status.className}`}><span className="status-dot" />{project.syncLabel}</span><span><GitBranch size={12} />{project.branch}</span><span><HardDrive size={12} />{project.diskSizeBytes > 0 ? formatBytes(project.diskSizeBytes) : "—"}</span>{dormant && <span className="status-pill status-behind"><span className="status-dot" />休眠</span>}</div></div>
    <button className={`favorite-button ${project.favorite ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }} aria-label={project.favorite ? "取消收藏" : "收藏项目"}><Star size={16} fill={project.favorite ? "currentColor" : "none"} /></button>
  </div>;
}

function EmptyProjects({ onImport }: { onImport: () => void }) {
  return <div className="empty-projects"><div className="empty-icon"><FolderGit2 size={21} /></div><strong>没有匹配的项目</strong><span>换一个搜索词，或导入一个本地仓库。</span><button className="button secondary compact" onClick={onImport}><Plus size={15} />导入项目</button></div>;
}

function ProjectDetail({ project, onToggleFavorite, onUpdateProject, onMoveProject, onRunGitOperation, activeOperation, operationOutput, onAnalyzeProject, isAnalyzing, analysis }: { project: Project; onToggleFavorite: () => void; onUpdateProject: (patch: Partial<Project>) => void; onMoveProject: () => void; onRunGitOperation: (operation: GitOperation) => void | Promise<void>; activeOperation: GitOperation | null; operationOutput: string | null; onAnalyzeProject: () => void | Promise<void>; isAnalyzing: boolean; analysis: ProjectAnalysis | null }) {
  const status = statusMeta[project.status];
  const ProviderIcon = providerIcons[project.provider];
  const bridge = getDesktopBridge();
  const [actionMessage, setActionMessage] = useState("");

  const runOpen = (editor: "vscode" | "cursor", newWindow: boolean) => {
    if (!bridge) {
      setActionMessage("浏览器预览不支持打开编辑器");
      return;
    }
    void bridge.openInEditor({ path: project.path, editor, newWindow }).then(() => setActionMessage(`已请求在 ${editor === "vscode" ? "VS Code" : "Cursor"} 中打开`)).catch((error) => setActionMessage(error instanceof Error ? error.message : "打开编辑器失败"));
  };

  const openTerminal = () => {
    if (!bridge) {
      setActionMessage("浏览器预览不支持打开终端");
      return;
    }
    void bridge.openInTerminal(project.path).then(() => setActionMessage("已在项目目录打开终端")).catch((error) => setActionMessage(error instanceof Error ? error.message : "打开终端失败"));
  };

  const copyPath = async () => {
    await navigator.clipboard.writeText(project.path);
    setActionMessage("项目路径已复制到剪贴板");
  };

  const openFolder = () => {
    if (!bridge) {
      setActionMessage("浏览器预览不支持打开资源管理器");
      return;
    }
    void bridge.openPath(project.path).then(() => setActionMessage("已在资源管理器中打开")).catch((error) => setActionMessage(error instanceof Error ? error.message : "打开失败"));
  };

  const generateSummary = async () => {
    if (!bridge) {
      setActionMessage("浏览器预览无法读取项目内容");
      return;
    }
    setActionMessage("正在生成摘要...");
    try {
      const [readme, history, disk] = await Promise.all([
        bridge.readProjectReadme(project.path),
        bridge.listCommitHistory(project.path).catch(() => []),
        bridge.getDiskSize(project.path).catch(() => 0),
      ]);
      const readmeSummary = readme.found && readme.content.trim()
        ? readme.content.trim().split(/\r?\n/).find((line) => /^#\s+/.test(line) || line.trim().length > 0)?.replace(/^#+\s*/, "").slice(0, 120)
        : "";
      const languageLine = analysis && analysis.languages.length > 0
        ? `主要语言：${analysis.languages.slice(0, 3).map((item) => item.name).join("、")}`
        : "";
      const historyLine = history.length > 0
        ? `最近提交：${history.slice(0, 3).map((entry) => entry.subject).join("；")}`
        : "";
      const sizeLine = disk > 0 ? `项目大小约 ${formatBytes(disk)}` : "";
      const parts = [
        readmeSummary ? `「${readmeSummary}」` : `基于 ${project.name} 的项目摘要。`,
        languageLine,
        historyLine,
        sizeLine,
        `共 ${analysis?.files ?? 0} 个文件、${analysis?.directories ?? 0} 个目录。`,
      ].filter(Boolean);
      onUpdateProject({ summary: parts.join("。") + "。" });
      setActionMessage("本地智能摘要已生成（未发送到任何外部服务）");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "生成摘要失败");
    }
  };

  return <aside className="detail-panel">
    <div className="detail-top"><div className="detail-provider"><ProviderIcon size={16} />{providerLabels[project.provider]}</div><button className={`favorite-button ${project.favorite ? "active" : ""}`} onClick={onToggleFavorite} aria-label={project.favorite ? "取消收藏" : "收藏项目"}><Star size={17} fill={project.favorite ? "currentColor" : "none"} /></button></div>
    <div className="detail-title"><div className="large-project-icon" style={{ color: project.languageColor }}><Code2 size={25} /></div><div><h2>{project.name}</h2><p>{project.path}</p></div><AliasEditor alias={project.alias} onSave={(alias) => onUpdateProject({ alias: alias.trim().length > 0 ? alias.trim() : undefined })} /></div>
    <div className="detail-status-row"><span className={`status-pill ${status.className}`}><span className="status-dot" />{status.label}</span><span className="detail-updated"><Clock3 size={13} />{project.updatedAt}</span></div>
    <p className="detail-summary">{project.summary}</p>
    <div className="detail-tags">{project.tags.map((tag) => <span className="tag" key={tag}><Tag size={11} />{tag}<button className="tag-remove" aria-label={`删除标签 ${tag}`} onClick={() => onUpdateProject({ tags: project.tags.filter((item) => item !== tag) })}><X size={9} /></button></span>)}<TagEditor tags={project.tags} onAdd={(tag) => onUpdateProject({ tags: [...project.tags, tag] })} /></div>
    <div className="detail-actions"><button className="button primary wide" onClick={() => onRunGitOperation("pull")} disabled={activeOperation !== null}><ArrowDownToLine size={15} />{activeOperation === "pull" ? "拉取中..." : "拉取更新"}</button><button className="button secondary square" onClick={() => onRunGitOperation("sync")} disabled={activeOperation !== null} aria-label="同步项目"><RefreshCw size={17} className={activeOperation === "sync" ? "spin" : ""} /></button></div>
    <div className="git-operation-grid">
      <GitOperationButton operation="fetch" activeOperation={activeOperation} onRun={onRunGitOperation} icon={<Cloud size={14} />} />
      <GitOperationButton operation="push" activeOperation={activeOperation} onRun={onRunGitOperation} icon={<ArrowUpRight size={14} />} />
      <GitOperationButton operation="sync" activeOperation={activeOperation} onRun={onRunGitOperation} icon={<RefreshCw size={14} />} />
    </div>
    {operationOutput && <div className="operation-output"><div><span>最近一次 Git 输出</span><button className="bare-button" onClick={() => onRunGitOperation("fetch")} aria-label="重新获取远程更新"><RefreshCw size={13} /></button></div><pre>{operationOutput}</pre></div>}
    <div className="detail-section"><div className="detail-section-heading"><span>项目概览</span><button className="bare-button" onClick={openFolder} aria-label="在资源管理器中打开" title="在资源管理器中打开"><ExternalLink size={14} /></button></div><div className="detail-stats"><DetailStat icon={<GitBranch size={14} />} label="当前分支" value={project.branch} /><DetailStat icon={<GitCommitHorizontal size={14} />} label="最近提交" value={project.commit} /><DetailStat icon={<FileCode2 size={14} />} label="文件数量" value={`${project.files}`} /></div></div>
    <ReadmeSection projectPath={project.path} />
    <div className="detail-section"><div className="detail-section-heading"><span>快捷入口</span></div><div className="quick-links"><button onClick={openTerminal}><TerminalSquare size={15} />打开终端<ArrowUpRight size={13} /></button><button onClick={() => runOpen("vscode", false)}><Code2 size={15} />VS Code<ArrowUpRight size={13} /></button><button onClick={() => runOpen("cursor", false)}><Blocks size={15} />Cursor<ArrowUpRight size={13} /></button><button onClick={copyPath}><FileCode2 size={15} />复制路径<ArrowUpRight size={13} /></button><button onClick={onAnalyzeProject} disabled={isAnalyzing}><Blocks size={15} />{isAnalyzing ? "分析中..." : "结构分析"}<ArrowUpRight size={13} /></button><button onClick={generateSummary}><Sparkles size={15} />生成摘要<ArrowUpRight size={13} /></button><button onClick={onMoveProject}><FolderGit2 size={15} />移动项目<ArrowUpRight size={13} /></button></div>{actionMessage && <div className="git-output"><pre>{actionMessage}</pre></div>}</div>
    {analysis && <ProjectAnalysisPanel analysis={analysis} />}
    <GitActionsPanel projectPath={project.path} />
  </aside>;
}

function AliasEditor({ alias, onSave }: { alias?: string; onSave: (alias: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(alias ?? "");
  if (!editing) {
    return <button className="alias-badge" onClick={() => { setValue(alias ?? ""); setEditing(true); }} title="编辑别名">{alias ? <><PenLine size={11} />{alias}</> : <span className="alias-empty">别名</span>}</button>;
  }
  return <div className="alias-edit"><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { onSave(value); setEditing(false); } if (event.key === "Escape") { setEditing(false); } }} placeholder="输入别名" /><button className="bare-button" onClick={() => { onSave(value); setEditing(false); }}><Check size={14} /></button></div>;
}

function TagEditor({ tags, onAdd }: { tags: string[]; onAdd: (tag: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const submit = () => {
    const tag = value.trim();
    if (tag && !tags.includes(tag)) {
      onAdd(tag);
    }
    setValue("");
    setEditing(false);
  };
  if (!editing) {
    return <button className="add-tag" aria-label="添加标签" title="添加标签" onClick={() => setEditing(true)}><Plus size={13} /></button>;
  }
  return <div className="tag-edit"><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); if (event.key === "Escape") setEditing(false); }} placeholder="新标签" /><button className="bare-button" onClick={submit}><Check size={13} /></button></div>;
}

function ReadmeSection({ projectPath }: { projectPath: string }) {
  const [state, setState] = useState<{ found: boolean; content: string; fileName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const bridge = getDesktopBridge();

  useEffect(() => {
    let cancelled = false;
    setState(null);
    if (!bridge) return;
    setLoading(true);
    void bridge.readProjectReadme(projectPath)
      .then((result) => { if (!cancelled) setState(result); })
      .catch(() => { if (!cancelled) setState({ found: false, content: "", fileName: "" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  if (loading) {
    return <div className="detail-section readme-section"><div className="detail-section-heading"><span>README</span><small>加载中...</small></div></div>;
  }
  if (!state?.found || !state.content.trim()) {
    return null;
  }
  return <div className="detail-section readme-section">
    <div className="detail-section-heading"><span>README</span><small>{state.fileName}</small></div>
    <div className="readme-body markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(state.content) }} />
  </div>;
}

function ProjectAnalysisPanel({ analysis }: { analysis: ProjectAnalysis }) {  const languageTotal = analysis.languages.reduce((total, language) => total + language.bytes, 0);
  return <div className="analysis-panel">
    <div className="analysis-heading"><div><span>结构分析</span><small>本地扫描结果</small></div><FileCode2 size={15} /></div>
    <div className="analysis-metrics"><AnalysisMetric label="文件" value={analysis.files.toString()} /><AnalysisMetric label="目录" value={analysis.directories.toString()} /><AnalysisMetric label="大小" value={formatBytes(analysis.total_bytes)} /></div>
    {analysis.languages.length > 0 && <div className="language-list"><div className="analysis-label">语言构成</div>{analysis.languages.slice(0, 4).map((language) => <div className="language-row" key={language.name}><span className="language-name"><i style={{ background: language.color }} />{language.name}</span><span>{languageTotal ? `${Math.round((language.bytes / languageTotal) * 100)}%` : "0%"}</span></div>)}</div>}
    {analysis.project_types.length > 0 && <div className="analysis-inline"><span>项目类型</span><strong>{analysis.project_types.join(" · ")}</strong></div>}
    {analysis.key_files.length > 0 && <div className="analysis-files"><div className="analysis-label">关键文件</div>{analysis.key_files.slice(0, 5).map((file) => <code key={file}>{file}</code>)}</div>}
  </div>;
}

function AnalysisMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdownSafe(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html.push(escapeHtml(line));
      continue;
    }
    if (!line.trim()) {
      if (inList) { html.push("</ul>"); inList = false; }
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inlineMarkdown(escapeHtml(line.replace(/^\s*[-*+]\s+/, "")))}</li>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inlineMarkdown(escapeHtml(line.replace(/^\s*\d+[.)]\s+/, "")))}</li>`);
      continue;
    }
    html.push(`<p>${inlineMarkdown(escapeHtml(line))}</p>`);
  }
  if (inCode) html.push("</code></pre>");
  if (inList) html.push("</ul>");
  return html.join("\n");
}

function inlineMarkdown(source: string): string {
  return source
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function isDormant(project: Project, thresholdMonths = 3): boolean {
  const match = project.updatedAt.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) {
    return false;
  }
  const lastActivity = new Date(`${match[0]}T00:00:00`);
  if (Number.isNaN(lastActivity.getTime())) {
    return false;
  }
  const monthsAgo = new Date();
  monthsAgo.setMonth(monthsAgo.getMonth() - thresholdMonths);
  return lastActivity < monthsAgo;
}

function GitOperationButton({ operation, activeOperation, onRun, icon }: { operation: GitOperation; activeOperation: GitOperation | null; onRun: (operation: GitOperation) => void | Promise<void>; icon: React.ReactNode }) {
  return <button className="git-operation-button" onClick={() => onRun(operation)} disabled={activeOperation !== null} title={operationLabels[operation]}>{icon}<span>{activeOperation === operation ? "执行中" : operationLabels[operation]}</span></button>;
}

function DetailStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="detail-stat"><span>{icon}{label}</span><strong>{value}</strong></div>; }

const changeStatusMeta: Record<ChangeFile["status"], { label: string; className: string }> = {
  added: { label: "新增", className: "change-added" },
  modified: { label: "修改", className: "change-modified" },
  deleted: { label: "删除", className: "change-deleted" },
  renamed: { label: "重命名", className: "change-renamed" },
  untracked: { label: "未跟踪", className: "change-untracked" },
  conflicted: { label: "冲突", className: "change-conflicted" },
};

function GitActionsPanel({ projectPath }: { projectPath: string }) {
  const [changedFiles, setChangedFiles] = useState<ChangeFile[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [history, setHistory] = useState<CommitEntry[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [tab, setTab] = useState<"changes" | "branches" | "history">("changes");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [newBranchName, setNewBranchName] = useState("");

  const bridge = getDesktopBridge();

  const loadChangedFiles = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setChangedFiles(await bridge.listChangedFiles(projectPath));
    } catch {
      setChangedFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const loadBranches = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setBranches(await bridge.listBranches(projectPath));
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setHistory(await bridge.listCommitHistory(projectPath));
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshActive = () => {
    if (tab === "changes") void loadChangedFiles();
    if (tab === "branches") void loadBranches();
    if (tab === "history") void loadHistory();
  };

  useEffect(() => {
    setChangedFiles([]);
    setBranches([]);
    setHistory([]);
    setOutput("");
    setCommitMessage("");
    refreshActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tab]);

  const toggleStage = async (file: ChangeFile) => {
    if (!bridge) return;
    setBusy(true);
    try {
      if (file.staged) {
        await bridge.unstageFiles(projectPath, [file.path]);
      } else {
        await bridge.stageFiles(projectPath, [file.path]);
      }
      await loadChangedFiles();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const result = await bridge.commitChanges({ path: projectPath, message: commitMessage });
      setOutput(result.output);
      if (result.success) {
        setCommitMessage("");
        await loadChangedFiles();
        await loadHistory();
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const createBranch = async () => {
    if (!bridge || !newBranchName.trim()) return;
    setBusy(true);
    try {
      await bridge.createBranch({ path: projectPath, name: newBranchName.trim() });
      setNewBranchName("");
      await loadBranches();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "创建分支失败");
    } finally {
      setBusy(false);
    }
  };

  const switchBranch = async (name: string) => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.switchBranch({ path: projectPath, name });
      setOutput(`已切换到分支 ${name}`);
      await loadBranches();
      await loadHistory();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "切换分支失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteBranch = async (name: string) => {
    if (!bridge) return;
    if (!window.confirm(`确定删除分支 ${name}？未合并的提交会一并丢弃。`)) return;
    setBusy(true);
    try {
      await bridge.deleteBranch({ path: projectPath, name });
      setOutput(`已删除分支 ${name}`);
      await loadBranches();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "删除分支失败");
    } finally {
      setBusy(false);
    }
  };

  const revert = async (hash: string) => {
    if (!bridge) return;
    if (!window.confirm(`对提交 ${hash.slice(0, 7)} 执行 revert？这会生成一个反向提交。`)) return;
    setBusy(true);
    try {
      const result = await bridge.revertCommit({ path: projectPath, hash });
      setOutput(result.output);
      await loadHistory();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "回退提交失败");
    } finally {
      setBusy(false);
    }
  };

  return <div className="git-actions-panel">
    <div className="analysis-heading"><div><span>Git 操作</span><small>提交、分支与历史</small></div><button className="bare-button" onClick={refreshActive} aria-label="刷新 Git 状态"><RefreshCw size={14} className={loading ? "spin" : ""} /></button></div>
    <div className="git-tabs">
      <button className={tab === "changes" ? "active" : ""} onClick={() => setTab("changes")}>变更 {changedFiles.length > 0 ? `(${changedFiles.length})` : ""}</button>
      <button className={tab === "branches" ? "active" : ""} onClick={() => setTab("branches")}>分支</button>
      <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>历史 {history.length > 0 ? `(${history.length})` : ""}</button>
    </div>

    {tab === "changes" && <div className="git-tab-content">
      {(() => {
        const conflictedFiles = changedFiles.filter((file) => file.status === "conflicted");
        if (conflictedFiles.length > 0) {
          return <div className="conflict-wizard">
            <div className="conflict-heading"><CircleAlert size={14} /><strong>存在 {conflictedFiles.length} 个冲突文件</strong></div>
            <p>拉取/合并产生冲突，已停止自动操作。请逐个解决冲突后暂存并提交。</p>
            <div className="conflict-files">{conflictedFiles.map((file) => <code key={file.path}>{file.path}</code>)}</div>
            <ol className="conflict-steps"><li>打开冲突文件，保留需要的改动（`&lt;&lt;&lt;&lt;&lt;&lt;&lt;` 到 `&gt;&gt;&gt;&gt;&gt;&gt;&gt;` 之间的内容）</li><li>删除冲突标记</li><li>回到此面板勾选暂存该文件</li><li>填写提交信息完成合并</li></ol>
          </div>;
        }
        return changedFiles.length === 0 ? <div className="git-empty">{loading ? "正在读取变更..." : "工作区干净，没有待提交的变更。"}</div> : <div className="change-list">{changedFiles.map((file) => <div className="change-row" key={`${file.path}-${file.staged}`}><label className="change-check"><input type="checkbox" checked={file.staged} disabled={busy} onChange={() => toggleStage(file)} /><span className={`change-status ${file.staged ? "staged" : ""}`}>{changeStatusMeta[file.status].label}</span></label><code>{file.path}</code></div>)}</div>;
      })()}
      <textarea className="commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="填写提交信息（subject / body）" rows={3} />
      <button className="button primary wide" onClick={commit} disabled={busy || !commitMessage.trim() || changedFiles.filter((file) => file.staged).length === 0}>{busy ? "提交中..." : "提交暂存的变更"}</button>
    </div>}

    {tab === "branches" && <div className="git-tab-content">
      {branches.length === 0 ? <div className="git-empty">{loading ? "正在读取分支..." : "没有分支"}</div> : <div className="branch-list">{branches.map((branch) => <div className="branch-row" key={branch.name}><div className="branch-main"><span className={`branch-name ${branch.current ? "current" : ""}`}>{branch.current ? "· " : ""}{branch.name}</span>{branch.remote && <small>{branch.remote}{branch.ahead > 0 ? ` · 领先 ${branch.ahead}` : ""}{branch.behind > 0 ? ` · 落后 ${branch.behind}` : ""}</small>}</div><div className="branch-actions">{!branch.current && <button className="bare-button" onClick={() => switchBranch(branch.name)} disabled={busy}>切换</button>}{!branch.current && <button className="bare-button danger" onClick={() => deleteBranch(branch.name)} disabled={busy}>删除</button>}</div></div>)}</div>}
      <div className="new-branch-row"><input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} placeholder="新分支名称" /><button className="button secondary compact-button" onClick={createBranch} disabled={busy || !newBranchName.trim()}>创建</button></div>
    </div>}

    {tab === "history" && <div className="git-tab-content">
      {history.length === 0 ? <div className="git-empty">{loading ? "正在读取提交历史..." : "还没有提交"}</div> : <div className="history-list">{history.map((entry) => <div className="history-row" key={entry.hash}><div className="history-main"><div className="history-title"><strong>{entry.subject}</strong><code>{entry.shortHash}</code></div><small>{entry.author} · {formatCommitDate(entry.date)}</small></div><button className="bare-button" onClick={() => revert(entry.hash)} disabled={busy} title="生成反向提交">回退</button></div>)}</div>}
    </div>}

    {output && <div className="git-output"><pre>{output}</pre><button className="bare-button" onClick={() => setOutput("")} aria-label="关闭输出">关闭</button></div>}
  </div>;
}

function formatCommitDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function AccountsWorkspace({ accounts, accountBusyId, onAdd, onTest, onDelete }: { accounts: Account[]; accountBusyId: string | null; onAdd: (input: { provider: RemoteProvider; displayName: string; username: string; token: string }) => Promise<boolean>; onTest: (accountId: string) => Promise<void>; onDelete: (accountId: string) => Promise<void> }) {
  const [provider, setProvider] = useState<RemoteProvider>("github");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    const saved = await onAdd({ provider, displayName, username, token });
    if (saved) {
      setDisplayName("");
      setUsername("");
      setToken("");
    }
    setIsSaving(false);
  };

  return <div className="module-page accounts-page">
    <div className="module-hero"><div className="module-icon"><KeyRound size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />CREDENTIALS</div><h1>账号与令牌</h1><p>连接远程平台，令牌只保存到 Windows 凭据管理器。</p></div></div>
    <div className="accounts-grid">
      <form className="account-form" onSubmit={submit}>
        <div className="panel-heading"><div><h2>添加远程账号</h2><span>当前支持 Personal Access Token</span></div><ShieldCheck size={16} /></div>
        <div className="form-body">
          <label>托管平台<select value={provider} onChange={(event) => setProvider(event.target.value as RemoteProvider)}><option value="github">GitHub</option><option value="gitee">Gitee</option><option value="gitlab">GitLab</option></select></label>
          <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：个人 GitHub" /></label>
          <label>平台用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="可稍后通过连接测试补全" /></label>
          <label>Personal Access Token<div className="secret-input"><input required type={showToken ? "text" : "password"} value={token} onChange={(event) => setToken(event.target.value)} placeholder="令牌不会显示或写入日志" /><button type="button" onClick={() => setShowToken((current) => !current)} aria-label={showToken ? "隐藏令牌" : "显示令牌"}>{showToken ? "隐藏" : "显示"}</button></div></label>
          <div className="credential-note"><ShieldCheck size={15} /><span>令牌将写入 Windows Credential Manager，SQLite 只保存账号元数据。</span></div>
          <button className="button primary form-submit" disabled={isSaving || !token.trim()}><Plus size={15} />{isSaving ? "保存中..." : "保存账号"}</button>
        </div>
      </form>
      <section className="account-list-panel"><div className="panel-heading"><div><h2>已连接账号</h2><span>{accounts.length} 个本地账号</span></div><span className="secure-label"><ShieldCheck size={13} />安全存储</span></div>{accounts.length ? <div className="account-list">{accounts.map((account) => <AccountRow key={account.id} account={account} busy={accountBusyId === account.id} onTest={() => onTest(account.id)} onDelete={() => onDelete(account.id)} />)}</div> : <div className="accounts-empty"><KeyRound size={21} /><strong>还没有远程账号</strong><span>添加账号后即可测试远程连接。</span></div>}</section>
    </div>
  </div>;
}

function AccountRow({ account, busy, onTest, onDelete }: { account: Account; busy: boolean; onTest: () => void; onDelete: () => void }) {
  const status = account.status === "active" ? "已连接" : account.status === "invalid" ? "令牌无效" : "待验证";
  const statusClass = account.status === "active" ? "status-clean" : account.status === "invalid" ? "status-dirty" : "status-behind";
  return <div className="account-row"><div className={`account-provider-icon ${account.provider}`}><span>{remoteProviderLabels[account.provider].slice(0, 1)}</span></div><div className="account-main"><div className="account-title"><strong>{account.displayName}</strong><span className={`status-pill ${statusClass}`}><span className="status-dot" />{status}</span></div><p>{remoteProviderLabels[account.provider]} · {account.username || "未填写用户名"}</p><small>Token 已受保护 · {account.scopes.length ? account.scopes.join(", ") : "权限待检测"}</small></div><div className="account-actions"><button className="button secondary compact-button" onClick={onTest} disabled={busy}>{busy ? "检测中..." : "连接测试"}</button><button className="icon-button danger" onClick={onDelete} disabled={busy} aria-label="删除账号"><Trash2 size={15} /></button></div></div>;
}

function RemoteRepositoriesWorkspace({ accounts, repositories, selectedAccountId, search, isLoading, cloningRepositoryId, onAccountChange, onSearchChange, onRefresh, onClone, onMutate }: { accounts: Account[]; repositories: RemoteRepository[]; selectedAccountId: string; search: string; isLoading: boolean; cloningRepositoryId: string | null; onAccountChange: (accountId: string) => void; onSearchChange: (search: string) => void; onRefresh: () => void | Promise<void>; onClone: (repository: RemoteRepository) => void | Promise<void>; onMutate: (action: "create" | "update" | "delete", input: { accountId: string; repositoryId?: string; name: string; description: string; visibility: "public" | "private" | "internal" | ""; init: boolean }) => Promise<boolean> }) {
  const filtered = repositories.filter((repository) => `${repository.fullName} ${repository.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const activeAccount = accounts.find((account) => account.id === selectedAccountId);
  const copyCloneUrl = async (repository: RemoteRepository) => {
    await navigator.clipboard.writeText(repository.httpsUrl);
  };

  const createRepository = async () => {
    if (!selectedAccountId) {
      window.alert("请先选择一个远程账号");
      return;
    }
    const name = window.prompt("新仓库名称（英文/数字/下划线）");
    if (!name) return;
    const description = window.prompt("仓库描述（可选）", "") ?? "";
    const visibility = window.confirm("创建为私有仓库？\n“确定”= 私有，“取消”= 公开") ? "private" : "public";
    const init = window.confirm("是否初始化 README？（clone 前建议初始化）");
    await onMutate("create", { accountId: selectedAccountId, name, description, visibility, init });
  };

  const editRepository = async (repository: RemoteRepository) => {
    const name = window.prompt("仓库名称", repository.name);
    if (!name) return;
    const description = window.prompt("仓库描述", repository.description) ?? "";
    const currentVisibility = repository.visibility === "private" ? "private" : "public";
    const visibility = window.confirm("修改为私有仓库？\n“确定”= 私有，“取消”= 公开") ? "private" : "public";
    await onMutate("update", {
      accountId: repository.accountId,
      repositoryId: repository.id,
      name,
      description,
      visibility,
      init: false,
    });
    void currentVisibility;
  };

  const deleteRepository = async (repository: RemoteRepository) => {
    await onMutate("delete", {
      accountId: repository.accountId,
      repositoryId: repository.id,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility === "private" ? "private" : "public",
      init: false,
    });
  };

  return <div className="module-page remote-page">
    <div className="module-hero"><div className="module-icon"><Cloud size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />REMOTE HUB</div><h1>远程仓库</h1><p>从 GitHub、Gitee 和 GitLab 读取当前账号可访问的仓库。</p></div><div className="heading-actions"><button className="button secondary" onClick={onRefresh} disabled={isLoading || !selectedAccountId}><RefreshCw size={15} className={isLoading ? "spin" : ""} />{isLoading ? "同步中..." : "同步仓库"}</button><button className="button primary" onClick={createRepository} disabled={!selectedAccountId}><Plus size={16} />创建仓库</button></div></div>
    <div className="remote-toolbar"><label className="account-select"><span>远程账号</span><select value={selectedAccountId} onChange={(event) => onAccountChange(event.target.value)}><option value="">选择账号</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.displayName} · {remoteProviderLabels[account.provider]}</option>)}</select></label><label className="search-box remote-search"><Search size={16} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索仓库名称或描述" /></label></div>
    <section className="remote-list-panel"><div className="panel-heading"><div><h2>{activeAccount ? `${activeAccount.displayName} 的仓库` : "远程仓库列表"}</h2><span>{filtered.length} 个结果</span></div>{activeAccount && <span className="provider-chip">{remoteProviderLabels[activeAccount.provider]}</span>}</div>{filtered.length ? <div className="remote-list">{filtered.map((repository) => <div className="remote-row" key={`${repository.accountId}-${repository.id}`}><div className={`account-provider-icon ${repository.provider}`}><span>{remoteProviderLabels[repository.provider].slice(0, 1)}</span></div><div className="remote-main"><div className="remote-title"><strong>{repository.fullName}</strong><span>{repository.visibility}</span>{repository.archived && <span>已归档</span>}</div><p>{repository.description || "暂无仓库描述"}</p><div className="remote-meta"><span><GitBranch size={12} />{repository.defaultBranch}</span><code>{repository.httpsUrl}</code></div></div><div className="remote-actions"><button className="button secondary compact-button" onClick={() => copyCloneUrl(repository)}>复制地址</button><button className="button secondary compact-button" onClick={() => editRepository(repository)}><Settings2 size={13} />编辑</button><button className="icon-button danger" onClick={() => deleteRepository(repository)} aria-label="删除仓库" title="删除仓库"><Trash2 size={16} /></button><button className="icon-button" aria-label="克隆仓库" title="克隆仓库" onClick={() => onClone(repository)} disabled={cloningRepositoryId !== null && cloningRepositoryId !== repository.id}>{cloningRepositoryId === repository.id ? <RefreshCw size={16} className="spin" /> : <ArrowDownToLine size={16} />}</button></div></div>)}</div> : <div className="accounts-empty"><Cloud size={22} /><strong>{accounts.length ? "尚未同步远程仓库" : "请先添加远程账号"}</strong><span>{accounts.length ? "选择账号后点击同步仓库。" : "账号令牌将由 Windows 凭据管理器保护。"}</span></div>}</section>
  </div>;
}

function ModuleWorkspace({ workspace, onImport }: { workspace: Exclude<Workspace, "overview" | "projects">; onImport: () => void }) {
  const content: Record<Exclude<Workspace, "overview" | "projects">, { eyebrow: string; title: string; description: string; icon: React.ReactNode; items: string[] }> = {
    remotes: { eyebrow: "REMOTE HUB", title: "远程仓库", description: "连接 GitHub、Gitee 与 GitLab，统一浏览远程项目。", icon: <Cloud size={21} />, items: ["GitHub · 6 个仓库", "Gitee · 4 个仓库", "GitLab · 2 个仓库"] },
    accounts: { eyebrow: "CREDENTIALS", title: "账号与令牌", description: "账号元数据留在本地，令牌由 Windows 凭据管理器保护。", icon: <KeyRound size={21} />, items: ["本地工作区 · 未连接远程账号", "Personal Access Token · 已准备", "OAuth · 等待授权"] },
    tasks: { eyebrow: "TASK RUNNER", title: "任务中心", description: "把构建、运行和打包命令放到同一个可追踪的入口。", icon: <ListTodo size={21} />, items: ["gitool · npm run dev · 运行中", "atlas-api · cargo test · 22 分钟前", "northstar-web · pnpm build · 昨天"] },
    backups: { eyebrow: "RECOVERY", title: "备份中心", description: "完整保留 .git 历史，把项目恢复到一个新的工作目录。", icon: <Archive size={21} />, items: ["本周已备份 · 3 个项目", "最近归档 · gitool_2026-09-19.zip", "备份策略 · 手动触发"] },
    logs: { eyebrow: "SYSTEM", title: "设置与记录", description: "查看应用运行环境、操作日志和本地数据位置。", icon: <Settings2 size={21} />, items: ["Git · 2.46.0", "Windows · x64", "数据目录 · %APPDATA%\\Gitool"] },
    settings: { eyebrow: "SYSTEM", title: "设置", description: "配置 Git 路径、默认目录与应用环境信息。", icon: <Settings2 size={21} />, items: ["Git 路径 · 系统 PATH", "默认项目目录 · 未设置", "默认备份目录 · 未设置"] },
  };
  const current = content[workspace];
  return <div className="module-page"><div className="module-hero"><div className="module-icon">{current.icon}</div><div><div className="eyebrow"><span className="eyebrow-line" />{current.eyebrow}</div><h1>{current.title}</h1><p>{current.description}</p></div><button className="button primary" onClick={onImport}><Plus size={16} />添加内容</button></div><section className="module-list"><div className="panel-heading"><div><h2>当前状态</h2><span>本地工作区快照</span></div><button className="bare-button"><RefreshCw size={16} /></button></div>{current.items.map((item, index) => <div className="module-list-row" key={item}><span className={`module-list-index ${index === 0 ? "active" : ""}`}>{index === 0 ? <Check size={14} /> : index + 1}</span><span>{item}</span><ArrowUpRight size={15} /></div>)}</section></div>;
}

function TasksWorkspace({ projects }: { projects: Project[] }) {
  const bridge = getDesktopBridge();
  const [profiles, setProfiles] = useState<TaskProfile[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TaskProfile | null>(null);
  const [draft, setDraft] = useState({ projectId: "", name: "", command: "", args: "", timeoutSeconds: 120 });
  const [runningId, setRunningId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const load = async () => {
    if (!bridge) return;
    const [loadedProfiles, loadedRuns] = await Promise.all([bridge.listTaskProfiles(), bridge.listTaskRuns()]);
    setProfiles(loadedProfiles);
    setRuns(loadedRuns);
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const taskTypeLabel: Record<TaskProfile["taskType"], string> = { build: "构建", run: "运行", package: "打包" };

  const save = async () => {
    if (!bridge || !draft.projectId || !draft.name || !draft.command) return;
    const now = new Date().toISOString();
    const profile: TaskProfile = {
      id: editing?.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      projectId: draft.projectId,
      projectPath: projects.find((project) => project.id === draft.projectId)?.path ?? "",
      taskType: editing?.taskType ?? "run",
      name: draft.name,
      command: draft.command,
      args: draft.args,
      workingDirectory: projects.find((project) => project.id === draft.projectId)?.path ?? "",
      timeoutSeconds: draft.timeoutSeconds,
      createdAt: editing?.createdAt ?? now,
    };
    try {
      await bridge.saveTaskProfile(profile);
      setNotice("任务已保存");
      setEditing(null);
      setDraft({ projectId: "", name: "", command: "", args: "", timeoutSeconds: 120 });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    }
  };

  const startTask = async (profile: TaskProfile) => {
    if (!bridge) return;
    setRunningId(profile.id);
    try {
      const run = await bridge.runTask(profile.id);
      setRuns((current) => [run, ...current]);
      setNotice(`任务「${profile.name}」已启动`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "启动失败");
    } finally {
      setRunningId(null);
    }
  };

  const deleteProfile = async (profile: TaskProfile) => {
    if (!bridge) return;
    if (!window.confirm(`删除任务「${profile.name}」？`)) return;
    await bridge.deleteTaskProfile(profile.id);
    await load();
  };

  const stopRun = async (runId: string) => {
    if (!bridge) return;
    setStoppingId(runId);
    try {
      await bridge.stopTask(runId);
      setNotice("已请求停止任务");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "停止失败");
    } finally {
      setStoppingId(null);
      await load();
    }
  };

  const runStatusMeta: Record<TaskRun["status"], { label: string; className: string }> = {
    running: { label: "运行中", className: "status-ahead" },
    succeeded: { label: "成功", className: "status-clean" },
    failed: { label: "失败", className: "status-conflicted" },
    stopped: { label: "已停止", className: "status-behind" },
    timedout: { label: "超时", className: "status-conflicted" },
  };

  const edit = (profile: TaskProfile) => {
    setEditing(profile);
    setDraft({ projectId: profile.projectId, name: profile.name, command: profile.command, args: profile.args, timeoutSeconds: profile.timeoutSeconds });
  };

  return <div className="module-page">
    <div className="module-hero"><div className="module-icon"><ListTodo size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />TASK RUNNER</div><h1>任务中心</h1><p>配置构建、运行和打包命令，一键执行并查看实时日志。</p></div></div>
    {notice && <div className="toast"><Check size={16} />{notice}</div>}
    <div className="accounts-grid">
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="panel-heading"><div><h2>{editing ? `编辑任务 · ${editing.name}` : "新建任务"}</h2><span>命令将在项目目录执行</span></div><ListTodo size={16} /></div>
        <div className="form-body">
          <label>关联项目<select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}><option value="">选择项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <label>任务名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：开发服务器" /></label>
          <label>命令<input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="例如：npm" /></label>
          <label>参数<input value={draft.args} onChange={(event) => setDraft({ ...draft, args: event.target.value })} placeholder="例如：run dev" /></label>
          <label>超时（秒）<input type="number" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) || 0 })} /></label>
          <button className="button primary form-submit" disabled={!draft.projectId || !draft.name || !draft.command}>{editing ? "保存修改" : "创建任务"}</button>
        </div>
      </form>
      <section className="account-list-panel">
        <div className="panel-heading"><div><h2>任务配置</h2><span>{profiles.length} 个任务</span></div><span className="secure-label"><ListTodo size={13} />可执行</span></div>
        {profiles.length ? <div className="account-list">{profiles.map((profile) => <div className="account-row" key={profile.id}><div className="account-provider-icon github"><span>{taskTypeLabel[profile.taskType].slice(0, 1)}</span></div><div className="account-main"><div className="account-title"><strong>{profile.name}</strong><span className="status-pill status-clean"><span className="status-dot" />{taskTypeLabel[profile.taskType]}</span></div><p>{profile.command} {profile.args}</p><small>{projects.find((project) => project.id === profile.projectId)?.name ?? profile.projectPath}</small></div><div className="account-actions"><button className="button secondary compact-button" onClick={() => startTask(profile)} disabled={runningId !== null}>{runningId === profile.id ? "启动中..." : "运行"}</button><button className="button secondary compact-button" onClick={() => edit(profile)}>编辑</button><button className="icon-button danger" onClick={() => deleteProfile(profile)} aria-label="删除任务"><Trash2 size={15} /></button></div></div>)}</div> : <div className="accounts-empty"><ListTodo size={21} /><strong>还没有任务配置</strong><span>在左侧表单创建第一个任务。</span></div>}
      </section>
    </div>
<section className="module-list" style={{ marginTop: 16 }}>
        <div className="panel-heading"><div><h2>运行记录</h2><span>最近 {runs.length} 次</span></div><button className="bare-button" onClick={() => void load()}><RefreshCw size={16} /></button></div>
        {runs.length ? <div className="remote-list">{runs.slice(0, 20).map((run) => { const meta = runStatusMeta[run.status] ?? runStatusMeta.failed; return <div className="remote-row" key={run.id}><div className="remote-main"><div className="remote-title"><strong>{run.name}</strong><span className={`status-pill ${meta.className}`}><span className="status-dot" />{meta.label}</span><span>{run.exitCode !== undefined ? `退出码 ${run.exitCode}` : ""}</span></div><p>{run.command} · {run.startedAt}</p><code className="run-output">{run.output.slice(0, 300) || "（无输出）"}</code></div><div className="remote-actions">{run.status === "running" && <button className="button secondary compact-button" onClick={() => stopRun(run.id)} disabled={stoppingId === run.id}>{stoppingId === run.id ? "停止中..." : <><X size={13} />停止</>}</button>}</div></div>; })}</div> : <div className="accounts-empty"><ListTodo size={22} /><strong>还没有运行记录</strong><span>运行任务后这里会显示输出。</span></div>}
      </section>
  </div>;
}

function BackupsWorkspace({ projects }: { projects: Project[] }) {
  const bridge = getDesktopBridge();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    setBackups(await bridge.listBackups());
  };

  useEffect(() => { void load(); }, []);

  const createBackup = async () => {
    if (!bridge || !selectedProjectId) return;
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) return;
    setBusy(true);
    try {
      const targetDirectory = await bridge.selectDirectory();
      if (!targetDirectory) return;
      const record = await bridge.createBackup({ projectId: project.id, projectName: project.name, sourcePath: project.path, targetDirectory });
      setNotice(record.status === "ok" ? `备份完成：${record.archivePath}` : `备份失败：${record.error}`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "备份失败");
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (backup: BackupRecord) => {
    if (!bridge) return;
    if (!window.confirm("恢复会解压到您选择的空目录。确定继续吗？")) return;
    setBusy(true);
    try {
      const targetDirectory = await bridge.selectDirectory();
      if (!targetDirectory) return;
      await bridge.restoreBackup({ archivePath: backup.archivePath, targetDirectory });
      setNotice("恢复完成，可到「我的项目」导入该目录");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  return <div className="module-page">
    <div className="module-hero"><div className="module-icon"><Archive size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />RECOVERY</div><h1>备份中心</h1><p>将项目打包为 ZIP（含 .git），可在新目录完整恢复。</p></div></div>
    {notice && <div className="toast"><Check size={16} />{notice}</div>}
    <div className="remote-toolbar"><label className="account-select"><span>选择要备份的项目</span><select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">选择项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><button className="button primary" onClick={createBackup} disabled={busy || !selectedProjectId}><Archive size={15} />{busy ? "处理中..." : "备份到目录"}</button></div>
    <section className="remote-list-panel"><div className="panel-heading"><div><h2>备份记录</h2><span>{backups.length} 条</span></div><button className="bare-button" onClick={() => void load()}><RefreshCw size={16} /></button></div>{backups.length ? <div className="remote-list">{backups.map((backup) => <div className="remote-row" key={backup.id}><div className="remote-main"><div className="remote-title"><strong>{backup.projectName}</strong><span className={`status-pill ${backup.status === "ok" ? "status-clean" : "status-conflicted"}`}>{backup.status === "ok" ? "成功" : "失败"}</span></div><p>{backup.archivePath}</p><div className="remote-meta"><span><HardDrive size={12} />{backup.sizeBytes > 0 ? formatBytes(backup.sizeBytes) : "—"}</span><span>{backup.createdAt}</span>{backup.error && <code>{backup.error.slice(0, 120)}</code>}</div></div>{backup.status === "ok" && <button className="button secondary compact-button" onClick={() => restoreBackup(backup)} disabled={busy}>恢复</button>}</div>)}</div> : <div className="accounts-empty"><Archive size={22} /><strong>还没有备份</strong><span>选择项目并点击「备份到目录」。</span></div>}</section>
  </div>;
}

function LogsWorkspace() {
  const bridge = getDesktopBridge();
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [notice, setNotice] = useState("");

  const load = async () => {
    if (!bridge) return;
    setRecords(await bridge.listOperationRecords());
  };

  useEffect(() => { void load(); }, []);

  const clear = async () => {
    if (!bridge) return;
    if (!window.confirm("清空全部操作记录？")) return;
    await bridge.clearOperationRecords();
    setNotice("操作记录已清空");
    await load();
  };

  const resultMeta: Record<OperationRecord["result"], { label: string; className: string }> = {
    ok: { label: "成功", className: "status-clean" },
    failed: { label: "失败", className: "status-conflicted" },
  };

  return <div className="module-page">
    <div className="module-hero"><div className="module-icon"><Clock3 size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />SYSTEM</div><h1>操作记录</h1><p>查看应用执行过的 Git 操作、任务与结果。</p></div><button className="button secondary" onClick={clear}><Trash2 size={15} />清空记录</button></div>
    {notice && <div className="toast"><Check size={16} />{notice}</div>}
    <section className="remote-list-panel"><div className="panel-heading"><div><h2>最近操作</h2><span>{records.length} 条</span></div><button className="bare-button" onClick={() => void load()}><RefreshCw size={16} /></button></div>{records.length ? <div className="remote-list">{records.map((record) => { const meta = resultMeta[record.result]; return <div className="remote-row" key={record.id}><div className="remote-main"><div className="remote-title"><strong>{record.operation}</strong><span className={`status-pill ${meta.className}`}>{meta.label}</span></div><p>{record.projectPath}</p><code className="run-output">{record.detail.slice(0, 300) || "（无详情）"}</code><small>{record.createdAt}</small></div></div>; })}</div> : <div className="accounts-empty"><Clock3 size={22} /><strong>还没有操作记录</strong><span>Git 操作会自动记录到这里。</span></div>}</section>
  </div>;
}

function SettingsWorkspace({ environment }: { environment: EnvironmentStatus | null }) {
  const bridge = getDesktopBridge();
  const [settings, setSettings] = useState<{ gitPath: string; defaultProjectDirectory: string; defaultBackupDirectory: string }>({ gitPath: "", defaultProjectDirectory: "", defaultBackupDirectory: "" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    setSettings(await bridge.loadSettings());
  };

  useEffect(() => { void load(); }, []);

  const pickDirectory = async (key: "defaultProjectDirectory" | "defaultBackupDirectory") => {
    if (!bridge) return;
    const directory = await bridge.selectDirectory(settings[key] || undefined);
    if (directory) setSettings((current) => ({ ...current, [key]: directory }));
  };

  const save = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.saveSettings(settings);
      setNotice("设置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const settingsRows = [
    { key: "gitPath" as const, label: "Git 可执行文件路径", value: settings.gitPath, placeholder: "留空则使用系统 PATH 中的 git", hint: "例如 C:\\Program Files\\Git\\cmd\\git.exe" },
    { key: "defaultProjectDirectory" as const, label: "默认项目目录", value: settings.defaultProjectDirectory, placeholder: "新建/导入项目时的默认位置", hint: "留空则不指定" },
    { key: "defaultBackupDirectory" as const, label: "默认备份目录", value: settings.defaultBackupDirectory, placeholder: "备份 ZIP 的默认存放位置", hint: "留空则每次备份时选择" },
  ];

  return <div className="module-page">
    <div className="module-hero"><div className="module-icon"><Settings2 size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />SYSTEM</div><h1>设置</h1><p>配置 Git 路径、默认目录与应用环境信息。</p></div><button className="button primary" onClick={save} disabled={busy}><Check size={15} />{busy ? "保存中..." : "保存设置"}</button></div>
    {notice && <div className="toast"><Check size={16} />{notice}</div>}
    <div className="accounts-grid">
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="panel-heading"><div><h2>应用设置</h2><span>保存到本地数据库</span></div><Settings2 size={16} /></div>
        <div className="form-body">
          {settingsRows.map((row) => <label key={row.key}>{row.label}<div className="setting-row"><input value={row.value} onChange={(event) => setSettings((current) => ({ ...current, [row.key]: event.target.value }))} placeholder={row.placeholder} />{row.key !== "gitPath" && <button type="button" className="button secondary compact-button" onClick={() => pickDirectory(row.key)}>选择</button>}</div><small className="setting-hint">{row.hint}</small></label>)}
          <button className="button primary form-submit" disabled={busy}>保存设置</button>
        </div>
      </form>
      <section className="account-list-panel">
        <div className="panel-heading"><div><h2>环境信息</h2><span>本地运行环境</span></div><span className="secure-label"><ShieldCheck size={13} />安全</span></div>
        <div className="form-body">
          <label>Git 可用性<span className="status-pill status-clean setting-value"><span className="status-dot" />{environment?.git_available ? "可用" : "不可用"}</span></label>
          <label>Git 版本<div className="setting-value mono">{environment?.git_version ?? "检测中"}</div></label>
          <label>操作系统<div className="setting-value mono">{environment?.platform === "web" ? "浏览器预览" : "Windows x64"}</div></label>
          <label>数据目录<div className="setting-value mono">%APPDATA%\Gitool</div></label>
        </div>
      </section>
    </div>
  </div>;
}

export default App;
