import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { operationLabels } from "./lib/meta";
import { AlertTriangle, ArrowDownToLine, Bell, Check, Command, GitBranch, Loader2 } from "lucide-react";
import type { Account, AppSettings, AppView, GitOperation, GitSnapshot, Project, ProjectAnalysis, ProjectFilter, RemoteProvider, RemoteRepository, RepositoryDiscoveryItem, WorkspaceEntity } from "./types";
import { getDesktopBridge, isDesktopRuntime, requireDesktopBridge } from "./lib/bridge";

import { buildNavGroups, workspaceLabel } from "./lib/navigation";
import { projectFromSnapshot, remoteProjectMatch } from "./lib/projectMatch";
import { ACTIVE_WORKSPACE_KEY, LAST_IMPORT_DIRECTORY_KEY, SETUP_DISMISS_KEY } from "./lib/storageKeys";


import { OverviewWorkspace } from "./components/OverviewWorkspace";

import { ProjectsWorkspace } from "./components/ProjectsWorkspace";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { RemoteRepositoriesWorkspace } from "./components/RemoteRepositoriesWorkspace";
import { TasksWorkspace } from "./components/TasksWorkspace";
import { BackupsWorkspace } from "./components/BackupsWorkspace";
import { LogsWorkspace } from "./components/LogsWorkspace";
import { SettingsWorkspace } from "./components/SettingsWorkspace";
import { ModuleWorkspace } from "./components/ModuleWorkspace";
import { useEnvironment } from "./hooks/useEnvironment";
import { useNotice } from "./hooks/useNotice";
import { useUpdater } from "./hooks/useUpdater";

import { loadProjects, saveProjects } from "./lib/projects";
import { DEFAULT_WORKSPACE_ID, createWorkspace as createWorkspaceLocal, deleteWorkspace as deleteWorkspaceLocal, listWorkspaces as listWorkspacesLocal, renameWorkspace as renameWorkspaceLocal } from "./lib/workspaces";

