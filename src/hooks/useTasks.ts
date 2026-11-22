import { useState, useCallback, useEffect } from "react";
import type { TaskProfile, TaskRun, DetectedCommand } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "./useAsyncData";

interface UseTasksResult {
  profiles: TaskProfile[];
  runs: TaskRun[];
  loading: boolean;
  error: string | null;
  loadProfiles: () => Promise<void>;
  loadRuns: () => Promise<void>;
  saveProfile: (profile: TaskProfile) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  runTask: (profileId: string) => Promise<void>;
  stopTask: (runId: string) => Promise<void>;
  getRunningOutput: (runId: string) => Promise<string>;
  detectCommands: (projectPath: string) => Promise<DetectedCommand[]>;
}

export function useTasks(): UseTasksResult {
  const bridge = getDesktopBridge();
  const [profiles, setProfiles] = useState<TaskProfile[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { load: _load, status } = useAsyncData<{ profiles: TaskProfile[]; runs: TaskRun[] }>({
    loader: async () => {
      if (!bridge) return { profiles: [], runs: [] };
      const [loadedProfiles, loadedRuns] = await Promise.all([
        bridge.listTaskProfiles(),
        bridge.listTaskRuns(),
      ]);
      return { profiles: loadedProfiles, runs: loadedRuns };
    },
    onLoaded: ({ profiles: loadedProfiles, runs: loadedRuns }) => {
      setProfiles(loadedProfiles);
      setRuns(loadedRuns);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "加载任务数据失败");
    },
    pollMs: 4000,
  });

  const loadProfiles = useCallback(async () => {
    if (!bridge) return;
    try {
      const result = await bridge.listTaskProfiles();
      setProfiles(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载任务配置失败");
    }
  }, [bridge]);

  const loadRuns = useCallback(async () => {
    if (!bridge) return;
    try {
      const result = await bridge.listTaskRuns();
      setRuns(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载运行记录失败");
    }
  }, [bridge]);

  const saveProfile = useCallback(
    async (profile: TaskProfile) => {
      if (!bridge) return;
      try {
        await bridge.saveTaskProfile(profile);
        await loadProfiles();
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存任务配置失败");
        throw err;
      }
    },
    [bridge, loadProfiles],
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      if (!bridge) return;
      try {
        await bridge.deleteTaskProfile(profileId);
        await loadProfiles();
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除任务配置失败");
        throw err;
      }
    },
    [bridge, loadProfiles],
  );

  const runTask = useCallback(
    async (profileId: string) => {
      if (!bridge) return;
      try {
        await bridge.runTask(profileId);
        await loadRuns();
      } catch (err) {
        setError(err instanceof Error ? err.message : "启动任务失败");
        throw err;
      }
    },
    [bridge, loadRuns],
  );

  const stopTask = useCallback(
    async (runId: string) => {
      if (!bridge) return;
      try {
        await bridge.stopTask(runId);
        await loadRuns();
      } catch (err) {
        setError(err instanceof Error ? err.message : "停止任务失败");
        throw err;
      }
    },
    [bridge, loadRuns],
  );

  const getRunningOutput = useCallback(
    async (runId: string) => {
      if (!bridge) return "";
      try {
        return await bridge.getRunningTaskOutput(runId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "获取运行输出失败");
        return "";
      }
    },
    [bridge],
  );

  const detectCommands = useCallback(
    async (projectPath: string) => {
      if (!bridge) return [];
      try {
        const result = await bridge.detectProjectCommands(projectPath);
        return result.commands;
      } catch (err) {
        setError(err instanceof Error ? err.message : "检测命令失败");
        return [];
      }
    },
    [bridge],
  );

  // 自动轮询在 useAsyncData 中处理，这里只暴露手动加载方法
  useEffect(() => {
    if (status === "error") {
      // 错误已在 onError 中处理
    }
  }, [status]);

  return {
    profiles,
    runs,
    loading: status === "loading",
    error,
    loadProfiles,
    loadRuns,
    saveProfile,
    deleteProfile,
    runTask,
    stopTask,
    getRunningOutput,
    detectCommands,
  };
}
