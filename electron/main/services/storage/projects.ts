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

/**
 * 按绝对路径反查项目（跨工作区），未命中返回 null。
 *
 * why 单条 SQL（2026-11-21 架构评审 A-21）：操作日志写入时每次都要按路径归组到项目，
 * 旧实现在 IPC 层遍历全部工作区逐区 loadProjects()，是 1+N 次全表读——工作区越多、
 * 日志写入越慢。这里用 `WHERE path = ?` 一次命中，调用方不再关心工作区维度。
 *
 * why ORDER BY + LIMIT 1：正常数据下同一路径只属于一个项目，但历史迁移可能留下重复行；
 * 固定按 updatedAt 倒序取最新一条，保证结果确定，不依赖 SQLite 的默认行序。
 *
 * why 索引：`projects(path)` 已有 `idx_projects_path`（database.ts `ensureIndexes` 建索引，
 * 幂等，老库启动时自动补齐），本查询是索引单点查询（SQLite `SEARCH … USING INDEX`），
 * 不再是全表扫描。
 */
export function findByPath(projectPath: string): Project | null {
  const connection = openDatabase();
  const row = connection
    .prepare(
      `SELECT id, name, path, provider, branch, status, commitHash, favorite, tags, remote,
              files, syncLabel, language, languageColor, summary, updatedAt, diskSizeBytes, alias, webUrl
       FROM projects WHERE path = ? ORDER BY updatedAt DESC LIMIT 1`,
    )
    .get(projectPath) as unknown as SqlRow | undefined;
  return row ? rowToProject(row) : null;
}

/**
 * 统计某工作区下的项目数（表所有权：projects 表只归本域所有）。
 *
 * 为什么单独导出：workspaces 域的删除守卫要判断「该工作区下是否还有项目」，
 * 但计数逻辑与表结构属于本域；由本域提供计数接口，守卫侧只需调用，不再直写
 * projects 表的 SQL（一张表只有一个 owner 模块，DDL 变更不必跨域同步）。
 */
export function countByWorkspace(workspaceId: string): number {
  const connection = openDatabase();
  const row = connection
    .prepare("SELECT COUNT(*) AS total FROM projects WHERE workspaceId = ?")
    .get(workspaceId) as SqlRow | undefined;
  return row ? Number(row.total) : 0;
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
