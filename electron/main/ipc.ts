import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  AppSettings,
  BackupCreateInput,
  BackupRestoreInput,
  CloneRepositoryInput,
  CloneRepositoryResult,
  CommitRequest,
  CommitResult,
  CompareRequest,
  CreateAccountInput,
  CreateBranchInput,
  CreateTagInput,
  DeleteBranchInput,
  FileDiffRequest,
  GitOperation,
  GitOperationResult,
  InitRepositoryInput,
  MoveProjectInput,
  OpenEditorInput,
  OperationRecord,
  Project,
  RemoteRepositoryWriteInput,
  RevertCommitInput,
  SetRemoteUrlInput,
  SwitchBranchInput,
  TaskProfile,
  TaskRun,
} from "../../shared/types";
import { analyzeProject } from "./services/analysis";
import { createBackup, restoreBackup } from "./services/backups";
import { openInEditor, openInTerminal } from "./services/openers";
import {
  cloneRepository,
  commitChanges,
  compareVersions,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  getDiskSize,
  getEnvironmentStatus,
  getFileDiff,
  getProjectSnapshot,
  initRepository,
  inspectLocalProject,
  listBranches,
  listChangedFiles,
  listCommitHistory,
  listTags,
  listVersions,
  moveProject,
  readProjectReadme,
  revertCommit,
  runGitOperation,
  scanDirectoryForRepositories,
  setRemoteUrl,
  stageFiles,
  switchBranch,
  unstageFiles,
} from "./services/git";
import {
  createRemoteRepository,
  deleteRemoteRepository,
  loadRemoteRepositories,
  testAccount,
  updateRemoteRepository,
} from "./services/providers";
import {
  createAccount,
  deleteAccount,
  loadAccounts,
  loadProjects,
  saveProjects,
} from "./services/storage";
import {
  clearOperationRecords,
  deleteTaskProfile,
  insertOperationRecord,
  insertTaskRun,
  listBackups,
  listOperationRecords,
  listTaskProfiles,
  listTaskRuns,
  loadSettings,
  saveSettings,
  saveTaskProfile,
  updateTaskRun,
} from "./services/storage";
import { getRunningTaskOutput, runTask, stopTask } from "./services/tasks";

