import type {
  ChangeFile,
  GitOperation,
  Project,
  ProjectStatus,
  RemoteProvider,
} from "../../shared/types";

/**
 * 展示层的映射表。
 *
 * 从 `App.tsx` 抽出的原因：这些常量被 5 个组件文件共用，留在 App.tsx 里会形成
 * "组件反向 import 主组件"的循环依赖。集中在这里，谁需要谁 import。
 */

export const statusMeta: Record<ProjectStatus, { label: string; className: string }> = {
  clean: { label: "已同步", className: "status-clean" },
  ahead: { label: "领先远程", className: "status-ahead" },
  behind: { label: "落后远程", className: "status-behind" },
  dirty: { label: "有未提交修改", className: "status-dirty" },
  conflicted: { label: "存在冲突", className: "status-conflicted" },
};

export const providerLabels: Record<Project["provider"], string> = {
  local: "本地",
  github: "GitHub",
  gitee: "Gitee",
  gitlab: "GitLab",
};

export const operationLabels: Record<GitOperation, string> = {
  fetch: "获取远程更新",
  pull: "拉取更新",
  push: "推送更新",
  sync: "同步项目",
  revert: "撤销提交",
};

export const remoteProviderLabels: Record<RemoteProvider, string> = {
  github: "GitHub",
  gitee: "Gitee",
  gitlab: "GitLab",
};

export const changeStatusMeta: Record<ChangeFile["status"], { label: string; className: string }> =
  {
    added: { label: "新增", className: "change-added" },
    modified: { label: "修改", className: "change-modified" },
    deleted: { label: "删除", className: "change-deleted" },
    renamed: { label: "重命名", className: "change-renamed" },
    untracked: { label: "未跟踪", className: "change-untracked" },
    conflicted: { label: "冲突", className: "change-conflicted" },
  };
