import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  CloneRepositoryResult,
  CommitResult,
  GitOperationResult,
  UpdateProgress,
} from "../../shared/types";
import { analyzeProject } from "./services/analysis";
import { deleteAiApiKey, generateAiSummary, hasStoredApiKey, saveAiApiKey } from "./services/ai";
import { createBackup, restoreBackup } from "./services/backups";
import { detectProjectCommands } from "./services/commandDetection";
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
import { getEnvironmentStatus } from "./services/environment";
import { installGit } from "./services/setup";
import {
  createRemoteRepository,
  deleteRemoteRepository,
  loadRemoteRepositories,
  resolveTokenUser,
  searchRemoteRepositories,
  toggleRepositoryInteraction,
  testAccount,
  updateRemoteRepository,
} from "./services/providers";
import {
  createWorkspace,
  deleteAccount,
  deleteWorkspace,
  getRemoteRepositoryCacheMeta,
  listWorkspaces,
  loadAccounts,
  loadProjects,
  loadRemoteRepositoryCache,
  renameWorkspace,
  saveProjects,
  upsertAccount,
} from "./services/storage";
import {
  clearOperationRecords,
  deleteTaskProfile,
  exportOperationRecords,
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
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  isTrustedInstallerPath,
} from "./services/updater";
import {
  aiSummaryRequestSchema,
  appSettingsSchema,
  backupCreateInputSchema,
  backupRestoreInputSchema,
  cloneRepositoryInputSchema,
  commitRequestSchema,
  compareRequestSchema,
  createAccountInputSchema,
  createBranchInputSchema,
  createTagInputSchema,
  createWorkspaceInputSchema,
  deleteBranchInputSchema,
  fileDiffRequestSchema,
  gitOperationSchema,
  initRepositoryInputSchema,
  moveProjectInputSchema,
  openEditorInputSchema,
  operationRecordSchema,
  parseOrThrow,
  projectsSchema,
  remoteRepositorySearchInputSchema,
  remoteRepositoryWriteInputSchema,
  renameWorkspaceInputSchema,
  repositoryInteractionInputSchema,
  revertCommitInputSchema,
  setRemoteUrlInputSchema,
  switchBranchInputSchema,
  taskProfileSchema,
  taskRunSchema,
} from "./ipc/schemas";

let cachedDownloadUrl = "";

