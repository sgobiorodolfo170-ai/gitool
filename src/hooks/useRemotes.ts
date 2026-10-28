import { useCallback, useEffect, useState } from "react";
import type { Project, RemoteRepository } from "../../shared/types";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";
import { remoteProjectMatch } from "../lib/projectMatch";
import { LAST_IMPORT_DIRECTORY_KEY } from "../lib/storageKeys";

/**
 * 远程仓库：同步列表、克隆、增删改、收藏/关注。
 *
 * 收藏与关注采用「乐观更新 + 失败回滚」：先在本地列表里改，再调平台 API，
 * 失败则执行 rollback。这比等接口返回再改 UI 更跟手，但必须保证 rollback 幂等。
 */
export type CloneProgress = { percent: number; phase: string; output: string };

export type RemotesApi = {
  repositories: RemoteRepository[];
  syncTime: string | null;
  selectedAccountId: string;
  search: string;
  isLoading: boolean;
  cloningRepositoryId: string | null;
  cloneProgress: CloneProgress | null;
  setSelectedAccountId: React.Dispatch<React.SetStateAction<string>>;
  setSearch: (value: string) => void;
  setRepositories: React.Dispatch<React.SetStateAction<RemoteRepository[]>>;
  /** 账号被删除后清掉它的仓库与选中态。 */
  forgetAccount: (accountId: string, remainingAccountIds: string[]) => void;
  loadRemoteRepositories: (accountId?: string, options?: { silent?: boolean }) => Promise<void>;
  cloneRemoteRepository: (repository: RemoteRepository) => Promise<void>;
  mutateRemoteRepository: (
    action: "create" | "update" | "delete",
    input: {
      accountId: string;
      repositoryId?: string;
      name: string;
      description: string;
      visibility: "public" | "private" | "internal" | "";
      init: boolean;
    },
  ) => Promise<boolean>;
  toggleRemoteFavorite: (repository: RemoteRepository) => Promise<void>;
  toggleRemoteWatch: (repository: RemoteRepository) => Promise<void>;
};

export type RemotesParams = {
  getProjects: () => Project[];
  updateProjects: (updater: (prev: Project[]) => Project[]) => void;
  onNotice: (message: string) => void;
  /** 克隆成功后选中并跳转到项目页。 */
  onCloned: (projectId: string) => void;
};

