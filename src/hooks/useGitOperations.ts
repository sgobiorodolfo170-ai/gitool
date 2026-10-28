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

  const runGitOperation = useCallback(
    async (operation: GitOperation) => {
      if (!selectedProject) return;
      setOperationOutput(null);
      if (!isDesktopRuntime()) {
        onNotice("浏览器预览不会执行 Git 命令，请使用桌面版");
        return;
      }

      setActiveOperation(operation);
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
          result.success ? `${operationLabels[operation]}完成` : `${operationLabels[operation]}失败`,
        );
      } catch (error) {
        setOperationOutput(error instanceof Error ? error.message : "Git 操作失败，请查看日志");
        onNotice(`${operationLabels[operation]}失败`);
      } finally {
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
      const bridge = requireDesktopBridge();
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
      onNotice(`批量${operationLabels[operation]}完成：成功 ${successCount}，失败 ${failureCount}`);
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

  return { activeOperation, isAnalyzing, runGitOperation, runBulkGitOperation, analyzeProject };
}
