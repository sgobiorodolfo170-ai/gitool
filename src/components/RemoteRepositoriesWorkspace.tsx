import { useMemo, useState } from "react";
import { remoteProviderLabels } from "../lib/meta";
import {
  ArrowDownToLine,
  Check,
  Cloud,
  Heart,
  ExternalLink,
  GitBranch,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { Account, Project, RemoteRepository } from "../types";
import { getDesktopBridge } from "../lib/bridge";

export function RemoteRepositoriesWorkspace({
  accounts,
  repositories,
  projects,
  selectedAccountId,
  syncTime,
  search,
  isLoading,
  cloningRepositoryId,
  cloneProgress,
  onAccountChange,
  onSearchChange,
  onRefresh,
  onClone,
  onMutate,
  onToggleFavorite,
  onToggleWatch,
}: {
  accounts: Account[];
  repositories: RemoteRepository[];
  projects: Project[];
  selectedAccountId: string;
  syncTime: string | null;
  search: string;
  isLoading: boolean;
  cloningRepositoryId: string | null;
  cloneProgress: { percent: number; phase: string; output: string } | null;
  onAccountChange: (accountId: string) => void;
  onSearchChange: (search: string) => void;
  onRefresh: () => void | Promise<void>;
  onClone: (repository: RemoteRepository) => void | Promise<void>;
  onMutate: (
    action: "create" | "update" | "delete",
    input: {
      accountId: string;
      repositoryId?: string;
      name: string;
      description: string;
      visibility: "public" | "private" | "internal" | "";
      init: boolean;
    },
  ) => Promise<boolean>;
  onToggleFavorite: (repository: RemoteRepository) => void | Promise<void>;
  onToggleWatch: (repository: RemoteRepository) => void | Promise<void>;
}) {
  const filtered = repositories.filter((repository) =>
    `${repository.fullName} ${repository.description}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const activeAccount = accounts.find((account) => account.id === selectedAccountId);
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    repositoryId?: string;
    name: string;
    description: string;
    visibility: "public" | "private";
    init: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formNotice, setFormNotice] = useState("");
  const [interactingRepo, setInteractingRepo] = useState<string | null>(null);

  const starredKeys = useMemo(() => {
    const set = new Set<string>();
    for (const project of projects) {
      if (project.favorite) set.add(`${project.provider}:${project.name}`);
    }
    return set;
  }, [projects]);

  const watchedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const project of projects) {
      if (project.tags.includes("watching")) set.add(`${project.provider}:${project.name}`);
    }
    return set;
  }, [projects]);

  const isStarred = (repository: RemoteRepository) =>
    starredKeys.has(`${repository.provider}:${repository.name}`);
  const isWatched = (repository: RemoteRepository) =>
    watchedKeys.has(`${repository.provider}:${repository.name}`);

  const handleToggleFavorite = async (repository: RemoteRepository) => {
    setInteractingRepo(repository.fullName);
    try {
      await onToggleFavorite(repository);
    } finally {
      setInteractingRepo(null);
    }
  };
  const handleToggleWatch = async (repository: RemoteRepository) => {
    setInteractingRepo(repository.fullName);
    try {
      await onToggleWatch(repository);
    } finally {
      setInteractingRepo(null);
    }
  };

  const openRepositoryPage = async (repository: RemoteRepository) => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      window.alert("浏览器预览无法打开外部链接");
      return;
    }
    try {
      await bridge.openExternal(repository.httpsUrl.replace(/\.git$/, ""));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "打开仓库页面失败");
    }
  };

  const openCreate = () => {
    if (!selectedAccountId) {
      window.alert("请先选择一个远程账号");
      return;
    }
    setFormState({ mode: "create", name: "", description: "", visibility: "public", init: false });
  };

  const openEdit = (repository: RemoteRepository) => {
    setFormState({
      mode: "edit",
      repositoryId: repository.id,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility === "private" ? "private" : "public",
      init: false,
    });
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState) return;
    if (!formState.name.trim()) {
      setFormNotice("仓库名称不能为空");
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(formState.name.trim())) {
      setFormNotice("仓库名称仅支持字母、数字、下划线、点和连字符");
      return;
    }
    setSaving(true);
    setFormNotice("");
    const ok = await onMutate(formState.mode === "create" ? "create" : "update", {
      accountId: selectedAccountId,
      repositoryId: formState.repositoryId,
      name: formState.name.trim(),
      description: formState.description.trim(),
      visibility: formState.visibility,
      init: formState.init,
    });
    setSaving(false);
    if (ok) {
      setFormState(null);
    } else {
      setFormNotice("操作失败，请稍后重试");
    }
  };

  const deleteRepository = async (repository: RemoteRepository) => {
    await onMutate("delete", {
      accountId: repository.accountId,
      repositoryId: repository.id,
      name: repository.name,
      description: repository.description,
      visibility: repository.visibility === "private" ? "private" : "public",
      init: false,
    });
  };

  return (
    <div className="module-page remote-page">
      <div className="module-hero">
        <div className="module-icon">
          <Cloud size={21} />
        </div>
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            REMOTE HUB
          </div>
          <h1>远程仓库</h1>
          <p>
            从 GitHub、Gitee 和 GitLab 读取当前账号可访问的仓库。
            {syncTime ? (
              <> 上次同步：{new Date(syncTime).toLocaleString("zh-CN", { hour12: false })}</>
            ) : null}
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button secondary"
            onClick={onRefresh}
            disabled={isLoading || !selectedAccountId}
          >
            <RefreshCw size={15} className={isLoading ? "spin" : ""} />
            {isLoading ? "同步中..." : "同步仓库"}
          </button>
          <button className="button primary" onClick={openCreate} disabled={!selectedAccountId}>
            <Plus size={16} />
            创建仓库
          </button>
        </div>
      </div>
      <div className="remote-toolbar">
        <label className="account-select">
          <span>远程账号</span>
          <select
            value={selectedAccountId}
            onChange={(event) => onAccountChange(event.target.value)}
          >
            <option value="">选择账号</option>
            {accounts.map((account) => (
              <option value={account.id} key={account.id}>
                {account.displayName} · {remoteProviderLabels[account.provider]}
              </option>
            ))}
          </select>
        </label>
        <label className="search-box remote-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索仓库名称或描述"
          />
        </label>
      </div>
      <section className="remote-list-panel">
        <div className="panel-heading">
          <div>
            <h2>{activeAccount ? `${activeAccount.displayName} 的仓库` : "远程仓库列表"}</h2>
            <span>{filtered.length} 个结果</span>
          </div>
          {activeAccount && (
            <span className="provider-chip">{remoteProviderLabels[activeAccount.provider]}</span>
          )}
        </div>
        {filtered.length ? (
          <div className="remote-list">
            {filtered.map((repository) => (
              <div className="remote-row" key={`${repository.accountId}-${repository.id}`}>
                <div className={`account-provider-icon ${repository.provider}`}>
                  <span>{remoteProviderLabels[repository.provider].slice(0, 1)}</span>
                </div>
                <div className="remote-main">
                  <div className="remote-title">
                    <strong>{repository.fullName}</strong>
                    <span>{repository.visibility}</span>
                    {repository.archived && <span>已归档</span>}
                  </div>
                  <p>{repository.description || "暂无仓库描述"}</p>
                  <div className="remote-meta">
                    <span>
                      <GitBranch size={12} />
                      {repository.defaultBranch}
                    </span>
                    <code>{repository.httpsUrl}</code>
                  </div>
                  {cloningRepositoryId === repository.id && cloneProgress && (
                    <div className="clone-progress">
                      <div
                        className="clone-progress-bar"
                        style={{ width: `${cloneProgress.percent}%` }}
                      />
                      <span>
                        {cloneProgress.phase} {cloneProgress.percent}%
                      </span>
                    </div>
                  )}
                </div>
                <div className="remote-actions">
                  <button
                    className={`icon-button favorite-button ${isStarred(repository) ? "active" : ""}`}
                    onClick={() => handleToggleFavorite(repository)}
                    disabled={interactingRepo === repository.fullName}
                    aria-label={isStarred(repository) ? "取消收藏" : "收藏仓库"}
                    title={isStarred(repository) ? "已收藏" : "收藏"}
                  >
                    <Star size={16} fill={isStarred(repository) ? "currentColor" : "none"} />
                  </button>
                  <button
                    className={`icon-button ${isWatched(repository) ? "active" : ""}`}
                    onClick={() => handleToggleWatch(repository)}
                    disabled={interactingRepo === repository.fullName}
                    aria-label={isWatched(repository) ? "取消关注" : "关注仓库"}
                    title={isWatched(repository) ? "已关注" : "关注"}
                    style={isWatched(repository) ? { color: "#e85d75" } : undefined}
                  >
                    <Heart size={16} fill={isWatched(repository) ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => openRepositoryPage(repository)}
                    aria-label="打开仓库页面"
                    title="在浏览器打开"
                  >
                    <ExternalLink size={15} />
                  </button>
                  <button
                    className="button secondary compact-button"
                    onClick={() => openEdit(repository)}
                  >
                    <Settings2 size={13} />
                    编辑
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() => deleteRepository(repository)}
                    aria-label="删除仓库"
                    title="删除仓库"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="克隆仓库"
                    title="克隆仓库"
                    onClick={() => onClone(repository)}
                    disabled={cloningRepositoryId !== null && cloningRepositoryId !== repository.id}
                  >
                    {cloningRepositoryId === repository.id ? (
                      <RefreshCw size={16} className="spin" />
                    ) : (
                      <ArrowDownToLine size={16} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="accounts-empty">
            <Cloud size={22} />
            <strong>{accounts.length ? "尚未同步远程仓库" : "请先添加远程账号"}</strong>
            <span>
              {accounts.length
                ? "选择账号后点击同步仓库。"
                : "账号令牌将由 Windows 凭据管理器保护。"}
            </span>
          </div>
        )}
      </section>
      {formState && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setFormState(null);
          }}
        >
          <div className="modal-panel" role="dialog" aria-modal="true">
            <form onSubmit={submitForm}>
              <div className="modal-heading">
                <div>
                  <h2>{formState.mode === "create" ? "创建远程仓库" : "编辑远程仓库"}</h2>
                  <span>
                    {activeAccount
                      ? `${activeAccount.displayName} · ${remoteProviderLabels[activeAccount.provider]}`
                      : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="bare-button"
                  onClick={() => setFormState(null)}
                  disabled={saving}
                  aria-label="关闭"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="form-body">
                <label>
                  仓库名称
                  <input
                    value={formState.name}
                    onChange={(event) => setFormState({ ...formState, name: event.target.value })}
                    placeholder="例如 my-project"
                    autoFocus
                  />
                </label>
                <label>
                  仓库描述
                  <input
                    value={formState.description}
                    onChange={(event) =>
                      setFormState({ ...formState, description: event.target.value })
                    }
                    placeholder="可选描述"
                  />
                </label>
                <label>
                  可见性
                  <select
                    value={formState.visibility}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        visibility: event.target.value as "public" | "private",
                      })
                    }
                  >
                    <option value="public">公开</option>
                    <option value="private">私有</option>
                  </select>
                </label>
                {formState.mode === "create" && (
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={formState.init}
                      onChange={(event) =>
                        setFormState({ ...formState, init: event.target.checked })
                      }
                    />
                    <span>初始化 README（推荐）</span>
                  </label>
                )}
                {formNotice && <div className="form-error">{formNotice}</div>}
                <button className="button primary form-submit" disabled={saving}>
                  <Check size={15} />
                  {saving ? "保存中..." : formState.mode === "create" ? "创建仓库" : "保存修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
