import { EVENT_CHANNELS, INVOKE_CHANNELS } from "../../shared/channels";
import { contextBridge, ipcRenderer } from "electron";
import type {
  Account,
  AccountTestResult,
  AiSummaryResult,
  AppSettings,
  BackupRecord,
  BranchInfo,
  ChangeFile,
  CloneProgressEvent,
  CloneRepositoryResult,
  CommitEntry,
  CommitResult,
  CompareResult,
  DesktopBridge,
  DetectCommandsResult,
  EnvironmentStatus,
  GitOperationResult,
  GitSnapshot,
  GitTag,
  InstallGitResult,
  InstallProgress,
  ListVersionsResult,
  LocalProjectInspection,
  MoveProjectInput,
  MoveProjectResult,
  OperationRecord,
  Project,
  ProjectAnalysis,
  ReadmeResult,
  ThemePreference,
  RemoteRepository,
  RemoteRepositoryMutationResult,
  RepositoryDiscoveryItem,
  TaskProfile,
  TaskRun,
  UpdateCheckResult,
  UpdateProgress,
  WorkspaceEntity,
} from "../../shared/types";

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    throw new Error(cleanMessage(error));
  }
}

function cleanMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}

/**
 * bridge 之所以导出：契约一致性测试要拿它的键名与主进程 ipcMain 注册表做差集
 * （审查 L-14 的死通道门禁）。导出不改变运行时暴露面——挂到 window 上的仍是下面这一个对象。
 */
