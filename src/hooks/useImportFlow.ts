import { useCallback, useState } from "react";
import type { GitSnapshot, Project, RepositoryDiscoveryItem } from "../../shared/types";
import { getDesktopBridge, isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";
import { projectFromSnapshot } from "../lib/projectMatch";
import { LAST_IMPORT_DIRECTORY_KEY } from "../lib/storageKeys";

/**
 * 项目导入：选目录导入、初始化新仓库、扫描目录批量导入。
 *
 * 三个入口共用 `isImporting` 标记，保证同一时刻只有一个导入流程在跑。
 * 与 useProjects 的耦合通过 `addProjects` / `getProjects` 两个回调完成，
 * 不直接 import，避免 hook 之间的循环依赖。
 */
export type ImportFlowApi = {
  isImporting: boolean;
  importProject: () => Promise<void>;
  initNewRepository: () => Promise<void>;
  scanDirectoryForImport: () => Promise<void>;
  importScannedRepositories: (items: RepositoryDiscoveryItem[]) => Promise<void>;
};

export type ImportFlowParams = {
  onNotice: (message: string) => void;
  defaultDirectoryHint: () => string | undefined;
  /** 取当前项目列表（用于批量导入去重，必须是最新值）。 */
  getProjects: () => Project[];
  /** 追加若干项目并落库。 */
  addProjects: (items: Project[]) => void;
  /** 导入成功后选中并跳转到项目页。 */
  onImported: (projectId: string) => void;
};

export function useImportFlow(params: ImportFlowParams): ImportFlowApi {
  const { onNotice, defaultDirectoryHint, getProjects, addProjects, onImported } = params;
  const [isImporting, setIsImporting] = useState(false);

  const importProject = useCallback(async () => {
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
        onNotice("这个目录还不是 Git 仓库");
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
      if (importedSnapshot) {
        Object.assign(newProject, projectFromSnapshot(newProject, importedSnapshot));
      }

      window.localStorage.setItem(LAST_IMPORT_DIRECTORY_KEY, path);
      addProjects([newProject]);
      onImported(newProject.id);
      onNotice("项目已导入");
    } catch {
      onNotice("无法读取这个目录，请确认路径存在且可访问");
    } finally {
      setIsImporting(false);
    }
  }, [addProjects, defaultDirectoryHint, onImported, onNotice]);

  const initNewRepository = useCallback(async () => {
    if (!isDesktopRuntime()) {
      onNotice("浏览器预览不支持初始化仓库");
      return;
    }
    const bridge = requireDesktopBridge();
    const directory = await bridge.selectDirectory(defaultDirectoryHint());
    if (!directory) return;

    const projectName = window.prompt("项目名称（用于新建项目目录）", "my-project");
    if (!projectName || !/^[a-zA-Z0-9_-]+$/.test(projectName)) {
      onNotice("项目名称只能使用字母、数字、下划线或连字符");
      return;
    }

    const targetPath = `${directory}\\${projectName}`;
    let alreadyExists = false;
    try {
      alreadyExists = (await bridge.inspectProject(targetPath)).is_git_repository;
    } catch {
      alreadyExists = false;
    }
    if (alreadyExists) {
      onNotice("该目录已经是 Git 仓库");
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
      addProjects([newProject]);
      onImported(newProject.id);
      onNotice("新 Git 仓库初始化完成");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "初始化失败");
    } finally {
      setIsImporting(false);
    }
  }, [addProjects, defaultDirectoryHint, onImported, onNotice]);

  const importScannedRepositories = useCallback(
    async (items: RepositoryDiscoveryItem[]) => {
      if (!isDesktopRuntime()) return;
      const bridge = requireDesktopBridge();
      setIsImporting(true);
      let imported = 0;
      try {
        const existingPaths = new Set(getProjects().map((project) => project.path.toLowerCase()));
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
          addProjects(newProjects);
        }
      } finally {
        setIsImporting(false);
      }
      onNotice(imported > 0 ? `已导入 ${imported} 个仓库` : "没有可导入的新仓库");
    },
    [addProjects, getProjects, onNotice],
  );

  const scanDirectoryForImport = useCallback(async () => {
    if (!isDesktopRuntime()) {
      onNotice("浏览器预览不支持批量导入");
      return;
    }
    const bridge = requireDesktopBridge();
    const directory = await bridge.selectDirectory(defaultDirectoryHint());
    if (!directory) return;
    try {
      const items = await bridge.scanDirectoryForRepositories(directory);
      const gitRepos = items.filter((item) => item.isGitRepository);
      if (gitRepos.length === 0) {
        onNotice("该目录下没有发现 Git 仓库");
        return;
      }
      const confirmed = window.confirm(
        `发现 ${items.length} 个子目录，其中 ${gitRepos.length} 个是 Git 仓库。导入全部仓库？`,
      );
      if (!confirmed) return;
      await importScannedRepositories(items);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "扫描失败");
    }
  }, [defaultDirectoryHint, importScannedRepositories, onNotice]);

  return { isImporting, importProject, initNewRepository, scanDirectoryForImport, importScannedRepositories };
}
