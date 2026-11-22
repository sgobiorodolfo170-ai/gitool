import { useState, useCallback } from "react";
import type { AppSettings } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "./useAsyncData";

interface UseSettingsResult {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (settings: AppSettings) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  gitPath: "",
  defaultProjectDirectory: "",
  defaultBackupDirectory: "",
  backupExcludePatterns: "",
  defaultSearchAccountId: "",
  aiApiKeyConfigured: false,
  aiModel: "",
  aiBaseUrl: "",
  closeToTray: false,
  theme: "system",
};

export function useSettings(): UseSettingsResult {
  const bridge = getDesktopBridge();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { status } = useAsyncData<AppSettings>({
    loader: async () => {
      if (!bridge) return DEFAULT_SETTINGS;
      return await bridge.loadSettings();
    },
    onLoaded: (data) => {
      setSettings(data);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "加载设置失败");
    },
  });

  const save = useCallback(
    async (newSettings: AppSettings): Promise<void> => {
      if (!bridge) return;
      try {
        await bridge.saveSettings(newSettings);
        setSettings(newSettings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存设置失败");
        throw err;
      }
    },
    [bridge],
  );

  return {
    settings: settings ?? DEFAULT_SETTINGS,
    loading: status === "loading",
    error,
    load: async () => {
      if (!bridge) return;
      try {
        const data = await bridge.loadSettings();
        setSettings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载设置失败");
      }
    },
    save,
  };
}
