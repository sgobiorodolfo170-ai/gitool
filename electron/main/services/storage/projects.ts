import type { Project } from "../../../../shared/types";
import { errorMessage } from "../serviceUtils";
import { openDatabase, rowToProject, type SqlRow } from "./database";

/**
 * 项目数据域：按工作区加载与整表保存。
 *
 * 保存语义（渲染层 useProjects 的 projectsRef + saveQueueRef 串行调用本接口，
 * 后端职责是保证单次写入的事务性与等幂覆盖，改动时勿破坏）：
 * - BEGIN/COMMIT 整体事务，失败 ROLLBACK 并抛「本地数据存储失败」；
 * - UPSERT 覆盖同 id 项目，列表中已消失的项目直接删行（本项目无软删除语义，
 *   从列表移除即不再展示，磁盘目录不受影响）。
 */

export function loadProjects(workspaceId: string): Project[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, name, path, provider, branch, status, commitHash, favorite, tags, remote,
              files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias, webUrl
       FROM projects WHERE workspaceId = ? ORDER BY favorite DESC, updatedAt DESC, name ASC`,
    )
    .all(workspaceId) as unknown as SqlRow[];

  return rows.map(rowToProject);
}

export function saveProjects(workspaceId: string, projects: Project[]): void {
  const connection = openDatabase();
  connection.exec("BEGIN");
  try {
    const statement = connection.prepare(
      `INSERT INTO projects
       (id, name, path, provider, branch, status, commitHash, favorite, tags, remote,
        files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias, webUrl, workspaceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, path = excluded.path, provider = excluded.provider,
        branch = excluded.branch, status = excluded.status, commitHash = excluded.commitHash,
        favorite = excluded.favorite, tags = excluded.tags, remote = excluded.remote,
        files = excluded.files, syncLabel = excluded.syncLabel, language = excluded.language,
        languageColor = excluded.languageColor, summary = excluded.summary,
        updatedAt = excluded.updatedAt, diskSizeBytes = excluded.diskSizeBytes,
        alias = excluded.alias, webUrl = excluded.webUrl, workspaceId = excluded.workspaceId`,
    );
    const ids = new Set<string>();
    for (const project of projects) {
      ids.add(project.id);
      statement.run(
        project.id,
        project.name,
        project.path,
        project.provider,
        project.branch,
        project.status,
        project.commit,
        project.favorite ? 1 : 0,
        JSON.stringify(project.tags),
        project.remote ?? null,
        project.files,
        project.syncLabel,
        project.language,
        project.languageColor,
        project.summary,
        project.updatedAt,
        project.diskSizeBytes ?? 0,
        project.alias ?? null,
        project.webUrl ?? null,
        workspaceId,
      );
    }
    // 清理已不在列表中的项目：直接删行（本项目无软删除语义，
    // 从列表移除即不再展示，磁盘目录不受影响）
    const stale = connection
      .prepare("SELECT id FROM projects WHERE workspaceId = ?")
      .all(workspaceId) as unknown as SqlRow[];
    const deleteStatement = connection.prepare(
      "DELETE FROM projects WHERE id = ? AND workspaceId = ?",
    );
    for (const row of stale) {
      if (!ids.has(String(row.id))) {
        deleteStatement.run(String(row.id), workspaceId);
      }
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw new Error(`本地数据存储失败：${errorMessage(error)}`);
  }
}
