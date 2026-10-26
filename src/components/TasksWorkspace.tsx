import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, ListTodo, RefreshCw, Trash2, X } from "lucide-react";
import type { DetectedCommand, Project, TaskProfile, TaskRun, TaskType } from "../types";
import { getDesktopBridge } from "../lib/bridge";


export function TasksWorkspace({ projects }: { projects: Project[] }) {
  const bridge = getDesktopBridge();
  const [profiles, setProfiles] = useState<TaskProfile[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TaskProfile | null>(null);
  const [draft, setDraft] = useState<{ projectId: string; name: string; command: string; args: string; taskType: TaskType; timeoutSeconds: number }>({ projectId: "", name: "", command: "", args: "", taskType: "run", timeoutSeconds: 120 });

  const generateTaskName = (projectId: string): string => {
    const project = projects.find((item) => item.id === projectId);
    const base = project?.name ?? projectId;
    const sameProjectTasks = profiles.filter((item) => item.projectId === projectId);
    if (sameProjectTasks.length === 0) return base;
    let max = 1;
    for (const task of sameProjectTasks) {
      if (task.name === base) {
        max = Math.max(max, 1);
      } else {
        const match = task.name.match(/^(.+?)\s(\d+)$/);
        if (match && match[1] === base) {
          max = Math.max(max, Number(match[2]));
        }
      }
    }
    return `${base} ${max + 1}`;
  };
  const [runningId, setRunningId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [detectedCommands, setDetectedCommands] = useState<DetectedCommand[]>([]);
  const [commandCustom, setCommandCustom] = useState(false);
  const [argsCustom, setArgsCustom] = useState(false);
  const [activeTab, setActiveTab] = useState<"create" | "profiles" | "runs">("create");

  const load = async () => {
    if (!bridge) return;
    const [loadedProfiles, loadedRuns] = await Promise.all([bridge.listTaskProfiles(), bridge.listTaskRuns()]);
    setProfiles(loadedProfiles);
    setRuns(loadedRuns);
  };

  const detectCommandsForProject = async (projectId: string): Promise<DetectedCommand[]> => {
    if (!bridge || !projectId) {
      setDetectedCommands([]);
      return [];
    }
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      setDetectedCommands([]);
      return [];
    }
    try {
      const result = await bridge.detectProjectCommands(project.path);
      setDetectedCommands(result.commands);
      return result.commands;
    } catch {
      setDetectedCommands([]);
      return [];
    }
  };

  const handleProjectChange = (projectId: string) => {
    setDraft((current) => ({ ...current, projectId, command: "", args: "" }));
    setCommandCustom(false);
    setArgsCustom(false);
    void detectCommandsForProject(projectId);
  };

  const refreshRunningOutput = async () => {
    if (!bridge) return;
    const runningRuns = runs.filter((run) => run.status === "running");
    if (runningRuns.length === 0) return;
    const patches = await Promise.all(runningRuns.map(async (run) => {
      const live = await bridge.getRunningTaskOutput(run.id).catch(() => "");
      return live && live !== run.output ? { id: run.id, output: live } : null;
    }));
    const valid = patches.filter((patch): patch is { id: string; output: string } => patch !== null);
    if (valid.length > 0) {
      setRuns((current) => current.map((run) => {
        const patch = valid.find((item) => item.id === run.id);
        return patch ? { ...run, output: patch.output } : run;
      }));
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { void refreshRunningOutput(); }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const taskTypeLabel: Record<TaskProfile["taskType"], string> = { build: "构建", run: "运行", package: "打包", deploy: "部署" };

  const commandOptions = useMemo(() => {
    const seen = new Map<string, DetectedCommand>();
    for (const item of detectedCommands) {
      if (item.category === draft.taskType && !seen.has(item.command)) {
        seen.set(item.command, item);
      }
    }
    return [...seen.values()];
  }, [detectedCommands, draft.taskType]);

  const argOptions = useMemo(() => {
    return detectedCommands.filter((item) => item.command === draft.command && item.category === draft.taskType);
  }, [detectedCommands, draft.command, draft.taskType]);

  const incompatibleCommands = useMemo(() => {
    return detectedCommands.filter((item) => item.category === draft.taskType && !item.osSupport.includes("windows"));
  }, [detectedCommands, draft.taskType]);

  const save = async () => {
    if (!bridge || !draft.projectId || !draft.command) return;
    const now = new Date().toISOString();
    const taskName = editing ? draft.name : generateTaskName(draft.projectId);
    const profile: TaskProfile = {
      id: editing?.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      projectId: draft.projectId,
      projectPath: projects.find((project) => project.id === draft.projectId)?.path ?? "",
      taskType: draft.taskType,
      name: taskName,
      command: draft.command,
      args: draft.args,
      workingDirectory: projects.find((project) => project.id === draft.projectId)?.path ?? "",
      timeoutSeconds: draft.timeoutSeconds,
      createdAt: editing?.createdAt ?? now,
    };
    try {
      await bridge.saveTaskProfile(profile);
      setNotice("任务已保存");
      setEditing(null);
      setDraft({ projectId: "", name: "", command: "", args: "", taskType: "run", timeoutSeconds: 120 });
      setDetectedCommands([]);
      setCommandCustom(false);
      setArgsCustom(false);
      setActiveTab("profiles");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    }
  };

  const startTask = async (profile: TaskProfile) => {
    if (!bridge) return;
    setRunningId(profile.id);
    try {
      const run = await bridge.runTask(profile.id);
      setRuns((current) => [run, ...current]);
      setNotice(`任务「${profile.name}」已启动`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "启动失败");
    } finally {
      setRunningId(null);
    }
  };

  const deleteProfile = async (profile: TaskProfile) => {
    if (!bridge) return;
    if (!window.confirm(`删除任务「${profile.name}」？`)) return;
    await bridge.deleteTaskProfile(profile.id);
    await load();
  };

  const stopRun = async (runId: string) => {
    if (!bridge) return;
    setStoppingId(runId);
    try {
      await bridge.stopTask(runId);
      setNotice("已请求停止任务");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "停止失败");
    } finally {
      setStoppingId(null);
      await load();
    }
  };

  const runStatusMeta: Record<TaskRun["status"], { label: string; className: string }> = {
    running: { label: "运行中", className: "status-ahead" },
    succeeded: { label: "成功", className: "status-clean" },
    failed: { label: "失败", className: "status-conflicted" },
    stopped: { label: "已停止", className: "status-behind" },
    timedout: { label: "超时", className: "status-conflicted" },
  };

  const edit = async (profile: TaskProfile) => {
    setEditing(profile);
    setDraft({ projectId: profile.projectId, name: profile.name, command: profile.command, args: profile.args, taskType: profile.taskType, timeoutSeconds: profile.timeoutSeconds });
    setActiveTab("create");
    const detected = await detectCommandsForProject(profile.projectId);
    const matched = detected.find((item) => item.command === profile.command);
    setCommandCustom(!matched);
    setArgsCustom(matched ? matched.args !== profile.args : true);
  };

  return <div className="module-page">
    <div className="module-hero"><div className="module-icon"><ListTodo size={21} /></div><div><div className="eyebrow"><span className="eyebrow-line" />TASK RUNNER</div><h1>任务中心</h1><p>配置构建、运行和打包命令，一键执行并查看实时日志。</p></div></div>
    {notice && <div className="toast"><Check size={16} />{notice}</div>}
    <div className="settings-tabs">
      <button className={`settings-tab ${activeTab === "create" ? "active" : ""}`} onClick={() => setActiveTab("create")}>{editing ? "编辑任务" : "新建任务"}</button>
      <button className={`settings-tab ${activeTab === "profiles" ? "active" : ""}`} onClick={() => setActiveTab("profiles")}>任务配置<span className="tab-count">{profiles.length}</span></button>
      <button className={`settings-tab ${activeTab === "runs" ? "active" : ""}`} onClick={() => setActiveTab("runs")}>运行记录<span className="tab-count">{runs.length}</span></button>
    </div>

    {activeTab === "create" && (
      <form className="account-form settings-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="panel-heading"><div><h2>{editing ? `编辑任务 · ${editing.name}` : "新建任务"}</h2><span>命令将在项目目录执行</span></div><ListTodo size={16} /></div>
        <div className="form-body">
          <label>关联项目<select value={draft.projectId} onChange={(event) => handleProjectChange(event.target.value)}><option value="">选择项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          {!editing && draft.projectId && <div className="task-name-preview"><ListTodo size={13} />任务名称将自动生成为「{generateTaskName(draft.projectId)}」</div>}
          <label>任务分类<select value={draft.taskType} onChange={(event) => { const value = event.target.value as TaskType; setDraft((current) => ({ ...current, taskType: value, command: "", args: "" })); setCommandCustom(false); setArgsCustom(false); }}><option value="build">构建</option><option value="run">运行</option><option value="package">打包</option><option value="deploy">部署</option></select></label>
          {incompatibleCommands.length > 0 && <div className="conflict-wizard" style={{ background: "#fef9e7", borderColor: "#f0d78a" }}><div className="conflict-heading" style={{ color: "#9a6b1f" }}><CircleAlert size={14} /><strong>检测到 {incompatibleCommands.length} 个当前系统不支持的命令</strong></div><p style={{ color: "#8a6d2f" }}>以下命令不支持 Windows 系统，仅支持：{incompatibleCommands[0].osSupport.join("、")}。可在其他系统上执行，或使用自定义命令手动配置。</p><div className="conflict-files">{incompatibleCommands.map((item) => <code key={`${item.command}-${item.args}`}>{item.label}（仅 {item.osSupport.join("/")}）</code>)}</div></div>}
          <label>命令{commandOptions.length > 0 && <select value={commandCustom ? "__custom__" : draft.command} onChange={(event) => { const value = event.target.value; if (value === "__custom__") { setCommandCustom(true); return; } setCommandCustom(false); setDraft({ ...draft, command: value, args: "" }); setArgsCustom(false); }}><option value="">选择命令</option>{commandOptions.map((item) => <option value={item.command} key={`${item.command}-${item.category}`}>{item.command} — {item.description ?? item.label}（{item.source}）</option>)}<option value="__custom__">自定义…</option></select>}{(commandCustom || commandOptions.length === 0) && <div className="secret-input" style={{ marginTop: commandOptions.length > 0 ? 6 : 0 }}><input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="例如：npm（选择项目后自动读取）" /></div>}</label>
          <label>参数{argOptions.length > 0 && draft.command && <select value={argsCustom ? "__custom__" : draft.args} onChange={(event) => { const value = event.target.value; if (value === "__custom__") { setArgsCustom(true); return; } setArgsCustom(false); setDraft({ ...draft, args: value }); }}><option value="">选择参数</option>{argOptions.map((item) => <option value={item.args} key={`${item.command}-${item.args}`}>{item.args} — {item.description ?? item.label}</option>)}<option value="__custom__">自定义…</option></select>}{(argsCustom || argOptions.length === 0 || !draft.command) && <div className="secret-input" style={{ marginTop: argOptions.length > 0 && draft.command ? 6 : 0 }}><input value={draft.args} onChange={(event) => setDraft({ ...draft, args: event.target.value })} placeholder="例如：run dev" /></div>}</label>
          <label>超时（秒）<input type="number" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) || 0 })} /></label>
          <button className="button primary form-submit" disabled={!draft.projectId || !draft.command}>{editing ? "保存修改" : "创建任务"}</button>
        </div>
      </form>
    )}

    {activeTab === "profiles" && (
      <section className="account-list-panel settings-form">
        <div className="panel-heading"><div><h2>任务配置</h2><span>{profiles.length} 个任务</span></div><div className="panel-heading-actions"><button className="bare-button" onClick={() => void load()}><RefreshCw size={16} /></button><span className="secure-label"><ListTodo size={13} />可执行</span></div></div>
        {profiles.length ? <div className="account-list">{profiles.map((profile) => <div className="account-row" key={profile.id}><div className="account-provider-icon github"><span>{taskTypeLabel[profile.taskType].slice(0, 1)}</span></div><div className="account-main"><div className="account-title"><strong>{profile.name}</strong><span className="status-pill status-clean"><span className="status-dot" />{taskTypeLabel[profile.taskType]}</span></div><p>{profile.command} {profile.args}</p><small>{projects.find((project) => project.id === profile.projectId)?.name ?? profile.projectPath}</small></div><div className="account-actions"><button className="button secondary compact-button" onClick={() => startTask(profile)} disabled={runningId !== null}>{runningId === profile.id ? "启动中..." : "运行"}</button><button className="button secondary compact-button" onClick={() => edit(profile)}>编辑</button><button className="icon-button danger" onClick={() => deleteProfile(profile)} aria-label="删除任务"><Trash2 size={15} /></button></div></div>)}</div> : <div className="accounts-empty"><ListTodo size={21} /><strong>还没有任务配置</strong><span>在「新建任务」标签页创建第一个任务。</span></div>}
      </section>
    )}

    {activeTab === "runs" && (
      <section className="account-list-panel settings-form">
        <div className="panel-heading"><div><h2>运行记录</h2><span>最近 {runs.length} 次</span></div><button className="bare-button" onClick={() => void load()}><RefreshCw size={16} /></button></div>
        {runs.length ? <div className="remote-list">{runs.slice(0, 20).map((run) => { const meta = runStatusMeta[run.status] ?? runStatusMeta.failed; return <div className="remote-row" key={run.id}><div className="remote-main"><div className="remote-title"><strong>{run.name}</strong><span className={`status-pill ${meta.className}`}><span className="status-dot" />{meta.label}</span><span>{run.exitCode !== undefined ? `退出码 ${run.exitCode}` : ""}</span></div><p>{run.command} · {run.startedAt}</p><code className="run-output">{run.output.slice(0, 300) || "（无输出）"}</code></div><div className="remote-actions">{run.status === "running" && <button className="button secondary compact-button" onClick={() => stopRun(run.id)} disabled={stoppingId === run.id}>{stoppingId === run.id ? "停止中..." : <><X size={13} />停止</>}</button>}</div></div>; })}</div> : <div className="accounts-empty"><ListTodo size={22} /><strong>还没有运行记录</strong><span>运行任务后这里会显示输出。</span></div>}
      </section>
    )}
  </div>;
}
