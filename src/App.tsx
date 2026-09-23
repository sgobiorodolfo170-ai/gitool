import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import type { Account, EnvironmentStatus, GitOperation, GitSnapshot, Project, ProjectAnalysis, ProjectFilter, ProjectStatus, RemoteProvider, RemoteRepository, Workspace } from "./types";
import { getDesktopBridge, isDesktopRuntime, requireDesktopBridge } from "./lib/bridge";
import { loadProjects, saveProjects } from "./lib/projects";

type NavItem = {
  id: Workspace;
  label: string;
  icon: typeof LayoutDashboard;
  count?: string;
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "工作区",
    items: [
      { id: "overview", label: "总览", icon: LayoutDashboard },
      { id: "projects", label: "我的项目", icon: FolderGit2, count: "12" },
      { id: "remotes", label: "远程仓库", icon: Cloud, count: "3" },
    ],
  },
  {
    label: "工具",
    items: [
      { id: "accounts", label: "账号与令牌", icon: KeyRound },
      { id: "tasks", label: "任务中心", icon: ListTodo, count: "2" },
      { id: "backups", label: "备份中心", icon: Archive },
      { id: "logs", label: "操作记录", icon: Clock3 },
    ],
  },
];

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

const LAST_IMPORT_DIRECTORY_KEY = "gitool.lastImportDirectory";

function App() {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  const [projects, setProjects] = useState<Project[]>(() => isDesktopRuntime() ? [] : loadProjects());
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
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
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "favorite" && project.favorite) ||
        (filter === "attention" && project.status !== "clean");
      const matchesSearch = !query || `${project.name} ${project.path} ${project.summary}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, projects, search]);

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
          return projectFromSnapshot(project, snapshot);
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
          {navGroups.map((group) => (
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
          <button className="nav-item settings-item" onClick={() => setWorkspace("logs")}>
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
              isImporting={isImporting}
              onFilterChange={setFilter}
              onSearchChange={setSearch}
              onSelect={(id) => { setSelectedId(id); setOperationOutput(null); setAnalysis(null); }}
              onToggleFavorite={toggleFavorite}
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
            <RemoteRepositoriesWorkspace accounts={accounts} repositories={remoteRepositories} selectedAccountId={selectedAccountId} search={remoteSearch} isLoading={isLoadingRemotes} onAccountChange={setSelectedAccountId} onSearchChange={setRemoteSearch} onRefresh={() => loadRemoteRepositories()} />
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
  };
  return labels[workspace];
}

type ProjectsWorkspaceProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject?: Project;
  filter: ProjectFilter;
  search: string;
  isImporting: boolean;
  workspace: Workspace;
  onFilterChange: (filter: ProjectFilter) => void;
  onSearchChange: (search: string) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
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
  isImporting,
  workspace,
  onFilterChange,
  onSearchChange,
  onSelect,
  onToggleFavorite,
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

      <div className="section-toolbar">
        <div className="filter-tabs">
          <FilterButton active={filter === "all"} onClick={() => onFilterChange("all")}>全部 <span>{projects.length}</span></FilterButton>
          <FilterButton active={filter === "favorite"} onClick={() => onFilterChange("favorite")}>已收藏 <span>{favoriteCount}</span></FilterButton>
          <FilterButton active={filter === "attention"} onClick={() => onFilterChange("attention")}>需要关注 <span>{attentionCount}</span></FilterButton>
        </div>
        <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索项目、路径或摘要" /><kbd>/</kbd></label>
      </div>

      <section className="project-layout">
        <div className="project-list-panel">
          <div className="panel-heading"><div><h2>最近项目</h2><span>{filteredProjects.length} 个结果</span></div><button className="bare-button" aria-label="更多项目"><MoreHorizontal size={18} /></button></div>
          <div className="project-list">
            {filteredProjects.length ? filteredProjects.map((project) => (
              <ProjectRow key={project.id} project={project} selected={project.id === selectedProject?.id} onSelect={() => onSelect(project.id)} onToggleFavorite={() => onToggleFavorite(project.id)} />
            )) : <EmptyProjects onImport={onImport} />}
          </div>
        </div>
        {selectedProject ? <ProjectDetail project={selectedProject} onToggleFavorite={() => onToggleFavorite(selectedProject.id)} onRunGitOperation={onRunGitOperation} activeOperation={activeOperation} operationOutput={operationOutput} onAnalyzeProject={onAnalyzeProject} isAnalyzing={isAnalyzing} analysis={analysis} /> : <div className="detail-panel empty-detail">选择一个项目查看详情</div>}
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><ArrowUpRight size={15} className="metric-arrow" /></div>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`filter-button ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function ProjectRow({ project, selected, onSelect, onToggleFavorite }: { project: Project; selected: boolean; onSelect: () => void; onToggleFavorite: () => void }) {
  const ProviderIcon = providerIcons[project.provider];
  const status = statusMeta[project.status];
  return <div className={`project-row ${selected ? "selected" : ""}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}>
    <div className="project-type-icon" style={{ color: project.languageColor }}><ProviderIcon size={18} /></div>
    <div className="project-row-main"><div className="project-name-line"><strong>{project.name}</strong><span className="provider-name">{providerLabels[project.provider]}</span></div><p>{project.path}</p><div className="project-row-meta"><span className={`status-pill ${status.className}`}><span className="status-dot" />{project.syncLabel}</span><span><GitBranch size={12} />{project.branch}</span></div></div>
    <button className={`favorite-button ${project.favorite ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }} aria-label={project.favorite ? "取消收藏" : "收藏项目"}><Star size={16} fill={project.favorite ? "currentColor" : "none"} /></button>
  </div>;
}

