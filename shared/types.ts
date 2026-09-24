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
  diskSizeBytes: number;
  alias?: string;
};

export type ProjectFilter = "all" | "favorite" | "attention";

export type Workspace = "overview" | "projects" | "remotes" | "accounts" | "tasks" | "backups" | "logs" | "settings";

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

export type CloneRepositoryInput = {
  url: string;
  targetPath: string;
  accountId?: string;
};

export type CloneRepositoryResult = {
  success: boolean;
  output: string;
  path: string;
};

export type ChangeFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export type ChangeFile = {
  path: string;
  status: ChangeFileStatus;
  staged: boolean;
};

export type CommitRequest = {
  path: string;
  message: string;
};

export type ReadmeResult = {
  found: boolean;
  content: string;
  fileName: string;
};

export type CommitResult = {
  success: boolean;
  commitHash?: string;
  output: string;
};

export type BranchInfo = {
  name: string;
  current: boolean;
  remote?: string;
  ahead: number;
  behind: number;
};

export type CreateBranchInput = {
  path: string;
  name: string;
};

export type SwitchBranchInput = {
  path: string;
  name: string;
};

export type DeleteBranchInput = {
  path: string;
  name: string;
};

export type CommitEntry = {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  subject: string;
};

export type RevertCommitInput = {
  path: string;
  hash: string;
};

export type RemoteRepositoryWriteInput = {
  accountId: string;
  repositoryId?: string;
  name: string;
  description: string;
  visibility: "public" | "private" | "internal" | "";
  init: boolean;
};

export type RemoteRepositoryMutationResult = {
  success: boolean;
  message: string;
  repository?: RemoteRepository;
};

export type OpenEditorInput = {
  path: string;
  editor: "vscode" | "cursor";
  newWindow: boolean;
};

export type TaskType = "build" | "run" | "package";

export type TaskProfile = {
  id: string;
  projectId: string;
  projectPath: string;
  taskType: TaskType;
  name: string;
  command: string;
  args: string;
  workingDirectory: string;
  timeoutSeconds: number;
  createdAt: string;
};

export type TaskRun = {
  id: string;
  profileId: string;
  projectId: string;
  name: string;
  command: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "succeeded" | "failed" | "stopped" | "timedout";
  exitCode?: number;
  output: string;
};

export type BackupRecord = {
  id: string;
  projectId: string;
  projectName: string;
  sourcePath: string;
  archivePath: string;
  sizeBytes: number;
  status: "ok" | "failed";
  error?: string;
  createdAt: string;
};

export type BackupCreateInput = {
  projectId: string;
  projectName: string;
  sourcePath: string;
  targetDirectory: string;
};

export type BackupRestoreInput = {
  archivePath: string;
  targetDirectory: string;
};

export type OperationRecord = {
  id: string;
  operation: string;
  projectId: string;
  projectPath: string;
  detail: string;
  result: "ok" | "failed";
  createdAt: string;
};

export type AppSettings = {
  gitPath: string;
  defaultProjectDirectory: string;
  defaultBackupDirectory: string;
};

export type MoveProjectInput = {
  sourcePath: string;
  targetDirectory: string;
};

export type MoveProjectResult = {
  success: boolean;
  targetPath: string;
  output: string;
};

export type DesktopBridge = {
  environment(): Promise<EnvironmentStatus>;
  selectDirectory(defaultPath?: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  openInEditor(input: OpenEditorInput): Promise<void>;
  openInTerminal(path: string): Promise<void>;
  inspectProject(path: string): Promise<LocalProjectInspection>;
  getProjectSnapshot(path: string): Promise<GitSnapshot>;
  analyzeProject(path: string): Promise<ProjectAnalysis>;
  getDiskSize(path: string): Promise<number>;
  readProjectReadme(path: string): Promise<ReadmeResult>;
  runGitOperation(path: string, operation: GitOperation): Promise<GitOperationResult>;
  cloneRepository(input: CloneRepositoryInput): Promise<CloneRepositoryResult>;
  listChangedFiles(path: string): Promise<ChangeFile[]>;
  stageFiles(path: string, files: string[]): Promise<void>;
  unstageFiles(path: string, files: string[]): Promise<void>;
  commitChanges(input: CommitRequest): Promise<CommitResult>;
  listBranches(path: string): Promise<BranchInfo[]>;
  createBranch(input: CreateBranchInput): Promise<void>;
  switchBranch(input: SwitchBranchInput): Promise<void>;
  deleteBranch(input: DeleteBranchInput): Promise<void>;
  listCommitHistory(path: string): Promise<CommitEntry[]>;
  revertCommit(input: RevertCommitInput): Promise<GitOperationResult>;
  loadProjects(): Promise<Project[]>;
  saveProjects(projects: Project[]): Promise<void>;
  loadAccounts(): Promise<Account[]>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  testAccount(accountId: string): Promise<AccountTestResult>;
  deleteAccount(accountId: string): Promise<void>;
  loadRemoteRepositories(accountId: string): Promise<RemoteRepository[]>;
  createRemoteRepository(input: RemoteRepositoryWriteInput): Promise<RemoteRepositoryMutationResult>;
  updateRemoteRepository(input: RemoteRepositoryWriteInput): Promise<RemoteRepositoryMutationResult>;
  deleteRemoteRepository(accountId: string, repositoryId: string): Promise<RemoteRepositoryMutationResult>;
  listTaskProfiles(): Promise<TaskProfile[]>;
  saveTaskProfile(input: TaskProfile): Promise<TaskProfile>;
  deleteTaskProfile(id: string): Promise<void>;
  runTask(profileId: string): Promise<TaskRun>;
  stopTask(runId: string): Promise<void>;
  listTaskRuns(): Promise<TaskRun[]>;
  listBackups(): Promise<BackupRecord[]>;
  createBackup(input: BackupCreateInput): Promise<BackupRecord>;
  restoreBackup(input: BackupRestoreInput): Promise<void>;
  listOperationRecords(): Promise<OperationRecord[]>;
  clearOperationRecords(): Promise<void>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  moveProject(input: MoveProjectInput): Promise<MoveProjectResult>;
};
