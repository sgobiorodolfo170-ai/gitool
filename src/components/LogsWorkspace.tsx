import { useEffect, useState } from "react";
import { Check, Clock3, HardDrive, RefreshCw, Search, Trash2 } from "lucide-react";
import type { OperationRecord } from "../types";
import { getDesktopBridge } from "../lib/bridge";

export function LogsWorkspace() {
  const bridge = getDesktopBridge();
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [notice, setNotice] = useState("");
  const [filterResult, setFilterResult] = useState<"all" | "ok" | "failed">("all");
  const [filterType, setFilterType] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    setRecords(await bridge.listOperationRecords());
  };

  useEffect(() => {
    void load();
  }, []);

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
    if (!window.confirm("清空全部操作记录？")) return;
    await bridge.clearOperationRecords();
    setNotice("操作记录已清空");
    await load();
  };

  const exportRecords = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const directory = await bridge.selectDirectory();
      if (!directory) return;
      const filePath = await bridge.exportOperationRecords(directory);
      setNotice(`已导出到 ${filePath}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导出失败");
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
      <div className="module-hero">
        <div className="module-icon">
          <Clock3 size={21} />
        </div>
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            SYSTEM
          </div>
          <h1>操作记录</h1>
          <p>查看应用执行过的 Git 操作、任务与结果。</p>
        </div>
        <div className="heading-actions">
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
        </div>
      </div>
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
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
          <button className="bare-button" onClick={() => void load()}>
            <RefreshCw size={16} />
          </button>
        </div>
        {filtered.length ? (
          <div className="remote-list">
            {filtered.map((record) => {
              const meta = resultMeta[record.result];
              return (
                <div className="remote-row" key={record.id}>
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
                </div>
              );
            })}
          </div>
        ) : (
          <div className="accounts-empty">
            <Clock3 size={22} />
            <strong>{records.length ? "没有匹配的记录" : "还没有操作记录"}</strong>
            <span>{records.length ? "调整筛选条件试试。" : "Git 操作会自动记录到这里。"}</span>
          </div>
        )}
      </section>
    </div>
  );
}
