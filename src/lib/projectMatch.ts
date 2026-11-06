import type { GitSnapshot, Project, RemoteRepository } from "../../shared/types";

/** name 键前缀：按「平台 + 名称」退化匹配（remoteProjectMatch 的 fallback 规则）。 */
const NAME_KEY_PREFIX = "name:";
/** web 键前缀：按 webUrl 精确匹配（remoteProjectMatch 的优先规则）。 */
const WEB_KEY_PREFIX = "web:";

/**
 * 生成远程匹配的候选键集合，Project 与 RemoteRepository 通用。
 *
 * remoteProjectMatch 的语义（webUrl 相等，或平台+名称相等）与
 * 「双方候选键集合交集非空」严格等价：webUrl 相等 ⟺ 双方 web 键相等；
 * 平台+名称相等 ⟺ 双方 name 键相等。UI 的星标/关注/收藏集合统一用本函数
 * 产键、用键命中判断，语义只在 remoteProjectMatch 一处定义，三处口径
 * 从机制上不再漂移（审查遗留 A：原三处各自手写 `provider:name` 键，
 * 克隆后本地目录改名/平台仓库改名时星标丢失）。
 *
 * 键前缀防止 name 键与 web 键互撞；键只存在于运行时 Set（useMemo），
 * 不落盘，改格式无迁移负担。
 */
export function remoteMatchKeys(source: { provider: string; name: string; webUrl?: string }): string[] {
  const keys = [`${NAME_KEY_PREFIX}${source.provider}:${source.name}`];
  if (source.webUrl) keys.push(`${WEB_KEY_PREFIX}${source.webUrl}`);
  return keys;
}

/**
 * 判断本地项目与远程仓库是否指向同一个仓库。
 *
 * 优先比对 webUrl（最可靠，跨协议一致）；拿不到 webUrl 时退化为
 * 「同平台 + 同名」。注意：同名不同 owner 的仓库会误判为同一个，
 * 这是有意的取舍——本地项目通常没有存 owner，无法更精确。
 */
export function remoteProjectMatch(project: Project, repository: RemoteRepository): boolean {
  const repositoryKeys = remoteMatchKeys(repository);
  return remoteMatchKeys(project).some((key) => repositoryKeys.includes(key));
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
