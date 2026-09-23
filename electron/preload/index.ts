import { contextBridge, ipcRenderer } from "electron";
import type {
  Account,
  AccountTestResult,
  BranchInfo,
  ChangeFile,
  CloneRepositoryResult,
  CommitEntry,
  CommitResult,
  DesktopBridge,
  EnvironmentStatus,
  GitOperationResult,
  GitSnapshot,
  LocalProjectInspection,
  Project,
  ProjectAnalysis,
  ReadmeResult,
  RemoteRepository,
  RemoteRepositoryMutationResult,
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
  inspectProject: (path) => invoke<LocalProjectInspection>("projects:inspect", path),
  getProjectSnapshot: (path) => invoke<GitSnapshot>("projects:snapshot", path),
  analyzeProject: (path) => invoke<ProjectAnalysis>("projects:analyze", path),
  getDiskSize: (path) => invoke<number>("projects:diskSize", path),
  readProjectReadme: (path) => invoke<ReadmeResult>("projects:readme", path),
  runGitOperation: (path, operation) =>
    invoke<GitOperationResult>("projects:gitOperation", path, operation),
  cloneRepository: (input) => invoke<CloneRepositoryResult>("projects:clone", input),
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
};

contextBridge.exposeInMainWorld("gitool", bridge);
