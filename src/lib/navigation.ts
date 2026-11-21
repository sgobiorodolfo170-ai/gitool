import {
  Archive,
  Clock3,
  Cloud,
  FolderGit2,
  LayoutDashboard,
  ListTodo,
  Settings2,
} from "lucide-react";
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
        { id: "tasks", label: "任务中心", icon: ListTodo },
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
  // 与侧栏一致：早期版本写成「设置与记录」，容易和设置页混淆
  logs: "操作记录",
  settings: "设置",
};

/**
 * 页面描述（阶段 D2）：页面头的副标题在这里集中维护。
 *
 * 为什么集中：7 个页面头的 eyebrow/标题/描述曾经各写各的，
 * 「操作记录」页的描述甚至与侧栏命名不一致。把静态文案收进导航元数据，
 * 页面只引用 key，文案调整不必再全仓搜索。
 */
const VIEW_DESCRIPTIONS: Record<AppView, string> = {
  overview: "这里是你今天的开发现场。",
  projects: "集中查看本地项目、远程关联与工作区状态。",
  remotes: "从 GitHub、Gitee 和 GitLab 读取当前账号可访问的仓库。",
  tasks: "配置构建、运行和打包命令，一键执行并查看实时日志。",
  backups: "将项目打包为 ZIP（含 .git），可在新目录完整恢复。",
  logs: "查看应用执行过的 Git 操作、任务与结果。",
  settings: "配置 Git 路径、默认目录与应用环境信息。",
};

export function workspaceLabel(workspace: AppView): string {
  return VIEW_LABELS[workspace];
}

export function workspaceDescription(workspace: AppView): string {
  return VIEW_DESCRIPTIONS[workspace];
}
