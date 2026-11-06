import { useEffect, useState } from "react";
import type { DesktopBridge } from "../../../shared/types";
import type { BranchInfo } from "../../types";
import { useLoadSequence } from "./loadSequence";

/**
 * 「分支」tab：分支列表（切换/删除）与新建分支。
 * 数据（分支列表、新分支名）与 loading 归本组件自持；
 * busy/output/全局互斥由面板下发（见 GitActionsPanel 头注释）。
 */
export function BranchesTab({
  projectPath,
  bridge,
  active,
  refreshSeq,
  isBusy,
  setBusy,
  setOutput,
  onLoadingChange,
  onHistoryChanged,
}: {
  projectPath: string;
  bridge: DesktopBridge | undefined;
  /** 是否为当前激活 tab：非激活时保持挂载、以 hidden 隐藏（沿用 ProjectDetail 的 visitedTabs 范式） */
  active: boolean;
  /** 面板刷新按钮的递增序号：变化且处于激活态时重载本 tab 数据 */
  refreshSeq: number;
  /** Git 操作全局互斥（本面板 busy 或批量操作 externalBusy）：禁用全部写操作按钮 */
  isBusy: boolean;
  setBusy: (busy: boolean) => void;
  setOutput: (output: string) => void;
  /** loading 变化上报面板：驱动头部刷新按钮旋转态 */
  onLoadingChange: (loading: boolean) => void;
  /** 切换分支成功后通知面板刷新历史（历史数据归 HistoryTab 所有） */
  onHistoryChanged: () => void | Promise<void>;
}) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [loading, setLoadingState] = useState(false);
  const { beginLoad, isStaleLoad } = useLoadSequence();

  // loading 本地驱动本 tab 空态文案，同时上报面板驱动头部刷新按钮旋转态
  const setLoading = (value: boolean) => {
    setLoadingState(value);
    onLoadingChange(value);
  };

  const loadBranches = async () => {
    if (!bridge) return;
    const seq = beginLoad("branches");
    setLoading(true);
    try {
      const list = await bridge.listBranches(projectPath);
      if (isStaleLoad("branches", seq)) return;
      setBranches(list);
    } catch {
      if (isStaleLoad("branches", seq)) return;
      setBranches([]);
    } finally {
      if (!isStaleLoad("branches", seq)) setLoading(false);
    }
  };

  // 换项目时只清数据；新分支名输入沿用原面板行为，不随项目切换清空
  useEffect(() => {
    setBranches([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // 激活 / 换项目 / 点刷新时重载（等价原面板 refreshActive 的 branches 分支）
  useEffect(() => {
    if (active) void loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectPath, refreshSeq]);

  const createBranch = async () => {
    if (!bridge || !newBranchName.trim()) return;
    setBusy(true);
    try {
      await bridge.createBranch({ path: projectPath, name: newBranchName.trim() });
      setNewBranchName("");
      await loadBranches();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "创建分支失败");
    } finally {
      setBusy(false);
    }
  };

  const switchBranch = async (name: string) => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.switchBranch({ path: projectPath, name });
      setOutput(`已切换到分支 ${name}`);
      await loadBranches();
      await onHistoryChanged();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "切换分支失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteBranch = async (name: string) => {
    if (!bridge) return;
    if (!window.confirm(`确定删除分支 ${name}？未合并的提交会一并丢弃。`)) return;
    setBusy(true);
    try {
      await bridge.deleteBranch({ path: projectPath, name });
      setOutput(`已删除分支 ${name}`);
      await loadBranches();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "删除分支失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-tab-content" hidden={!active}>
      {branches.length === 0 ? (
        <div className="git-empty">{loading ? "正在读取分支..." : "没有分支"}</div>
      ) : (
        <div className="branch-list">
          {branches.map((branch) => (
            <div className="branch-row" key={branch.name}>
              <div className="branch-main">
                <span className={`branch-name ${branch.current ? "current" : ""}`}>
                  {branch.current ? "· " : ""}
                  {branch.name}
                </span>
                {branch.remote && (
                  <small>
                    {branch.remote}
                    {branch.ahead > 0 ? ` · 领先 ${branch.ahead}` : ""}
                    {branch.behind > 0 ? ` · 落后 ${branch.behind}` : ""}
                  </small>
                )}
              </div>
              <div className="branch-actions">
                {!branch.current && (
                  <button
                    className="bare-button"
                    onClick={() => switchBranch(branch.name)}
                    disabled={isBusy}
                  >
                    切换
                  </button>
                )}
                {!branch.current && (
                  <button
                    className="bare-button danger"
                    onClick={() => deleteBranch(branch.name)}
                    disabled={isBusy}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="new-branch-row">
        <input
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          placeholder="新分支名称"
        />
        <button
          className="button secondary compact-button"
          onClick={createBranch}
          disabled={isBusy || !newBranchName.trim()}
        >
          创建
        </button>
      </div>
    </div>
  );
}