export function registerIpcHandlers(): void {
  ipcMain.handle("system:environment", () => getEnvironmentStatus());
  // system:refreshEnvironment 与 system:environment 调用同一函数，但语义独立：
  // 前者用于「一键安装完成后刷新」等显式触发场景，后者用于首启拉取。
  ipcMain.handle("system:refreshEnvironment", () => getEnvironmentStatus());
  // 一键安装 Git：下载官方安装包 → UAC 提权静默安装 → 写入 gitPath → 返回最新体检。
  // 进度通过 setup:installProgress 事件单向推送到渲染层。
  ipcMain.handle("system:installGit", async () => installGit());

  ipcMain.handle("system:selectDirectory", async (event, defaultPath: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const properties = ["openDirectory", "createDirectory"] as const;
    const options = {
      properties: [...properties],
      defaultPath:
        typeof defaultPath === "string" && defaultPath.length > 0 ? defaultPath : undefined,
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
    const editorInput = parseOrThrow(openEditorInputSchema, input, "编辑器参数");
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
  ipcMain.handle("projects:detectCommands", (_event, projectPath: unknown) =>
    detectProjectCommands(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:diskSize", (_event, projectPath: unknown) =>
    getDiskSize(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:readme", (_event, projectPath: unknown) =>
    readProjectReadme(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:init", (_event, input: unknown) =>
    initRepository(parseOrThrow(initRepositoryInputSchema, input, "初始化仓库参数")),
  );
  ipcMain.handle("projects:scanDirectory", (_event, directory: unknown) =>
    scanDirectoryForRepositories(requireString(directory, "目录")),
  );
  ipcMain.handle("projects:fileDiff", (_event, input: unknown) =>
    getFileDiff(parseOrThrow(fileDiffRequestSchema, input, "差异查看参数")),
  );
  ipcMain.handle("projects:setRemoteUrl", (_event, input: unknown) =>
    setRemoteUrl(parseOrThrow(setRemoteUrlInputSchema, input, "远程地址参数")),
  );
  ipcMain.handle("git:tags", (_event, projectPath: unknown) =>
    listTags(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:createTag", (_event, input: unknown) =>
    createTag(parseOrThrow(createTagInputSchema, input, "创建标签参数")),
  );
  ipcMain.handle("git:deleteTag", (_event, projectPath: unknown, name: unknown) =>
    deleteTag(requireString(projectPath, "项目路径"), requireString(name, "标签名")),
  );
  ipcMain.handle("git:listVersions", (_event, projectPath: unknown) =>
    listVersions(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:compareVersions", (_event, input: unknown) =>
    compareVersions(parseOrThrow(compareRequestSchema, input, "版本对比参数")),
  );
  ipcMain.handle("projects:gitOperation", (_event, projectPath: unknown, operation: unknown) =>
    recordGitOperation(projectPath, operation),
  );
  ipcMain.handle("projects:clone", (_event, input: unknown) => recordClone(input));
  ipcMain.handle("git:changedFiles", (_event, projectPath: unknown) =>
    listChangedFiles(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:stageFiles", (_event, projectPath: unknown, files: unknown) =>
    stageFiles(requireString(projectPath, "项目路径"), requireStringArray(files)),
  );
  ipcMain.handle("git:unstageFiles", (_event, projectPath: unknown, files: unknown) =>
    unstageFiles(requireString(projectPath, "项目路径"), requireStringArray(files)),
  );
  ipcMain.handle("git:commit", (_event, input: unknown) => recordCommit(input));
  ipcMain.handle("git:branches", (_event, projectPath: unknown) =>
    listBranches(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:createBranch", (_event, input: unknown) =>
    createBranch(parseOrThrow(createBranchInputSchema, input, "创建分支参数")),
  );
  ipcMain.handle("git:switchBranch", (_event, input: unknown) =>
    switchBranch(parseOrThrow(switchBranchInputSchema, input, "切换分支参数")),
  );
  ipcMain.handle("git:deleteBranch", (_event, input: unknown) =>
    deleteBranch(parseOrThrow(deleteBranchInputSchema, input, "删除分支参数")),
  );
  ipcMain.handle("git:history", (_event, projectPath: unknown) =>
    listCommitHistory(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("git:revert", (_event, input: unknown) =>
    revertCommit(parseOrThrow(revertCommitInputSchema, input, "回退提交参数")),
  );
  ipcMain.handle("projects:load", (_event, workspaceId: unknown) =>
    loadProjects(requireString(workspaceId, "工作区 ID")),
  );
  ipcMain.handle("projects:save", (_event, workspaceId: unknown, projects: unknown) =>
    saveProjects(
      requireString(workspaceId, "工作区 ID"),
      parseOrThrow(projectsSchema, projects, "项目数据"),
    ),
  );

  ipcMain.handle("workspaces:list", () => listWorkspaces());
  ipcMain.handle("workspaces:create", (_event, input: unknown) =>
    createWorkspace(parseOrThrow(createWorkspaceInputSchema, input, "工作区数据")),
  );
  ipcMain.handle("workspaces:rename", (_event, input: unknown) =>
    renameWorkspace(parseOrThrow(renameWorkspaceInputSchema, input, "工作区数据")),
  );
  ipcMain.handle("workspaces:delete", (_event, id: unknown) =>
    deleteWorkspace(requireString(id, "工作区 ID")),
  );

  ipcMain.handle("accounts:load", () => loadAccounts());
  ipcMain.handle("accounts:create", async (_event, input: unknown) => {
    const { provider, token } = parseOrThrow(createAccountInputSchema, input, "账号数据");
    const trimmed = token.trim();
    const { username } = await resolveTokenUser(provider, trimmed);
    return upsertAccount(provider, username, trimmed);
  });
  ipcMain.handle("accounts:test", (_event, accountId: unknown) =>
    testAccount(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("accounts:delete", (_event, accountId: unknown) =>
    deleteAccount(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:load", (_event, accountId: unknown) =>
    loadRemoteRepositories(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle(
    "remoteRepositories:loadCached",
    (_event, accountId: unknown) =>
      loadRemoteRepositoryCache(requireString(accountId, "账号 ID")) ?? [],
  );
  ipcMain.handle("remoteRepositories:cacheMeta", (_event, accountId: unknown) =>
    getRemoteRepositoryCacheMeta(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:create", (_event, input: unknown) =>
    createRemoteRepository(parseOrThrow(remoteRepositoryWriteInputSchema, input, "远程仓库参数")),
  );
  ipcMain.handle("remoteRepositories:update", (_event, input: unknown) =>
    updateRemoteRepository(parseOrThrow(remoteRepositoryWriteInputSchema, input, "远程仓库参数")),
  );
  ipcMain.handle("remoteRepositories:delete", (_event, accountId: unknown, repositoryId: unknown) =>
    deleteRemoteRepository(
      requireString(accountId, "账号 ID"),
      requireString(repositoryId, "仓库 ID"),
    ),
  );
  ipcMain.handle("remoteRepositories:search", (_event, input: unknown) => {
    const { provider, query, accountId } = parseOrThrow(
      remoteRepositorySearchInputSchema,
      input,
      "搜索参数",
    );
    return searchRemoteRepositories(provider, query, accountId);
  });
  ipcMain.handle("remoteRepositories:interact", (_event, input: unknown) => {
    const { accountId, owner, name, action } = parseOrThrow(
      repositoryInteractionInputSchema,
      input,
      "交互参数",
    );
    return toggleRepositoryInteraction(accountId, owner, name, action);
  });

  ipcMain.handle("tasks:listProfiles", () => listTaskProfiles());
  ipcMain.handle("tasks:saveProfile", (_event, input: unknown) =>
    saveTaskProfile(parseOrThrow(taskProfileSchema, input, "任务配置")),
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
    const validated = parseOrThrow(taskRunSchema, run, "任务运行记录");
    updateTaskRun(validated);
  });

  ipcMain.handle("backups:list", () => listBackups());
  ipcMain.handle("backups:create", (_event, input: unknown) =>
    createBackup(parseOrThrow(backupCreateInputSchema, input, "备份参数")),
  );
  ipcMain.handle("backups:restore", (_event, input: unknown) =>
    restoreBackup(parseOrThrow(backupRestoreInputSchema, input, "恢复参数")),
  );

  ipcMain.handle("operations:list", () => listOperationRecords());
  ipcMain.handle("operations:clear", () => clearOperationRecords());
  ipcMain.handle("operations:export", (_event, directory: unknown) =>
    exportOperationRecords(requireString(directory, "导出目录")),
  );
  ipcMain.handle("operations:record", (_event, record: unknown) => {
    insertOperationRecord(parseOrThrow(operationRecordSchema, record, "操作记录"));
  });

  ipcMain.handle("settings:load", () => loadSettings());
  ipcMain.handle("settings:save", (_event, settings: unknown) => {
    saveSettings(parseOrThrow(appSettingsSchema, settings, "设置数据"));
  });
  ipcMain.handle("projects:move", (_event, input: unknown) =>
    moveProject(parseOrThrow(moveProjectInputSchema, input, "移动项目参数")),
  );
  ipcMain.handle("ai:generateSummary", (_event, input: unknown) =>
    generateAiSummary(parseOrThrow(aiSummaryRequestSchema, input, "AI 摘要参数")),
  );
  ipcMain.handle("ai:saveKey", (_event, secret: unknown) => {
    saveAiApiKey(requireString(secret, "AI API Key"));
  });
  ipcMain.handle("ai:deleteKey", () => {
    deleteAiApiKey();
  });
  ipcMain.handle("ai:hasKey", () => hasStoredApiKey());

  ipcMain.handle("updater:check", async () => {
    const result = await checkForUpdates();
    if (result.hasUpdate && result.downloadUrl) {
      cachedDownloadUrl = result.downloadUrl;
    }
    return result;
  });

  ipcMain.handle("updater:download", async (event) => {
    if (!cachedDownloadUrl) {
      throw new Error("没有可用的更新");
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    return downloadUpdate(cachedDownloadUrl, (progress: UpdateProgress) => {
      win?.webContents.send("updater:progress", progress);
    });
  });

  ipcMain.handle("updater:install", async (_event, filePath: unknown) => {
    const installerPath = requireString(filePath, "安装包路径");
    // 该入参最终会被 cmd start 执行，必须限制在下载目录内且为 exe。
    if (!isTrustedInstallerPath(installerPath)) {
      throw new Error("安装包路径不受信任，已拒绝执行");
    }
    installUpdate(installerPath);
  });
}

async function recordGitOperation(
  projectPath: unknown,
  operation: unknown,
): Promise<GitOperationResult> {
  const path = requireString(projectPath, "项目路径");
  const op = parseOrThrow(gitOperationSchema, operation, "Git 操作");
  const result = await runGitOperation(path, op);
  recordOperation(op, path, result.output, result.success ? "ok" : "failed");
  return result;
}

async function recordClone(input: unknown): Promise<CloneRepositoryResult> {
  const validated = parseOrThrow(cloneRepositoryInputSchema, input, "克隆参数");
  const result = await cloneRepository(validated);
  recordOperation("clone", validated.targetPath, result.output, result.success ? "ok" : "failed");
  return result;
}

async function recordCommit(input: unknown): Promise<CommitResult> {
  const validated = parseOrThrow(commitRequestSchema, input, "提交参数");
  const result = await commitChanges(validated);
  recordOperation("commit", validated.path, result.output, result.success ? "ok" : "failed");
  return result;
}

function recordOperation(
  operation: string,
  path: string,
  detail: string,
  result: "ok" | "failed",
): void {
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("文件列表格式不正确");
  }
  return value;
}