export function registerIpcHandlers(): void {  ipcMain.handle("system:environment", () => getEnvironmentStatus());

  ipcMain.handle("system:selectDirectory", async (event, defaultPath: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const properties = ["openDirectory", "createDirectory"] as const;
    const options = {
      properties: [...properties],
      defaultPath: typeof defaultPath === "string" && defaultPath.length > 0 ? defaultPath : undefined,
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new Error("只允许打开 HTTP 或 HTTPS 链接");
    }
    await shell.openExternal(url);
  });

  ipcMain.handle("shell:openPath", async (_event, projectPath: unknown) => {
    const path = requireString(projectPath, "项目路径");
    const errorMessage = await shell.openPath(path);
    if (errorMessage) {
      throw new Error(`无法在资源管理器中打开：${errorMessage}`);
    }
  });

  ipcMain.handle("shell:openEditor", (_event, input: unknown) => {
    const editorInput = requireOpenEditorInput(input);
    return openInEditor(editorInput.path, editorInput.editor, editorInput.newWindow);
  });
  ipcMain.handle("shell:openTerminal", (_event, projectPath: unknown) =>
    openInTerminal(requireString(projectPath, "项目路径")),
  );

  ipcMain.handle("projects:inspect", (_event, projectPath: unknown) =>
    inspectLocalProject(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:snapshot", (_event, projectPath: unknown) =>
    getProjectSnapshot(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:analyze", (_event, projectPath: unknown) =>
    analyzeProject(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:diskSize", (_event, projectPath: unknown) =>
    getDiskSize(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:readme", (_event, projectPath: unknown) =>
    readProjectReadme(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:init", (_event, input: unknown) =>
    initRepository(requireInitRepositoryInput(input)),
  );
  ipcMain.handle("projects:scanDirectory", (_event, directory: unknown) =>
    scanDirectoryForRepositories(requireString(directory, "目录")),
  );
  ipcMain.handle("projects:fileDiff", (_event, input: unknown) =>
    getFileDiff(requireFileDiffRequest(input)),
  );
  ipcMain.handle("projects:setRemoteUrl", (_event, input: unknown) =>
    setRemoteUrl(requireSetRemoteUrlInput(input)),
  );
  ipcMain.handle("git:tags", (_event, projectPath: unknown) =>
    listTags(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:createTag", (_event, input: unknown) =>
    createTag(requireCreateTagInput(input)),
  );
  ipcMain.handle("git:deleteTag", (_event, projectPath: unknown, name: unknown) =>
    deleteTag(requireString(projectPath, "项目路径"), requireString(name, "标签名")),
  );
  ipcMain.handle("git:listVersions", (_event, projectPath: unknown) =>
    listVersions(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:compareVersions", (_event, input: unknown) =>
    compareVersions(requireCompareRequest(input)),
  );
  ipcMain.handle("projects:gitOperation", (_event, projectPath: unknown, operation: unknown) =>
    recordGitOperation(projectPath, operation),
  );
  ipcMain.handle("projects:clone", (_event, input: unknown) =>
    recordClone(input),
  );
  ipcMain.handle("git:changedFiles", (_event, projectPath: unknown) =>
    listChangedFiles(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:stageFiles", (_event, projectPath: unknown, files: unknown) =>
    stageFiles(requireString(projectPath, "项目路径"), requireStringArray(files)),
  );
  ipcMain.handle("git:unstageFiles", (_event, projectPath: unknown, files: unknown) =>
    unstageFiles(requireString(projectPath, "项目路径"), requireStringArray(files)),
  );
  ipcMain.handle("git:commit", (_event, input: unknown) =>
    recordCommit(input),
  );
  ipcMain.handle("git:branches", (_event, projectPath: unknown) =>
    listBranches(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:createBranch", (_event, input: unknown) =>
    createBranch(requireCreateBranchInput(input)),
  );
  ipcMain.handle("git:switchBranch", (_event, input: unknown) =>
    switchBranch(requireSwitchBranchInput(input)),
  );
  ipcMain.handle("git:deleteBranch", (_event, input: unknown) =>
    deleteBranch(requireDeleteBranchInput(input)),
  );
  ipcMain.handle("git:history", (_event, projectPath: unknown) =>
    listCommitHistory(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:revert", (_event, input: unknown) =>
    revertCommit(requireRevertCommitInput(input)),
  );
  ipcMain.handle("projects:load", () => loadProjects());
  ipcMain.handle("projects:save", (_event, projects: unknown) =>
    saveProjects(requireProjects(projects)),
  );

  ipcMain.handle("accounts:load", () => loadAccounts());
  ipcMain.handle("accounts:create", (_event, input: unknown) =>
    createAccount(requireCreateAccountInput(input)),
  );
  ipcMain.handle("accounts:test", (_event, accountId: unknown) =>
    testAccount(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("accounts:delete", (_event, accountId: unknown) =>
    deleteAccount(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:load", (_event, accountId: unknown) =>
    loadRemoteRepositories(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:create", (_event, input: unknown) =>
    createRemoteRepository(requireRemoteRepositoryWriteInput(input)),
  );
  ipcMain.handle("remoteRepositories:update", (_event, input: unknown) =>
    updateRemoteRepository(requireRemoteRepositoryWriteInput(input)),
  );
  ipcMain.handle("remoteRepositories:delete", (_event, accountId: unknown, repositoryId: unknown) =>
    deleteRemoteRepository(
      requireString(accountId, "账号 ID"),
      requireString(repositoryId, "仓库 ID"),
    ),
  );

  ipcMain.handle("tasks:listProfiles", () => listTaskProfiles());
  ipcMain.handle("tasks:saveProfile", (_event, input: unknown) =>
    saveTaskProfile(requireTaskProfile(input)),
  );
  ipcMain.handle("tasks:deleteProfile", (_event, id: unknown) =>
    deleteTaskProfile(requireString(id, "任务 ID")),
  );
  ipcMain.handle("tasks:run", async (_event, profileId: unknown) => {
    const run = await runTask(requireString(profileId, "任务 ID"));
    insertTaskRun(run);
    return run;
  });
  ipcMain.handle("tasks:stop", (_event, runId: unknown) =>
    stopTask(requireString(runId, "运行 ID")),
  );
  ipcMain.handle("tasks:listRuns", () => listTaskRuns());
  ipcMain.handle("tasks:getRunningOutput", (_event, runId: unknown) =>
    getRunningTaskOutput(requireString(runId, "运行 ID")),
  );
  ipcMain.handle("tasks:updateRun", (_event, run: unknown) => {
    const validated = requireTaskRun(run);
    updateTaskRun(validated);
  });

  ipcMain.handle("backups:list", () => listBackups());
  ipcMain.handle("backups:create", (_event, input: unknown) =>
    createBackup(requireBackupCreateInput(input)),
  );
  ipcMain.handle("backups:restore", (_event, input: unknown) =>
    restoreBackup(requireBackupRestoreInput(input)),
  );

  ipcMain.handle("operations:list", () => listOperationRecords());
  ipcMain.handle("operations:clear", () => clearOperationRecords());
  ipcMain.handle("operations:record", (_event, record: unknown) => {
    insertOperationRecord(requireOperationRecord(record));
  });

  ipcMain.handle("settings:load", () => loadSettings());
  ipcMain.handle("settings:save", (_event, settings: unknown) => {
    saveSettings(requireAppSettings(settings));
  });
  ipcMain.handle("projects:move", (_event, input: unknown) =>
    moveProject(requireMoveProjectInput(input)),
  );
}

async function recordGitOperation(projectPath: unknown, operation: unknown): Promise<GitOperationResult> {
  const path = requireString(projectPath, "项目路径");
  const op = requireGitOperation(operation);
  const result = await runGitOperation(path, op);
  recordOperation(op, path, result.output, result.success ? "ok" : "failed");
  return result;
}

async function recordClone(input: unknown): Promise<CloneRepositoryResult> {
  const validated = requireCloneRepositoryInput(input);
  const result = await cloneRepository(validated);
  recordOperation("clone", validated.targetPath, result.output, result.success ? "ok" : "failed");
  return result;
}

async function recordCommit(input: unknown): Promise<CommitResult> {
  const validated = requireCommitRequest(input);
  const result = await commitChanges(validated);
  recordOperation("commit", validated.path, result.output, result.success ? "ok" : "failed");
  return result;
}

function recordOperation(operation: string, path: string, detail: string, result: "ok" | "failed"): void {
  try {
    insertOperationRecord({
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operation,
      projectId: "",
      projectPath: path,
      detail: detail.slice(0, 500),
      result,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // 记录失败不影响主流程
  }
}

function requireAppSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value === null) {
    throw new Error("设置数据格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    gitPath: typeof candidate.gitPath === "string" ? candidate.gitPath : "",
    defaultProjectDirectory: typeof candidate.defaultProjectDirectory === "string" ? candidate.defaultProjectDirectory : "",
    defaultBackupDirectory: typeof candidate.defaultBackupDirectory === "string" ? candidate.defaultBackupDirectory : "",
    backupExcludePatterns: typeof candidate.backupExcludePatterns === "string" ? candidate.backupExcludePatterns : "",
  };
}

function requireMoveProjectInput(value: unknown): MoveProjectInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("移动项目参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    sourcePath: requireString(candidate.sourcePath, "源路径"),
    targetDirectory: requireString(candidate.targetDirectory, "目标目录"),
  };
}

function requireInitRepositoryInput(value: unknown): InitRepositoryInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("初始化仓库参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "初始化路径"),
    defaultBranch: typeof candidate.defaultBranch === "string" && candidate.defaultBranch.trim().length > 0 ? candidate.defaultBranch.trim() : undefined,
  };
}

function requireFileDiffRequest(value: unknown): FileDiffRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("差异查看参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    file: requireString(candidate.file, "文件路径"),
  };
}

function requireSetRemoteUrlInput(value: unknown): SetRemoteUrlInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("远程地址参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    url: requireString(candidate.url, "远程地址"),
    remote: typeof candidate.remote === "string" && candidate.remote.trim().length > 0 ? candidate.remote.trim() : undefined,
  };
}

function requireCreateTagInput(value: unknown): CreateTagInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("创建标签参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    name: requireString(candidate.name, "标签名"),
    message: typeof candidate.message === "string" ? candidate.message : undefined,
  };
}

function requireCompareRequest(value: unknown): CompareRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("版本对比参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    base: requireString(candidate.base, "基线版本"),
    head: requireString(candidate.head, "目标版本"),
  };
}

function requireOpenEditorInput(value: unknown): OpenEditorInput {  if (typeof value !== "object" || value === null) {
    throw new Error("编辑器参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const editor = candidate.editor;
  if (editor !== "vscode" && editor !== "cursor") {
    throw new Error("不支持的编辑器类型");
  }
  return {
    path: requireString(candidate.path, "项目路径"),
    editor,
    newWindow: candidate.newWindow === true,
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
  return value;
}

function requireTaskProfile(value: unknown): TaskProfile {
  if (typeof value !== "object" || value === null) {
    throw new Error("任务配置格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const taskType = candidate.taskType;
  if (taskType !== "build" && taskType !== "run" && taskType !== "package") {
    throw new Error("任务类型无效");
  }
  return {
    id: requireString(candidate.id, "任务 ID"),
    projectId: requireString(candidate.projectId, "项目 ID"),
    projectPath: requireString(candidate.projectPath, "任务工作目录"),
    taskType,
    name: requireString(candidate.name, "任务名称"),
    command: requireString(candidate.command, "命令"),
    args: typeof candidate.args === "string" ? candidate.args : "",
    workingDirectory: requireString(candidate.workingDirectory, "任务工作目录"),
    timeoutSeconds: typeof candidate.timeoutSeconds === "number" ? candidate.timeoutSeconds : 0,
    createdAt: requireString(candidate.createdAt, "创建时间"),
  };
}

function requireTaskRun(value: unknown): TaskRun {
  if (typeof value !== "object" || value === null) {
    throw new Error("任务运行记录格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const status = candidate.status;
  if (status !== "running" && status !== "succeeded" && status !== "failed" && status !== "stopped" && status !== "timedout") {
    throw new Error("任务状态无效");
  }
  return {
    id: requireString(candidate.id, "运行 ID"),
    profileId: typeof candidate.profileId === "string" ? candidate.profileId : "",
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : "",
    name: typeof candidate.name === "string" ? candidate.name : "",
    command: typeof candidate.command === "string" ? candidate.command : "",
    startedAt: requireString(candidate.startedAt, "开始时间"),
    finishedAt: typeof candidate.finishedAt === "string" ? candidate.finishedAt : undefined,
    status: status as TaskRun["status"],
    exitCode: typeof candidate.exitCode === "number" ? candidate.exitCode : undefined,
    output: typeof candidate.output === "string" ? candidate.output : "",
  };
}

function requireBackupCreateInput(value: unknown): BackupCreateInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("备份参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    projectId: requireString(candidate.projectId, "项目 ID"),
    projectName: requireString(candidate.projectName, "项目名称"),
    sourcePath: requireString(candidate.sourcePath, "源路径"),
    targetDirectory: requireString(candidate.targetDirectory, "备份目录"),
  };
}

function requireBackupRestoreInput(value: unknown): BackupRestoreInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("恢复参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    archivePath: requireString(candidate.archivePath, "备份文件"),
    targetDirectory: requireString(candidate.targetDirectory, "恢复目录"),
  };
}

function requireOperationRecord(value: unknown): OperationRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("操作记录格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    id: requireString(candidate.id, "记录 ID"),
    operation: requireString(candidate.operation, "操作类型"),
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : "",
    projectPath: typeof candidate.projectPath === "string" ? candidate.projectPath : "",
    detail: typeof candidate.detail === "string" ? candidate.detail : "",
    result: candidate.result === "ok" || candidate.result === "failed" ? candidate.result : "ok",
    createdAt: requireString(candidate.createdAt, "记录时间"),
  };
}

function requireGitOperation(value: unknown): GitOperation {
  if (value === "fetch" || value === "pull" || value === "push" || value === "sync") {
    return value;
  }
  throw new Error("不支持的 Git 操作");
}

function requireProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) {
    throw new Error("项目数据格式不正确");
  }
  return value.map((item, index) => requireProject(item, index));
}

function requireProject(value: unknown, index: number): Project {
  if (typeof value !== "object" || value === null) {
    throw new Error(`第 ${index + 1} 个项目数据格式不正确`);
  }
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  if (provider !== "local" && provider !== "github" && provider !== "gitee" && provider !== "gitlab") {
    throw new Error(`第 ${index + 1} 个项目的平台无效`);
  }

  return {
    id: requireString(candidate.id, "项目 ID"),
    name: requireString(candidate.name, "项目名称"),
    path: requireString(candidate.path, "项目路径"),
    provider,
    branch: typeof candidate.branch === "string" ? candidate.branch : "",
    status: requireProjectStatus(candidate.status),
    commit: typeof candidate.commit === "string" ? candidate.commit : "",
    favorite: candidate.favorite === true,
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    remote: typeof candidate.remote === "string" ? candidate.remote : undefined,
    files: typeof candidate.files === "number" ? candidate.files : 0,
    syncLabel: typeof candidate.syncLabel === "string" ? candidate.syncLabel : "",
    language: typeof candidate.language === "string" ? candidate.language : "",
    languageColor: typeof candidate.languageColor === "string" ? candidate.languageColor : "#8b97a8",
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    diskSizeBytes: typeof candidate.diskSizeBytes === "number" ? candidate.diskSizeBytes : 0,
    alias: typeof candidate.alias === "string" && candidate.alias.trim().length > 0 ? candidate.alias.trim() : undefined,
  };
}

function requireProjectStatus(value: unknown): Project["status"] {
  if (value === "clean" || value === "dirty" || value === "ahead" || value === "behind" || value === "conflicted") {
    return value;
  }
  return "clean";
}

function requireCreateAccountInput(value: unknown): CreateAccountInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("账号数据格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  if (provider !== "github" && provider !== "gitee" && provider !== "gitlab") {
    throw new Error("不支持的远程平台");
  }
  if (candidate.authType !== "pat") {
    throw new Error("当前版本账号录入使用 Personal Access Token");
  }

  return {
    provider,
    displayName: typeof candidate.displayName === "string" ? candidate.displayName : "",
    username: typeof candidate.username === "string" ? candidate.username : "",
    authType: "pat",
    token: requireString(candidate.token, "令牌"),
  };
}

function requireCloneRepositoryInput(value: unknown): CloneRepositoryInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("克隆参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const accountId = candidate.accountId;
  if (typeof accountId !== "undefined" && typeof accountId !== "string") {
    throw new Error("账号标识格式不正确");
  }
  return {
    url: requireString(candidate.url, "克隆地址"),
    targetPath: requireString(candidate.targetPath, "克隆目标目录"),
    accountId: accountId === "" ? undefined : accountId,
  };
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("文件列表格式不正确");
  }
  return value;
}

function requireCommitRequest(value: unknown): CommitRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("提交参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    message: requireString(candidate.message, "提交信息"),
  };
}

function requireCreateBranchInput(value: unknown): CreateBranchInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("创建分支参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    name: requireString(candidate.name, "分支名"),
  };
}

function requireSwitchBranchInput(value: unknown): SwitchBranchInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("切换分支参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    name: requireString(candidate.name, "分支名"),
  };
}

function requireDeleteBranchInput(value: unknown): DeleteBranchInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("删除分支参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    name: requireString(candidate.name, "分支名"),
  };
}

function requireRevertCommitInput(value: unknown): RevertCommitInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("回退提交参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: requireString(candidate.path, "项目路径"),
    hash: requireString(candidate.hash, "提交哈希"),
  };
}

function requireRemoteRepositoryWriteInput(value: unknown): RemoteRepositoryWriteInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("远程仓库参数格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const visibility = candidate.visibility;
  if (visibility !== "" && visibility !== "public" && visibility !== "private" && visibility !== "internal") {
    throw new Error("可见性必须为 public、private 或 internal");
  }
  const repositoryId = candidate.repositoryId;
  if (typeof repositoryId !== "undefined" && typeof repositoryId !== "string") {
    throw new Error("仓库标识格式不正确");
  }
  return {
    accountId: requireString(candidate.accountId, "账号 ID"),
    repositoryId: typeof repositoryId === "string" && repositoryId.length > 0 ? repositoryId : undefined,
    name: requireString(candidate.name, "仓库名称"),
    description: typeof candidate.description === "string" ? candidate.description : "",
    visibility: visibility as RemoteRepositoryWriteInput["visibility"],
    init: candidate.init === true,
  };
}
