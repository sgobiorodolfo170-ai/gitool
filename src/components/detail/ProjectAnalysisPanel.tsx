import { FileCode2 } from "lucide-react";
import type { ProjectAnalysis } from "../../types";
import { formatBytes } from "../../lib/format";
import { AnalysisMetric } from "../common";

/** 结构分析结果面板：文件/目录/体积指标、语言构成、项目类型与关键文件。原 ProjectDetail 内嵌组件原样迁移。 */
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
