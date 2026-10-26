import { useMemo, useState } from "react";
import { ArrowDownToLine, Cloud, Github, Search, Star } from "lucide-react";
import type { Project, RemoteRepository } from "../types";
import { getDesktopBridge } from "../lib/bridge";

export function RemoteRepositorySearch({
  projects,
  onClone,
  cloningRepositoryId,
  defaultAccountId,
  onToggleFavorite,
}: {
  projects: Project[];
  onClone: (repository: RemoteRepository) => void | Promise<void>;
  cloningRepositoryId: string | null;
  defaultAccountId: string;
  onToggleFavorite: (repository: RemoteRepository) => void;
}) {
  const bridge = getDesktopBridge();
  const [provider, setProvider] = useState<"github" | "gitee">("github");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RemoteRepository[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const favoriteKeys = useMemo(() => {
    const set = new Set<string>();
    for (const project of projects) {
      if (project.favorite) set.add(`${project.provider}:${project.name}`);
    }
    return set;
  }, [projects]);

  const isFavorite = (repository: RemoteRepository) =>
    favoriteKeys.has(`${repository.provider}:${repository.name}`);

  const openRepository = (repository: RemoteRepository, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const url = repository.webUrl || repository.httpsUrl;
    if (!url) return;
    if (!bridge) {
      setNotice("浏览器预览不支持打开外部链接，请使用桌面版");
      return;
    }
    void bridge.openExternal(url).catch((error) => {
      setNotice(error instanceof Error ? error.message : "打开链接失败");
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    if (!bridge) {
      setNotice("浏览器预览不支持搜索远程仓库，请使用桌面版");
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      const found = await bridge.searchRemoteRepositories({
        provider,
        query: query.trim(),
        accountId: defaultAccountId || undefined,
      });
      setResults(found);
      if (found.length === 0) {
        setNotice("没有找到匹配的项目");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="repo-search-panel">
      <div className="panel-heading">
        <div>
          <h2>远程项目搜索</h2>
          <span>在 GitHub / Gitee 上检索开源项目，单击行打开项目网页</span>
        </div>
        <button
          className="bare-button"
          onClick={() => {
            const url = provider === "github" ? "https://github.com" : "https://gitee.com";
            if (bridge) void bridge.openExternal(url);
          }}
          aria-label={`打开 ${provider === "github" ? "GitHub" : "Gitee"} 官网`}
        >
          {provider === "github" ? <Github size={16} /> : <Cloud size={16} />}
        </button>
      </div>
      <form
        className="repo-search-bar"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value as "github" | "gitee")}
          aria-label="平台"
        >
          <option value="github">github</option>
          <option value="gitee">gitee</option>
        </select>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入关键词，如 git gui"
        />
        <button
          className="button secondary compact-button"
          type="submit"
          disabled={searching || !query.trim()}
        >
          <Search size={14} />
          {searching ? "搜索中..." : "搜索"}
        </button>
      </form>
      {notice && <div className="repo-search-notice">{notice}</div>}
      {results.length > 0 && (
        <div className="remote-list">
          {results.map((repository) => {
            const favorite = isFavorite(repository);
            return (
              <div
                className="remote-row repo-search-row"
                key={repository.id}
                onClick={(event) => openRepository(repository, event)}
              >
                <div className="remote-main">
                  <div className="remote-title">
                    <strong>{repository.fullName}</strong>
                    {repository.visibility === "public" || repository.visibility === "unknown" ? (
                      <span className="status-pill status-clean">
                        <span className="status-dot" />
                        公开
                      </span>
                    ) : (
                      <span className="status-pill status-behind">
                        <span className="status-dot" />
                        私有
                      </span>
                    )}
                  </div>
                  <p>{repository.description || "（无描述）"}</p>
                  <div className="remote-meta">
                    <span>
                      {repository.provider === "github" ? (
                        <Github size={12} />
                      ) : (
                        <Cloud size={12} />
                      )}
                      {repository.provider}
                    </span>
                    <span>{repository.defaultBranch}</span>
                    {repository.updatedAt && <span>{repository.updatedAt.slice(0, 10)}</span>}
                  </div>
                </div>
                <div className="remote-actions">
                  <button
                    className={`icon-button favorite-button ${favorite ? "active" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(repository);
                    }}
                    aria-label={favorite ? "取消收藏" : "收藏项目"}
                  >
                    <Star size={16} fill={favorite ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="button secondary compact-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onClone(repository);
                    }}
                    disabled={cloningRepositoryId !== null}
                  >
                    <ArrowDownToLine size={13} />
                    {cloningRepositoryId === repository.id ? "克隆中..." : "克隆"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