function EmptyProjects({ onImport }: { onImport: () => void }) {
  return <div className="empty-projects"><div className="empty-icon"><FolderGit2 size={21} /></div><strong>没有匹配的项目</strong><span>换一个搜索词，或导入一个本地仓库。</span><button className="button secondary compact" onClick={onImport}><Plus size={15} />导入项目</button></div>;
}

function ProjectDetail({ project, onToggleFavorite, onRunGitOperation, activeOperation, operationOutput, onAnalyzeProject, isAnalyzing, analysis }: { project: Project; onToggleFavorite: () => void; onRunGitOperation: (operation: GitOperation) => void | Promise<void>; activeOperation: GitOperation | null; operationOutput: string | null; onAnalyzeProject: () => void | Promise<void>; isAnalyzing: boolean; analysis: ProjectAnalysis | null }) {
  const status = statusMeta[project.status];
  const ProviderIcon = providerIcons[project.provider];
  return <aside className="detail-panel">
    <div className="detail-top"><div className="detail-provider"><ProviderIcon size={16} />{providerLabels[project.provider]}</div><button className={`favorite-button ${project.favorite ? "active" : ""}`} onClick={onToggleFavorite} aria-label={project.favorite ? "取消收藏" : "收藏项目"}><Star size={17} fill={project.favorite ? "currentColor" : "none"} /></button></div>
    <div className="detail-title"><div className="large-project-icon" style={{ color: project.languageColor }}><Code2 size={25} /></div><div><h2>{project.name}</h2><p>{project.path}</p></div></div>
    <div className="detail-status-row"><span className={`status-pill ${status.className}`}><span className="status-dot" />{status.label}</span><span className="detail-updated"><Clock3 size={13} />{project.updatedAt}</span></div>
    <p className="detail-summary">{project.summary}</p>
    <div className="detail-tags">{project.tags.map((tag) => <span className="tag" key={tag}><Tag size={11} />{tag}</span>)}<button className="add-tag" aria-label="添加标签"><Plus size={13} /></button></div>
    <div className="detail-actions"><button className="button primary wide" onClick={() => onRunGitOperation("pull")} disabled={activeOperation !== null}><ArrowDownToLine size={15} />{activeOperation === "pull" ? "拉取中..." : "拉取更新"}</button><button className="button secondary square" onClick={() => onRunGitOperation("sync")} disabled={activeOperation !== null} aria-label="同步项目"><RefreshCw size={17} className={activeOperation === "sync" ? "spin" : ""} /></button></div>
    <div className="git-operation-grid">
      <GitOperationButton operation="fetch" activeOperation={activeOperation} onRun={onRunGitOperation} icon={<Cloud size={14} />} />
      <GitOperationButton operation="push" activeOperation={activeOperation} onRun={onRunGitOperation} icon={<ArrowUpRight size={14} />} />
      <GitOperationButton operation="sync" activeOperation={activeOperation} onRun={onRunGitOperation} icon={<RefreshCw size={14} />} />
    </div>
    {operationOutput && <div className="operation-output"><div><span>最近一次 Git 输出</span><button className="bare-button" onClick={() => onRunGitOperation("fetch")} aria-label="重新获取远程更新"><RefreshCw size={13} /></button></div><pre>{operationOutput}</pre></div>}
    <div className="detail-section"><div className="detail-section-heading"><span>项目概览</span><button className="bare-button"><ExternalLink size={14} /></button></div><div className="detail-stats"><DetailStat icon={<GitBranch size={14} />} label="当前分支" value={project.branch} /><DetailStat icon={<GitCommitHorizontal size={14} />} label="最近提交" value={project.commit} /><DetailStat icon={<FileCode2 size={14} />} label="文件数量" value={`${project.files}`} /></div></div>
    <div className="detail-section"><div className="detail-section-heading"><span>快捷入口</span></div><div className="quick-links"><button><TerminalSquare size={15} />打开终端<ArrowUpRight size={13} /></button><button onClick={onAnalyzeProject} disabled={isAnalyzing}><Blocks size={15} />{isAnalyzing ? "分析中..." : "结构分析"}<ArrowUpRight size={13} /></button><button><Sparkles size={15} />生成 AI 摘要<ArrowUpRight size={13} /></button></div></div>
    {analysis && <ProjectAnalysisPanel analysis={analysis} />}
  </aside>;
}

