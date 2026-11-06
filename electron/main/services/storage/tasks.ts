import type { TaskProfile, TaskRun } from "../../../../shared/types";
import { openDatabase, rowToTaskProfile, rowToTaskRun, type SqlRow } from "./database";

/**
 * 任务数据域：任务配置（task_profiles）与执行记录（task_runs）。
 *
 * listTaskRuns 只回最近 200 条是刻意的：runs 含完整输出，全量回传会拖慢 IPC；
 * 配置则全量返回（量小）。
 */

export function listTaskProfiles(): TaskProfile[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, projectId, projectPath, taskType, name, command, args, workingDirectory, timeoutSeconds, createdAt
       FROM task_profiles ORDER BY createdAt DESC`,
    )
    .all() as unknown as SqlRow[];
  return rows.map(rowToTaskProfile);
}

export function getTaskProfile(profileId: string): TaskProfile | undefined {
  const connection = openDatabase();
  const row = connection
    .prepare(`SELECT * FROM task_profiles WHERE id = ?`)
    .get(profileId) as unknown as SqlRow | undefined;
  return row ? rowToTaskProfile(row) : undefined;
}

export function saveTaskProfile(input: TaskProfile): TaskProfile {
  const connection = openDatabase();
  const existing = connection.prepare("SELECT id FROM task_profiles WHERE id = ?").get(input.id) as
    SqlRow | undefined;
  if (existing) {
    connection
      .prepare(
        `UPDATE task_profiles SET projectId = ?, projectPath = ?, taskType = ?, name = ?, command = ?,
         args = ?, workingDirectory = ?, timeoutSeconds = ? WHERE id = ?`,
      )
      .run(
        input.projectId,
        input.projectPath,
        input.taskType,
        input.name,
        input.command,
        input.args,
        input.workingDirectory,
        input.timeoutSeconds,
        input.id,
      );
  } else {
    connection
      .prepare(
        `INSERT INTO task_profiles
         (id, projectId, projectPath, taskType, name, command, args, workingDirectory, timeoutSeconds, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.projectPath,
        input.taskType,
        input.name,
        input.command,
        input.args,
        input.workingDirectory,
        input.timeoutSeconds,
        input.createdAt,
      );
  }
  return input;
}

export function deleteTaskProfile(profileId: string): void {
  const connection = openDatabase();
  connection.prepare("DELETE FROM task_profiles WHERE id = ?").run(profileId);
}

export function listTaskRuns(): TaskRun[] {
  const connection = openDatabase();
  const rows = connection
    .prepare(
      `SELECT id, profileId, projectId, name, command, startedAt, finishedAt, status, exitCode, output
       FROM task_runs ORDER BY startedAt DESC LIMIT 200`,
    )
    .all() as unknown as SqlRow[];
  return rows.map(rowToTaskRun);
}

export function insertTaskRun(run: TaskRun): void {
  const connection = openDatabase();
  connection
    .prepare(
      `INSERT INTO task_runs (id, profileId, projectId, name, command, startedAt, finishedAt, status, exitCode, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.profileId,
      run.projectId,
      run.name,
      run.command,
      run.startedAt,
      run.finishedAt ?? null,
      run.status,
      run.exitCode ?? null,
      run.output,
    );
}

export function updateTaskRun(run: TaskRun): void {
  const connection = openDatabase();
  connection
    .prepare(
      `UPDATE task_runs SET finishedAt = ?, status = ?, exitCode = ?, output = ? WHERE id = ?`,
    )
    .run(run.finishedAt ?? null, run.status, run.exitCode ?? null, run.output, run.id);
}
