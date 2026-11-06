import type { ReactNode } from "react";
import type { CommitEntry } from "../../types";
import { formatCommitDate, formatDayGroup } from "../../lib/format";

/**
 * 提交历史时间线视图：按「日」分组渲染提交条目。
 * 原 GitActionsPanel 内的 renderTimeline 原样迁移，保持纯函数签名
 * （非组件：无内部状态，由调用处在列表/时间线两种视图间选择）。
 */
export function renderTimeline(
  history: CommitEntry[],
  busy: boolean,
  revert: (hash: string) => void,
): ReactNode {
  const groups: Array<{ label: string; entries: CommitEntry[] }> = [];
  for (const entry of history) {
    const label = formatDayGroup(entry.date);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }
  return (
    <div className="timeline-list">
      {groups.map((group) => (
        <div className="timeline-group" key={group.label}>
          <div className="timeline-day">
            {group.label}
            <span>{group.entries.length} 次提交</span>
          </div>
          {group.entries.map((entry) => (
            <div className="timeline-item" key={entry.hash}>
              <span className="timeline-dot" />
              <div className="timeline-main">
                <div className="timeline-title">
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
                disabled={busy}
                title="生成反向提交"
              >
                回退
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
