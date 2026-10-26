import { Archive, Clock3, Cloud, FolderGit2, LayoutDashboard, ListTodo, Settings2 } from "lucide-react";
import type { AppView } from "../../shared/types";

export type NavItem = {
  id: AppView;
  label: string;
  icon: typeof LayoutDashboard;
  count?: string;
};

/** 侧栏导航分组。计数为 0 时不显示徽标，避免空态下出现一排「0」。 */
export function buildNavGroups(counts: {
  projects: number;
  remotes: number;
  tasks: number;
}): { label: string; items: NavItem[] }[] {
  return [
    {
      label: "工作区",
      items: [
        { id: "overview", label: "总览", icon: LayoutDashboard },
        {
          id: "projects",
          label: "我的项目",
          icon: FolderGit2,
          count: counts.projects > 0 ? String(counts.projects) : undefined,
        },
        {
          id: "remotes",
          label: "远程仓库",
          icon: Cloud,
          count: counts.remotes > 0 ? String(counts.remotes) : undefined,
        },
      ],
    },
    {
      label: "工具",
      items: [
        {
          id: "tasks",
          label: "任务中心",
          icon: ListTodo,
          count: counts.tasks > 0 ? String(counts.tasks) : undefined,
        },
        { id: "backups", label: "备份中心", icon: Archive },
        { id: "logs", label: "操作记录", icon: Clock3 },
        { id: "settings", label: "设置", icon: Settings2 },
      ],
    },
  ];
}

const VIEW_LABELS: Record<AppView, string> = {
  overview: "总览",
  projects: "我的项目",
  remotes: "远程仓库",
  tasks: "任务中心",
  backups: "备份中心",
  logs: "设置与记录",
  settings: "设置",
};

export function workspaceLabel(workspace: AppView): string {
  return VIEW_LABELS[workspace];
}