export function useRemotes(params: RemotesParams): RemotesApi {
  const { getProjects, updateProjects, onNotice, onCloned } = params;

  const [repositories, setRepositories] = useState<RemoteRepository[]>([]);
  const [syncTime, setSyncTime] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [cloningRepositoryId, setCloningRepositoryId] = useState<string | null>(null);
  const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    return requireDesktopBridge().onCloneProgress((event) => {
      setCloneProgress({ percent: event.percent, phase: event.phase, output: event.output });
      if (event.done) {
        window.setTimeout(() => setCloneProgress(null), 2000);
      }
    });
  }, []);

  const forgetAccount = useCallback((accountId: string, remainingAccountIds: string[]) => {
    setRepositories((current) => current.filter((item) => item.accountId !== accountId));
    setSelectedAccountId((current) =>
      current === accountId ? (remainingAccountIds[0] ?? "") : current,
    );
  }, []);

  const loadRemoteRepositories = useCallback(
    async (accountId = selectedAccountId, options?: { silent?: boolean }) => {
      if (!accountId) {
        onNotice("请先添加并选择一个远程账号");
        return;
      }
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会访问远程平台，请使用 Windows 桌面版");
        return;
      }
      const bridge = requireDesktopBridge();

      setIsLoading(true);
      try {
        // 先展示本地缓存（上次已同步的数据），避免每次启动都等待网络
        const cached = await bridge.loadCachedRemoteRepositories(accountId);
        if (cached.length > 0) {
          setRepositories(cached);
          const meta = await bridge.getRemoteRepositoryCacheMeta(accountId).catch(() => null);
          if (meta) setSyncTime(meta.syncedAt);
        }
        const fresh = await bridge.loadRemoteRepositories(accountId);
        setRepositories(fresh);
        const meta = await bridge.getRemoteRepositoryCacheMeta(accountId).catch(() => null);
        if (meta) setSyncTime(meta.syncedAt);
        if (!options?.silent) {
          onNotice(`已同步 ${fresh.length} 个远程仓库（已缓存）`);
        }
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "远程仓库同步失败");
      } finally {
        setIsLoading(false);
      }
    },
    [onNotice, selectedAccountId],
  );

  const toggleRemoteFavorite = useCallback(
    async (repository: RemoteRepository) => {
      const projects = getProjects();
      const isFav = projects.some(
        (project) => remoteProjectMatch(project, repository) && project.favorite,
      );
      const match = projects.find((project) => remoteProjectMatch(project, repository));
      let rollback: (() => void) | null = null;

      if (match) {
        if (match.path === "" && !match.tags.includes("watching")) {
          updateProjects((prev) => prev.filter((project) => project.id !== match.id));
          rollback = () => updateProjects((prev) => [match, ...prev]);
        } else {
          updateProjects((prev) =>
            prev.map((project) =>
              project.id === match.id ? { ...project, favorite: !project.favorite } : project,
            ),
          );
          rollback = () =>
            updateProjects((prev) =>
              prev.map((project) =>
                project.id === match.id ? { ...project, favorite: match.favorite } : project,
              ),
            );
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
        rollback = () =>
          updateProjects((prev) => prev.filter((project) => project.id !== favoriteProject.id));
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
          onNotice(error instanceof Error ? error.message : "平台收藏操作失败");
        }
      }
    },
    [getProjects, onNotice, updateProjects],
  );

  const toggleRemoteWatch = useCallback(
    async (repository: RemoteRepository) => {
      const projects = getProjects();
      const isWatched = projects.some(
        (project) => remoteProjectMatch(project, repository) && project.tags.includes("watching"),
      );
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
          updateProjects((prev) =>
            prev.map((project) =>
              project.id === match.id ? { ...project, tags: nextTags } : project,
            ),
          );
          rollback = () =>
            updateProjects((prev) =>
              prev.map((project) =>
                project.id === match.id ? { ...project, tags: match.tags } : project,
              ),
            );
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
        rollback = () =>
          updateProjects((prev) => prev.filter((project) => project.id !== watchedProject.id));
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
          onNotice(error instanceof Error ? error.message : "平台关注操作失败");
        }
      }
    },
    [getProjects, onNotice, updateProjects],
  );

  const cloneRemoteRepository = useCallback(
    async (repository: RemoteRepository) => {
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会执行克隆，请使用 Windows 桌面版");
        return;
      }
      const bridge = requireDesktopBridge();
      const defaultDirectory = window.localStorage.getItem(LAST_IMPORT_DIRECTORY_KEY) ?? undefined;
      const parentDirectory = await bridge.selectDirectory(defaultDirectory);
      if (!parentDirectory) return;

      const targetPath = `${parentDirectory}\\${repository.name}`;
      setCloningRepositoryId(repository.id);
      try {
        const result = await bridge.cloneRepository({
          url: repository.httpsUrl,
          targetPath,
          accountId: repository.accountId,
        });
        if (!result.success) {
          onNotice(`克隆失败：${result.output.slice(0, 200)}`);
          return;
        }

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

        // 如果之前收藏过这个远程仓库，克隆后用真实项目替换掉那条占位记录
        const favoriteStub = getProjects().find(
          (project) =>
            project.path === "" && project.webUrl === repository.webUrl && project.favorite,
        );
        if (favoriteStub) {
          newProject.favorite = true;
          updateProjects((prev) => [
            newProject,
            ...prev.filter((project) => project.id !== favoriteStub.id),
          ]);
        } else {
          updateProjects((prev) => [newProject, ...prev]);
        }
        onCloned(newProject.id);
        onNotice("仓库克隆完成，已加入我的项目");
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "克隆失败，请查看日志");
      } finally {
        setCloningRepositoryId(null);
      }
    },
    [getProjects, onCloned, onNotice, updateProjects],
  );

  const mutateRemoteRepository = useCallback(
    async (
      action: "create" | "update" | "delete",
      input: {
        accountId: string;
        repositoryId?: string;
        name: string;
        description: string;
        visibility: "public" | "private" | "internal" | "";
        init: boolean;
      },
    ) => {
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会修改远程仓库，请使用 Windows 桌面版");
        return false;
      }
      if (action === "delete") {
        const confirmed = window.confirm(
          "删除远程仓库是不可逆操作，仓库及其历史将被永久删除。确定继续吗？",
        );
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
        onNotice(result.message);
        if (action === "create" || action === "update") {
          await loadRemoteRepositories(input.accountId);
        } else {
          setRepositories((current) =>
            current.filter(
              (repository) =>
                repository.accountId !== input.accountId || repository.id !== input.repositoryId,
            ),
          );
        }
        return result.success;
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "远程仓库操作失败");
        return false;
      }
    },
    [loadRemoteRepositories, onNotice],
  );

  return {
    repositories,
    syncTime,
    selectedAccountId,
    search,
    isLoading,
    cloningRepositoryId,
    cloneProgress,
    setSelectedAccountId,
    setSearch,
    setRepositories,
    forgetAccount,
    loadRemoteRepositories,
    cloneRemoteRepository,
    mutateRemoteRepository,
    toggleRemoteFavorite,
    toggleRemoteWatch,
  };
}