export const bridge: DesktopBridge = {
  environment: () => invoke<EnvironmentStatus>(INVOKE_CHANNELS.environment),
  refreshEnvironment: () => invoke<EnvironmentStatus>(INVOKE_CHANNELS.refreshEnvironment),
  installGit: () => invoke<InstallGitResult>(INVOKE_CHANNELS.installGit),
  onInstallProgress: (callback) => {
    const listener = (_event: unknown, payload: unknown) => {
      callback(payload as InstallProgress);
    };
    ipcRenderer.on(EVENT_CHANNELS.installProgress, listener);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNELS.installProgress, listener);
    };
  },
  selectDirectory: (defaultPath) => invoke<string | null>(INVOKE_CHANNELS.selectDirectory, defaultPath),
  // P-31：路径拼接收归主进程，渲染层只传 parentDirectory + name（语义入参）
  resolveTargetPath: (input) => invoke<string>(INVOKE_CHANNELS.resolveTargetPath, input),
  openExternal: (url) => invoke<void>(INVOKE_CHANNELS.openExternal, url),
  openPath: (path) => invoke<void>(INVOKE_CHANNELS.openPath, path),
  openInEditor: (input) => invoke<void>(INVOKE_CHANNELS.openInEditor, input),
  openInTerminal: (path) => invoke<void>(INVOKE_CHANNELS.openInTerminal, path),
  inspectProject: (path) => invoke<LocalProjectInspection>(INVOKE_CHANNELS.inspectProject, path),
  getProjectSnapshot: (path) => invoke<GitSnapshot>(INVOKE_CHANNELS.getProjectSnapshot, path),
  analyzeProject: (path) => invoke<ProjectAnalysis>(INVOKE_CHANNELS.analyzeProject, path),
  detectProjectCommands: (path) => invoke<DetectCommandsResult>(INVOKE_CHANNELS.detectProjectCommands, path),
  getDiskSize: (path) => invoke<number>(INVOKE_CHANNELS.getDiskSize, path),
  readProjectReadme: (path) => invoke<ReadmeResult>(INVOKE_CHANNELS.readProjectReadme, path),
  runGitOperation: (path, operation) =>
    invoke<GitOperationResult>(INVOKE_CHANNELS.runGitOperation, path, operation),
  cloneRepository: (input) => invoke<CloneRepositoryResult>(INVOKE_CHANNELS.cloneRepository, input),
  onCloneProgress: (callback) => {
    const listener = (_event: unknown, payload: unknown) => {
      callback(payload as CloneProgressEvent);
    };
    ipcRenderer.on(EVENT_CHANNELS.cloneProgress, listener);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNELS.cloneProgress, listener);
    };
  },
  listChangedFiles: (path) => invoke<ChangeFile[]>(INVOKE_CHANNELS.listChangedFiles, path),
  stageFiles: (path, files) => invoke<void>(INVOKE_CHANNELS.stageFiles, path, files),
  unstageFiles: (path, files) => invoke<void>(INVOKE_CHANNELS.unstageFiles, path, files),
  commitChanges: (input) => invoke<CommitResult>(INVOKE_CHANNELS.commitChanges, input),
  listBranches: (path) => invoke<BranchInfo[]>(INVOKE_CHANNELS.listBranches, path),
  createBranch: (input) => invoke<void>(INVOKE_CHANNELS.createBranch, input),
  switchBranch: (input) => invoke<void>(INVOKE_CHANNELS.switchBranch, input),
  deleteBranch: (input) => invoke<void>(INVOKE_CHANNELS.deleteBranch, input),
  listCommitHistory: (path) => invoke<CommitEntry[]>(INVOKE_CHANNELS.listCommitHistory, path),
  revertCommit: (input) => invoke<GitOperationResult>(INVOKE_CHANNELS.revertCommit, input),
  loadProjects: (workspaceId) => invoke<Project[]>(INVOKE_CHANNELS.loadProjects, workspaceId),
  saveProjects: (workspaceId, projects) => invoke<void>(INVOKE_CHANNELS.saveProjects, workspaceId, projects),
  listWorkspaces: () => invoke<WorkspaceEntity[]>(INVOKE_CHANNELS.listWorkspaces),
  createWorkspace: (input) => invoke<WorkspaceEntity>(INVOKE_CHANNELS.createWorkspace, input),
  renameWorkspace: (input) => invoke<void>(INVOKE_CHANNELS.renameWorkspace, input),
  deleteWorkspace: (id) => invoke<void>(INVOKE_CHANNELS.deleteWorkspace, id),
  loadAccounts: () => invoke<Account[]>(INVOKE_CHANNELS.loadAccounts),
  createAccount: (input) => invoke<Account>(INVOKE_CHANNELS.createAccount, input),
  testAccount: (accountId) => invoke<AccountTestResult>(INVOKE_CHANNELS.testAccount, accountId),
  deleteAccount: (accountId) => invoke<void>(INVOKE_CHANNELS.deleteAccount, accountId),
  loadRemoteRepositories: (accountId) =>
    invoke<RemoteRepository[]>("remoteRepositories:load", accountId),
  loadCachedRemoteRepositories: (accountId) =>
    invoke<RemoteRepository[]>("remoteRepositories:loadCached", accountId),
  getRemoteRepositoryCacheMeta: (accountId) =>
    invoke<{ syncedAt: string } | null>("remoteRepositories:cacheMeta", accountId),
  searchRemoteRepositories: (input) =>
    invoke<RemoteRepository[]>("remoteRepositories:search", input),
  toggleRepositoryInteraction: (input) => invoke<void>("remoteRepositories:interact", input),
  createRemoteRepository: (input) =>
    invoke<RemoteRepositoryMutationResult>("remoteRepositories:create", input),
  updateRemoteRepository: (input) =>
    invoke<RemoteRepositoryMutationResult>("remoteRepositories:update", input),
  deleteRemoteRepository: (accountId, repositoryId) =>
    invoke<RemoteRepositoryMutationResult>("remoteRepositories:delete", accountId, repositoryId),
  listTaskProfiles: () => invoke<TaskProfile[]>(INVOKE_CHANNELS.listTaskProfiles),
  saveTaskProfile: (input) => invoke<TaskProfile>(INVOKE_CHANNELS.saveTaskProfile, input),
  deleteTaskProfile: (id) => invoke<void>(INVOKE_CHANNELS.deleteTaskProfile, id),
  runTask: (profileId) => invoke<TaskRun>(INVOKE_CHANNELS.runTask, profileId),
  stopTask: (runId) => invoke<void>(INVOKE_CHANNELS.stopTask, runId),
  listTaskRuns: () => invoke<TaskRun[]>(INVOKE_CHANNELS.listTaskRuns),
  listBackups: () => invoke<BackupRecord[]>(INVOKE_CHANNELS.listBackups),
  createBackup: (input) => invoke<BackupRecord>(INVOKE_CHANNELS.createBackup, input),
  restoreBackup: (input) => invoke<void>(INVOKE_CHANNELS.restoreBackup, input),
  listOperationRecords: () => invoke<OperationRecord[]>(INVOKE_CHANNELS.listOperationRecords),
  clearOperationRecords: () => invoke<void>(INVOKE_CHANNELS.clearOperationRecords),
  exportOperationRecords: (directory) => invoke<string>(INVOKE_CHANNELS.exportOperationRecords, directory),
  loadSettings: () => invoke<AppSettings>(INVOKE_CHANNELS.loadSettings),
  saveSettings: (settings: AppSettings) => invoke<void>(INVOKE_CHANNELS.saveSettings, settings),
  setTheme: (theme: ThemePreference) => invoke<void>(INVOKE_CHANNELS.setTheme, theme),
  moveProject: (input: MoveProjectInput) => invoke<MoveProjectResult>(INVOKE_CHANNELS.moveProject, input),
  initRepository: (input) => invoke<void>(INVOKE_CHANNELS.initRepository, input),
  scanDirectoryForRepositories: (path) =>
    invoke<RepositoryDiscoveryItem[]>(INVOKE_CHANNELS.scanDirectoryForRepositories, path),
  getFileDiff: (input) => invoke<string>(INVOKE_CHANNELS.getFileDiff, input),
  getRunningTaskOutput: (runId) => invoke<string>(INVOKE_CHANNELS.getRunningTaskOutput, runId),
  setRemoteUrl: (input) => invoke<void>(INVOKE_CHANNELS.setRemoteUrl, input),
  listTags: (path) => invoke<GitTag[]>(INVOKE_CHANNELS.listTags, path),
  createTag: (input) => invoke<void>(INVOKE_CHANNELS.createTag, input),
  deleteTag: (path, name) => invoke<void>(INVOKE_CHANNELS.deleteTag, path, name),
  listVersions: (path) => invoke<ListVersionsResult>(INVOKE_CHANNELS.listVersions, path),
  compareVersions: (input) => invoke<CompareResult>(INVOKE_CHANNELS.compareVersions, input),
  generateAiSummary: (input) => invoke<AiSummaryResult>(INVOKE_CHANNELS.generateAiSummary, input),
  saveAiApiKey: (secret) => invoke<void>(INVOKE_CHANNELS.saveAiApiKey, secret),
  deleteAiApiKey: () => invoke<void>(INVOKE_CHANNELS.deleteAiApiKey),
  hasAiApiKey: () => invoke<boolean>(INVOKE_CHANNELS.hasAiApiKey),
  checkForUpdates: () => invoke<UpdateCheckResult>(INVOKE_CHANNELS.checkForUpdates),
  downloadUpdate: () => invoke<string>(INVOKE_CHANNELS.downloadUpdate),
  installUpdate: (filePath) => invoke<void>(INVOKE_CHANNELS.installUpdate, filePath),
  onUpdateAvailable: (callback) => {
    const listener = (_event: unknown, payload: unknown) => {
      callback(payload as { version: string });
    };
    ipcRenderer.on(EVENT_CHANNELS.updateAvailable, listener);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNELS.updateAvailable, listener);
    };
  },
  onUpdateProgress: (callback) => {
    const listener = (_event: unknown, payload: unknown) => {
      callback(payload as UpdateProgress);
    };
    ipcRenderer.on(EVENT_CHANNELS.updateProgress, listener);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNELS.updateProgress, listener);
    };
  },
};

contextBridge.exposeInMainWorld("gitool", bridge);
