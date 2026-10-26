import type { GitSnapshot, Project, RemoteRepository } from "../../shared/types";

/**
 * 判断本地项目与远程仓库是否指向同一个仓库。
 *
 * 优先比对 webUrl（最可靠，跨协议一致）；拿不到 webUrl 时退化为
 * 「同平台 + 同名」。注意：同名不同 owner 的仓库会误判为同一个，
 * 这是有意的取舍——本地项目通常没有存 owner，无法更精确。
 */
export function remoteProjectMatch(project: Project, repository: RemoteRepository): boolean {
  if (project.webUrl && repository.webUrl && project.webUrl === repository.webUrl) {
    return true;
  }
  return project.provider === repository.provider && project.name === repository.name;
}

/**
 * 用最新的 Git 快照覆盖项目上的陈旧字段。
 * 只覆盖快照里有的字段，`favorite` / `tags` / `alias` 等用户数据必须保留。
 */
export function projectFromSnapshot(project: Project, snapshot: GitSnapshot): Project {
  return {
    ...project,
    branch: snapshot.branch,
    status: snapshot.status,
    commit: snapshot.commit,
    files: snapshot.files,
    syncLabel: snapshot.sync_label,
    updatedAt: snapshot.updated_at,
  };
}
