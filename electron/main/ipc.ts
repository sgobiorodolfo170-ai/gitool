import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { UpdateProgress } from "../../shared/types";
import { analyzeProject } from "./services/analysis";
import { deleteAiApiKey, generateAiSummary, hasStoredApiKey, saveAiApiKey } from "./services/ai";
import { createBackup, restoreBackup } from "./services/backups";
import { detectProjectCommands } from "./services/commandDetection";
import { openInEditor, openInTerminal } from "./services/openers";
import { recordClone, recordCommit, recordGitOperation } from "./services/operations";
import {
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
  loadCachedRemoteRepositories,
  loadRemoteRepositories,
  loadRemoteRepositoryCacheMeta,
  resolveTokenUser,
  searchRemoteRepositories,
  toggleRepositoryInteraction,
  testAccount,
  updateRemoteRepository,
} from "./services/providers";
import { deleteAccount, loadAccounts, upsertAccount } from "./services/storage/accounts";
// why 别名：ipc 只剩「按工作区列项目」一处正当用法，路径反查已下沉 services/operations.ts（A-21）
import { loadProjects as loadWorkspaceProjects, saveProjects } from "./services/storage/projects";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  renameWorkspace,
} from "./services/storage/workspaces";
import { listBackups } from "./services/storage/backups";
import {
  clearOperationRecords,
  exportOperationRecords,
  listOperationRecords,
} from "./services/storage/operations";
import { loadSettings, saveSettings } from "./services/storage/settings";
import {
  deleteTaskProfile,
  listTaskProfiles,
  listTaskRuns,
  saveTaskProfile,
} from "./services/storage/tasks";
import { getRunningTaskOutput, runTask, stopTask } from "./services/tasks";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  isTrustedInstallerPath,
} from "./services/updater";
import {
  aiSummaryRequestSchema,
  aiSecretSchema,
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
} from "./ipc/schemas";

let cachedDownloadUrl = "";
// 下载中再点「更新」会写同一个临时文件互相踩踏，用进行中标记挡住
let updateDownloadInFlight = false;

