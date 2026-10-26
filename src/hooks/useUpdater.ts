import { useCallback, useEffect, useState } from "react";
import { getDesktopBridge, isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";

/**
 * 应用更新：可用版本提示、下载进度、下载与安装。
 *
 * 抽出来的原因：更新逻辑与主流程完全解耦，只依赖 bridge 和一个错误回调，
 * 留在 App() 里会让主组件多背 4 个 state 和 2 个 handler。
 */
export type UpdaterApi = {
  available: { version: string } | null;
  progress: { percent: number } | null;
  downloadedPath: string | null;
  isDownloading: boolean;
  download: () => Promise<void>;
  install: () => void;
  dismiss: () => void;
};

export function useUpdater(onError: (message: string) => void): UpdaterApi {
  const [available, setAvailable] = useState<{ version: string } | null>(null);
  const [progress, setProgress] = useState<{ percent: number } | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const bridge = requireDesktopBridge();
    const unsubscribeAvailable = bridge.onUpdateAvailable((info) => setAvailable(info));
    const unsubscribeProgress = bridge.onUpdateProgress((value) =>
      setProgress({ percent: value.percent }),
    );
    return () => {
      unsubscribeAvailable();
      unsubscribeProgress();
    };
  }, []);

  const download = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setIsDownloading(true);
    setProgress(null);
    try {
      setDownloadedPath(await bridge.downloadUpdate());
    } catch (error) {
      onError(error instanceof Error ? error.message : "下载更新失败");
    } finally {
      setIsDownloading(false);
    }
  }, [onError]);

  const install = useCallback(() => {
    const bridge = getDesktopBridge();
    if (!bridge || !downloadedPath) return;
    bridge.installUpdate(downloadedPath);
  }, [downloadedPath]);

  const dismiss = useCallback(() => setAvailable(null), []);

  return { available, progress, downloadedPath, isDownloading, download, install, dismiss };
}
