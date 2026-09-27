import type { CreateWorkspaceInput, RenameWorkspaceInput, WorkspaceEntity } from "../types";

const STORAGE_KEY = "gitool.workspaces";

export const DEFAULT_WORKSPACE_ID = "default";

export function listWorkspaces(): WorkspaceEntity[] {
  ensureSeeded();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed)) {
      return parsed as WorkspaceEntity[];
    }
  } catch {
    // 忽略损坏数据，回退到默认工作区
  }
  const fallback = seedDefaultWorkspace();
  return [fallback];
}

export function createWorkspace(input: CreateWorkspaceInput): WorkspaceEntity {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("工作区名称不能为空");
  }
  const now = new Date().toISOString();
  const workspace: WorkspaceEntity = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
  };
  const all = listWorkspaces();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...all, workspace]));
  return workspace;
}

export function renameWorkspace(input: RenameWorkspaceInput): void {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("工作区名称不能为空");
  }
  const all = listWorkspaces();
  const next = all.map((workspace) => (
    workspace.id === input.id
      ? { ...workspace, name, updatedAt: new Date().toISOString() }
      : workspace
  ));
  if (!next.some((workspace) => workspace.id === input.id)) {
    throw new Error("工作区不存在");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function deleteWorkspace(id: string): void {
  const all = listWorkspaces();
  if (all.length <= 1) {
    throw new Error("至少保留一个工作区，无法删除最后一个工作区");
  }
  const next = all.filter((workspace) => workspace.id !== id);
  if (next.length === all.length) {
    throw new Error("工作区不存在");
  }
  const projectKey = projectStorageKey(id);
  const stored = localStorage.getItem(projectKey);
  if (stored) {
    try {
      const projects: unknown = JSON.parse(stored);
      if (Array.isArray(projects) && projects.length > 0) {
        throw new Error(`该工作区还有 ${projects.length} 个项目，请先清空或移动项目后再删除`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("该工作区还有")) {
        throw error;
      }
    }
  }
  localStorage.removeItem(projectKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function projectStorageKey(workspaceId: string): string {
  return `gitool.projects.${workspaceId}`;
}

function ensureSeeded(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      seedDefaultWorkspace();
    }
  } catch {
    // ignore
  }
}

function seedDefaultWorkspace(): WorkspaceEntity {
  const now = new Date().toISOString();
  const workspace: WorkspaceEntity = {
    id: DEFAULT_WORKSPACE_ID,
    name: "个人工作区",
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify([workspace]));
  return workspace;
}