import type { Project } from "../types";

const STORAGE_KEY_PREFIX = "gitool.projects.";

const LEGACY_STORAGE_KEY = "gitool.projects";

export function loadProjects(workspaceId: string): Project[] {
  const key = storageKeyForWorkspace(workspaceId);
  migrateLegacyStorageIfNeeded(workspaceId);
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

export function saveProjects(workspaceId: string, projects: Project[]) {
  localStorage.setItem(storageKeyForWorkspace(workspaceId), JSON.stringify(projects));
}

function storageKeyForWorkspace(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}${workspaceId}`;
}

function migrateLegacyStorageIfNeeded(workspaceId: string): void {
  if (workspaceId !== "default") return;
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy) return;
  const targetKey = storageKeyForWorkspace(workspaceId);
  if (localStorage.getItem(targetKey) === null) {
    localStorage.setItem(targetKey, legacy);
  }
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
