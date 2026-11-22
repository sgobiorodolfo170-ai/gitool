import { useState, useCallback } from "react";
import type { BackupRecord } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "./useAsyncData";

interface UseBackupsResult {
  backups: BackupRecord[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  createBackup: (input: {
    projectId: string;
    projectName: string;
    sourcePath: string;
    targetDirectory: string;
  }) => Promise<BackupRecord | null>;
  restoreBackup: (archivePath: string, targetDirectory: string) => Promise<void>;
}

export function useBackups(): UseBackupsResult {
  const bridge = getDesktopBridge();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { load, status } = useAsyncData<BackupRecord[]>({
    loader: async () => {
      if (!bridge) return [];
      return await bridge.listBackups();
    },
    onLoaded: (data) => {
      setBackups(data);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "加载备份记录失败");
    },
  });

  const createBackup = useCallback(
    async (input: {
      projectId: string;
      projectName: string;
      sourcePath: string;
      targetDirectory: string;
    }): Promise<BackupRecord | null> => {
      if (!bridge) return null;
      try {
        const record = await bridge.createBackup(input);
        await load();
        return record;
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建备份失败");
        return null;
      }
    },
    [bridge, load],
  );

  const restoreBackup = useCallback(
    async (archivePath: string, targetDirectory: string): Promise<void> => {
      if (!bridge) return;
      try {
        await bridge.restoreBackup({ archivePath, targetDirectory });
      } catch (err) {
        setError(err instanceof Error ? err.message : "恢复备份失败");
        throw err;
      }
    },
    [bridge],
  );

  return {
    backups,
    loading: status === "loading",
    error,
    load,
    createBackup,
    restoreBackup,
  };
}