export function registerIpcHandlers(): void {
  ipcMain.handle("system:environment", () => getEnvironmentStatus());
  // 与 system:environment 同函数但语义独立：用于「安装完成后刷新」等显式触发（首启拉取走前者）
  ipcMain.handle("system:refreshEnvironment", () => getEnvironmentStatus());
  // 一键安装 Git：下载 → UAC 静默安装 → 写 gitPath → 返回体检；进度走 setup:installProgress 事件
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
  ipcMain.handle("shell:openTerminal", (_event, p: unknown) =>
    openInTerminal(requireString(p, "项目路径")),
  );

  ipcMain.handle("projects:inspect", (_event, p: unknown) =>
    inspectLocalProject(requireString(p, "项目路径")),
  );
  ipcMain.handle("projects:snapshot", (_event, projectPath: unknown) =>
    getProjectSnapshot(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:analyze", (_event, p: unknown) =>
    analyzeProject(requireString(p, "项目路径")),
  );
  ipcMain.handle("projects:detectCommands", (_event, projectPath: unknown) =>
    detectProjectCommands(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:diskSize", (_event, p: unknown) =>
    getDiskSize(requireString(p, "项目路径")),
  );
  ipcMain.handle("projects:readme", (_event, p: unknown) =>
    readProjectReadme(requireString(p, "项目路径")),
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
  ipcMain.handle("git:tags", (_event, p: unknown) => listTags(requireString(p, "项目路径")));
  ipcMain.handle("git:createTag", (_event, input: unknown) =>
    createTag(parseOrThrow(createTagInputSchema, input, "创建标签参数")),
  );
  ipcMain.handle("git:deleteTag", (_event, projectPath: unknown, name: unknown) =>
    deleteTag(requireString(projectPath, "项目路径"), requireString(name, "标签名")),
  );
  ipcMain.handle("git:listVersions", (_event, p: unknown) =>
    listVersions(requireString(p, "项目路径")),
  );
  ipcMain.handle("git:compareVersions", (_event, input: unknown) =>
    compareVersions(parseOrThrow(compareRequestSchema, input, "版本对比参数")),
  );
  ipcMain.handle("projects:gitOperation", (_event, p: unknown, o: unknown) =>
    recordGitOperation(
      requireString(p, "项目路径"),
      parseOrThrow(gitOperationSchema, o, "Git 操作"),
    ),
  );
  ipcMain.handle("projects:clone", (_event, input: unknown) =>
    recordClone(parseOrThrow(cloneRepositoryInputSchema, input, "克隆参数")),
  );
  ipcMain.handle("git:changedFiles", (_event, p: unknown) =>
    listChangedFiles(requireString(p, "项目路径")),
  );
  ipcMain.handle("git:stageFiles", (_event, projectPath: unknown, files: unknown) =>
    stageFiles(requireString(projectPath, "项目路径"), requireStringArray(files)),
  );
  ipcMain.handle("git:unstageFiles", (_event, projectPath: unknown, files: unknown) =>
    unstageFiles(requireString(projectPath, "项目路径"), requireStringArray(files)),
  );
  ipcMain.handle("git:commit", (_event, i: unknown) =>
    recordCommit(parseOrThrow(commitRequestSchema, i, "提交参数")),
  );
  ipcMain.handle("git:branches", (_event, p: unknown) =>
    listBranches(requireString(p, "项目路径")),
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
  ipcMain.handle("git:history", (_event, p: unknown) =>
    listCommitHistory(requireString(p, "项目路径")),
  );
  ipcMain.handle("git:revert", (_event, input: unknown) =>
    revertCommit(parseOrThrow(revertCommitInputSchema, input, "回退提交参数")),
  );
  ipcMain.handle("projects:load", (_event, id: unknown) =>
    loadWorkspaceProjects(requireString(id, "工作区 ID")),
  );
  ipcMain.handle("projects:save", (_event, id: unknown, projects: unknown) =>
    saveProjects(
      requireString(id, "工作区 ID"),
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
  ipcMain.handle("accounts:test", (_event, id: unknown) =>
    testAccount(requireString(id, "账号 ID")),
  );
  ipcMain.handle("accounts:delete", (_event, id: unknown) =>
    deleteAccount(requireString(id, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:load", (_event, accountId: unknown) =>
    loadRemoteRepositories(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:loadCached", (_event, accountId: unknown) =>
    loadCachedRemoteRepositories(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:cacheMeta", (_event, accountId: unknown) =>
    loadRemoteRepositoryCacheMeta(requireString(accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:create", (_event, input: unknown) =>
    createRemoteRepository(parseOrThrow(remoteRepositoryWriteInputSchema, input, "远程仓库参数")),
  );
  ipcMain.handle("remoteRepositories:update", (_event, input: unknown) =>
    updateRemoteRepository(parseOrThrow(remoteRepositoryWriteInputSchema, input, "远程仓库参数")),
  );
  ipcMain.handle("remoteRepositories:delete", (_event, a: unknown, r: unknown) =>
    deleteRemoteRepository(requireString(a, "账号 ID"), requireString(r, "仓库 ID")),
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
  // running 记录的 insert 已移入 runTask（A-22）：旧实现在 runTask 返回后才落库，
  // 子进程若瞬间结束，close 回调的 UPDATE 会打到不存在的行（记录永远停在 running）。
  ipcMain.handle("tasks:run", (_event, id: unknown) => runTask(requireString(id, "任务 ID")));
  ipcMain.handle("tasks:stop", (_event, id: unknown) => stopTask(requireString(id, "运行 ID")));
  ipcMain.handle("tasks:listRuns", () => listTaskRuns());
  ipcMain.handle("tasks:getRunningOutput", (_event, runId: unknown) =>
    getRunningTaskOutput(requireString(runId, "运行 ID")),
  );

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
    saveAiApiKey(parseOrThrow(aiSecretSchema, secret, "AI API Key"));
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
    if (updateDownloadInFlight) {
      throw new Error("更新包正在下载中，请稍候");
    }
    if (!cachedDownloadUrl) {
      throw new Error("没有可用的更新");
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    updateDownloadInFlight = true;
    try {
      return await downloadUpdate(cachedDownloadUrl, (progress: UpdateProgress) => {
        win?.webContents.send("updater:progress", progress);
      });
    } finally {
      updateDownloadInFlight = false;
    }
  });

  ipcMain.handle("updater:install", async (_event, filePath: unknown) => {
    const installerPath = requireString(filePath, "安装包路径");
    // 该入参最终由 spawn 直接执行（已移除 cmd 链路），必须限制在下载目录内且命中文件名白名单。
    if (!isTrustedInstallerPath(installerPath)) {
      throw new Error("安装包路径不受信任，已拒绝执行");
    }
    // 必须 return：installUpdate 启动失败时是 reject 而不是 throw，
    // 不返回这个 Promise，错误只会在主进程内部变成一条日志，渲染层收不到任何反馈
    return installUpdate(installerPath);
  });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
  return value;
}

// IPC 是公开攻击面：字符串数组必须有总量与单项长度上限
const MAX_IPC_ARRAY_ITEMS = 10000;
const MAX_IPC_ITEM_LENGTH = 4096;

function requireStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_IPC_ARRAY_ITEMS ||
    !value.every((item) => typeof item === "string" && item.length <= MAX_IPC_ITEM_LENGTH)
  ) {
    throw new Error("文件列表格式不正确");
  }
  return value;
}
