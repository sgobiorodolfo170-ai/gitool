import { useEffect, useState } from "react";
import { providerLabels } from "../lib/meta";
import { providerIcons } from "./providerIcons";
import { statusMeta } from "../lib/meta";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Check,
  Clock3,
  Cloud,
  Code2,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  LayoutDashboard,
  Maximize2,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  TerminalSquare,
  X,
} from "lucide-react";
import type { GitOperation, Project, ProjectAnalysis } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { renderMarkdownSafe } from "../lib/markdown";
import { formatBytes } from "../lib/format";
import { AnalysisMetric, DetailStat, GitOperationButton } from "./common";
import { GitActionsPanel } from "./GitActionsPanel";
import { ReadmeOverlay } from "./ReadmeOverlay";
import type { ReadmeState } from "../hooks/useReadme";
import { useReadme } from "../hooks/useReadme";

type DetailTabId = "overview" | "readme" | "git";

/** 详情卡片的分区。新增分区时只需在这里加一项，并在下面加对应的面板。 */
const DETAIL_TABS: { id: DetailTabId; label: string; icon: typeof Github }[] = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "readme", label: "README", icon: BookOpen },
  { id: "git", label: "Git 操作", icon: TerminalSquare },
];

export function ProjectDetail({
  project,
  onToggleFavorite,
  onUpdateProject,
  onMoveProject,
  onRunGitOperation,
  activeOperation,
  externalBusy,
  operationOutput,
  onAnalyzeProject,
  isAnalyzing,
  analysis,
}: {
  project: Project;
  onToggleFavorite: () => void;
  onUpdateProject: (patch: Partial<Project>) => void;
  onMoveProject: () => void;
  onRunGitOperation: (operation: GitOperation) => void | Promise<void>;
  activeOperation: GitOperation | null;
  /** Git 操作全局互斥（单个/批量操作执行中）：透传给 GitActionsPanel 禁用其按钮。 */
  externalBusy: boolean;
  operationOutput: string | null;
  onAnalyzeProject: () => void | Promise<void>;
  isAnalyzing: boolean;
  analysis: ProjectAnalysis | null;
}) {
  const status = statusMeta[project.status];
  const ProviderIcon = providerIcons[project.provider];
  const bridge = getDesktopBridge();
  const [actionMessage, setActionMessage] = useState("");
  const [tab, setTab] = useState<DetailTabId>("overview");
  // 已访问过的分区：首次访问才挂载，之后保持挂载，避免 README 反复读盘
  const [visitedTabs, setVisitedTabs] = useState<Set<DetailTabId>>(() => new Set(["overview"]));

  const readme = useReadme(project.path);
  const [readmeExpanded, setReadmeExpanded] = useState(false);

  // 换项目时收起全屏阅读层，避免读到上一个项目的文档
  useEffect(() => {
    setReadmeExpanded(false);
  }, [project.id]);

  // 换项目时回到概览：否则从 A 的 Git 页切到 B 会直接落在 B 的 Git 页
  useEffect(() => {
    setTab("overview");
    setVisitedTabs(new Set(["overview"]));
  }, [project.id]);

  const selectTab = (id: DetailTabId) => {
    setTab(id);
    setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

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
      .catch((error) => setActionMessage(error instanceof Error ? error.message : "打开终端失败"));
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
      .catch((error) => setActionMessage(error instanceof Error ? error.message : "打开失败"));
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

  if (project.path === "") {
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
          <Code2 size={25} />
        </div>
        <div>
          <h2>{project.name}</h2>
          <p>{project.path}</p>
        </div>
        <AliasEditor
          alias={project.alias}
          onSave={(alias) =>
            onUpdateProject({ alias: alias.trim().length > 0 ? alias.trim() : undefined })
          }
        />
      </div>
      <div className="detail-status-row">
        <span className={`status-pill ${status.className}`}>
          <span className="status-dot" />
          {status.label}
        </span>
        <span className="detail-updated">
          <Clock3 size={13} />
          {project.updatedAt}
        </span>
      </div>
      <nav className="detail-tabs" aria-label="项目详情分区">
        {DETAIL_TABS.map((item) => (
          <button
            key={item.id}
            aria-pressed={tab === item.id}
            className={`detail-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => selectTab(item.id)}
          >
            <item.icon size={14} />
            {item.label}
            {item.id === "git" && operationOutput && <span className="detail-tab-dot" />}
          </button>
        ))}
      </nav>

      {/* 面板首次访问后才挂载，之后保持挂载：README 不会每次切回都重新读盘，
          Git 操作的历史输出也不会因为切页而丢失。 */}
      <div className="detail-tab-panel" hidden={tab !== "overview"}>
        {visitedTabs.has("overview") && (
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
                <DetailStat
                  icon={<GitBranch size={14} />}
                  label="当前分支"
                  value={project.branch}
                />
                <DetailStat
                  icon={<GitCommitHorizontal size={14} />}
                  label="最近提交"
                  value={project.commit}
                />
                <DetailStat
                  icon={<FileCode2 size={14} />}
                  label="文件数量"
                  value={`${project.files}`}
                />
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
        )}
      </div>

      <div className="detail-tab-panel" hidden={tab !== "readme"}>
        {visitedTabs.has("readme") && (
          <ReadmeSection readme={readme} onExpand={() => setReadmeExpanded(true)} />
        )}
      </div>

      <div className="detail-tab-panel" hidden={tab !== "git"}>
        {visitedTabs.has("git") && (
          <>
            <div className="detail-actions">
              <button
                className="button primary wide"
                onClick={() => onRunGitOperation("pull")}
                disabled={activeOperation !== null}
              >
                <ArrowDownToLine size={15} />
                {activeOperation === "pull" ? "拉取中..." : "拉取更新"}
              </button>
              <button
                className="button secondary square"
                onClick={() => onRunGitOperation("sync")}
                disabled={activeOperation !== null}
                aria-label="同步项目"
              >
                <RefreshCw size={17} className={activeOperation === "sync" ? "spin" : ""} />
              </button>
            </div>

            <div className="git-operation-grid">
              <GitOperationButton
                operation="fetch"
                activeOperation={activeOperation}
                onRun={onRunGitOperation}
                icon={<Cloud size={14} />}
              />
              <GitOperationButton
                operation="push"
                activeOperation={activeOperation}
                onRun={onRunGitOperation}
                icon={<ArrowUpRight size={14} />}
              />
              <GitOperationButton
                operation="sync"
                activeOperation={activeOperation}
                onRun={onRunGitOperation}
                icon={<RefreshCw size={14} />}
              />
            </div>

            {operationOutput && (
              <div className="operation-output">
                <div>
                  <span>最近一次 Git 输出</span>
                  <button
                    className="bare-button"
                    onClick={() => onRunGitOperation("fetch")}
                    aria-label="重新获取远程更新"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <pre>{operationOutput}</pre>
              </div>
            )}

            <GitActionsPanel projectPath={project.path} externalBusy={externalBusy} />
          </>
        )}
      </div>

      {readmeExpanded && (
        <ReadmeOverlay
          readme={readme}
          projectName={project.alias || project.name}
          onClose={() => setReadmeExpanded(false)}
        />
      )}
    </aside>
  );
}

export function AliasEditor({
  alias,
  onSave,
}: {
  alias?: string;
  onSave: (alias: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(alias ?? "");
  if (!editing) {
    return (
      <button
        className="alias-badge"
        onClick={() => {
          setValue(alias ?? "");
          setEditing(true);
        }}
        title="编辑别名"
      >
        {alias ? (
          <>
            <PenLine size={11} />
            {alias}
          </>
        ) : (
          <span className="alias-empty">别名</span>
        )}
      </button>
    );
  }
  return (
    <div className="alias-edit">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSave(value);
            setEditing(false);
          }
          if (event.key === "Escape") {
            setEditing(false);
          }
        }}
        placeholder="输入别名"
      />
      <button
        className="bare-button"
        onClick={() => {
          onSave(value);
          setEditing(false);
        }}
      >
        <Check size={14} />
      </button>
    </div>
  );
}

export function TagEditor({ tags, onAdd }: { tags: string[]; onAdd: (tag: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const submit = () => {
    const tag = value.trim();
    if (tag && !tags.includes(tag)) {
      onAdd(tag);
    }
    setValue("");
    setEditing(false);
  };
  if (!editing) {
    return (
      <button
        className="add-tag"
        aria-label="添加标签"
        title="添加标签"
        onClick={() => setEditing(true)}
      >
        <Plus size={13} />
      </button>
    );
  }
  return (
    <div className="tag-edit">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") setEditing(false);
        }}
        placeholder="新标签"
      />
      <button className="bare-button" onClick={submit}>
        <Check size={13} />
      </button>
    </div>
  );
}

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

export function ProjectAnalysisPanel({ analysis }: { analysis: ProjectAnalysis }) {
  const languageTotal = analysis.languages.reduce((total, language) => total + language.bytes, 0);
  return (
    <div className="analysis-panel">
      <div className="analysis-heading">
        <div>
          <span>结构分析</span>
          <small>本地扫描结果</small>
        </div>
        <FileCode2 size={15} />
      </div>
      <div className="analysis-metrics">
        <AnalysisMetric label="文件" value={analysis.files.toString()} />
        <AnalysisMetric label="目录" value={analysis.directories.toString()} />
        <AnalysisMetric label="大小" value={formatBytes(analysis.total_bytes)} />
      </div>
      {analysis.languages.length > 0 && (
        <div className="language-list">
          <div className="analysis-label">语言构成</div>
          {analysis.languages.slice(0, 4).map((language) => (
            <div className="language-row" key={language.name}>
              <span className="language-name">
                <i style={{ background: language.color }} />
                {language.name}
              </span>
              <span>
                {languageTotal ? `${Math.round((language.bytes / languageTotal) * 100)}%` : "0%"}
              </span>
            </div>
          ))}
        </div>
      )}
      {analysis.project_types.length > 0 && (
        <div className="analysis-inline">
          <span>项目类型</span>
          <strong>{analysis.project_types.join(" · ")}</strong>
        </div>
      )}
      {analysis.key_files.length > 0 && (
        <div className="analysis-files">
          <div className="analysis-label">关键文件</div>
          {analysis.key_files.slice(0, 5).map((file) => (
            <code key={file}>{file}</code>
          ))}
        </div>
      )}
    </div>
  );
}
