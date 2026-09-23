import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { CreateAccountInput, GitOperation, Project } from "../../shared/types";
import { analyzeProject } from "./services/analysis";
import {
  getEnvironmentStatus,
  getProjectSnapshot,
  inspectLocalProject,
  runGitOperation,
} from "./services/git";
import { loadRemoteRepositories, testAccount } from "./services/providers";
import {
  createAccount,
  deleteAccount,
  loadAccounts,
  loadProjects,
  saveProjects,
} from "./services/storage";

export function registerIpcHandlers(): void {
  ipcMain.handle("system:environment", () => getEnvironmentStatus());

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

  ipcMain.handle("projects:inspect", (_event, projectPath: unknown) =>
    inspectLocalProject(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:snapshot", (_event, projectPath: unknown) =>
    getProjectSnapshot(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:analyze", (_event, projectPath: unknown) =>
    analyzeProject(requireString(projectPath, "项目路径")),
  );
  ipcMain.handle("projects:gitOperation", (_event, projectPath: unknown, operation: unknown) =>
    runGitOperation(requireString(projectPath, "项目路径"), requireGitOperation(operation)),
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
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
  return value;
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
