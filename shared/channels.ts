import type { DesktopBridge } from "./types";

/**
 * IPC 通道名常量表（P-14 / 架构评审 L-09）。
 *
 * why 需要单一常量源：通道字符串原先在三处各自硬编码——主进程注册
 * （ipcMain.handle）、preload 白名单（invoke/on）、类型定义（DesktopBridge）——
 * 之间没有任何编译期关联。改通道名时 TypeScript 不报错，只能靠运行时
 * "404 not found" 式失败暴露，且已经产生过 2 个「有 handler 无桥接方法」
 * 的死通道（tasks:updateRun、operations:record，已删除）。
 *
 * 现在 preload 与 main 都从本表取通道名；`satisfies Record<keyof DesktopBridge, string>`
 * 保证每个桥成员都有对应通道（缺一个编译即失败）。
 *
 * why 按域分组：78+ 个通道平铺无法维护；按 system/shell/projects/git/... 分组后，
 * 新增通道时能一眼定位相邻命名风格，避免 `projects:clone` vs `git:cloneProgress`
 * 这类前缀漂移继续扩大。
 *
 * why 放独立文件而不并入 types.ts：types.ts 是纯类型叶（零运行时代码），
 * 本文件是运行时常量；混入会把这段代码拖进所有只引用类型的模块产物。
 */

/** invoke 通道：渲染层主动调用主进程。 */
export const INVOKE_CHANNELS = {
  // system 域
  environment: "system:environment",
  refreshEnvironment: "system:refreshEnvironment",
  installGit: "system:installGit",
  selectDirectory: "system:selectDirectory",
  resolveTargetPath: "system:resolveTargetPath",
  // shell 域
  openExternal: "shell:openExternal",
  openPath: "shell:openPath",
  openInEditor: "shell:openEditor",
  openInTerminal: "shell:openTerminal",
  // projects 域
  inspectProject: "projects:inspect",
  getProjectSnapshot: "projects:snapshot",
  analyzeProject: "projects:analyze",
  detectProjectCommands: "projects:detectCommands",
  getDiskSize: "projects:diskSize",
  readProjectReadme: "projects:readme",
  initRepository: "projects:init",
  scanDirectoryForRepositories: "projects:scanDirectory",
  getFileDiff: "projects:fileDiff",
  setRemoteUrl: "projects:setRemoteUrl",
  runGitOperation: "projects:gitOperation",
  cloneRepository: "projects:clone",
  moveProject: "projects:move",
  loadProjects: "projects:load",
  saveProjects: "projects:save",
  // git 域
  listChangedFiles: "git:changedFiles",
  stageFiles: "git:stageFiles",
  unstageFiles: "git:unstageFiles",
  commitChanges: "git:commit",
  listBranches: "git:branches",
  createBranch: "git:createBranch",
  switchBranch: "git:switchBranch",
  deleteBranch: "git:deleteBranch",
  listCommitHistory: "git:history",
  revertCommit: "git:revert",
  listTags: "git:tags",
  createTag: "git:createTag",
  deleteTag: "git:deleteTag",
  listVersions: "git:listVersions",
  compareVersions: "git:compareVersions",
  // workspaces 域
  listWorkspaces: "workspaces:list",
  createWorkspace: "workspaces:create",
  renameWorkspace: "workspaces:rename",
  deleteWorkspace: "workspaces:delete",
  // accounts 域
  loadAccounts: "accounts:load",
  createAccount: "accounts:create",
  testAccount: "accounts:test",
  deleteAccount: "accounts:delete",
  // remoteRepositories 域
  loadRemoteRepositories: "remoteRepositories:load",
  loadCachedRemoteRepositories: "remoteRepositories:loadCached",
  getRemoteRepositoryCacheMeta: "remoteRepositories:cacheMeta",
  searchRemoteRepositories: "remoteRepositories:search",
  toggleRepositoryInteraction: "remoteRepositories:interact",
  createRemoteRepository: "remoteRepositories:create",
  updateRemoteRepository: "remoteRepositories:update",
  deleteRemoteRepository: "remoteRepositories:delete",
  // tasks 域
  listTaskProfiles: "tasks:listProfiles",
  saveTaskProfile: "tasks:saveProfile",
  deleteTaskProfile: "tasks:deleteProfile",
  runTask: "tasks:run",
  stopTask: "tasks:stop",
  listTaskRuns: "tasks:listRuns",
  getRunningTaskOutput: "tasks:getRunningOutput",
  // backups 域
  listBackups: "backups:list",
  createBackup: "backups:create",
  restoreBackup: "backups:restore",
  // operations 域
  listOperationRecords: "operations:list",
  clearOperationRecords: "operations:clear",
  exportOperationRecords: "operations:export",
  // settings 域
  loadSettings: "settings:load",
  saveSettings: "settings:save",
  setTheme: "theme:set",
  // ai 域
  generateAiSummary: "ai:generateSummary",
  saveAiApiKey: "ai:saveKey",
  deleteAiApiKey: "ai:deleteKey",
  hasAiApiKey: "ai:hasKey",
  // updater 域
  checkForUpdates: "updater:check",
  downloadUpdate: "updater:download",
  installUpdate: "updater:install",
} as const satisfies Record<keyof Omit<DesktopBridge, "onInstallProgress" | "onCloneProgress" | "onUpdateAvailable" | "onUpdateProgress">, string>;

/** 事件通道：主进程主动推送给渲染层。 */
export const EVENT_CHANNELS = {
  installProgress: "setup:installProgress",
  cloneProgress: "git:cloneProgress",
  updateAvailable: "updater:available",
  updateProgress: "updater:progress",
} as const satisfies Record<
  "installProgress" | "cloneProgress" | "updateAvailable" | "updateProgress",
  string
>;

/** 全部通道（invoke + event），供差集校验与死通道扫描使用。 */
export const ALL_CHANNELS = { ...INVOKE_CHANNELS, ...EVENT_CHANNELS } as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[keyof typeof INVOKE_CHANNELS];
export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS];
export type Channel = InvokeChannel | EventChannel;
