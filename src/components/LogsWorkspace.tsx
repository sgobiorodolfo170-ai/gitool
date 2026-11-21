import { useState } from "react";
import { Clock3, HardDrive, RefreshCw, Search, Trash2 } from "lucide-react";
import type { OperationRecord } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "../hooks/useAsyncData";
import { workspaceDescription } from "../lib/navigation";
import { confirmDialog } from "./ConfirmProvider";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { Skeleton } from "./Skeleton";

export function LogsWorkspace({
  onNotice,
}: {
  /** 提示统一走 App 的全局 useNotice：本地 toast 与全局双轨已收敛。 */
  onNotice: (
    message: string,
    options?: { kind?: "success" | "error" | "warning" | "info" },
  ) => void;
}) {
  const bridge = getDesktopBridge();
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [filterResult, setFilterResult] = useState<"all" | "ok" | "failed">("all");
  const [filterType, setFilterType] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [busy, setBusy] = useState(false);

  // 操作记录加载：挂载自动加载一次 + 刷新按钮/清空后手动回读。
  // 原实现无 try/catch，listOperationRecords reject 会静默失败，现经 onError 提示。
  const { load, status, hasLoaded } = useAsyncData<OperationRecord[]>({
    loader: () => (bridge ? bridge.listOperationRecords() : Promise.resolve([])),
    onLoaded: setRecords,
    onError: (error) =>
      onNotice(error instanceof Error ? error.message : "加载操作记录失败", { kind: "error" }),
  });

  // 首屏三态（阶段 D5）：清空/导出后的回读失败保留旧列表，只经 onNotice 提示。
  const showSkeleton = !hasLoaded && status !== "error";
  const loadFailed = status === "error" && !hasLoaded;
  const filtering = Boolean(filterKeyword.trim()) || filterResult !== "all" || filterType !== "all";

  const operationTypes = ["fetch", "pull", "push", "sync", "clone", "commit"];
  const filtered = records.filter((record) => {
    if (filterResult !== "all" && record.result !== filterResult) return false;
    if (filterType !== "all" && record.operation !== filterType) return false;
    if (
      filterKeyword.trim() &&
      !`${record.operation} ${record.projectPath} ${record.detail}`
        .toLowerCase()
        .includes(filterKeyword.trim().toLowerCase())
    )
      return false;
    return true;
  });

  const clear = async () => {
    if (!bridge) return;
    const confirmed = await confirmDialog({
      title: "清空全部操作记录？",
      description: "此操作不可撤销。",
      confirmLabel: "清空",
      danger: true,
    });
    if (!confirmed) return;
    await bridge.clearOperationRecords();
    onNotice("操作记录已清空");
    await load();
  };

  const exportRecords = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const directory = await bridge.selectDirectory();
      if (!directory) return;
      const filePath = await bridge.exportOperationRecords(directory);
      onNotice(`已导出到 ${filePath}`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "导出失败", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const resultMeta: Record<OperationRecord["result"], { label: string; className: string }> = {
    ok: { label: "成功", className: "status-clean" },
    failed: { label: "失败", className: "status-conflicted" },
  };

  return (
    <div className="module-page">
      <PageHeader
        eyebrow="系统记录"
        title="操作记录"
        description={workspaceDescription("logs")}
        icon={<Clock3 size={21} />}
        actions={
          <>
            <button
              className="button secondary"
              onClick={exportRecords}
              disabled={busy || records.length === 0}
            >
              <HardDrive size={15} />
              {busy ? "导出中..." : "导出 CSV"}
            </button>
            <button className="button secondary" onClick={clear}>
              <Trash2 size={15} />
              清空记录
            </button>
          </>
        }
      />
      <div className="remote-toolbar logs-toolbar">
        <label className="account-select">
          <span>结果</span>
          <select
            value={filterResult}
            onChange={(event) => setFilterResult(event.target.value as "all" | "ok" | "failed")}
          >
            <option value="all">全部</option>
            <option value="ok">成功</option>
            <option value="failed">失败</option>
          </select>
        </label>
        <label className="account-select">
          <span>操作类型</span>
          <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
            <option value="all">全部</option>
            {operationTypes.map((type) => (
              <option value={type} key={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="search-box remote-search">
          <Search size={16} />
          <input
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="搜索路径或详情"
          />
        </label>
      </div>
      <section className="remote-list-panel">
        <div className="panel-heading">
          <div>
            <h2>最近操作</h2>
            <span>{filtered.length} 条</span>
          </div>
          <button
            className="bare-button"
            onClick={() => void load()}
            aria-label="刷新操作记录"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {showSkeleton ? (
          <Skeleton rows={4} />
        ) : loadFailed ? (
          <EmptyState
            variant="error"
            icon={<Clock3 size={21} />}
            title="无法加载操作记录"
            description="记录列表读取失败，可重试或稍后刷新。"
            action={
              <button className="button secondary compact" onClick={() => void load()}>
                重试
              </button>
            }
          />
        ) : filtered.length ? (
          <ul className="remote-list">
            {filtered.map((record) => {
              const meta = resultMeta[record.result];
              return (
                <li className="remote-row" key={record.id}>
                  <div className="remote-main">
                    <div className="remote-title">
                      <strong>{record.operation}</strong>
                      <span className={`status-pill ${meta.className}`}>{meta.label}</span>
                    </div>
                    <p>{record.projectPath}</p>
                    <code className="run-output">
                      {record.detail.slice(0, 300) || "（无详情）"}
                    </code>
                    <small>{record.createdAt}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            variant={filtering ? "no-match" : "no-data"}
            icon={<Clock3 size={21} />}
            title={filtering ? "没有匹配的记录" : "还没有操作记录"}
            description={filtering ? "调整筛选条件试试。" : "Git 操作会自动记录到这里。"}
            action={
              filtering ? (
                <button
                  className="button secondary compact"
                  onClick={() => {
                    setFilterResult("all");
                    setFilterType("all");
                    setFilterKeyword("");
                  }}
                >
                  清除筛选
                </button>
              ) : undefined
            }
          />
        )}
      </section>
    </div>
  );
}
