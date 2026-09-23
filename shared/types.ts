export type ProjectStatus = "clean" | "dirty" | "ahead" | "behind" | "conflicted";

export type GitSnapshot = {
  branch: string;
  status: ProjectStatus;
  commit: string;
  files: number;
  sync_label: string;
  updated_at: string;
};

export type GitOperation = "fetch" | "pull" | "push" | "sync";

export type GitOperationResult = {
  operation: GitOperation;
  success: boolean;
  output: string;
  snapshot?: GitSnapshot;
};

export type EnvironmentStatus = {
  git_available: boolean;
  git_version?: string | null;
  platform: string;
};

export type ProjectAnalysis = {
  files: number;
  directories: number;
  total_bytes: number;
  languages: Array<{ name: string; files: number; bytes: number; color: string }>;
  project_types: string[];
  key_files: string[];
};

export type RemoteProvider = "github" | "gitee" | "gitlab";

export type Account = {
  id: string;
  provider: RemoteProvider;
  username: string;
  displayName: string;
  authType: "pat" | "oauth";
  credentialRef: string;
  status: "active" | "expired" | "invalid" | "unknown";
  scopes: string[];
  lastCheckedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountTestResult = {
  success: boolean;
  username?: string;
  scopes: string[];
  message: string;
};

export type RemoteRepository = {
  id: string;
  accountId: string;
  provider: RemoteProvider;
  owner: string;
  name: string;
  fullName: string;
  description: string;
  visibility: string;
  defaultBranch: string;
  httpsUrl: string;
  sshUrl?: string;
  archived: boolean;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  provider: "github" | "gitee" | "gitlab" | "local";
  branch: string;
  status: ProjectStatus;
  commit: string;
  favorite: boolean;
  tags: string[];
  remote?: string;
  files: number;
  syncLabel: string;
  language: string;
  languageColor: string;
  summary: string;
  updatedAt: string;
};

export type ProjectFilter = "all" | "favorite" | "attention";

export type Workspace = "overview" | "projects" | "remotes" | "accounts" | "tasks" | "backups" | "logs";

export type LocalProjectInspection = {
  path: string;
  name: string;
  is_git_repository: boolean;
  snapshot?: GitSnapshot;
};

export type CreateAccountInput = {
  provider: RemoteProvider;
  displayName: string;
  username: string;
  authType: "pat";
  token: string;
};

export type DesktopBridge = {
  environment(): Promise<EnvironmentStatus>;
  selectDirectory(defaultPath?: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  inspectProject(path: string): Promise<LocalProjectInspection>;
  getProjectSnapshot(path: string): Promise<GitSnapshot>;
  analyzeProject(path: string): Promise<ProjectAnalysis>;
  runGitOperation(path: string, operation: GitOperation): Promise<GitOperationResult>;
  loadProjects(): Promise<Project[]>;
  saveProjects(projects: Project[]): Promise<void>;
  loadAccounts(): Promise<Account[]>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  testAccount(accountId: string): Promise<AccountTestResult>;
  deleteAccount(accountId: string): Promise<void>;
  loadRemoteRepositories(accountId: string): Promise<RemoteRepository[]>;
};
