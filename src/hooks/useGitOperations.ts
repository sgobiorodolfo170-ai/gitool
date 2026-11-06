import { useCallback, useState } from "react";
import type { GitOperation, Project, ProjectAnalysis } from "../../shared/types";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";
import { operationLabels } from "../lib/meta";
import { projectFromSnapshot } from "../lib/projectMatch";

/**
 * Git 操作与结构分析：单个项目操作、批量操作、项目结构分析。
 *
 * `operationOutput` / `analysis` 两个 state 刻意留在 App：
 * 它们被 `clearDetail` 使用，而 `clearDetail` 又要传给 useProjects，
 * 若收进本 hook 会形成 useProjects ↔ useGitOperations 的循环依赖。
 * 这里只接收它们的 setter。
 */
export type GitOperationsApi = {
  activeOperation: GitOperation | null;
  /** 批量 Git 操作执行中。UI 据此禁用批量按钮并提示进度。 */
  bulkRunning: boolean;
  isAnalyzing: boolean;
  runGitOperation: (operation: GitOperation) => Promise<void>;
  runBulkGitOperation: (operation: GitOperation, ids: string[]) => Promise<void>;
  analyzeProject: () => Promise<void>;
};

export type GitOperationsParams = {
  selectedProject: Project | undefined;
  getProjects: () => Project[];
  updateProjects: (updater: (prev: Project[]) => Project[]) => void;
  onNotice: (message: string) => void;
  setOperationOutput: (value: string | null) => void;
  setAnalysis: (value: ProjectAnalysis | null) => void;
};

/**
 * Git 操作全局互斥的权威开关（2026-11-07 审查 P1-7）。
 *
 * 为什么放模块级而不是 hook 内部 useRef：本 hook 的编排已下沉 ProjectsPage
 * （治理轮-3），页面随工作区切换会卸载重挂——hook 内部的 ref 会随之重置，
 * 「批量操作执行中切走再切回，可对同一仓库并发 git 进程（index.lock 冲突）」
 * 的互斥保护就被弱化了。互斥锁的语义是跨页面、跨挂载实例的应用级锁，
 * 属于域层而非组件树，因此用模块级单例承载。锁在 finally 里释放，
 * 操作完成晚于页面卸载时也能正确复位。
 */
const gitBusyRef = { current: false };

export function useGitOperations(params: GitOperationsParams): GitOperationsApi {
  const {
    selectedProject,
    getProjects,
    updateProjects,
    onNotice,
    setOperationOutput,
    setAnalysis,
  } = params;

  const [activeOperation, setActiveOperation] = useState<GitOperation | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  // state 只承担 UI 反馈职责；互斥的权威开关是上面的模块级 gitBusyRef。

  const runGitOperation = useCallback(
    async (operation: GitOperation) => {
      if (!selectedProject) return;
      if (gitBusyRef.current) {
        onNotice("已有 Git 操作在执行，请稍候");
        return;
      }
      setOperationOutput(null);
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会执行 Git 命令，请使用桌面版");
        return;
      }

      setActiveOperation(operation);
      gitBusyRef.current = true;
      try {
        const result = await requireDesktopBridge().runGitOperation(
          selectedProject.path,
          operation,
        );
        setOperationOutput(result.output);
        if (result.snapshot) {
          const snapshot = result.snapshot;
          updateProjects((prev) =>
            prev.map((project) =>
              project.id === selectedProject.id ? projectFromSnapshot(project, snapshot) : project,
            ),
          );
        }
        onNotice(
          result.success
            ? `${operationLabels[operation]}完成`
            : `${operationLabels[operation]}失败`,
        );
      } catch (error) {
        setOperationOutput(error instanceof Error ? error.message : "Git 操作失败，请查看日志");
        onNotice(`${operationLabels[operation]}失败`);
      } finally {
        gitBusyRef.current = false;
        setActiveOperation(null);
      }
    },
    [onNotice, selectedProject, setOperationOutput, updateProjects],
  );

  const runBulkGitOperation = useCallback(
    async (operation: GitOperation, ids: string[]) => {
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会执行 Git 命令，请使用桌面版");
        return;
      }
      if (gitBusyRef.current) {
        onNotice("已有 Git 操作在执行，请稍候");
        return;
      }
      const bridge = requireDesktopBridge();
      gitBusyRef.current = true;
      setBulkRunning(true);
      try {
        let successCount = 0;
        let failureCount = 0;
        const updated: Project[] = [];

        for (const project of getProjects()) {
          if (!ids.includes(project.id)) continue;
          try {
            const result = await bridge.runGitOperation(project.path, operation);
            if (result.success) {
              successCount += 1;
              updated.push(
                result.snapshot ? projectFromSnapshot(project, result.snapshot) : project,
              );
            } else {
              failureCount += 1;
              updated.push(project);
            }
          } catch {
            failureCount += 1;
            updated.push(project);
          }
        }

        updateProjects((prev) =>
          prev.map((project) => updated.find((item) => item.id === project.id) ?? project),
        );
        onNotice(
          `批量${operationLabels[operation]}完成：成功 ${successCount}，失败 ${failureCount}`,
        );
      } finally {
        gitBusyRef.current = false;
        setBulkRunning(false);
      }
    },
    [getProjects, onNotice, updateProjects],
  );

  const analyzeProject = useCallback(async () => {
    if (!selectedProject) return;
    setAnalysis(null);
    if (!isDesktopRuntime()) {
      onNotice("浏览器预览不会扫描本地文件，请使用桌面版");
      return;
    }
    setIsAnalyzing(true);
    try {
      setAnalysis(await requireDesktopBridge().analyzeProject(selectedProject.path));
      onNotice("项目结构分析完成");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "项目结构分析失败");
    } finally {
      setIsAnalyzing(false);
    }
  }, [onNotice, selectedProject, setAnalysis]);

  return {
    activeOperation,
    bulkRunning,
    isAnalyzing,
    runGitOperation,
    runBulkGitOperation,
    analyzeProject,
  };
}