function App() {
  const [workspace, setWorkspace] = useState<AppView>("overview");
  const [projects, setProjects] = useState<Project[]>([]);
  // 项目列表的同步副本：updateProjects 需要在不等待 React 重渲染的情况下读到最新值，
  // 否则连续两次更新会基于同一个旧快照计算。
  const projectsRef = useRef<Project[]>([]);
  // 串行保存队列：见 persistProjects 的注释。
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [workspaces, setWorkspaces] = useState<WorkspaceEntity[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountBusyId, setAccountBusyId] = useState<string | null>(null);
  const [remoteRepositories, setRemoteRepositories] = useState<RemoteRepository[]>([]);
  const [remoteSyncTime, setRemoteSyncTime] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [remoteSearch, setRemoteSearch] = useState("");
  const [isLoadingRemotes, setIsLoadingRemotes] = useState(false);
  const [cloningRepositoryId, setCloningRepositoryId] = useState<string | null>(null);
  const [cloneProgress, setCloneProgress] = useState<{ percent: number; phase: string; output: string } | null>(null);
  

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
    return appSettings?.defaultProjectDirectory?.trim()
      || window.localStorage.getItem(LAST_IMPORT_DIRECTORY_KEY)
      || undefined;
  };

  /**
   * 项目列表的唯一写入口：同时维护 ref 与 state，避免两者漂移。
   */
  const applyProjects = useCallback((next: Project[]) => {
    projectsRef.current = next;
    setProjects(next);
  }, []);

  /**
   * 落库项目列表。
   *
   * 两个关键点：
   * 1. 副作用不能写在 setState 的 updater 里——React 严格模式下 updater 可能被调用两次，
   *    等于重复落库。
   * 2. 必须串行：连续快速操作（如连点收藏）会并发触发保存，后发起的请求可能先返回，
   *    旧快照会覆盖新快照。这里用 Promise 链保证落库顺序与内存顺序一致。
   */
  const persistProjects = useCallback((workspaceId: string, next: Project[]) => {
    if (!isDesktopRuntime()) {
      saveProjects(workspaceId, next);
      return;
    }
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => requireDesktopBridge().saveProjects(workspaceId, next))
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "项目数据保存失败");
        window.setTimeout(() => setNotice(null), 4000);
      });
  }, []);

  const updateProjects = (updater: (prev: Project[]) => Project[]) => {
    const next = updater(projectsRef.current);
    applyProjects(next);
    persistProjects(activeWorkspaceId, next);
  };

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const unsubscribe = requireDesktopBridge().onCloneProgress((event) => {
      setCloneProgress({ percent: event.percent, phase: event.phase, output: event.output });
      if (event.done) {
        window.setTimeout(() => setCloneProgress(null), 2000);
      }
    });
    return unsubscribe;
  }, []);

    useEffect(() => {
    let cancelled = false;

    if (isDesktopRuntime()) {
      const bridge = requireDesktopBridge();
      void Promise.all([
        bridge.listWorkspaces(),
        bridge.environment(),
        bridge.loadAccounts(),
        bridge.loadSettings(),
      ]).then(async ([loadedWorkspaces, environmentStatus, storedAccounts, storedSettings]) => {
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
        if (!environmentStatus.git_available && window.localStorage.getItem(SETUP_DISMISS_KEY) !== "1") {
          setShowSetupModal(true);
        }
      }).catch(() => {
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

  const selectedProject = projects.find((project) => project.id === selectedId) ?? projects[0];
  const allTags = useMemo(() => [...new Set(projects.flatMap((project) => project.tags))].sort(), [projects]);
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "favorite" && project.favorite) ||
        (filter === "attention" && (project.status !== "clean" || project.tags.includes("watching")));
      const matchesTag = !tagFilter || project.tags.includes(tagFilter);
      const matchesSearch = !query || `${project.name} ${project.path} ${project.summary} ${project.tags.join(" ")}`.toLowerCase().includes(query);
      return matchesFilter && matchesTag && matchesSearch;
    });
  }, [filter, projects, search, tagFilter]);

  const switchWorkspace = async (id: string) => {
    if (id === activeWorkspaceId) return;
    setActiveWorkspaceId(id);
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
    try {
      const stored = isDesktopRuntime()
        ? await requireDesktopBridge().loadProjects(id)
        : loadProjects(id);
      applyProjects(stored);
    } catch {
      applyProjects([]);
    }
    setSelectedId("");
    setFilter("all");
    setSearch("");
    setTagFilter("");
    setOperationOutput(null);
    setAnalysis(null);
    setWorkspace("overview");
  };

  const createWorkspace = async (name: string) => {
    try {
      const created = isDesktopRuntime()
        ? await requireDesktopBridge().createWorkspace({ name })
        : createWorkspaceLocal({ name });
      setWorkspaces((current) => [...current, created]);
      setNotice(`工作区「${created.name}」已创建`);
      window.setTimeout(() => setNotice(null), 3000);
      return created;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建工作区失败");
      window.setTimeout(() => setNotice(null), 3000);
      return null;
    }
  };

  const renameWorkspace = async (id: string, name: string) => {
    try {
      if (isDesktopRuntime()) {
        await requireDesktopBridge().renameWorkspace({ id, name });
      } else {
        renameWorkspaceLocal({ id, name });
      }
      setWorkspaces((current) => current.map((item) => item.id === id ? { ...item, name, updatedAt: new Date().toISOString() } : item));
      setNotice("工作区已重命名");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重命名失败");
    } finally {
      window.setTimeout(() => setNotice(null), 3000);
    }
  };

  const deleteWorkspace = async (id: string) => {
    try {
      if (isDesktopRuntime()) {
        await requireDesktopBridge().deleteWorkspace(id);
      } else {
        deleteWorkspaceLocal(id);
      }
      setWorkspaces((current) => current.filter((item) => item.id !== id));
      if (activeWorkspaceId === id) {
        const remaining = workspaces.find((item) => item.id !== id);
        if (remaining) {
          void switchWorkspace(remaining.id);
        }
      }
      setNotice("工作区已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      window.setTimeout(() => setNotice(null), 3000);
    }
  };

  const openProjectDetail = (id: string) => {
    setSelectedId(id);
    setOperationOutput(null);
    setAnalysis(null);
    setWorkspace("projects");
  };

  const toggleFavorite = (projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    if (target && target.path === "" && target.favorite) {
      updateProjects((prev) => prev.filter((project) => project.id !== projectId));
      return;
    }
    updateProjects((prev) => prev.map((project) => (project.id === projectId ? { ...project, favorite: !project.favorite } : project)));
  };

  const toggleRemoteFavorite = async (repository: RemoteRepository) => {
    const isFav = projects.some((project) => remoteProjectMatch(project, repository) && project.favorite);
    const match = projects.find((project) => remoteProjectMatch(project, repository));
    let rollback: (() => void) | null = null;
    if (match) {
      if (match.path === "" && !match.tags.includes("watching")) {
        updateProjects((prev) => prev.filter((project) => project.id !== match.id));
        rollback = () => updateProjects((prev) => [match, ...prev]);
      } else {
        updateProjects((prev) => prev.map((project) => project.id === match.id ? { ...project, favorite: !project.favorite } : project));
        rollback = () => updateProjects((prev) => prev.map((project) => project.id === match.id ? { ...project, favorite: match.favorite } : project));
      }
    } else {
      const now = new Date().toISOString();
      const favoriteProject: Project = {
        id: `fav:${repository.provider}:${repository.fullName.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`,
        name: repository.name,
        path: "",
        provider: repository.provider,
        branch: repository.defaultBranch || "main",
        status: "clean",
        commit: "未克隆",
        favorite: true,
        tags: ["remote", "favorite"],
        files: 0,
        syncLabel: "未克隆",
        language: "未克隆",
        languageColor: "#8b97a8",
        summary: repository.description || "远程收藏项目，尚未克隆到本地。",
        updatedAt: now,
        diskSizeBytes: 0,
        webUrl: repository.webUrl,
      };
      updateProjects((prev) => [favoriteProject, ...prev]);
      rollback = () => updateProjects((prev) => prev.filter((project) => project.id !== favoriteProject.id));
    }
    if (isDesktopRuntime()) {
      try {
        await requireDesktopBridge().toggleRepositoryInteraction({
          accountId: repository.accountId,
          owner: repository.owner,
          name: repository.name,
          action: isFav ? "unstar" : "star",
        });
      } catch (error) {
        rollback?.();
        setNotice(error instanceof Error ? error.message : "平台收藏操作失败");
        window.setTimeout(() => setNotice(null), 3000);
      }
    }
  };

  const toggleRemoteWatch = async (repository: RemoteRepository) => {
    const isWatched = projects.some((project) => remoteProjectMatch(project, repository) && project.tags.includes("watching"));
    const match = projects.find((project) => remoteProjectMatch(project, repository));
    let rollback: (() => void) | null = null;
    if (match) {
      const nextTags = isWatched
        ? match.tags.filter((tag) => tag !== "watching")
        : [...match.tags, "watching"];
      if (match.path === "" && !match.favorite && isWatched) {
        updateProjects((prev) => prev.filter((project) => project.id !== match.id));
        rollback = () => updateProjects((prev) => [match, ...prev]);
      } else {
        updateProjects((prev) => prev.map((project) => project.id === match.id ? { ...project, tags: nextTags } : project));
        rollback = () => updateProjects((prev) => prev.map((project) => project.id === match.id ? { ...project, tags: match.tags } : project));
      }
    } else {
      const now = new Date().toISOString();
      const watchedProject: Project = {
        id: `watch:${repository.provider}:${repository.fullName.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`,
        name: repository.name,
        path: "",
        provider: repository.provider,
        branch: repository.defaultBranch || "main",
        status: "clean",
        commit: "未克隆",
        favorite: false,
        tags: ["remote", "watching"],
        files: 0,
        syncLabel: "已关注",
        language: "未克隆",
        languageColor: "#8b97a8",
        summary: repository.description || "远程关注项目，尚未克隆到本地。",
        updatedAt: now,
        diskSizeBytes: 0,
        webUrl: repository.webUrl,
      };
      updateProjects((prev) => [watchedProject, ...prev]);
      rollback = () => updateProjects((prev) => prev.filter((project) => project.id !== watchedProject.id));
    }
    if (isDesktopRuntime()) {
      try {
        await requireDesktopBridge().toggleRepositoryInteraction({
          accountId: repository.accountId,
          owner: repository.owner,
          name: repository.name,
          action: isWatched ? "unwatch" : "watch",
        });
      } catch (error) {
        rollback?.();
        setNotice(error instanceof Error ? error.message : "平台关注操作失败");
        window.setTimeout(() => setNotice(null), 3000);
      }
    }
  };

  const deleteProjectFromList = (projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    if (!target) return;
    const message = target.path === ""
      ? `确定移除「${target.alias || target.name}」？这是未克隆的远程收藏条目。`
      : `确定从我的项目中移除「${target.alias || target.name}」？\n项目目录不会被删除，后续可重新导入。`;
    if (!window.confirm(message)) return;
    const wasSelected = selectedId === projectId;
    updateProjects((prev) => {
      const remaining = prev.filter((project) => project.id !== projectId);
      if (wasSelected) setSelectedId(remaining[0]?.id ?? "");
      return remaining;
    });
    setOperationOutput(null);
    setAnalysis(null);
    setNotice("已从我的项目移除");
    window.setTimeout(() => setNotice(null), 3000);
  };

  const addAccount = async (input: { provider: RemoteProvider; token: string }) => {
    if (!isDesktopRuntime()) {
      setNotice("账号凭据管理需要使用 Windows 桌面版");
      window.setTimeout(() => setNotice(null), 3000);
      return false;
    }

    try {
      const account = await requireDesktopBridge().createAccount({
        provider: input.provider,
        token: input.token,
      });
      setAccounts((current) => {
        const without = current.filter((item) => !(item.provider === account.provider && item.username === account.username));
        return [account, ...without];
      });
      setSelectedAccountId((current) => current || account.id);
      setNotice(`账号「${account.username}」已保存`);
      window.setTimeout(() => setNotice(null), 3000);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "账号保存失败");
      window.setTimeout(() => setNotice(null), 3000);
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
      setSelectedAccountId((current) => {
        if (current !== accountId) return current;
        const remaining = accounts.filter((account) => account.id !== accountId);
        return remaining[0]?.id ?? "";
      });
      setNotice("账号和对应凭据已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "账号删除失败");
    } finally {
      setAccountBusyId(null);
      window.setTimeout(() => setNotice(null), 3200);
    }
  };

  const loadRemoteRepositories = async (accountId = selectedAccountId, options?: { silent?: boolean }) => {
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
    const bridge = requireDesktopBridge();

    setIsLoadingRemotes(true);
    try {
      // 先展示本地缓存（上次已同步的数据），避免每次启动都等待网络
      const cached = await bridge.loadCachedRemoteRepositories(accountId);
      if (cached.length > 0) {
        setRemoteRepositories(cached);
        const meta = await bridge.getRemoteRepositoryCacheMeta(accountId).catch(() => null);
        if (meta) {
          setRemoteSyncTime(meta.syncedAt);
        }
      }
      const repositories = await bridge.loadRemoteRepositories(accountId);
      setRemoteRepositories(repositories);
      const meta = await bridge.getRemoteRepositoryCacheMeta(accountId).catch(() => null);
      if (meta) {
        setRemoteSyncTime(meta.syncedAt);
      }
      if (!options?.silent) {
        setNotice(`已同步 ${repositories.length} 个远程仓库（已缓存）`);
      }
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
          webUrl: repository.webUrl,
        };
        const favoriteStub = projects.find((project) => project.path === "" && project.webUrl === repository.webUrl && project.favorite);
        if (favoriteStub) {
          newProject.favorite = true;
          updateProjects((prev) => [newProject, ...prev.filter((project) => project.id !== favoriteStub.id)]);
        } else {
          updateProjects((prev) => [newProject, ...prev]);
        }
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
        updateProjects((prev) => prev.map((project) => (
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
    updateProjects((prev) => prev.map((project) => updated.find((item) => item.id === project.id) ?? project));
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
    const lastDirectory = defaultDirectoryHint();
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
      updateProjects((prev) => [newProject, ...prev]);
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
      const refreshed = await mapWithConcurrency(projects, 4, async (project) => {
        try {
          const snapshot = await bridge.getProjectSnapshot(project.path);
          const disk = await bridge.getDiskSize(project.path).catch(() => 0);
          return { ...projectFromSnapshot(project, snapshot), diskSizeBytes: disk };
        } catch {
          return project;
        }
      });
      updateProjects(() => refreshed);
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
    const targetDirectory = await bridge.selectDirectory(defaultDirectoryHint());
    if (!targetDirectory) return;
    try {
      const result = await bridge.moveProject({ sourcePath: sourceProject.path, targetDirectory });
      if (result.success) {
        updateProjects((prev) => prev.map((project) => project.id === sourceProject.id ? { ...project, path: result.targetPath } : project));
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

  const initNewRepository = async () => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不支持初始化仓库");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    const bridge = requireDesktopBridge();
    const directory = await bridge.selectDirectory(defaultDirectoryHint());
    if (!directory) return;
    const projectName = window.prompt("项目名称（用于新建项目目录）", "my-project");
    if (!projectName || !/^[a-zA-Z0-9_-]+$/.test(projectName)) {
      setNotice("项目名称只能使用字母、数字、下划线或连字符");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    const targetPath = `${directory}\\${projectName}`;
    let alreadyExists = false;
    try {
      const inspected = await bridge.inspectProject(targetPath);
      alreadyExists = inspected.is_git_repository;
    } catch {
      alreadyExists = false;
    }
    if (alreadyExists) {
      setNotice("该目录已经是 Git 仓库");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    setIsImporting(true);
    try {
      await bridge.initRepository({ path: targetPath });
      const inspected = await bridge.inspectProject(targetPath);
      const diskSizeBytes = await bridge.getDiskSize(targetPath).catch(() => 0);
      const newProject: Project = {
        id: `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        name: inspected.name,
        path: targetPath,
        provider: "local",
        branch: "main",
        status: "clean",
        commit: "无提交",
        favorite: false,
        tags: ["new"],
        files: 0,
        syncLabel: "已初始化",
        language: "待分析",
        languageColor: "#8b97a8",
        summary: "刚初始化的新 Git 仓库。",
        updatedAt: "刚刚",
        diskSizeBytes,
      };
      updateProjects((prev) => [newProject, ...prev]);
      setSelectedId(newProject.id);
      setWorkspace("projects");
      setNotice("新 Git 仓库初始化完成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "初始化失败");
    } finally {
      setIsImporting(false);
      window.setTimeout(() => setNotice(null), 3500);
    }
  };

  const importScannedRepositories = async (items: RepositoryDiscoveryItem[]) => {
    if (!isDesktopRuntime()) return;
    const bridge = requireDesktopBridge();
    setIsImporting(true);
    let imported = 0;
    try {
      const existingPaths = new Set(projects.map((project) => project.path.toLowerCase()));
      const newProjects: Project[] = [];
      for (const item of items) {
        if (!item.isGitRepository || existingPaths.has(item.path.toLowerCase())) {
          continue;
        }
        const inspected = await bridge.inspectProject(item.path);
        const snapshot = inspected.snapshot;
        const diskSizeBytes = await bridge.getDiskSize(item.path).catch(() => 0);
        newProjects.push({
          id: `${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: inspected.name,
          path: item.path,
          provider: "local",
          branch: snapshot?.branch ?? "main",
          status: snapshot?.status ?? "clean",
          commit: snapshot?.commit ?? "未扫描",
          favorite: false,
          tags: ["new"],
          files: snapshot?.files ?? 0,
          syncLabel: snapshot?.sync_label ?? "待扫描",
          language: "待分析",
          languageColor: "#8b97a8",
          summary: "批量扫描导入的本地项目。",
          updatedAt: snapshot?.updated_at ?? "刚刚",
          diskSizeBytes,
        });
        existingPaths.add(item.path.toLowerCase());
        imported += 1;
      }
      if (newProjects.length > 0) {
        updateProjects((prev) => [...newProjects, ...prev]);
      }
    } finally {
      setIsImporting(false);
    }
    setNotice(imported > 0 ? `已导入 ${imported} 个仓库` : "没有可导入的新仓库");
    window.setTimeout(() => setNotice(null), 3500);
  };

  const scanDirectoryForImport = async () => {
    if (!isDesktopRuntime()) {
      setNotice("浏览器预览不支持批量导入");
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    const bridge = requireDesktopBridge();
    const directory = await bridge.selectDirectory(defaultDirectoryHint());
    if (!directory) return;
    try {
      const items = await bridge.scanDirectoryForRepositories(directory);
      const gitRepos = items.filter((item) => item.isGitRepository);
      if (gitRepos.length === 0) {
        setNotice("该目录下没有发现 Git 仓库");
        window.setTimeout(() => setNotice(null), 3000);
        return;
      }
      const confirmed = window.confirm(`发现 ${items.length} 个子目录，其中 ${gitRepos.length} 个是 Git 仓库。导入全部仓库？`);
      if (!confirmed) return;
      await importScannedRepositories(items);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "扫描失败");
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
          {buildNavGroups({ projects: projects.length, remotes: remoteRepositories.length, tasks: projects.filter((project) => project.tags.includes("building")).length }).map((group) => (
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
            <button className="sidebar-update-btn" onClick={() => void handleUpdate()}>→ v{updateAvailable.version} 更新</button>
          )}
          {isDownloading && updateProgress && (
            <span className="sidebar-update-progress">
              <span className="sidebar-update-progress-bar" style={{ width: `${updateProgress.percent}%` }} />
              <span className="sidebar-update-progress-text">{updateProgress.percent}%</span>
            </span>
          )}
          {downloadedPath && (
            <button className="sidebar-update-btn install" onClick={handleInstallUpdate}>重启安装</button>
          )}
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

        {environment && !environment.git_available && (
          <div className="env-banner">
            <AlertTriangle size={14} />
            <span>未检测到 Git，仓库克隆、提交、拉取等功能不可用。</span>
            <button className="button primary compact-button" onClick={() => void installGit()} disabled={installingGit}>
              {installingGit ? <><Loader2 size={13} className="spin" />安装中</> : <><ArrowDownToLine size={13} />一键安装</>}
            </button>
            <button className="button secondary compact-button" onClick={() => setWorkspace("settings")}>查看详情</button>
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
              onSelect={(id) => { setSelectedId(id); setOperationOutput(null); setAnalysis(null); }}
              onToggleFavorite={toggleFavorite}
              onUpdateProject={(projectId, patch) => updateProjects((prev) => prev.map((project) => project.id === projectId ? { ...project, ...patch } : project))}
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
            <RemoteRepositoriesWorkspace accounts={accounts} repositories={remoteRepositories} projects={projects} selectedAccountId={selectedAccountId} syncTime={remoteSyncTime} search={remoteSearch} isLoading={isLoadingRemotes} cloningRepositoryId={cloningRepositoryId} cloneProgress={cloneProgress} onAccountChange={(accountId) => { setSelectedAccountId(accountId); setRemoteRepositories([]); void loadRemoteRepositories(accountId, { silent: true }); }} onSearchChange={setRemoteSearch} onRefresh={() => loadRemoteRepositories()} onClone={cloneRemoteRepository} onMutate={mutateRemoteRepository} onToggleFavorite={toggleRemoteFavorite} onToggleWatch={toggleRemoteWatch} />
          ) : workspace === "tasks" ? (
            <TasksWorkspace projects={projects} />
          ) : workspace === "backups" ? (
            <BackupsWorkspace projects={projects} />
          ) : workspace === "logs" ? (
            <LogsWorkspace />
          ) : workspace === "settings" ? (
            <SettingsWorkspace environment={environment} accounts={accounts} accountBusyId={accountBusyId} onAdd={addAccount} onTest={testAccount} onDelete={deleteAccount} onSettingsChange={(next) => setAppSettings(next)} onRefreshEnvironment={refreshEnvironment} onInstallGit={installGit} installingGit={installingGit} installProgress={installProgress} />
          ) : (
            <ModuleWorkspace workspace={workspace} onImport={importProject} />
          )}
        </div>
      </main>

      {notice && <div className="toast"><Check size={16} />{notice}</div>}

      {/* 浮动进度块：仅当安装进行中/刚结束、且模态未打开时显示。避免与模态内的进度条重复。 */}
      {installProgress && !showSetupModal && (
        <div className={`setup-progress-float ${installProgress.phase === "failed" ? "failed" : installProgress.phase === "done" ? "done" : ""}`}>
          <div className="setup-progress-header">
            {installProgress.phase === "done"
              ? <Check size={13} />
              : installProgress.phase === "failed"
                ? <AlertTriangle size={13} />
                : <Loader2 size={13} className="spin" />}
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
          <div className="setup-progress-bar"><div className="setup-progress-fill" style={{ width: `${installProgress.percent}%` }} /></div>
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
                Gitool 的克隆、提交、分支、拉取、推送等操作依赖 Git 命令行工具，当前系统未检测到 Git。
                点击下方按钮将自动从官方（git-for-windows）下载 64 位安装包，并以管理员权限静默安装，
                完成后无需重启即可使用。
              </p>
              {installProgress && (
                <div className={`setup-progress ${installProgress.phase === "failed" ? "failed" : installProgress.phase === "done" ? "done" : ""}`}>
                  <div className="setup-progress-bar">
                    <div className="setup-progress-fill" style={{ width: `${installProgress.percent}%` }} />
                  </div>
                  <span className="setup-progress-text">{installProgress.message}</span>
                </div>
              )}
              {installProgress?.phase === "failed" && (
                <p className="form-error">安装未完成。可关闭后重试，或在「设置 → 环境信息」手动指定已存在的 git.exe 路径。</p>
              )}
              <div className="setup-actions">
                <button className="button primary" onClick={() => void installGit()} disabled={installingGit || installProgress?.phase === "downloading" || installProgress?.phase === "installing" || installProgress?.phase === "verifying"}>
                  {installingGit || (installProgress && installProgress.phase !== "done" && installProgress.phase !== "failed")
                    ? <><Loader2 size={14} className="spin" />正在安装...</>
                    : <><ArrowDownToLine size={14} />一键安装 Git</>}
                </button>
                <button className="button secondary" onClick={() => setShowSetupModal(false)} disabled={installingGit}>稍后再说</button>
                <label className="checkbox-row setup-dismiss">
                  <input type="checkbox" onChange={(event) => {
                    if (event.target.checked) {
                      window.localStorage.setItem(SETUP_DISMISS_KEY, "1");
                    } else {
                      window.localStorage.removeItem(SETUP_DISMISS_KEY);
                    }
                  }} />
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

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index]);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export default App;
