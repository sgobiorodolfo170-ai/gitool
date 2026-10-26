import { useCallback, useEffect, useState } from "react";
import type { EnvironmentStatus, InstallGitResult, InstallProgress } from "../../shared/types";
import { isDesktopRuntime, requireDesktopBridge } from "../lib/bridge";

/**
 * 运行环境体检与一键安装 Git。
 *
 * 抽出来的原因：这组状态（环境 / 安装进度 / 引导弹窗 / 安装中标记）只被
 * 设置页和首启引导消费，与项目、远程仓库等主流程无耦合。
 */
export type EnvironmentApi = {
  environment: EnvironmentStatus | null;
  installProgress: InstallProgress | null;
  installingGit: boolean;
  showSetupModal: boolean;
  setEnvironment: (value: EnvironmentStatus | null) => void;
  setShowSetupModal: (value: boolean) => void;
  refreshEnvironment: () => Promise<void>;
  installGit: () => Promise<InstallGitResult | null>;
};

export function useEnvironment(onError: (message: string) => void): EnvironmentApi {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [installingGit, setInstallingGit] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    return requireDesktopBridge().onInstallProgress((event) => {
      setInstallProgress(event);
      // 成功提示 2s 后消失，失败提示 4s 后消失（让用户看清错误信息）
      if (event.phase === "done" || event.phase === "failed") {
        window.setTimeout(() => setInstallProgress(null), event.phase === "done" ? 2000 : 4000);
      }
    });
  }, []);

  const refreshEnvironment = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      setEnvironment(await requireDesktopBridge().refreshEnvironment());
    } catch (error) {
      onError(error instanceof Error ? error.message : "刷新环境信息失败");
    }
  }, [onError]);

  const installGit = useCallback(async (): Promise<InstallGitResult | null> => {
    if (!isDesktopRuntime()) return null;
    setInstallingGit(true);
    try {
      const result = await requireDesktopBridge().installGit();
      if (result.environment) setEnvironment(result.environment);
      if (result.success) {
        setShowSetupModal(false);
        onError("Git 安装成功，相关功能已可用");
      } else {
        onError(result.message || "安装未完成");
      }
      return result;
    } catch (error) {
      onError(error instanceof Error ? error.message : "安装失败");
      return null;
    } finally {
      setInstallingGit(false);
    }
  }, [onError]);

  return {
    environment,
    installProgress,
    installingGit,
    showSetupModal,
    setEnvironment,
    setShowSetupModal,
    refreshEnvironment,
    installGit,
  };
}
