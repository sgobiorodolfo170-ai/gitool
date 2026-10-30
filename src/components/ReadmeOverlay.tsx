import { useEffect } from "react";
import { X } from "lucide-react";
import { renderMarkdownSafe } from "../lib/markdown";
import type { ReadmeState } from "../hooks/useReadme";

/**
 * README 全屏阅读层。
 *
 * 详情面板的宽度受分栏限制（30%–75%），长文档在窄栏里读起来一直在折行。
 * 这里给一个近全宽的阅读视图：正文限宽到舒适行宽、字号比卡片内大一号，
 * ESC 或点击遮罩关闭。
 */
export function ReadmeOverlay({
  readme,
  projectName,
  onClose,
}: {
  readme: ReadmeState;
  projectName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (readme.status !== "ready") return null;

  return (
    <div
      className="readme-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${projectName} 的 README`}
      onClick={onClose}
    >
      <div className="readme-overlay-panel" onClick={(event) => event.stopPropagation()}>
        <header className="readme-overlay-head">
          <div>
            <span>{projectName}</span>
            <small>{readme.fileName}</small>
          </div>
          <button
            className="bare-button"
            onClick={onClose}
            aria-label="关闭阅读视图"
            title="关闭（Esc）"
          >
            <X size={17} />
          </button>
        </header>
        <div
          className="readme-overlay-body markdown-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(readme.content) }}
        />
      </div>
    </div>
  );
}
