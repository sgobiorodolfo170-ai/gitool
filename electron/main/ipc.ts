import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { UpdateProgress } from "../../shared/types";
import { analyzeProject } from "./services/analysis";
import { deleteAiApiKey, generateAiSummary, hasStoredApiKey, saveAiApiKey } from "./services/ai";
import { createBackup, restoreBackup } from "./services/backups";
import { detectProjectCommands } from "./services/commandDetection";
import { openInEditor, openInTerminal } from "./services/openers";
import { recordClone, recordCommit, recordGitOperation } from "./services/operations";
import {
  assertLocalAbsolutePath,
  assertPathAllowed,
  assertRegistrableProjectPath,
  collectAllowedRoots,
  pathsNeedingValidation,
  PathPolicyError,
} from "./services/pathPolicy";
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
  externalUrlSchema,
  fileDiffRequestSchema,
  fileListSchema,
  gitOperationSchema,
  idSchema,
  initRepositoryInputSchema,
  localPathSchema,
  moveProjectInputSchema,
  openEditorInputSchema,
  parseOrThrow,
  projectsSchema,
  refNameSchema,
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

/**
 * 本次进程内由 system:selectDirectory 选出的目录。
 *
 * why 需要会话例外：导入、新建仓库、批量扫描、克隆、移动、备份、导出面对的都是
 * 「尚未登记」的新目录，唯一可信来源是用户亲自在系统对话框里选择。把对话框返回值
 * 登记为会话级允许根，正常流程全部放行，而渲染层无法凭空构造同样的一条记录。
 *
 * why 设上限：对话框虽然需要用户操作，但渲染层可反复触发；用 FIFO 上限避免集合
 * 在长驻进程里无限增长（超出上限只影响很早以前选过的目录，用户重新选择即可）。
 */
const MAX_SESSION_DIRECTORIES = 64;
const sessionSelectedDirectories: string[] = [];

function rememberSessionDirectory(directory: string): void {
  if (sessionSelectedDirectories.includes(directory)) {
    return;
  }
  sessionSelectedDirectories.push(directory);
  if (sessionSelectedDirectories.length > MAX_SESSION_DIRECTORIES) {
    sessionSelectedDirectories.shift();
  }
}

/**
 * 已登记项目路径（跨全部工作区）。
 *
 * why 不用 storage/projects 的 findByPath(target)：这里需要「根目录集合」而不是单点反查；
 * 项目可能属于任意工作区，只查当前工作区会误拒其他工作区的正常操作。
 * why 每次现查而不缓存：路径准入是安全边界，宁可多一次索引查询也不能用过期集合；
 * 这些 handler 都是用户触发，查询开销远小于紧随其后的一次 git/磁盘操作。
 */
function registeredProjectPaths(): string[] {
  return listWorkspaces().flatMap((workspace) =>
    loadWorkspaceProjects(workspace.id).map((project) => project.path),
  );
}

/**
 * 项目路径类通道的允许根：用户主目录 + 已登记项目路径 + 会话内对话框选出的目录。
 *
 * why 主目录：绝大多数项目就放在主目录下，且「用户自己的目录」是纵深防御里可以
 * 接受的信任边界——威胁是 UNC / 系统目录 / 任意可写目录，而不是用户自己的文件。
 */
function projectPathRoots(): string[] {
  return collectAllowedRoots({
    registeredProjectPaths: registeredProjectPaths(),
    extraRoots: sessionSelectedDirectories,
  });
}

/**
 * 导出类通道的允许根：用户主目录 + 设置里的默认备份目录 + 会话内选择的目录。
 * why 不包含已登记项目：导出 CSV 没有任何理由写进项目目录，收紧一层。
 */
function exportPathRoots(): string[] {
  return collectAllowedRoots({
    backupDirectory: defaultBackupDirectory(),
    extraRoots: sessionSelectedDirectories,
  });
}

