import type { CommitEntry, Project, ProjectAnalysis } from "../types";
import { formatBytes } from "./format";

/**
 * AI 摘要上下文构建器（P-17 / 架构评审 L-10）：从项目数据生成 LLM 上下文的纯函数。
 *
 * why 抽成纯函数：
 * 1. 可单测：不依赖 React 生命周期，可独立测试各种输入组合
 * 2. 可复用：批量生成摘要、其他 UI 场景都能调用
 * 3. 可配置：magic number 集中管理，便于调参
 */

// Magic numbers 集中管理（原 OverviewPanel.tsx:106,117,153 硬编码，违反 AGENTS.md 第七节）
const README_MAX_CHARS = 400;
const LANGUAGE_MAX_COUNT = 3;
const HISTORY_MAX_COMMITS = 5;
const FALLBACK_SUMMARY_MAX_CHARS = 120;

export interface SummaryContext {
  /** 用于 AI 调用的完整上下文。 */
  forAi: string;
  /** 用于本地回退的摘要片段。 */
  fallbackParts: string[];
}

export interface BuildSummaryContextInput {
  project: Project;
  readme: { found: boolean; content: string } | null;
  history: CommitEntry[];
  /** 磁盘字节数（bridge.getDiskSize 返回 number）。 */
  disk: number;
  analysis: ProjectAnalysis | null;
}

/**
 * 构建 AI 摘要所需的上下文。
 *
 * 输出格式：
 * ```
 * README 首段：...
 * 主要语言：...
 * 项目类型：...
 * 最近提交：...
 * 共 X 个文件、Y 个目录，磁盘约 Z。
 * ```
 */
export function buildSummaryContext(input: BuildSummaryContextInput): SummaryContext {
  const { project, readme, history, disk, analysis } = input;

  // README 首段（原 OverviewPanel.tsx:101-102）
  const readmeSummary =
    readme?.found && readme.content.trim()
      ? readme.content.trim().slice(0, README_MAX_CHARS)
      : "";

  // 主要语言（原 OverviewPanel.tsx:103-109）
  const languageLine =
    analysis && analysis.languages.length > 0
      ? `主要语言：${analysis.languages
          .slice(0, LANGUAGE_MAX_COUNT)
          .map((item) => item.name)
          .join("、")}`
      : "";

  // 最近提交（原 OverviewPanel.tsx:110-116）
  const historyLine =
    history.length > 0
      ? `最近提交：${history
          .slice(0, HISTORY_MAX_COMMITS)
          .map((entry) => entry.subject)
          .join("；")}`
      : "";

  // 项目类型（原 OverviewPanel.tsx:117-120）
  const projectTypes =
    analysis && analysis.project_types.length > 0
      ? `项目类型：${analysis.project_types.join("、")}`
      : "";

  // 文件统计（原 OverviewPanel.tsx:127）
  const statsLine = `共 ${analysis?.files ?? 0} 个文件、${analysis?.directories ?? 0} 个目录，磁盘约 ${formatBytes(disk)}。`;

  // AI 上下文（原 OverviewPanel.tsx:122-130）
  const forAi = [
    readmeSummary ? `README 首段：${readmeSummary}` : "",
    languageLine,
    projectTypes,
    historyLine,
    statsLine,
  ]
    .filter(Boolean)
    .join("\n");

  // 本地回退摘要片段（原 OverviewPanel.tsx:144-154）
  const fallbackParts = [
    readmeSummary
      ? `「${readmeSummary
          .split(/\r?\n/)[0]
          .replace(/^#+\s*/, "")
          .slice(0, FALLBACK_SUMMARY_MAX_CHARS)}」`
      : `基于 ${project.name} 的项目摘要。`,
    languageLine,
    historyLine,
    statsLine,
  ].filter(Boolean);

  return { forAi, fallbackParts };
}

/**
 * 生成本地回退摘要。
 *
 * 当 AI 服务不可用时，用此函数生成一个基于项目元数据的摘要。
 */
export function buildFallbackSummary(fallbackParts: string[]): string {
  return fallbackParts.join("。") + "。";
}
