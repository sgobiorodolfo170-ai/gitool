import {
  ArrowDownToLine,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { EnvironmentStatus, InstallGitResult, InstallProgress } from "../../types";
import {
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
} from "../../lib/uiPrefs";

/**
 * 「环境信息」设置 tab：Git/数据目录/凭据/网络体检结果与前端字号调节。
 * 纯展示组件——所有数据与回调（含一键安装与进度）都是只读 props，
 * 无内部状态，因此可以整块下沉而不牵动任何共享状态。
 */
export function EnvironmentTab({
  environment,
  onRefreshEnvironment,
  onInstallGit,
  installingGit,
  installProgress,
  fontScale,
  onFontScaleChange,
}: {
  environment: EnvironmentStatus | null;
  onRefreshEnvironment: () => Promise<void>;
  onInstallGit: () => Promise<InstallGitResult | null>;
  installingGit: boolean;
  installProgress: InstallProgress | null;
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
}) {
  return (
    <section className="account-list-panel settings-form">
      <div className="panel-heading">
        <div>
          <h2>环境信息</h2>
          <span>本地运行环境</span>
        </div>
        <div className="panel-heading-actions">
          <button
            className="bare-button"
            onClick={() => void onRefreshEnvironment()}
            disabled={installingGit}
            aria-label="刷新环境信息"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="form-body">
        {/* Git 可用性：缺失时显示一键安装按钮 */}
        <label>
          Git 可用性
          <span
            className={`status-pill setting-value ${environment?.git_available ? "status-clean" : "status-conflicted"}`}
          >
            <span className="status-dot" />
            {environment?.git_available ? "可用" : "不可用"}
          </span>
          {!environment?.git_available && (
            <button
              className="button primary env-install-btn"
              onClick={() => void onInstallGit()}
              disabled={installingGit}
            >
              {installingGit ||
              (installProgress &&
                installProgress.phase !== "done" &&
                installProgress.phase !== "failed") ? (
                <>
                  <Loader2 size={13} className="spin" />
                  安装中
                </>
              ) : (
                <>
                  <ArrowDownToLine size={13} />
                  一键安装 Git
                </>
              )}
            </button>
          )}
        </label>
        <label>
          Git 版本
          <div className="setting-value mono">{environment?.git_version ?? "检测中"}</div>
        </label>
        {/* 数据目录可写性：sqlite + 备份 ZIP 均需写入 */}
        <label>
          数据目录可写
          <span
            className={`status-pill setting-value ${environment?.data_directory_writable ? "status-clean" : "status-conflicted"}`}
          >
            <span className="status-dot" />
            {environment?.data_directory_writable ? "可写" : "不可写"}
          </span>
        </label>
        <label>
          数据目录
          <div className="setting-value mono">
            {environment?.data_directory || "%APPDATA%\\Gitool"}
          </div>
        </label>
        {/* 凭据管理器：PAT / AI Key 依赖它保存 */}
        <label>
          凭据管理器
          <span
            className={`status-pill setting-value ${environment?.keyring_available ? "status-clean" : "status-conflicted"}`}
          >
            <span className="status-dot" />
            {environment?.keyring_available ? "可用" : "不可用"}
          </span>
        </label>
        {/* 网络可达性：影响远程仓库列表、克隆、星标同步 */}
        <label>
          网络可达性
          <div className="env-network-list">
            {(
              [
                { key: "github", label: "GitHub" },
                { key: "gitee", label: "Gitee" },
                { key: "gitlab", label: "GitLab" },
              ] as const
            ).map((item) => {
              const state = environment?.network?.[item.key] ?? "unknown";
              const cls =
                state === "reachable"
                  ? "status-clean"
                  : state === "unreachable"
                    ? "status-conflicted"
                    : "status-behind";
              return (
                <span key={item.key} className={`status-pill setting-value ${cls}`}>
                  <span className="status-dot" />
                  {item.label} ·{" "}
                  {state === "reachable" ? "可达" : state === "unreachable" ? "不可达" : "未知"}
                </span>
              );
            })}
          </div>
        </label>
        <label>
          操作系统
          <div className="setting-value mono">
            {environment?.platform === "web" ? "浏览器预览" : "Windows x64"}
          </div>
        </label>
        {/* 字号缩放：只影响 font-size，不改布局尺寸 */}
        <label>
          前端字号
          <div className="font-scale-control">
            <input
              type="range"
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={FONT_SCALE_STEP}
              value={fontScale}
              onChange={(event) => onFontScaleChange(Number(event.target.value))}
              aria-label="前端字号缩放比例"
            />
            <span className="setting-value mono">{Math.round(fontScale * 100)}%</span>
            <button
              className="bare-button"
              onClick={() => onFontScaleChange(FONT_SCALE_DEFAULT)}
              disabled={fontScale === FONT_SCALE_DEFAULT}
            >
              重置
            </button>
          </div>
        </label>
        {installProgress && (
          <div
            className={`setup-progress ${installProgress.phase === "failed" ? "failed" : installProgress.phase === "done" ? "done" : ""}`}
          >
            <div className="setup-progress-bar">
              <div
                className="setup-progress-fill"
                style={{ width: `${installProgress.percent}%` }}
              />
            </div>
            <span className="setup-progress-text">{installProgress.message}</span>
          </div>
        )}
      </div>
    </section>
  );
}
