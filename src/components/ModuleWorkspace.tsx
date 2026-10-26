import {
  Archive,
  ArrowUpRight,
  Check,
  Cloud,
  ListTodo,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { AppView } from "../types";

export function ModuleWorkspace({
  workspace,
  onImport,
}: {
  workspace: Exclude<AppView, "overview" | "projects">;
  onImport: () => void;
}) {
  const content: Record<
    Exclude<AppView, "overview" | "projects">,
    { eyebrow: string; title: string; description: string; icon: React.ReactNode; items: string[] }
  > = {
    remotes: {
      eyebrow: "REMOTE HUB",
      title: "远程仓库",
      description: "连接 GitHub、Gitee 与 GitLab，统一浏览远程项目。",
      icon: <Cloud size={21} />,
      items: ["GitHub · 6 个仓库", "Gitee · 4 个仓库", "GitLab · 2 个仓库"],
    },
    tasks: {
      eyebrow: "TASK RUNNER",
      title: "任务中心",
      description: "把构建、运行和打包命令放到同一个可追踪的入口。",
      icon: <ListTodo size={21} />,
      items: [
        "gitool · npm run dev · 运行中",
        "atlas-api · cargo test · 22 分钟前",
        "northstar-web · pnpm build · 昨天",
      ],
    },
    backups: {
      eyebrow: "RECOVERY",
      title: "备份中心",
      description: "完整保留 .git 历史，把项目恢复到一个新的工作目录。",
      icon: <Archive size={21} />,
      items: ["本周已备份 · 3 个项目", "最近归档 · gitool_2026-09-19.zip", "备份策略 · 手动触发"],
    },
    logs: {
      eyebrow: "SYSTEM",
      title: "设置与记录",
      description: "查看应用运行环境、操作日志和本地数据位置。",
      icon: <Settings2 size={21} />,
      items: ["Git · 2.46.0", "Windows · x64", "数据目录 · %APPDATA%\\Gitool"],
    },
    settings: {
      eyebrow: "SYSTEM",
      title: "设置",
      description: "配置 Git 路径、默认目录与应用环境信息。",
      icon: <Settings2 size={21} />,
      items: ["Git 路径 · 系统 PATH", "默认项目目录 · 未设置", "默认备份目录 · 未设置"],
    },
  };
  const current = content[workspace];
  return (
    <div className="module-page">
      <div className="module-hero">
        <div className="module-icon">{current.icon}</div>
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            {current.eyebrow}
          </div>
          <h1>{current.title}</h1>
          <p>{current.description}</p>
        </div>
        <button className="button primary" onClick={onImport}>
          <Plus size={16} />
          添加内容
        </button>
      </div>
      <section className="module-list">
        <div className="panel-heading">
          <div>
            <h2>当前状态</h2>
            <span>本地工作区快照</span>
          </div>
          <button className="bare-button">
            <RefreshCw size={16} />
          </button>
        </div>
        {current.items.map((item, index) => (
          <div className="module-list-row" key={item}>
            <span className={`module-list-index ${index === 0 ? "active" : ""}`}>
              {index === 0 ? <Check size={14} /> : index + 1}
            </span>
            <span>{item}</span>
            <ArrowUpRight size={15} />
          </div>
        ))}
      </section>
    </div>
  );
}
