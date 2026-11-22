import { useState, useCallback } from "react";
import type { OperationRecord } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "./useAsyncData";

interface UseLogsResult {
  records: OperationRecord[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  clear: () => Promise<void>;
  exportToCsv: (directory: string) => Promise<string | null>;
}

export function useLogs(): UseLogsResult {
  const bridge = getDesktopBridge();
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { load, status } = useAsyncData<OperationRecord[]>({
    loader: async () => {
      if (!bridge) return [];
      return await bridge.listOperationRecords();
    },
    onLoaded: (data) => {
      setRecords(data);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "加载操作记录失败");
    },
  });

  const clear = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    try {
      await bridge.clearOperationRecords();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空操作记录失败");
      throw err;
    }
  }, [bridge, load]);

  const exportToCsv = useCallback(
    async (directory: string): Promise<string | null> => {
      if (!bridge) return null;
      try {
        const filePath = await bridge.exportOperationRecords(directory);
        return filePath;
      } catch (err) {
        setError(err instanceof Error ? err.message : "导出操作记录失败");
        return null;
      }
    },
    [bridge],
  );

  return {
    records,
    loading: status === "loading",
    error,
    load,
    clear,
    exportToCsv,
  };
}
