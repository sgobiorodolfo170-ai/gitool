import { useEffect, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import type { DesktopBridge } from "../../../shared/types";
import type { ChangeFile } from "../../types";
import { changeStatusMeta } from "../../lib/meta";
import { useLoadSequence } from "./loadSequence";

/**
 * 「变更」tab：变更列表 / 冲突向导 / 提交表单 / 差异查看。
 * 数据（变更文件、提交草稿、差异内容）与 loading 归本组件自持；
 * busy/output/全局互斥由面板下发（见 GitActionsPanel 头注释）。
 */
export function ChangesTab({
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
  onHistoryChanged,
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
  /** 变更文件数上报面板：驱动「变更」tab 角标 */
  onCountChange: (count: number) => void;
  /** 提交成功后通知面板刷新历史（历史数据归 HistoryTab 所有，需 await 保持与原实现相同的互斥窗口） */
  onHistoryChanged: () => void | Promise<void>;
}) {
  const [changedFiles, setChangedFiles] = useState<ChangeFile[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoadingState] = useState(false);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const { beginLoad, isStaleLoad } = useLoadSequence();

  // loading 本地驱动本 tab 空态文案，同时上报面板驱动头部刷新按钮旋转态
  const setLoading = (value: boolean) => {
    setLoadingState(value);
    onLoadingChange(value);
  };

  const loadDiff = async (filePath: string) => {
    if (!bridge) return;
    const seq = beginLoad("diff");
    setDiffFor(filePath);
    setDiffText("正在读取差异...");
    try {
      const text = await bridge.getFileDiff({ path: projectPath, file: filePath });
      if (isStaleLoad("diff", seq)) return;
      setDiffText(text);
    } catch (error) {
      if (isStaleLoad("diff", seq)) return;
      setDiffText(error instanceof Error ? error.message : "读取差异失败");
    }
  };

  const loadChangedFiles = async () => {
    if (!bridge) return;
    const seq = beginLoad("changed");
    setLoading(true);
    try {
      const files = await bridge.listChangedFiles(projectPath);
      if (isStaleLoad("changed", seq)) return;
      setChangedFiles(files);
      onCountChange(files.length);
    } catch {
      if (isStaleLoad("changed", seq)) return;
      setChangedFiles([]);
      onCountChange(0);
    } finally {
      if (!isStaleLoad("changed", seq)) setLoading(false);
    }
  };

  // 提交草稿只在切换项目时清空：切 tab 保留用户正在输入的内容。
  // 差异视图沿用原面板行为：不随项目切换清空，由用户手动关闭。
  useEffect(() => {
    setChangedFiles([]);
    onCountChange(0);
    setCommitMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // 激活 / 换项目 / 点刷新时重载（等价原面板 refreshActive 的 changes 分支）
  useEffect(() => {
    if (active) void loadChangedFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectPath, refreshSeq]);

  const toggleStage = async (file: ChangeFile) => {
    if (!bridge) return;
    setBusy(true);
    try {
      if (file.staged) {
        await bridge.unstageFiles(projectPath, [file.path]);
      } else {
        await bridge.stageFiles(projectPath, [file.path]);
      }
      await loadChangedFiles();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const result = await bridge.commitChanges({ path: projectPath, message: commitMessage });
      setOutput(result.output);
      if (result.success) {
        setCommitMessage("");
        await loadChangedFiles();
        await onHistoryChanged();
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const stageAllResolved = async () => {
    if (!bridge) return;
    const unresolved = changedFiles.filter((file) => file.status === "conflicted" && !file.staged);
    if (unresolved.length === 0) {
      setOutput("没有待暂存的冲突文件");
      return;
    }
    setBusy(true);
    try {
      await bridge.stageFiles(
        projectPath,
        unresolved.map((file) => file.path),
      );
      setOutput(`已暂存 ${unresolved.length} 个已解决的冲突文件`);
      await loadChangedFiles();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "暂存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-tab-content" hidden={!active}>
      {(() => {
        const conflictedFiles = changedFiles.filter((file) => file.status === "conflicted");
        if (conflictedFiles.length > 0) {
          return (
            <div className="conflict-wizard">
              <div className="conflict-heading">
                <CircleAlert size={14} />
                <strong>存在 {conflictedFiles.length} 个冲突文件</strong>
              </div>
              <p>拉取/合并产生冲突，已停止自动操作。请逐个解决冲突后暂存并提交。</p>
              <div className="conflict-files">
                {conflictedFiles.map((file) => (
                  <code key={file.path}>{file.path}</code>
                ))}
              </div>
              <ol className="conflict-steps">
                <li>
                  打开冲突文件，保留需要的改动（`&lt;&lt;&lt;&lt;&lt;&lt;&lt;` 到
                  `&gt;&gt;&gt;&gt;&gt;&gt;&gt;` 之间的内容）
                </li>
                <li>删除冲突标记</li>
                <li>回到此面板勾选暂存该文件</li>
                <li>填写提交信息完成合并</li>
              </ol>
              <button
                className="button secondary compact-button conflict-resolve-button"
                onClick={stageAllResolved}
                disabled={isBusy}
              >
                暂存已解决的文件（{conflictedFiles.filter((file) => !file.staged).length}）
              </button>
            </div>
          );
        }
        return changedFiles.length === 0 ? (
          <div className="git-empty">
            {loading ? "正在读取变更..." : "工作区干净，没有待提交的变更。"}
          </div>
        ) : (
          <div className="change-list">
            {changedFiles.map((file) => (
              <div className="change-row" key={file.path}>
                <label className="change-check">
                  <input
                    type="checkbox"
                    checked={file.staged}
                    disabled={isBusy}
                    onChange={() => toggleStage(file)}
                  />
                  <span className={`change-status ${file.staged ? "staged" : ""}`}>
                    {changeStatusMeta[file.status].label}
                  </span>
                </label>
                <code
                  className="change-path"
                  onClick={() => loadDiff(file.path)}
                  title="点击查看差异"
                >
                  {file.path}
                </code>
              </div>
            ))}
          </div>
        );
      })()}
      <textarea
        className="commit-message"
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="填写提交信息（subject / body）"
        rows={3}
      />
      <button
        className="button primary wide"
        onClick={commit}
        disabled={
          isBusy ||
          !commitMessage.trim() ||
          changedFiles.filter((file) => file.staged).length === 0
        }
      >
        {busy ? "提交中..." : "提交暂存的变更"}
      </button>
      {diffFor && (
        <div className="diff-viewer">
          <div className="diff-heading">
            <span>差异 · {diffFor}</span>
            <button
              className="bare-button"
              onClick={() => setDiffFor(null)}
              aria-label="关闭差异"
            >
              <X size={13} />
            </button>
          </div>
          <pre>{diffText}</pre>
        </div>
      )}
    </div>
  );
}
