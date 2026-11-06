import { useState } from "react";
import {
  ArrowUpRight,
  Blocks,
  Code2,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Sparkles,
  Tag,
  TerminalSquare,
  X,
} from "lucide-react";
import type { Project, ProjectAnalysis } from "../../types";
import { formatBytes } from "../../lib/format";
import { getDesktopBridge } from "../../lib/bridge";
import { DetailStat } from "../common";
import { TagEditor } from "./TagEditor";
import { ProjectAnalysisPanel } from "./ProjectAnalysisPanel";

/**
 * 「概览」选项卡：摘要/标签、项目统计、快捷入口与结构分析。
 * actionMessage 与六个快捷动作（终端/编辑器/复制路径/资源管理器/分析/摘要）
 * 只被本 tab 消费，随面板下沉；generateSummary 的 AI→本地两级回退逻辑
 * 是本 tab 的业务核心，一并迁入。project 与 analysis 只读，写操作经
 * onUpdateProject / onAnalyzeProject / onMoveProject 回调上抛。
 */
export function OverviewPanel({
  project,
  analysis,
  onUpdateProject,
  onAnalyzeProject,
  isAnalyzing,
  onMoveProject,
}: {
  project: Project;
  analysis: ProjectAnalysis | null;
  onUpdateProject: (patch: Partial<Project>) => void;
  onAnalyzeProject: () => void | Promise<void>;
  isAnalyzing: boolean;
  onMoveProject: () => void;
}) {
  const bridge = getDesktopBridge();
  const [actionMessage, setActionMessage] = useState("");

  const runOpen = (editor: "vscode" | "cursor", newWindow: boolean) => {
    if (!bridge) {
      setActionMessage("浏览器预览不支持打开编辑器");
      return;
    }
    void bridge
      .openInEditor({ path: project.path, editor, newWindow })
      .then(() => setActionMessage(`已请求在 ${editor === "vscode" ? "VS Code" : "Cursor"} 中打开`))
      .catch((error) =>
        setActionMessage(error instanceof Error ? error.message : "打开编辑器失败"),
      );
  };

  const openTerminal = () => {
    if (!bridge) {
      setActionMessage("浏览器预览不支持打开终端");
      return;
    }
    void bridge
      .openInTerminal(project.path)
      .then(() => setActionMessage("已在项目目录打开终端"))
      .catch((error) =>
        setActionMessage(error instanceof Error ? error.message : "打开终端失败"),
      );
  };

  const copyPath = async () => {
    await navigator.clipboard.writeText(project.path);
    setActionMessage("项目路径已复制到剪贴板");
  };

  const openFolder = () => {
    if (!bridge) {
      setActionMessage("浏览器预览不支持打开资源管理器");
      return;
    }
    void bridge
      .openPath(project.path)
      .then(() => setActionMessage("已在资源管理器中打开"))
      .catch((error) =>
        setActionMessage(error instanceof Error ? error.message : "打开失败"),
      );
  };

  const generateSummary = async () => {
    if (!bridge) {
      setActionMessage("浏览器预览无法生成摘要");
      return;
    }
    setActionMessage("正在生成摘要...");
    try {
      const [readme, history, disk, settings] = await Promise.all([
        bridge.readProjectReadme(project.path),
        bridge.listCommitHistory(project.path).catch(() => []),
        bridge.getDiskSize(project.path).catch(() => 0),
        bridge.loadSettings().catch(() => null),
      ]);
      const readmeSummary =
        readme.found && readme.content.trim() ? readme.content.trim().slice(0, 400) : "";
      const languageLine =
        analysis && analysis.languages.length > 0
          ? `主要语言：${analysis.languages
              .slice(0, 3)
              .map((item) => item.name)
              .join("、")}`
          : "";
      const historyLine =
        history.length > 0
          ? `最近提交：${history
              .slice(0, 5)
              .map((entry) => entry.subject)
              .join("；")}`
          : "";
      const projectTypes =
        analysis && analysis.project_types.length > 0
          ? `项目类型：${analysis.project_types.join("、")}`
          : "";

      const context = [
        readmeSummary ? `README 首段：${readmeSummary}` : "",
        languageLine,
        projectTypes,
        historyLine,
        `共 ${analysis?.files ?? 0} 个文件、${analysis?.directories ?? 0} 个目录，磁盘约 ${formatBytes(disk)}。`,
      ]
        .filter(Boolean)
        .join("\n");

      const aiConfigured = Boolean(settings?.aiApiKeyConfigured);
      if (aiConfigured) {
        setActionMessage("正在调用 AI 服务生成摘要...");
        const aiResult = await bridge.generateAiSummary({ projectName: project.name, context });
        if (aiResult.success) {
          onUpdateProject({ summary: aiResult.summary });
          setActionMessage("AI 摘要已生成并保存");
          return;
        }
        setActionMessage(`${aiResult.error ?? "AI 摘要失败"}，已回退到本地摘要`);
      }

      const fallbackParts = [
        readmeSummary
          ? `「${readmeSummary
              .split(/\r?\n/)[0]
              .replace(/^#+\s*/, "")
              .slice(0, 120)}」`
          : `基于 ${project.name} 的项目摘要。`,
        languageLine,
        historyLine,
        `共 ${analysis?.files ?? 0} 个文件、${analysis?.directories ?? 0} 个目录。`,
      ].filter(Boolean);
      onUpdateProject({ summary: fallbackParts.join("。") + "。" });
      setActionMessage(
        aiConfigured
          ? "已保存本地智能摘要（AI 服务不可用）"
          : "本地智能摘要已生成（未发送到任何外部服务）",
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "生成摘要失败");
    }
  };

  return (
    <>
      <p className="detail-summary">{project.summary}</p>
      <div className="detail-tags">
        {project.tags.map((tag) => (
          <span className="tag" key={tag}>
            <Tag size={11} />
            {tag}
            <button
              className="tag-remove"
              aria-label={`删除标签 ${tag}`}
              onClick={() =>
                onUpdateProject({ tags: project.tags.filter((item) => item !== tag) })
              }
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <TagEditor
          tags={project.tags}
          onAdd={(tag) => onUpdateProject({ tags: [...project.tags, tag] })}
        />
      </div>

      <div className="detail-section">
        <div className="detail-section-heading">
          <span>项目概览</span>
          <button
            className="bare-button"
            onClick={openFolder}
            aria-label="在资源管理器中打开"
            title="在资源管理器中打开"
          >
            <ExternalLink size={14} />
          </button>
        </div>
        <div className="detail-stats">
          <DetailStat icon={<GitBranch size={14} />} label="当前分支" value={project.branch} />
          <DetailStat
            icon={<GitCommitHorizontal size={14} />}
            label="最近提交"
            value={project.commit}
          />
          <DetailStat icon={<FileCode2 size={14} />} label="文件数量" value={`${project.files}`} />
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-heading">
          <span>快捷入口</span>
        </div>
        <div className="quick-links">
          <button onClick={openTerminal}>
            <TerminalSquare size={15} />
            打开终端
            <ArrowUpRight size={13} />
          </button>
          <button onClick={() => runOpen("vscode", false)}>
            <Code2 size={15} />
            VS Code
            <ArrowUpRight size={13} />
          </button>
          <button onClick={() => runOpen("cursor", false)}>
            <Blocks size={15} />
            Cursor
            <ArrowUpRight size={13} />
          </button>
          <button onClick={copyPath}>
            <FileCode2 size={15} />
            复制路径
            <ArrowUpRight size={13} />
          </button>
          <button onClick={onAnalyzeProject} disabled={isAnalyzing}>
            <Blocks size={15} />
            {isAnalyzing ? "分析中..." : "结构分析"}
            <ArrowUpRight size={13} />
          </button>
          <button onClick={generateSummary}>
            <Sparkles size={15} />
            生成摘要
            <ArrowUpRight size={13} />
          </button>
          <button onClick={onMoveProject}>
            <FolderGit2 size={15} />
            移动项目
            <ArrowUpRight size={13} />
          </button>
        </div>
        {actionMessage && (
          <div className="git-output">
            <pre>{actionMessage}</pre>
          </div>
        )}
      </div>

      {analysis && <ProjectAnalysisPanel analysis={analysis} />}
    </>
  );
}
