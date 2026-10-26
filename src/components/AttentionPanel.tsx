import { CircleAlert } from "lucide-react";
import { statusMeta } from "../lib/meta";
import type { Project } from "../types";


export function AttentionPanel({ projects, selectedId, onSelect }: { projects: Project[]; selectedId?: string; onSelect: (id: string) => void }) {
  const attention = projects.filter((project) => project.status !== "clean" || project.tags.includes("watching"));
  if (attention.length === 0) {
    return null;
  }
  return <section className="attention-panel">
    <div className="panel-heading"><div><h2>需要关注</h2><span>未提交 / 领先 / 落后 / 冲突 项目</span></div><span className="secure-label"><CircleAlert size={13} />{attention.length} 项</span></div>
    <div className="attention-list">
      {attention.map((project) => {
        const status = statusMeta[project.status];
        return <button className={`attention-row ${project.id === selectedId ? "selected" : ""}`} key={project.id} onClick={() => onSelect(project.id)}>
          <span className={`status-pill ${status.className}`}><span className="status-dot" />{status.label}</span>
          <strong>{project.name}</strong>
          <span className="attention-path">{project.path}</span>
          <span className="attention-sync">{project.syncLabel}</span>
        </button>;
      })}
    </div>
  </section>;
}
