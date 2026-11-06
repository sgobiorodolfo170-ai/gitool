import { ArrowDownToLine, ArrowUpRight, Cloud, RefreshCw } from "lucide-react";
import type { GitOperation } from "../../types";
import { GitOperationButton } from "../common";
import { GitActionsPanel } from "../GitActionsPanel";

/**
 * 「Git 操作」选项卡：拉取/同步快捷区、单操作网格、最近输出与完整的
 * GitActionsPanel。本组件是纯透传——所有数据（activeOperation/operationOutput）
 * 与动作（onRunGitOperation）都由 App 的 useGitOperations 下发，
 * externalBusy 继续透传给 GitActionsPanel 维持全局互斥链路。
 */
export function GitTabPanel({
  projectPath,
  onRunGitOperation,
  activeOperation,
  externalBusy,
  operationOutput,
}: {
  projectPath: string;
  onRunGitOperation: (operation: GitOperation) => void | Promise<void>;
  activeOperation: GitOperation | null;
  /** Git 操作全局互斥（单个/批量操作执行中）：透传给 GitActionsPanel 禁用其按钮。 */
  externalBusy: boolean;
  operationOutput: string | null;
}) {
  return (
    <>
      <div className="detail-actions">
        <button
          className="button primary wide"
          onClick={() => onRunGitOperation("pull")}
          disabled={activeOperation !== null}
        >
          <ArrowDownToLine size={15} />
          {activeOperation === "pull" ? "拉取中..." : "拉取更新"}
        </button>
        <button
          className="button secondary square"
          onClick={() => onRunGitOperation("sync")}
          disabled={activeOperation !== null}
          aria-label="同步项目"
        >
          <RefreshCw size={17} className={activeOperation === "sync" ? "spin" : ""} />
        </button>
      </div>

      <div className="git-operation-grid">
        <GitOperationButton
          operation="fetch"
          activeOperation={activeOperation}
          onRun={onRunGitOperation}
          icon={<Cloud size={14} />}
        />
        <GitOperationButton
          operation="push"
          activeOperation={activeOperation}
          onRun={onRunGitOperation}
          icon={<ArrowUpRight size={14} />}
        />
        <GitOperationButton
          operation="sync"
          activeOperation={activeOperation}
          onRun={onRunGitOperation}
          icon={<RefreshCw size={14} />}
        />
      </div>

      {operationOutput && (
        <div className="operation-output">
          <div>
            <span>最近一次 Git 输出</span>
            <button
              className="bare-button"
              onClick={() => onRunGitOperation("fetch")}
              aria-label="重新获取远程更新"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          <pre>{operationOutput}</pre>
        </div>
      )}

      <GitActionsPanel projectPath={projectPath} externalBusy={externalBusy} />
    </>
  );
}
