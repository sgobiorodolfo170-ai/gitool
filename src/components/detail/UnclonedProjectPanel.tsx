import { ExternalLink, Github, Star } from "lucide-react";
import type { Project } from "../../types";
import { providerLabels } from "../../lib/meta";
import { providerIcons } from "../providerIcons";
import { getDesktopBridge } from "../../lib/bridge";

/**
 * 未克隆项目的详情占位视图（project.path 为空时的整体 early-return 分支）：
 * 只有收藏切换与打开仓库网页两个动作，与已克隆详情无共享状态，
 * 整块抽出让 ProjectDetail 主体只保留已克隆视图。
 * 头部（provider + 收藏按钮）与已克隆视图的标记重复是原实现如此，保持不动。
 */
export function UnclonedProjectPanel({
  project,
  onToggleFavorite,
}: {
  project: Project;
  onToggleFavorite: () => void;
}) {
  const bridge = getDesktopBridge();
  const ProviderIcon = providerIcons[project.provider];
  return (
    <aside className="detail-panel">
      <div className="detail-top">
        <div className="detail-provider">
          <ProviderIcon size={16} />
          {providerLabels[project.provider]}
        </div>
        <button
          className={`favorite-button ${project.favorite ? "active" : ""}`}
          onClick={onToggleFavorite}
          aria-label={project.favorite ? "取消收藏" : "收藏项目"}
        >
          <Star size={17} fill={project.favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="detail-title">
        <div className="large-project-icon" style={{ color: project.languageColor }}>
          <Github size={25} />
        </div>
        <div>
          <h2>{project.name}</h2>
          <p>尚未克隆到本地</p>
        </div>
      </div>
      <div className="detail-status-row">
        <span className="status-pill status-behind">
          <span className="status-dot" />
          未克隆
        </span>
      </div>
      <p className="detail-summary">
        {project.summary || "远程收藏项目。可打开仓库网页查看，或先克隆到本地。"}
      </p>
      <div className="detail-actions">
        {project.webUrl && (
          <button
            className="button secondary compact-button"
            onClick={() => {
              if (bridge) void bridge.openExternal(project.webUrl!);
            }}
          >
            <ExternalLink size={14} />
            打开仓库网页
          </button>
        )}
        <button className="button secondary compact-button" onClick={onToggleFavorite}>
          <Star size={14} fill="none" />
          取消收藏
        </button>
      </div>
    </aside>
  );
}
