import { useEffect, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import type { DesktopBridge } from "../../../shared/types";
import type { BranchInfo, CommitEntry, GitTag } from "../../types";
import { formatCommitDate } from "../../lib/format";
import { useLoadSequence } from "./loadSequence";
import { renderTimeline } from "./CommitTimeline";

/**
 * 「历史」tab：提交列表/时间线、版本对比（分支/标签/提交）与回退。
 * 数据（提交历史、版本清单、对比状态）与 loading 归本组件自持；
 * busy/output/全局互斥由面板下发（见 GitActionsPanel 头注释）。
 *
 * 历史 data 是跨 tab 联动目标（提交/切分支成功后面板会触发重载）：
 * 通过 registerReload 把重载函数登记给面板，避免面板反向持有历史状态。
 */
export function HistoryTab({
  projectPath,
  bridge,
  active,
  refreshSeq,
  busy,
  isBusy,
  setBusy,
  setOutput,
  onLoadingChange,
  onCountChange,
  registerReload,
}: {
  projectPath: string;
  bridge: DesktopBridge | undefined;
  /** 是否为当前激活 tab：非激活时保持挂载、以 hidden 隐藏（沿用 ProjectDetail 的 visitedTabs 范式） */
  active: boolean;
  /** 面板刷新按钮的递增序号：变化且处于激活态时重载本 tab 数据 */
  refreshSeq: number;
  busy: boolean;
  /** Git 操作全局互斥（本面板 busy 或批量操作 externalBusy）：禁用全部写操作按钮 */
  isBusy: boolean;
  setBusy: (busy: boolean) => void;
  setOutput: (output: string) => void;
  /** loading 变化上报面板：驱动头部刷新按钮旋转态 */
  onLoadingChange: (loading: boolean) => void;
  /** 提交数上报面板：驱动「历史」tab 角标 */
  onCountChange: (count: number) => void;
  /** 把「仅重载历史」登记给面板（提交/切分支成功后的跨 tab 联动）；卸载时传 null 注销 */
  registerReload: (reload: (() => void | Promise<void>) | null) => void;
}) {
  const [history, setHistory] = useState<CommitEntry[]>([]);
  const [timelineMode, setTimelineMode] = useState(false);
  const [allBranches, setAllBranches] = useState<BranchInfo[]>([]);
  const [allTags, setAllTags] = useState<GitTag[]>([]);
  const [compareBase, setCompareBase] = useState("");
  const [compareHead, setCompareHead] = useState("");
  const [compareResult, setCompareResult] = useState<{
    changedFiles: string[];
    insertions: number;
    deletions: number;
    output: string;
  } | null>(null);
  const [loading, setLoadingState] = useState(false);
  const { beginLoad, isStaleLoad } = useLoadSequence();

  // loading 本地驱动本 tab 空态文案，同时上报面板驱动头部刷新按钮旋转态
  const setLoading = (value: boolean) => {
    setLoadingState(value);
    onLoadingChange(value);
  };

  const loadHistory = async () => {
    if (!bridge) return;
    const seq = beginLoad("history");
    setLoading(true);
    try {
      const list = await bridge.listCommitHistory(projectPath);
      if (isStaleLoad("history", seq)) return;
      setHistory(list);
      onCountChange(list.length);
    } catch {
      if (isStaleLoad("history", seq)) return;
      setHistory([]);
      onCountChange(0);
    } finally {
      if (!isStaleLoad("history", seq)) setLoading(false);
    }
  };

  const loadVersions = async () => {
    if (!bridge) return;
    const seq = beginLoad("versions");
    try {
      const versions = await bridge.listVersions(projectPath);
      if (isStaleLoad("versions", seq)) return;
      setAllBranches(versions.branches);
      setAllTags(versions.tags);
    } catch {
      if (isStaleLoad("versions", seq)) return;
      setAllBranches([]);
      setAllTags([]);
    }
  };

  // 换项目时只清历史（与原面板一致）；对比选中项/结果、版本清单、时间线模式
  // 原实现就不随项目切换清空，保持原语义
  useEffect(() => {
    setHistory([]);
    onCountChange(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // 激活 / 换项目 / 点刷新时重载（等价原面板 refreshActive 的 history 分支：
  // 历史与版本清单都拉取）
  useEffect(() => {
    if (active) {
      void loadHistory();
      void loadVersions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectPath, refreshSeq]);

  // 登记「仅重载历史」给面板：提交/切分支成功后的跨 tab 联动入口。
  // 每次渲染重新登记以持有最新闭包；卸载时注销（面板会走角标兜底）。
  useEffect(() => {
    registerReload(() => loadHistory());
    return () => registerReload(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const revert = async (hash: string) => {
    if (!bridge) return;
    if (!window.confirm(`对提交 ${hash.slice(0, 7)} 执行 revert？这会生成一个反向提交。`)) return;
    setBusy(true);
    try {
      const result = await bridge.revertCommit({ path: projectPath, hash });
      setOutput(result.output);
      await loadHistory();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "回退提交失败");
    } finally {
      setBusy(false);
    }
  };

  const runCompare = async () => {
    if (!bridge || !compareBase || !compareHead) return;
    setBusy(true);
    try {
      const result = await bridge.compareVersions({
        path: projectPath,
        base: compareBase,
        head: compareHead,
      });
      setCompareResult({
        changedFiles: result.changedFiles,
        insertions: result.insertions,
        deletions: result.deletions,
        output: result.output,
      });
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "版本对比失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-tab-content" hidden={!active}>
      <div className="history-toolbar">
        <button
          className={`bare-button history-toggle ${timelineMode ? "active" : ""}`}
          onClick={() => setTimelineMode((value) => !value)}
        >
          <GitCommitHorizontal size={12} />
          {timelineMode ? "列表" : "时间线"}
        </button>
      </div>
      {history.length === 0 ? (
        <div className="git-empty">{loading ? "正在读取提交历史..." : "还没有提交"}</div>
      ) : timelineMode ? (
        renderTimeline(history, isBusy, revert)
      ) : (
        <div className="history-list">
          {history.map((entry) => (
            <div className="history-row" key={entry.hash}>
              <div className="history-main">
                <div className="history-title">
                  <strong>{entry.subject}</strong>
                  <code>{entry.shortHash}</code>
                </div>
                <small>
                  {entry.author} · {formatCommitDate(entry.date)}
                </small>
              </div>
              <button
                className="bare-button"
                onClick={() => revert(entry.hash)}
                disabled={isBusy}
                title="生成反向提交"
              >
                回退
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="compare-section">
        <div className="compare-heading">
          <GitCommitHorizontal size={13} />
          版本对比（提交 / 分支 / 标签）
        </div>
        <div className="compare-inputs">
          <select value={compareBase} onChange={(event) => setCompareBase(event.target.value)}>
            <option value="">基线版本</option>
            <optgroup label="分支">
              {allBranches.map((branch) => (
                <option value={branch.name} key={`b-br-${branch.name}`}>
                  {branch.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="标签">
              {allTags.map((tag) => (
                <option value={tag.name} key={`b-tg-${tag.name}`}>
                  {tag.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="提交">
              {history.slice(0, 20).map((entry) => (
                <option value={entry.hash} key={`b-cm-${entry.hash}`}>
                  {entry.shortHash} · {entry.subject.slice(0, 24)}
                </option>
              ))}
            </optgroup>
          </select>
          <select value={compareHead} onChange={(event) => setCompareHead(event.target.value)}>
            <option value="">目标版本</option>
            <optgroup label="分支">
              {allBranches.map((branch) => (
                <option value={branch.name} key={`h-br-${branch.name}`}>
                  {branch.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="标签">
              {allTags.map((tag) => (
                <option value={tag.name} key={`h-tg-${tag.name}`}>
                  {tag.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="提交">
              {history.slice(0, 20).map((entry) => (
                <option value={entry.hash} key={`h-cm-${entry.hash}`}>
                  {entry.shortHash} · {entry.subject.slice(0, 24)}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            className="button secondary compact-button"
            onClick={runCompare}
            disabled={isBusy || !compareBase || !compareHead}
          >
            {busy ? "对比中..." : "对比"}
          </button>
        </div>
        {compareResult && (
          <div className="compare-result">
            <div className="compare-stats">
              <span>变更文件 {compareResult.changedFiles.length}</span>
              <span className="compare-add">+{compareResult.insertions}</span>
              <span className="compare-del">-{compareResult.deletions}</span>
            </div>
            {compareResult.changedFiles.slice(0, 10).map((file) => (
              <code key={file}>{file}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
