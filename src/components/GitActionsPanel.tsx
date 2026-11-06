import { useEffect, useRef, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { getDesktopBridge } from "../lib/bridge";
import { ChangesTab } from "./git/ChangesTab";
import { BranchesTab } from "./git/BranchesTab";
import { HistoryTab } from "./git/HistoryTab";
import { TagsTab } from "./git/TagsTab";

type GitTabId = "changes" | "branches" | "history" | "tags";

/**
 * Git 操作面板（提交、分支、历史、标签与远程）。
 *
 * 为什么这么拆：面板只保留跨 tab 共享的状态——激活 tab、写操作 busy、共享输出区、
 * 远程地址编辑器；各 tab 的数据与 loading 由 ChangesTab/BranchesTab/HistoryTab/TagsTab
 * 自持（序号守卫随迁），projectPath/bridge/busy/互斥 isBusy 经 props 下发。
 *
 * 挂载策略沿用 ProjectDetail 的 visitedTabs 范式：首次访问才挂载，之后保持挂载、
 * 以 hidden 隐藏——切 tab 时保留已加载数据，且每次激活仍会重载（等价原实现
 * refreshActive 的 [projectPath, tab] 副作用）；头部刷新按钮通过 refreshSeq
 * 递增序号通知「激活中的 tab」重载。
 *
 * 跨 tab 联动（提交/切分支成功后刷新历史）：历史数据归 HistoryTab 所有，面板
 * 通过 registerReload 登记的重载入口触发；历史页从未挂载时兜底拉取一次历史
 * 以更新角标计数，保持旧行为（角标无需访问过历史页也会刷新）。
 */
export function GitActionsPanel({
  projectPath,
  externalBusy = false,
}: {
  projectPath: string;
  /** Git 操作全局互斥（单个/批量操作执行中）：禁用本面板全部写操作按钮。 */
  externalBusy?: boolean;
}) {
  const bridge = getDesktopBridge();
  const [tab, setTab] = useState<GitTabId>("changes");
  // 已访问过的 tab：首次访问才挂载，之后保持挂载（hidden 隐藏），切回不丢数据
  const [visitedTabs, setVisitedTabs] = useState<Set<GitTabId>>(() => new Set(["changes"]));
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [showRemoteEditor, setShowRemoteEditor] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  // 头部刷新按钮旋转态：镜像「正在加载数据的一方」（激活 tab 上报，或历史页
  // 未挂载时的兜底计数请求）。原实现为单一共享 loading 变量，此处语义等价。
  const [loading, setLoading] = useState(false);
  // tab 角标计数：数据归各 tab 所有，加载后上报上来
  const [changedCount, setChangedCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [tagsCount, setTagsCount] = useState(0);
  // 面板级互斥：本地 busy（写操作进行中）或全局 externalBusy（单个/批量 Git 操作）。
  const isBusy = busy || externalBusy;
  // HistoryTab 登记的「仅重载历史」入口；未挂载时为 null
  const historyReloadRef = useRef<(() => void | Promise<void>) | null>(null);

  // 历史页未挂载时的角标兜底：提交/切分支成功后拉取历史只为了刷新计数
  // （与原实现 loadHistory 的成功/失败路径一致：失败记 0，loading 照常起落）
  const refreshHistoryCount = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      const list = await bridge.listCommitHistory(projectPath);
      setHistoryCount(list.length);
    } catch {
      setHistoryCount(0);
    } finally {
      setLoading(false);
    }
  };

  const reloadHistory = (): void | Promise<void> => {
    const reload = historyReloadRef.current;
    if (reload) return reload();
    return refreshHistoryCount();
  };

  // 换项目时重置角标计数；挂载中的 tab 自行清数据并在激活态下重载
  useEffect(() => {
    setChangedCount(0);
    setHistoryCount(0);
    setTagsCount(0);
  }, [projectPath]);

  const selectTab = (id: GitTabId) => {
    setTab(id);
    setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const updateRemoteUrl = async () => {
    if (!bridge || !remoteUrl.trim()) return;
    setBusy(true);
    try {
      await bridge.setRemoteUrl({ path: projectPath, url: remoteUrl.trim() });
      setOutput("远程地址已更新");
      setShowRemoteEditor(false);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "更新远程地址失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-actions-panel">
      <div className="analysis-heading">
        <div>
          <span>Git 操作</span>
          <small>提交、分支、历史、标签与远程</small>
        </div>
        <button
          className="bare-button"
          onClick={() => setRefreshSeq((seq) => seq + 1)}
          aria-label="刷新 Git 状态"
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="git-tabs">
        <button className={tab === "changes" ? "active" : ""} onClick={() => selectTab("changes")}>
          变更 {changedCount > 0 ? `(${changedCount})` : ""}
        </button>
        <button className={tab === "branches" ? "active" : ""} onClick={() => selectTab("branches")}>
          分支
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => selectTab("history")}>
          历史 {historyCount > 0 ? `(${historyCount})` : ""}
        </button>
        <button className={tab === "tags" ? "active" : ""} onClick={() => selectTab("tags")}>
          标签 {tagsCount > 0 ? `(${tagsCount})` : ""}
        </button>
      </div>
      <div className="remote-url-row">
        <button className="bare-button" onClick={() => setShowRemoteEditor((current) => !current)}>
          <GitBranch size={12} />
          远程地址{showRemoteEditor ? " · 编辑中" : ""}
        </button>
      </div>
      {showRemoteEditor && (
        <div className="remote-url-editor">
          <input
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="https://github.com/owner/repo.git 或 git@host:owner/repo.git"
          />
          <button
            className="button secondary compact-button"
            onClick={updateRemoteUrl}
            disabled={isBusy || !remoteUrl.trim()}
          >
            {busy ? "保存中..." : "保存"}
          </button>
        </div>
      )}

      {visitedTabs.has("changes") && (
        <ChangesTab
          projectPath={projectPath}
          bridge={bridge}
          active={tab === "changes"}
          refreshSeq={refreshSeq}
          busy={busy}
          isBusy={isBusy}
          setBusy={setBusy}
          setOutput={setOutput}
          onLoadingChange={setLoading}
          onCountChange={setChangedCount}
          onHistoryChanged={reloadHistory}
        />
      )}

      {visitedTabs.has("branches") && (
        <BranchesTab
          projectPath={projectPath}
          bridge={bridge}
          active={tab === "branches"}
          refreshSeq={refreshSeq}
          isBusy={isBusy}
          setBusy={setBusy}
          setOutput={setOutput}
          onLoadingChange={setLoading}
          onHistoryChanged={reloadHistory}
        />
      )}

      {visitedTabs.has("history") && (
        <HistoryTab
          projectPath={projectPath}
          bridge={bridge}
          active={tab === "history"}
          refreshSeq={refreshSeq}
          busy={busy}
          isBusy={isBusy}
          setBusy={setBusy}
          setOutput={setOutput}
          onLoadingChange={setLoading}
          onCountChange={setHistoryCount}
          registerReload={(reload) => {
            historyReloadRef.current = reload;
          }}
        />
      )}

      {visitedTabs.has("tags") && (
        <TagsTab
          projectPath={projectPath}
          bridge={bridge}
          active={tab === "tags"}
          refreshSeq={refreshSeq}
          isBusy={isBusy}
          setBusy={setBusy}
          setOutput={setOutput}
          onLoadingChange={setLoading}
          onCountChange={setTagsCount}
        />
      )}

      {output && (
        <div className="git-output">
          <pre>{output}</pre>
          <button className="bare-button" onClick={() => setOutput("")} aria-label="关闭输出">
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
