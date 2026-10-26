import { useEffect, useState } from "react";
import { changeStatusMeta } from "../lib/meta";
import { CircleAlert, GitBranch, GitCommitHorizontal, RefreshCw, X } from "lucide-react";
import type { BranchInfo, ChangeFile, CommitEntry, GitTag } from "../types";
import { getDesktopBridge } from "../lib/bridge";

import { formatCommitDate, formatDayGroup } from "../lib/format";

export function GitActionsPanel({ projectPath }: { projectPath: string }) {
  const [changedFiles, setChangedFiles] = useState<ChangeFile[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [history, setHistory] = useState<CommitEntry[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [tab, setTab] = useState<"changes" | "branches" | "history" | "tags">("changes");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [tags, setTags] = useState<GitTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMessage, setNewTagMessage] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [showRemoteEditor, setShowRemoteEditor] = useState(false);
  const [compareBase, setCompareBase] = useState("");
  const [compareHead, setCompareHead] = useState("");
  const [compareResult, setCompareResult] = useState<{ changedFiles: string[]; insertions: number; deletions: number; output: string } | null>(null);
  const [timelineMode, setTimelineMode] = useState(false);
  const [allBranches, setAllBranches] = useState<BranchInfo[]>([]);
  const [allTags, setAllTags] = useState<GitTag[]>([]);

  const bridge = getDesktopBridge();

  const loadDiff = async (filePath: string) => {
    if (!bridge) return;
    setDiffFor(filePath);
    setDiffText("正在读取差异...");
    try {
      setDiffText(await bridge.getFileDiff({ path: projectPath, file: filePath }));
    } catch (error) {
      setDiffText(error instanceof Error ? error.message : "读取差异失败");
    }
  };

  const loadChangedFiles = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setChangedFiles(await bridge.listChangedFiles(projectPath));
    } catch {
      setChangedFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const loadBranches = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setBranches(await bridge.listBranches(projectPath));
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setHistory(await bridge.listCommitHistory(projectPath));
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTags = async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setTags(await bridge.listTags(projectPath));
    } catch {
      setTags([]);
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async () => {
    if (!bridge) return;
    try {
      const versions = await bridge.listVersions(projectPath);
      setAllBranches(versions.branches);
      setAllTags(versions.tags);
    } catch {
      setAllBranches([]);
      setAllTags([]);
    }
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

  const addTag = async () => {
    if (!bridge || !newTagName.trim()) return;
    setBusy(true);
    try {
      await bridge.createTag({ path: projectPath, name: newTagName.trim(), message: newTagMessage.trim() || undefined });
      setOutput(`标签 ${newTagName.trim()} 已创建`);
      setNewTagName("");
      setNewTagMessage("");
      await loadTags();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "创建标签失败");
    } finally {
      setBusy(false);
    }
  };

  const removeTag = async (name: string) => {
    if (!bridge) return;
    if (!window.confirm(`删除标签 ${name}？`)) return;
    setBusy(true);
    try {
      await bridge.deleteTag(projectPath, name);
      setOutput(`标签 ${name} 已删除`);
      await loadTags();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "删除标签失败");
    } finally {
      setBusy(false);
    }
  };

  const runCompare = async () => {
    if (!bridge || !compareBase || !compareHead) return;
    setBusy(true);
    try {
      const result = await bridge.compareVersions({ path: projectPath, base: compareBase, head: compareHead });
      setCompareResult({ changedFiles: result.changedFiles, insertions: result.insertions, deletions: result.deletions, output: result.output });
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "版本对比失败");
    } finally {
      setBusy(false);
    }
  };

  const refreshActive = () => {
    if (tab === "changes") void loadChangedFiles();
    if (tab === "branches") void loadBranches();
    if (tab === "history") {
      void loadHistory();
      void loadVersions();
    }
    if (tab === "tags") void loadTags();
  };

  useEffect(() => {
    setChangedFiles([]);
    setBranches([]);
    setHistory([]);
    setTags([]);
    setOutput("");
    setCommitMessage("");
    refreshActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tab]);

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
        await loadHistory();
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
      await bridge.stageFiles(projectPath, unresolved.map((file) => file.path));
      setOutput(`已暂存 ${unresolved.length} 个已解决的冲突文件`);
      await loadChangedFiles();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "暂存失败");
    } finally {
      setBusy(false);
    }
  };

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
      await loadHistory();
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

  return <div className="git-actions-panel">
    <div className="analysis-heading"><div><span>Git 操作</span><small>提交、分支、历史、标签与远程</small></div><button className="bare-button" onClick={refreshActive} aria-label="刷新 Git 状态"><RefreshCw size={14} className={loading ? "spin" : ""} /></button></div>
    <div className="git-tabs">
      <button className={tab === "changes" ? "active" : ""} onClick={() => setTab("changes")}>变更 {changedFiles.length > 0 ? `(${changedFiles.length})` : ""}</button>
      <button className={tab === "branches" ? "active" : ""} onClick={() => setTab("branches")}>分支</button>
      <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>历史 {history.length > 0 ? `(${history.length})` : ""}</button>
      <button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>标签 {tags.length > 0 ? `(${tags.length})` : ""}</button>
    </div>
    <div className="remote-url-row"><button className="bare-button" onClick={() => setShowRemoteEditor((current) => !current)}><GitBranch size={12} />远程地址{showRemoteEditor ? " · 编辑中" : ""}</button></div>
    {showRemoteEditor && <div className="remote-url-editor"><input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repo.git 或 git@host:owner/repo.git" /><button className="button secondary compact-button" onClick={updateRemoteUrl} disabled={busy || !remoteUrl.trim()}>{busy ? "保存中..." : "保存"}</button></div>}

    {tab === "changes" && <div className="git-tab-content">
      {(() => {
        const conflictedFiles = changedFiles.filter((file) => file.status === "conflicted");
        if (conflictedFiles.length > 0) {
          return <div className="conflict-wizard">
            <div className="conflict-heading"><CircleAlert size={14} /><strong>存在 {conflictedFiles.length} 个冲突文件</strong></div>
            <p>拉取/合并产生冲突，已停止自动操作。请逐个解决冲突后暂存并提交。</p>
            <div className="conflict-files">{conflictedFiles.map((file) => <code key={file.path}>{file.path}</code>)}</div>
            <ol className="conflict-steps"><li>打开冲突文件，保留需要的改动（`&lt;&lt;&lt;&lt;&lt;&lt;&lt;` 到 `&gt;&gt;&gt;&gt;&gt;&gt;&gt;` 之间的内容）</li><li>删除冲突标记</li><li>回到此面板勾选暂存该文件</li><li>填写提交信息完成合并</li></ol>
            <button className="button secondary compact-button conflict-resolve-button" onClick={stageAllResolved} disabled={busy}>暂存已解决的文件（{conflictedFiles.filter((file) => !file.staged).length}）</button>
          </div>;
        }
        return changedFiles.length === 0 ? <div className="git-empty">{loading ? "正在读取变更..." : "工作区干净，没有待提交的变更。"}</div> : <div className="change-list">{changedFiles.map((file) => <div className="change-row" key={`${file.path}-${file.staged}`}><label className="change-check"><input type="checkbox" checked={file.staged} disabled={busy} onChange={() => toggleStage(file)} /><span className={`change-status ${file.staged ? "staged" : ""}`}>{changeStatusMeta[file.status].label}</span></label><code className="change-path" onClick={() => loadDiff(file.path)} title="点击查看差异">{file.path}</code></div>)}</div>;
      })()}
      <textarea className="commit-message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="填写提交信息（subject / body）" rows={3} />
      <button className="button primary wide" onClick={commit} disabled={busy || !commitMessage.trim() || changedFiles.filter((file) => file.staged).length === 0}>{busy ? "提交中..." : "提交暂存的变更"}</button>
      {diffFor && <div className="diff-viewer"><div className="diff-heading"><span>差异 · {diffFor}</span><button className="bare-button" onClick={() => setDiffFor(null)} aria-label="关闭差异"><X size={13} /></button></div><pre>{diffText}</pre></div>}
    </div>}

    {tab === "branches" && <div className="git-tab-content">
      {branches.length === 0 ? <div className="git-empty">{loading ? "正在读取分支..." : "没有分支"}</div> : <div className="branch-list">{branches.map((branch) => <div className="branch-row" key={branch.name}><div className="branch-main"><span className={`branch-name ${branch.current ? "current" : ""}`}>{branch.current ? "· " : ""}{branch.name}</span>{branch.remote && <small>{branch.remote}{branch.ahead > 0 ? ` · 领先 ${branch.ahead}` : ""}{branch.behind > 0 ? ` · 落后 ${branch.behind}` : ""}</small>}</div><div className="branch-actions">{!branch.current && <button className="bare-button" onClick={() => switchBranch(branch.name)} disabled={busy}>切换</button>}{!branch.current && <button className="bare-button danger" onClick={() => deleteBranch(branch.name)} disabled={busy}>删除</button>}</div></div>)}</div>}
      <div className="new-branch-row"><input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} placeholder="新分支名称" /><button className="button secondary compact-button" onClick={createBranch} disabled={busy || !newBranchName.trim()}>创建</button></div>
    </div>}

    {tab === "history" && <div className="git-tab-content">
      <div className="history-toolbar"><button className={`bare-button history-toggle ${timelineMode ? "active" : ""}`} onClick={() => setTimelineMode((value) => !value)}><GitCommitHorizontal size={12} />{timelineMode ? "列表" : "时间线"}</button></div>
      {history.length === 0 ? <div className="git-empty">{loading ? "正在读取提交历史..." : "还没有提交"}</div> : timelineMode ? renderTimeline(history, busy, revert) : <div className="history-list">{history.map((entry) => <div className="history-row" key={entry.hash}><div className="history-main"><div className="history-title"><strong>{entry.subject}</strong><code>{entry.shortHash}</code></div><small>{entry.author} · {formatCommitDate(entry.date)}</small></div><button className="bare-button" onClick={() => revert(entry.hash)} disabled={busy} title="生成反向提交">回退</button></div>)}</div>}
      <div className="compare-section">
        <div className="compare-heading"><GitCommitHorizontal size={13} />版本对比（提交 / 分支 / 标签）</div>
        <div className="compare-inputs">
          <select value={compareBase} onChange={(event) => setCompareBase(event.target.value)}>
            <option value="">基线版本</option>
            <optgroup label="分支">{allBranches.map((branch) => <option value={branch.name} key={`b-br-${branch.name}`}>{branch.name}</option>)}</optgroup>
            <optgroup label="标签">{allTags.map((tag) => <option value={tag.name} key={`b-tg-${tag.name}`}>{tag.name}</option>)}</optgroup>
            <optgroup label="提交">{history.slice(0, 20).map((entry) => <option value={entry.hash} key={`b-cm-${entry.hash}`}>{entry.shortHash} · {entry.subject.slice(0, 24)}</option>)}</optgroup>
          </select>
          <select value={compareHead} onChange={(event) => setCompareHead(event.target.value)}>
            <option value="">目标版本</option>
            <optgroup label="分支">{allBranches.map((branch) => <option value={branch.name} key={`h-br-${branch.name}`}>{branch.name}</option>)}</optgroup>
            <optgroup label="标签">{allTags.map((tag) => <option value={tag.name} key={`h-tg-${tag.name}`}>{tag.name}</option>)}</optgroup>
            <optgroup label="提交">{history.slice(0, 20).map((entry) => <option value={entry.hash} key={`h-cm-${entry.hash}`}>{entry.shortHash} · {entry.subject.slice(0, 24)}</option>)}</optgroup>
          </select>
          <button className="button secondary compact-button" onClick={runCompare} disabled={busy || !compareBase || !compareHead}>{busy ? "对比中..." : "对比"}</button>
        </div>
        {compareResult && <div className="compare-result"><div className="compare-stats"><span>变更文件 {compareResult.changedFiles.length}</span><span className="compare-add">+{compareResult.insertions}</span><span className="compare-del">-{compareResult.deletions}</span></div>{compareResult.changedFiles.slice(0, 10).map((file) => <code key={file}>{file}</code>)}</div>}
      </div>
    </div>}

    {tab === "tags" && <div className="git-tab-content">
      {tags.length === 0 ? <div className="git-empty">{loading ? "正在读取标签..." : "还没有标签"}</div> : <div className="tag-list">{tags.map((tag) => <div className="tag-row" key={tag.name}><div className="tag-main"><strong>{tag.name}</strong><small>{tag.shortCommit}{tag.message ? ` · ${tag.message}` : ""}</small></div><button className="bare-button danger" onClick={() => removeTag(tag.name)} disabled={busy}>删除</button></div>)}</div>}
      <div className="tag-create"><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="标签名称（如 v0.1.0）" /><input value={newTagMessage} onChange={(event) => setNewTagMessage(event.target.value)} placeholder="标签说明（可选）" /><button className="button secondary compact-button" onClick={addTag} disabled={busy || !newTagName.trim()}>创建</button></div>
    </div>}

    {output && <div className="git-output"><pre>{output}</pre><button className="bare-button" onClick={() => setOutput("")} aria-label="关闭输出">关闭</button></div>}
  </div>;
}

export function renderTimeline(history: CommitEntry[], busy: boolean, revert: (hash: string) => void): React.ReactNode {
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
  return <div className="timeline-list">
    {groups.map((group) => (
      <div className="timeline-group" key={group.label}>
        <div className="timeline-day">{group.label}<span>{group.entries.length} 次提交</span></div>
        {group.entries.map((entry) => (
          <div className="timeline-item" key={entry.hash}>
            <span className="timeline-dot" />
            <div className="timeline-main">
              <div className="timeline-title"><strong>{entry.subject}</strong><code>{entry.shortHash}</code></div>
              <small>{entry.author} · {formatCommitDate(entry.date)}</small>
            </div>
            <button className="bare-button" onClick={() => revert(entry.hash)} disabled={busy} title="生成反向提交">回退</button>
          </div>
        ))}
      </div>
    ))}
  </div>;
}
