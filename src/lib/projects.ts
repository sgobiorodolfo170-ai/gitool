import type { Project } from "../types";

export const seedProjects: Project[] = [
  {
    id: "gitool",
    name: "gitool",
    path: "D:/Projects/gitool",
    provider: "local",
    branch: "main",
    status: "clean",
    language: "TypeScript",
    languageColor: "#3178c6",
    summary: "Windows Git 仓库管理工具，聚合远程仓库、本地项目与开发任务。",
    updatedAt: "今天 14:32",
    commit: "a82e4d1",
    favorite: true,
    tags: ["active", "desktop"],
    files: 128,
    syncLabel: "已同步",
    diskSizeBytes: 184_500_000,
  },
  {
    id: "atlas-api",
    name: "atlas-api",
    path: "D:/Projects/atlas-api",
    provider: "github",
    branch: "feat/metrics",
    status: "ahead",
    language: "Rust",
    languageColor: "#ce412b",
    summary: "Internal service layer for metrics ingestion and workspace identity.",
    updatedAt: "昨天 18:09",
    commit: "d13c6b8",
    favorite: true,
    tags: ["backend", "review"],
    remote: "origin",
    files: 246,
    syncLabel: "领先 2 个提交",
    diskSizeBytes: 96_200_000,
  },
  {
    id: "northstar-web",
    name: "northstar-web",
    path: "E:/Workspaces/northstar-web",
    provider: "gitee",
    branch: "main",
    status: "dirty",
    language: "Vue",
    languageColor: "#42b883",
    summary: "Northstar customer workspace for operations and support teams.",
    updatedAt: "周二 09:46",
    commit: "9f4a210",
    favorite: false,
    tags: ["client", "needs-sync"],
    remote: "origin",
    files: 382,
    syncLabel: "3 个文件未提交",
    diskSizeBytes: 321_000_000,
  },
  {
    id: "papertrail",
    name: "papertrail",
    path: "D:/Lab/papertrail",
    provider: "gitlab",
    branch: "release/0.8",
    status: "behind",
    language: "Python",
    languageColor: "#3776ab",
    summary: "A lightweight document pipeline for local research archives.",
    updatedAt: "6 月 12 日",
    commit: "7ce08f2",
    favorite: false,
    tags: ["archive"],
    remote: "origin",
    files: 74,
    syncLabel: "落后 1 个提交",
    diskSizeBytes: 12_800_000,
  },
];

const STORAGE_KEY = "gitool.projects";

export function loadProjects(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return seedProjects;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as Project[]) : seedProjects;
  } catch {
    return seedProjects;
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}
