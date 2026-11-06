import { useEffect, useState } from "react";
import { providerLabels, statusMeta } from "../lib/meta";
import { providerIcons } from "./providerIcons";
import {
  BookOpen,
  Clock3,
  Code2,
  Github,
  LayoutDashboard,
  Star,
  TerminalSquare,
} from "lucide-react";
import type { GitOperation, Project, ProjectAnalysis } from "../types";
import { useReadme } from "../hooks/useReadme";
import { ReadmeOverlay } from "./ReadmeOverlay";
import { AliasEditor } from "./detail/AliasEditor";
import { ReadmeSection } from "./detail/ReadmeSection";
import { UnclonedProjectPanel } from "./detail/UnclonedProjectPanel";
import { OverviewPanel } from "./detail/OverviewPanel";
import { GitTabPanel } from "./detail/GitTabPanel";

type DetailTabId = "overview" | "readme" | "git";

/** 详情卡片的分区。新增分区时只需在这里加一项，并在下面加对应的面板。 */
const DETAIL_TABS: { id: DetailTabId; label: string; icon: typeof Github }[] = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "readme", label: "README", icon: BookOpen },
  { id: "git", label: "Git 操作", icon: TerminalSquare },
];

/**
 * 项目详情卡片（概览 / README / Git 操作三个选项卡）。
 *
 * 为什么这么拆：本组件只保留 tab 编排（DETAIL_TABS 声明 + visitedTabs 惰性挂载）、
 * 头部信息与 README 阅读层开关；未克隆视图整块抽为 UnclonedProjectPanel，
 * 概览 tab 的快捷动作/摘要生成与 actionMessage 下沉到 OverviewPanel，
 * Git tab 的快捷操作区下沉到 GitTabPanel，内嵌的 AliasEditor/TagEditor/
 * ReadmeSection/ProjectAnalysisPanel 拆至 detail/ 独立文件。
 */
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

  if (project.path === "") {
    return <UnclonedProjectPanel project={project} onToggleFavorite={onToggleFavorite} />;
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
          <OverviewPanel
            project={project}
            analysis={analysis}
            onUpdateProject={onUpdateProject}
            onAnalyzeProject={onAnalyzeProject}
            isAnalyzing={isAnalyzing}
            onMoveProject={onMoveProject}
          />
        )}
      </div>

      <div className="detail-tab-panel" hidden={tab !== "readme"}>
        {visitedTabs.has("readme") && (
          <ReadmeSection readme={readme} onExpand={() => setReadmeExpanded(true)} />
        )}
      </div>

      <div className="detail-tab-panel" hidden={tab !== "git"}>
        {visitedTabs.has("git") && (
          <GitTabPanel
            projectPath={project.path}
            onRunGitOperation={onRunGitOperation}
            activeOperation={activeOperation}
            externalBusy={externalBusy}
            operationOutput={operationOutput}
          />
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
