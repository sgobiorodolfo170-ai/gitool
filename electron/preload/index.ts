import { contextBridge, ipcRenderer } from "electron";
import type {
  Account,
  AccountTestResult,
  DesktopBridge,
  EnvironmentStatus,
  GitOperationResult,
  GitSnapshot,
  LocalProjectInspection,
  Project,
  ProjectAnalysis,
  RemoteRepository,
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
  runGitOperation: (path, operation) =>
    invoke<GitOperationResult>("projects:gitOperation", path, operation),
  loadProjects: () => invoke<Project[]>("projects:load"),
  saveProjects: (projects) => invoke<void>("projects:save", projects),
  loadAccounts: () => invoke<Account[]>("accounts:load"),
  createAccount: (input) => invoke<Account>("accounts:create", input),
  testAccount: (accountId) => invoke<AccountTestResult>("accounts:test", accountId),
  deleteAccount: (accountId) => invoke<void>("accounts:delete", accountId),
  loadRemoteRepositories: (accountId) =>
    invoke<RemoteRepository[]>("remoteRepositories:load", accountId),
};

contextBridge.exposeInMainWorld("gitool", bridge);
