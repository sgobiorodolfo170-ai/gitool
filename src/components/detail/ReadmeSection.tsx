import { Maximize2 } from "lucide-react";
import type { ReadmeState } from "../../hooks/useReadme";
import { renderMarkdownSafe } from "../../lib/markdown";

/** README 选项卡正文：加载中 / 缺失 / 渲染三态。原 ProjectDetail 内嵌组件原样迁移。 */
export function ReadmeSection({ readme, onExpand }: { readme: ReadmeState; onExpand: () => void }) {
  if (readme.status === "loading") {
    return (
      <div className="detail-section readme-section">
        <div className="detail-section-heading">
          <span>README</span>
          <small>加载中...</small>
        </div>
      </div>
    );
  }
  // README 独占一个选项卡，找不到时要给明确提示，
  // 否则用户切过去只看到一片空白，会以为是加载失败。
  if (readme.status === "missing") {
    return (
      <div className="detail-section readme-section">
        <div className="detail-section-heading">
          <span>README</span>
        </div>
        <p className="detail-empty-hint">该项目没有 README 文件。</p>
      </div>
    );
  }
  return (
    <div className="detail-section readme-section">
      <div className="detail-section-heading">
        <span>README</span>
        <div className="readme-heading-actions">
          <small>{readme.fileName}</small>
          <button className="bare-button" onClick={onExpand} aria-label="放大阅读" title="放大阅读">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div
        className="readme-body markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(readme.content) }}
      />
    </div>
  );
}
