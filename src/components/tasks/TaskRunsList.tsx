import { ListTodo, RefreshCw, X } from "lucide-react";
import type { TaskRun } from "../../types";

/** 运行状态的展示元数据：徽标文案与配色类名。只有运行记录列表消费。 */
const runStatusMeta: Record<TaskRun["status"], { label: string; className: string }> = {
  running: { label: "运行中", className: "status-ahead" },
  succeeded: { label: "成功", className: "status-clean" },
  failed: { label: "失败", className: "status-conflicted" },
  stopped: { label: "已停止", className: "status-behind" },
  timedout: { label: "超时", className: "status-conflicted" },
};

/**
 * 「运行记录」列表：最近 20 次任务运行的输出与停止操作。
 * 纯展示列表——runs 数据（含 1 秒轮询增量，见 TasksWorkspace 的 runsRef）
 * 与停止回调都由父级下发。
 */
export function TaskRunsList({
  runs,
  stoppingId,
  onStop,
  onReload,
}: {
  runs: TaskRun[];
  stoppingId: string | null;
  onStop: (runId: string) => void;
  onReload: () => void;
}) {
  return (
    <section className="account-list-panel settings-form">
      <div className="panel-heading">
        <div>
          <h2>运行记录</h2>
          <span>最近 {runs.length} 次</span>
        </div>
        <button className="bare-button" onClick={onReload}>
          <RefreshCw size={16} />
        </button>
      </div>
      {runs.length ? (
        <div className="remote-list">
          {runs.slice(0, 20).map((run) => {
            const meta = runStatusMeta[run.status] ?? runStatusMeta.failed;
            return (
              <div className="remote-row" key={run.id}>
                <div className="remote-main">
                  <div className="remote-title">
                    <strong>{run.name}</strong>
                    <span className={`status-pill ${meta.className}`}>
                      <span className="status-dot" />
                      {meta.label}
                    </span>
                    <span>{run.exitCode !== undefined ? `退出码 ${run.exitCode}` : ""}</span>
                  </div>
                  <p>
                    {run.command} · {run.startedAt}
                  </p>
                  <code className="run-output">{run.output.slice(0, 300) || "（无输出）"}</code>
                </div>
                <div className="remote-actions">
                  {run.status === "running" && (
                    <button
                      className="button secondary compact-button"
                      onClick={() => onStop(run.id)}
                      disabled={stoppingId === run.id}
                    >
                      {stoppingId === run.id ? (
                        "停止中..."
                      ) : (
                        <>
                          <X size={13} />
                          停止
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="accounts-empty">
          <ListTodo size={22} />
          <strong>还没有运行记录</strong>
          <span>运行任务后这里会显示输出。</span>
        </div>
      )}
    </section>
  );
}
