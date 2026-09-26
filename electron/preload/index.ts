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
  EnvironmentStatus,
  GitOperationResult,
  GitSnapshot,
  GitTag,
  ListVersionsResult,
  LocalProjectInspection,
  MoveProjectInput,
  MoveProjectResult,
  OperationRecord,
  Project,
  ProjectAnalysis,
  ReadmeResult,
  RemoteRepository,
  RemoteRepositoryMutationResult,
  RepositoryDiscoveryItem,
  TaskProfile,
  TaskRun,
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
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^Error:\s*/, "");
}

const bridge: DesktopBridge = {
  environment: () => invoke<EnvironmentStatus>("system:environment"),
  selectDirectory: (defaultPath) => invoke<string | null>("system:selectDirectory", defaultPath),
  openExternal: (url) => invoke<void>("shell:openExternal", url),
  openPath: (path) => invoke<void>("shell:openPath", path),
  openInEditor: (input) => invoke<void>("shell:openEditor", input),
  openInTerminal: (path) => invoke<void>("shell:openTerminal", path),
  inspectProject: (path) => invoke<LocalProjectInspection>("projects:inspect", path),
  getProjectSnapshot: (path) => invoke<GitSnapshot>("projects:snapshot", path),
  analyzeProject: (path) => invoke<ProjectAnalysis>("projects:analyze", path),
  getDiskSize: (path) => invoke<number>("projects:diskSize", path),
  readProjectReadme: (path) => invoke<ReadmeResult>("projects:readme", path),
  runGitOperation: (path, operation) =>
    invoke<GitOperationResult>("projects:gitOperation", path, operation),
  cloneRepository: (input) => invoke<CloneRepositoryResult>("projects:clone", input),
  onCloneProgress: (callback) => {
    const listener = (_event: unknown, payload: unknown) => {
      callback(payload as CloneProgressEvent);
    };
    ipcRenderer.on("git:cloneProgress", listener);
    return () => {
      ipcRenderer.removeListener("git:cloneProgress", listener);
    };
  },
  listChangedFiles: (path) => invoke<ChangeFile[]>("git:changedFiles", path),
  stageFiles: (path, files) => invoke<void>("git:stageFiles", path, files),
  unstageFiles: (path, files) => invoke<void>("git:unstageFiles", path, files),
  commitChanges: (input) => invoke<CommitResult>("git:commit", input),
  listBranches: (path) => invoke<BranchInfo[]>("git:branches", path),
  createBranch: (input) => invoke<void>("git:createBranch", input),
  switchBranch: (input) => invoke<void>("git:switchBranch", input),
  deleteBranch: (input) => invoke<void>("git:deleteBranch", input),
  listCommitHistory: (path) => invoke<CommitEntry[]>("git:history", path),
  revertCommit: (input) => invoke<GitOperationResult>("git:revert", input),
  loadProjects: () => invoke<Project[]>("projects:load"),
  saveProjects: (projects) => invoke<void>("projects:save", projects),
  loadAccounts: () => invoke<Account[]>("accounts:load"),
  createAccount: (input) => invoke<Account>("accounts:create", input),
  testAccount: (accountId) => invoke<AccountTestResult>("accounts:test", accountId),
  deleteAccount: (accountId) => invoke<void>("accounts:delete", accountId),
  loadRemoteRepositories: (accountId) =>
    invoke<RemoteRepository[]>("remoteRepositories:load", accountId),
  createRemoteRepository: (input) =>
    invoke<RemoteRepositoryMutationResult>("remoteRepositories:create", input),
  updateRemoteRepository: (input) =>
    invoke<RemoteRepositoryMutationResult>("remoteRepositories:update", input),
  deleteRemoteRepository: (accountId, repositoryId) =>
    invoke<RemoteRepositoryMutationResult>("remoteRepositories:delete", accountId, repositoryId),
  listTaskProfiles: () => invoke<TaskProfile[]>("tasks:listProfiles"),
  saveTaskProfile: (input) => invoke<TaskProfile>("tasks:saveProfile", input),
  deleteTaskProfile: (id) => invoke<void>("tasks:deleteProfile", id),
  runTask: (profileId) => invoke<TaskRun>("tasks:run", profileId),
  stopTask: (runId) => invoke<void>("tasks:stop", runId),
  listTaskRuns: () => invoke<TaskRun[]>("tasks:listRuns"),
  listBackups: () => invoke<BackupRecord[]>("backups:list"),
  createBackup: (input) => invoke<BackupRecord>("backups:create", input),
  restoreBackup: (input) => invoke<void>("backups:restore", input),
  listOperationRecords: () => invoke<OperationRecord[]>("operations:list"),
  clearOperationRecords: () => invoke<void>("operations:clear"),
  exportOperationRecords: (directory) => invoke<string>("operations:export", directory),
  loadSettings: () => invoke<AppSettings>("settings:load"),
  saveSettings: (settings: AppSettings) => invoke<void>("settings:save", settings),
  moveProject: (input: MoveProjectInput) => invoke<MoveProjectResult>("projects:move", input),
  initRepository: (input) => invoke<void>("projects:init", input),
  scanDirectoryForRepositories: (path) => invoke<RepositoryDiscoveryItem[]>("projects:scanDirectory", path),
  getFileDiff: (input) => invoke<string>("projects:fileDiff", input),
  getRunningTaskOutput: (runId) => invoke<string>("tasks:getRunningOutput", runId),
  setRemoteUrl: (input) => invoke<void>("projects:setRemoteUrl", input),
  listTags: (path) => invoke<GitTag[]>("git:tags", path),
  createTag: (input) => invoke<void>("git:createTag", input),
  deleteTag: (path, name) => invoke<void>("git:deleteTag", path, name),
  listVersions: (path) => invoke<ListVersionsResult>("git:listVersions", path),
  compareVersions: (input) => invoke<CompareResult>("git:compareVersions", input),
  generateAiSummary: (input) => invoke<AiSummaryResult>("ai:generateSummary", input),
};

contextBridge.exposeInMainWorld("gitool", bridge);
