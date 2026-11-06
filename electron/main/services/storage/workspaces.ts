import type {
  CreateWorkspaceInput,
  RenameWorkspaceInput,
  WorkspaceEntity,
} from "../../../../shared/types";
import { openDatabase, rowToWorkspace, type SqlRow } from "./database";

/**
 * 工作区数据域：列表、创建、重命名、删除。
 *
 * 删除守卫两条（行为约定，勿破坏）：
 * 1. 至少保留一个工作区——UI 依赖「永远有当前工作区」这一不变量；
 * 2. 工作区下还有项目时禁止删除——项目归属 workspaceId，删除会让项目失联。
 */

export function listWorkspaces(): WorkspaceEntity[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, name, createdAt, updatedAt FROM workspaces ORDER BY createdAt ASC, name ASC`,
    )
    .all() as unknown as SqlRow[];
  return rows.map(rowToWorkspace);
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
  const connection = openDatabase();
  connection
    .prepare(`INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`)
    .run(workspace.id, workspace.name, workspace.createdAt, workspace.updatedAt);
  return workspace;
}

export function renameWorkspace(input: RenameWorkspaceInput): void {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("工作区名称不能为空");
  }
  const connection = openDatabase();
  const existing = connection.prepare("SELECT id FROM workspaces WHERE id = ?").get(input.id) as
    SqlRow | undefined;
  if (!existing) {
    throw new Error("工作区不存在");
  }
  connection
    .prepare("UPDATE workspaces SET name = ?, updatedAt = ? WHERE id = ?")
    .run(name, new Date().toISOString(), input.id);
}

export function deleteWorkspace(id: string): void {
  const connection = openDatabase();
  const count = Number(
    (connection.prepare("SELECT COUNT(*) AS total FROM workspaces").get() as SqlRow).total,
  );
  if (count <= 1) {
    throw new Error("至少保留一个工作区，无法删除最后一个工作区");
  }
  const existing = connection.prepare("SELECT id FROM workspaces WHERE id = ?").get(id) as
    SqlRow | undefined;
  if (!existing) {
    throw new Error("工作区不存在");
  }
  const projectCount = Number(
    (
      connection
        .prepare("SELECT COUNT(*) AS total FROM projects WHERE workspaceId = ?")
        .get(id) as SqlRow
    ).total,
  );
  if (projectCount > 0) {
    throw new Error(`该工作区还有 ${projectCount} 个项目，请先清空或移动项目后再删除`);
  }
  connection.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}