function ProjectAnalysisPanel({ analysis }: { analysis: ProjectAnalysis }) {
  const languageTotal = analysis.languages.reduce((total, language) => total + language.bytes, 0);
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

function GitOperationButton({ operation, activeOperation, onRun, icon }: { operation: GitOperation; activeOperation: GitOperation | null; onRun: (operation: GitOperation) => void | Promise<void>; icon: React.ReactNode }) {
  return <button className="git-operation-button" onClick={() => onRun(operation)} disabled={activeOperation !== null} title={operationLabels[operation]}>{icon}<span>{activeOperation === operation ? "执行中" : operationLabels[operation]}</span></button>;
}

function DetailStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="detail-stat"><span>{icon}{label}</span><strong>{value}</strong></div>; }

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

function RemoteRepositoriesWorkspace({ accounts, repositories, selectedAccountId, search, isLoading, onAccountChange, onSearchChange, onRefresh }: { accounts: Account[]; repositories: RemoteRepository[]; selectedAccountId: string; search: string; isLoading: boolean; onAccountChange: (accountId: string) => void; onSearchChange: (search: string) => void; onRefresh: () => void | Promise<void> }) {
  const filtered = repositories.filter((repository) => `${repository.fullName} ${repository.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const activeAccount = accounts.find((account) => account.id === selectedAccountId);
  const copyCloneUrl = async (repository: RemoteRepository) => {
    await navigator.clipboard.writeText(repository.httpsUrl);
  };

  return <div className="module-page remote-page">
    <div className="module-hero"><div className="module-icon"><Cloud size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />REMOTE HUB</div><h1>远程仓库</h1><p>从 GitHub、Gitee 和 GitLab 读取当前账号可访问的仓库。</p></div><button className="button primary" onClick={onRefresh} disabled={isLoading || !selectedAccountId}><RefreshCw size={15} className={isLoading ? "spin" : ""} />{isLoading ? "同步中..." : "同步仓库"}</button></div>
    <div className="remote-toolbar"><label className="account-select"><span>远程账号</span><select value={selectedAccountId} onChange={(event) => onAccountChange(event.target.value)}><option value="">选择账号</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.displayName} · {remoteProviderLabels[account.provider]}</option>)}</select></label><label className="search-box remote-search"><Search size={16} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索仓库名称或描述" /></label></div>
    <section className="remote-list-panel"><div className="panel-heading"><div><h2>{activeAccount ? `${activeAccount.displayName} 的仓库` : "远程仓库列表"}</h2><span>{filtered.length} 个结果</span></div>{activeAccount && <span className="provider-chip">{remoteProviderLabels[activeAccount.provider]}</span>}</div>{filtered.length ? <div className="remote-list">{filtered.map((repository) => <div className="remote-row" key={`${repository.accountId}-${repository.id}`}><div className={`account-provider-icon ${repository.provider}`}><span>{remoteProviderLabels[repository.provider].slice(0, 1)}</span></div><div className="remote-main"><div className="remote-title"><strong>{repository.fullName}</strong><span>{repository.visibility}</span>{repository.archived && <span>已归档</span>}</div><p>{repository.description || "暂无仓库描述"}</p><div className="remote-meta"><span><GitBranch size={12} />{repository.defaultBranch}</span><code>{repository.httpsUrl}</code></div></div><div className="remote-actions"><button className="button secondary compact-button" onClick={() => copyCloneUrl(repository)}>复制地址</button><button className="icon-button" aria-label="克隆仓库" title="克隆仓库"><ArrowDownToLine size={16} /></button></div></div>)}</div> : <div className="accounts-empty"><Cloud size={22} /><strong>{accounts.length ? "尚未同步远程仓库" : "请先添加远程账号"}</strong><span>{accounts.length ? "选择账号后点击同步仓库。" : "账号令牌将由 Windows 凭据管理器保护。"}</span></div>}</section>
  </div>;
}

function ModuleWorkspace({ workspace, onImport }: { workspace: Exclude<Workspace, "overview" | "projects">; onImport: () => void }) {
  const content: Record<Exclude<Workspace, "overview" | "projects">, { eyebrow: string; title: string; description: string; icon: React.ReactNode; items: string[] }> = {
    remotes: { eyebrow: "REMOTE HUB", title: "远程仓库", description: "连接 GitHub、Gitee 与 GitLab，统一浏览远程项目。", icon: <Cloud size={21} />, items: ["GitHub · 6 个仓库", "Gitee · 4 个仓库", "GitLab · 2 个仓库"] },
    accounts: { eyebrow: "CREDENTIALS", title: "账号与令牌", description: "账号元数据留在本地，令牌由 Windows 凭据管理器保护。", icon: <KeyRound size={21} />, items: ["本地工作区 · 未连接远程账号", "Personal Access Token · 已准备", "OAuth · 等待授权"] },
    tasks: { eyebrow: "TASK RUNNER", title: "任务中心", description: "把构建、运行和打包命令放到同一个可追踪的入口。", icon: <ListTodo size={21} />, items: ["gitool · npm run dev · 运行中", "atlas-api · cargo test · 22 分钟前", "northstar-web · pnpm build · 昨天"] },
    backups: { eyebrow: "RECOVERY", title: "备份中心", description: "完整保留 .git 历史，把项目恢复到一个新的工作目录。", icon: <Archive size={21} />, items: ["本周已备份 · 3 个项目", "最近归档 · gitool_2026-09-19.zip", "备份策略 · 手动触发"] },
    logs: { eyebrow: "SYSTEM", title: "设置与记录", description: "查看应用运行环境、操作日志和本地数据位置。", icon: <Settings2 size={21} />, items: ["Git · 2.46.0", "Windows · x64", "数据目录 · %APPDATA%\\Gitool"] },
  };
  const current = content[workspace];
  return <div className="module-page"><div className="module-hero"><div className="module-icon">{current.icon}</div><div><div className="eyebrow"><span className="eyebrow-line" />{current.eyebrow}</div><h1>{current.title}</h1><p>{current.description}</p></div><button className="button primary" onClick={onImport}><Plus size={16} />添加内容</button></div><section className="module-list"><div className="panel-heading"><div><h2>当前状态</h2><span>本地工作区快照</span></div><button className="bare-button"><RefreshCw size={16} /></button></div>{current.items.map((item, index) => <div className="module-list-row" key={item}><span className={`module-list-index ${index === 0 ? "active" : ""}`}>{index === 0 ? <Check size={14} /> : index + 1}</span><span>{item}</span><ArrowUpRight size={15} /></div>)}</section></div>;
}

export default App;