/** 读取默认备份目录；读不到就退化为「主目录 + 会话目录」，安全性不下降。 */
function defaultBackupDirectory(): string | null {
  try {
    return loadSettings().defaultBackupDirectory.trim() || null;
  } catch {
    // why 吞掉异常：一条无关配置读取失败不应让导出整体不可用；此时仍有两道放行面。
    return null;
  }
}

/**
 * 项目路径类通道的语义准入：已校验字符串 → 本机绝对路径 → 允许根。
 * why 收在一处：打开、读取、git 操作这一族通道的放行面必须完全一致，
 * 散落实现最容易出现「某个 handler 忘了校验」。
 * why 只做语义：类型/长度层由每个调用点显式 `parseOrThrow(localPathSchema, ...)` 完成，
 * 这样每个 handler 代码块都直接可见校验调用，源码级门禁不必再解析 helper 间接层。
 */
function requireAllowedProjectPath(path: string, label = "项目路径"): string {
  return assertPathAllowed(path, projectPathRoots(), label);
}

export function registerIpcHandlers(): void {
  ipcMain.handle("system:environment", () => getEnvironmentStatus());
  // 与 system:environment 同函数但语义独立：用于「安装完成后刷新」等显式触发（首启拉取走前者）
  ipcMain.handle("system:refreshEnvironment", () => getEnvironmentStatus());
  // 一键安装 Git：下载 → UAC 静默安装 → 写 gitPath → 返回体检；进度走 setup:installProgress 事件
  ipcMain.handle("system:installGit", async () => installGit());

  ipcMain.handle("system:selectDirectory", async (event, defaultPath: unknown) => {
    // why 归入「无入参」通道：defaultPath 只是对话框的初始位置提示，非法值会被
    // safeDialogDefaultPath 丢弃，本通道不接收任何业务入参；真正的安全边界在返回值
    // 处——selected 由 assertLocalAbsolutePath（pathPolicy）校验后才登记为会话允许根。
    // coverage.test 因此把 system:selectDirectory 列入 NO_INPUT_CHANNELS。
    const owner = BrowserWindow.fromWebContents(event.sender);
    const properties = ["openDirectory", "createDirectory"] as const;
    const options = {
      properties: [...properties],
      // why 先校验默认路径：它只是对话框的「打开位置」提示，UNC 默认值会让对话框自己
      // 去连共享（同样触发 SMB 认证）；非法提示直接忽略，不必让选择流程失败。
      defaultPath: safeDialogDefaultPath(defaultPath),
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const selected = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!selected) {
      return null;
    }
    // why 在返回值处立刻拦 UNC：该字符串会被后续 scan/init/备份/导出直接当本地路径使用，
    // 一旦网络共享流进 fs/git 调用，就等于主进程替攻击者发起出站认证（Net-NTLMv2 泄露）。
    const validated = assertLocalAbsolutePath(selected, "所选目录");
    rememberSessionDirectory(validated);
    return validated;
  });

  ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
    // why schema：只判协议前缀不足以防载荷失界；externalUrlSchema 统一负责
    // 「非空 + 长度 ≤2048 + 拒控制字符 + 仅 http(s)」，错误文案与原实现一致。
    await shell.openExternal(parseOrThrow(externalUrlSchema, url, "链接"));
  });

  ipcMain.handle("shell:openPath", async (_event, projectPath: unknown) => {
    // why root：资源管理器只打开项目；主目录/已登记项目/会话选择目录之外一律不打开，
    // 防止渲染层把 UNC 共享交给主进程（SMB 出站认证）。
    const path = requireAllowedProjectPath(parseOrThrow(localPathSchema, projectPath, "项目路径"));
    const errorMessage = await shell.openPath(path);
    if (errorMessage) {
      throw new Error(`无法在资源管理器中打开：${errorMessage}`);
    }
  });

  ipcMain.handle("shell:openEditor", (_event, input: unknown) => {
    const editorInput = parseOrThrow(openEditorInputSchema, input, "编辑器参数");
    // why root：编辑器进程会读取/写入该目录，与 openPath/openTerminal 同一条信任边界。
    assertPathAllowed(editorInput.path, projectPathRoots(), "项目路径");
    return openInEditor(editorInput.path, editorInput.editor, editorInput.newWindow);
  });
  ipcMain.handle("shell:openTerminal", (_event, p: unknown) => {
    // why root：终端 cwd 会继承给用户后续命令，绝不能让任意目录/UNC 成为命令起点。
    return openInTerminal(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径")));
  });

  ipcMain.handle("projects:inspect", (_event, p: unknown) =>
    // why root：inspect 会读目录元数据；只允许主目录/已登记项目/会话选择目录。
    inspectLocalProject(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"))),
  );
  ipcMain.handle("projects:snapshot", (_event, projectPath: unknown) =>
    // why root：快照会执行 git 读取，路径必须落在同一条信任边界内。
    getProjectSnapshot(
      requireAllowedProjectPath(parseOrThrow(localPathSchema, projectPath, "项目路径")),
    ),
  );
  ipcMain.handle("projects:analyze", (_event, p: unknown) =>
    // why root：分析会递归遍历目录，任意路径等于把整盘结构暴露给渲染层。
    analyzeProject(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"))),
  );
  ipcMain.handle("projects:detectCommands", (_event, projectPath: unknown) =>
    // why root：命令探测会读取项目内配置文件，禁止指向未授权目录。
    detectProjectCommands(
      requireAllowedProjectPath(parseOrThrow(localPathSchema, projectPath, "项目路径")),
    ),
  );
  ipcMain.handle("projects:diskSize", (_event, p: unknown) =>
    // why root：磁盘统计会递归读取目录，必须限制在允许根内。
    getDiskSize(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"))),
  );
  ipcMain.handle("projects:readme", (_event, p: unknown) =>
    // why root：readme 曾能读任意目录的 README，这里按项目路径同一放行面收紧。
    readProjectReadme(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"))),
  );
  ipcMain.handle("projects:init", (_event, input: unknown) => {
    const parsed = parseOrThrow(initRepositoryInputSchema, input, "初始化仓库参数");
    // why 显式例外：新建仓库目标尚未登记，root 由 projectPathRoots 追加本次
    // selectDirectory 的返回值；用户没在对话框里选过父目录就无法通过。
    assertPathAllowed(parsed.path, projectPathRoots(), "初始化路径");
    return initRepository(parsed);
  });
  ipcMain.handle("projects:scanDirectory", (_event, directory: unknown) => {
    const target = parseOrThrow(localPathSchema, directory, "目录");
    // why 显式例外：批量导入的待扫描目录一定尚未登记，只允许会话内对话框选中的目录；
    // 扫描结果里的子仓库同样落在该目录之下，后续导入不会被误拒。
    assertPathAllowed(target, projectPathRoots(), "目录");
    return scanDirectoryForRepositories(target);
  });
  ipcMain.handle("projects:fileDiff", (_event, input: unknown) => {
    const parsed = parseOrThrow(fileDiffRequestSchema, input, "差异查看参数");
    // why root：diff 读取项目内文件，项目路径必须已登记或由本次对话框选中。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return getFileDiff(parsed);
  });
  ipcMain.handle("projects:setRemoteUrl", (_event, input: unknown) => {
    const parsed = parseOrThrow(setRemoteUrlInputSchema, input, "远程地址参数");
    // why root：写 remote 会改动项目 .git/config，项目路径必须落在允许根内。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return setRemoteUrl(parsed);
  });
  ipcMain.handle("git:tags", (_event, p: unknown) => {
    // why root：标签读取走 git 命令，cwd 必须是已登记/会话选中的项目。
    return listTags(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径")));
  });
  ipcMain.handle("git:createTag", (_event, input: unknown) => {
    const parsed = parseOrThrow(createTagInputSchema, input, "创建标签参数");
    // why root：写标签会改动项目引用，只允许已登记/会话选中的项目路径。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return createTag(parsed);
  });
  ipcMain.handle("git:deleteTag", (_event, projectPath: unknown, name: unknown) => {
    // why root：删标签同属写操作，项目路径先过同一放行面。
    const target = requireAllowedProjectPath(
      parseOrThrow(localPathSchema, projectPath, "项目路径"),
    );
    return deleteTag(target, parseOrThrow(refNameSchema, name, "标签名"));
  });
  ipcMain.handle("git:listVersions", (_event, p: unknown) => {
    // why root：版本列表依赖 git 读取项目历史。
    return listVersions(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径")));
  });
  ipcMain.handle("git:compareVersions", (_event, input: unknown) => {
    const parsed = parseOrThrow(compareRequestSchema, input, "版本对比参数");
    // why root：版本对比会 checkout/读取项目内容，路径必须落在允许根内。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return compareVersions(parsed);
  });
  ipcMain.handle("projects:gitOperation", (_event, p: unknown, o: unknown) => {
    // why root：操作日志按项目路径归组并执行 git 动作，路径必须受控。
    const projectPath = requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"));
    return recordGitOperation(projectPath, parseOrThrow(gitOperationSchema, o, "Git 操作"));
  });
  ipcMain.handle("projects:clone", (_event, input: unknown) => {
    const parsed = parseOrThrow(cloneRepositoryInputSchema, input, "克隆参数");
    // why root：targetPath 是克隆的写入位置（父目录来自对话框，值为其子目录）；
    // 落在主目录/已登记项目/会话选择目录之下才允许，否则等于任意目录写入。
    assertPathAllowed(parsed.targetPath, projectPathRoots(), "克隆目标目录");
    return recordClone(parsed);
  });
  ipcMain.handle("git:changedFiles", (_event, p: unknown) => {
    // why root：变更列表读取项目工作区状态。
    return listChangedFiles(
      requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径")),
    );
  });
  ipcMain.handle("git:stageFiles", (_event, projectPath: unknown, files: unknown) => {
    // why root：暂存会写项目索引，项目路径必须已登记/由本次对话框选中。
    return stageFiles(
      requireAllowedProjectPath(parseOrThrow(localPathSchema, projectPath, "项目路径")),
      parseOrThrow(fileListSchema, files, "文件列表"),
    );
  });
  ipcMain.handle("git:unstageFiles", (_event, projectPath: unknown, files: unknown) => {
    // why root：取消暂存同样是项目索引写操作。
    return unstageFiles(
      requireAllowedProjectPath(parseOrThrow(localPathSchema, projectPath, "项目路径")),
      parseOrThrow(fileListSchema, files, "文件列表"),
    );
  });
  ipcMain.handle("git:commit", (_event, i: unknown) => {
    const parsed = parseOrThrow(commitRequestSchema, i, "提交参数");
    // why root：提交会写入项目历史，路径必须落在允许根内。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return recordCommit(parsed);
  });
  ipcMain.handle("git:branches", (_event, p: unknown) => {
    // why root：分支列表依赖 git 读取项目引用。
    return listBranches(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径")));
  });
  ipcMain.handle("git:createBranch", (_event, input: unknown) => {
    const parsed = parseOrThrow(createBranchInputSchema, input, "创建分支参数");
    // why root：创建分支会写项目引用。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return createBranch(parsed);
  });
  ipcMain.handle("git:switchBranch", (_event, input: unknown) => {
    const parsed = parseOrThrow(switchBranchInputSchema, input, "切换分支参数");
    // why root：切换分支会改动工作区文件，路径必须受控。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return switchBranch(parsed);
  });
  ipcMain.handle("git:deleteBranch", (_event, input: unknown) => {
    const parsed = parseOrThrow(deleteBranchInputSchema, input, "删除分支参数");
    // why root：删除分支是破坏性写操作，项目路径必须受控。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return deleteBranch(parsed);
  });
  ipcMain.handle("git:history", (_event, p: unknown) => {
    // why root：提交历史读取走 git 命令，cwd 必须受控。
    return listCommitHistory(
      requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径")),
    );
  });
  ipcMain.handle("git:revert", (_event, input: unknown) => {
    const parsed = parseOrThrow(revertCommitInputSchema, input, "回退提交参数");
    // why root：回退会重写项目文件，路径必须落在允许根内。
    assertPathAllowed(parsed.path, projectPathRoots(), "项目路径");
    return revertCommit(parsed);
  });
  ipcMain.handle("projects:load", (_event, id: unknown) =>
    loadWorkspaceProjects(parseOrThrow(idSchema, id, "工作区 ID")),
  );
  ipcMain.handle("projects:save", (_event, id: unknown, projects: unknown) => {
    const workspaceId = parseOrThrow(idSchema, id, "工作区 ID");
    const parsed = parseOrThrow(projectsSchema, projects, "项目数据");
    // why 先读当前已登记路径：save 是整表覆盖，只有「新增/换路径」的条目才可能扩大
    // A-11 白名单，未变的既有路径重复校验没有安全收益，还会被离线盘误伤。
    const existingPaths = new Set(
      loadWorkspaceProjects(workspaceId).map((project) => project.path),
    );
    // why 只校验差集：U 盘拔出、网络盘未挂载、目录被手工删除时，收藏/改别名/删除项目
    // 等无关操作不应整批失败；差集校验仍能拦住「凭空登记系统目录/盘符根」的后门。
    // 差集任一失败即抛错，且校验发生在 saveProjects 之前，不会出现部分写入。
    const pendingPaths = pathsNeedingValidation(parsed, existingPaths);
    for (const path of pendingPaths) {
      try {
        assertRegistrableProjectPath(path);
      } catch (error) {
        // why 只回显路径：错误会进 UI/日志，不能把 name/remote 等其他字段一起带出去。
        const reason = error instanceof Error ? error.message : String(error);
        throw new PathPolicyError(`无法登记项目路径「${path}」：${reason}`);
      }
    }
    return saveProjects(workspaceId, parsed);
  });

  ipcMain.handle("workspaces:list", () => listWorkspaces());
  ipcMain.handle("workspaces:create", (_event, input: unknown) =>
    createWorkspace(parseOrThrow(createWorkspaceInputSchema, input, "工作区数据")),
  );
  ipcMain.handle("workspaces:rename", (_event, input: unknown) =>
    renameWorkspace(parseOrThrow(renameWorkspaceInputSchema, input, "工作区数据")),
  );
  ipcMain.handle("workspaces:delete", (_event, id: unknown) =>
    deleteWorkspace(parseOrThrow(idSchema, id, "工作区 ID")),
  );

  ipcMain.handle("accounts:load", () => loadAccounts());
  ipcMain.handle("accounts:create", async (_event, input: unknown) => {
    const { provider, token } = parseOrThrow(createAccountInputSchema, input, "账号数据");
    const trimmed = token.trim();
    const { username } = await resolveTokenUser(provider, trimmed);
    return upsertAccount(provider, username, trimmed);
  });
  ipcMain.handle("accounts:test", (_event, id: unknown) =>
    testAccount(parseOrThrow(idSchema, id, "账号 ID")),
  );
  ipcMain.handle("accounts:delete", (_event, id: unknown) =>
    deleteAccount(parseOrThrow(idSchema, id, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:load", (_event, accountId: unknown) =>
    loadRemoteRepositories(parseOrThrow(idSchema, accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:loadCached", (_event, accountId: unknown) =>
    loadCachedRemoteRepositories(parseOrThrow(idSchema, accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:cacheMeta", (_event, accountId: unknown) =>
    loadRemoteRepositoryCacheMeta(parseOrThrow(idSchema, accountId, "账号 ID")),
  );
  ipcMain.handle("remoteRepositories:create", (_event, input: unknown) =>
    createRemoteRepository(parseOrThrow(remoteRepositoryWriteInputSchema, input, "远程仓库参数")),
  );
  ipcMain.handle("remoteRepositories:update", (_event, input: unknown) =>
    updateRemoteRepository(parseOrThrow(remoteRepositoryWriteInputSchema, input, "远程仓库参数")),
  );
  ipcMain.handle("remoteRepositories:delete", (_event, a: unknown, r: unknown) =>
    deleteRemoteRepository(
      parseOrThrow(idSchema, a, "账号 ID"),
      parseOrThrow(idSchema, r, "仓库 ID"),
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
    deleteTaskProfile(parseOrThrow(idSchema, id, "任务 ID")),
  );
  // running 记录的 insert 已移入 runTask（A-22）：旧实现在 runTask 返回后才落库，
  // 子进程若瞬间结束，close 回调的 UPDATE 会打到不存在的行（记录永远停在 running）。
  ipcMain.handle("tasks:run", (_event, id: unknown) =>
    runTask(parseOrThrow(idSchema, id, "任务 ID")),
  );
  ipcMain.handle("tasks:stop", (_event, id: unknown) =>
    stopTask(parseOrThrow(idSchema, id, "运行 ID")),
  );
  ipcMain.handle("tasks:listRuns", () => listTaskRuns());
  ipcMain.handle("tasks:getRunningOutput", (_event, runId: unknown) =>
    getRunningTaskOutput(parseOrThrow(idSchema, runId, "运行 ID")),
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
  ipcMain.handle("operations:export", (_event, directory: unknown) => {
    const target = parseOrThrow(localPathSchema, directory, "导出目录");
    // why root：导出目录只允许主目录、设置里的备份目录或本次对话框选中的目录；
    // 放任任意可写目录（尤其 UNC）会让操作日志 CSV 被写到共享/系统位置。
    assertPathAllowed(target, exportPathRoots(), "导出目录");
    return exportOperationRecords(target);
  });

  ipcMain.handle("settings:load", () => loadSettings());
  ipcMain.handle("settings:save", (_event, settings: unknown) => {
    saveSettings(parseOrThrow(appSettingsSchema, settings, "设置数据"));
  });
  ipcMain.handle("projects:move", (_event, input: unknown) => {
    const parsed = parseOrThrow(moveProjectInputSchema, input, "移动项目参数");
    // why root：移动会复制整棵项目目录并更新记录；源必须是已登记项目，
    // 目标必须是主目录/会话选择目录，避免渲染层借「移动」做任意目录搬运。
    assertPathAllowed(parsed.sourcePath, projectPathRoots(), "源路径");
    assertPathAllowed(parsed.targetDirectory, projectPathRoots(), "目标目录");
    return moveProject(parsed);
  });
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
    const installerPath = parseOrThrow(localPathSchema, filePath, "安装包路径");
    // why 白名单不搬进 schema：可信根（下载目录）与文件名规则属于 updater 服务的
    // 业务约束，会随更新机制演进；schema 只守类型/长度/控制字符，避免两处规则漂移。
    // 该入参最终由 spawn 直接执行（已移除 cmd 链路），必须限制在下载目录内且命中文件名白名单。
    if (!isTrustedInstallerPath(installerPath)) {
      throw new Error("安装包路径不受信任，已拒绝执行");
    }
    // 必须 return：installUpdate 启动失败时是 reject 而不是 throw，
    // 不返回这个 Promise，错误只会在主进程内部变成一条日志，渲染层收不到任何反馈
    return installUpdate(installerPath);
  });
}

/**
 * 对话框「打开位置」提示的安全化：非法提示（UNC / 相对 / 穿越）直接忽略。
 * why 不抛错：defaultPath 只是建议位置，拒绝它没有安全收益，反而会让选择流程中断；
 * 真正的边界在返回值处（assertLocalAbsolutePath + 会话登记）。
 */
function safeDialogDefaultPath(value: unknown): string | undefined {
  // why safeParse 而不是 parseOrThrow：defaultPath 只是「打开位置」提示，非法值
  // （非字符串/空/超长/控制字符）直接忽略即可，不该让选择流程失败。
  // 类型/长度层复用 localPathSchema，与其它路径通道同口径，避免这里成为长度盲区。
  const parsed = localPathSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  try {
    return assertLocalAbsolutePath(parsed.data, "默认路径");
  } catch {
    return undefined;
  }
}
