import { useEffect, useRef, useState } from "react";
import { Check, ListTodo } from "lucide-react";
import type { DetectedCommand, Project, TaskProfile, TaskRun } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { useAsyncData } from "../hooks/useAsyncData";
import { TaskForm, type TaskDraft } from "./tasks/TaskForm";
import { TaskProfilesList } from "./tasks/TaskProfilesList";
import { TaskRunsList } from "./tasks/TaskRunsList";

const EMPTY_DRAFT: TaskDraft = {
  projectId: "",
  name: "",
  command: "",
  args: "",
  taskType: "run",
  timeoutSeconds: 120,
};

/**
 * 任务中心（新建任务 / 任务配置 / 运行记录）。
 *
 * 为什么这么拆：draft 与 detectedCommands/commandCustom/argsCustom 是跨 tab
 * 状态——「任务配置」页的编辑按钮写入草稿并切页，save 成功后重置草稿并切回
 * 配置页——按「跨 tab 共享才上提」归本组件所有；表单展示与派生候选下沉到
 * TaskForm，两份列表各自抽为 TaskProfilesList/TaskRunsList。
 * 轮询（1s 实时日志 + 4s 列表刷新）与任务启停的编排留在本组件。
 */
export function TasksWorkspace({ projects }: { projects: Project[] }) {
  const bridge = getDesktopBridge();
  const [profiles, setProfiles] = useState<TaskProfile[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TaskProfile | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [detectedCommands, setDetectedCommands] = useState<DetectedCommand[]>([]);
  const [commandCustom, setCommandCustom] = useState(false);
  const [argsCustom, setArgsCustom] = useState(false);
  const [activeTab, setActiveTab] = useState<"create" | "profiles" | "runs">("create");

  // 任务数据加载：挂载自动加载一次 + 4s 轮询 + 写操作（保存/删除/停止）后回读。
  // 原实现 listTaskProfiles/listTaskRuns 无 try/catch（轮询里 reject 会反复静默失败），
  // 现经 onError 提示；轮询结果经 useAsyncData 的序号守卫过滤，慢响应不再互踩。
  const { load } = useAsyncData<{ profiles: TaskProfile[]; runs: TaskRun[] }>({
    loader: async () => {
      if (!bridge) return { profiles: [], runs: [] };
      const [loadedProfiles, loadedRuns] = await Promise.all([
        bridge.listTaskProfiles(),
        bridge.listTaskRuns(),
      ]);
      return { profiles: loadedProfiles, runs: loadedRuns };
    },
    onLoaded: ({ profiles: loadedProfiles, runs: loadedRuns }) => {
      setProfiles(loadedProfiles);
      setRuns(loadedRuns);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "加载任务数据失败"),
    pollMs: 4000,
  });

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

  // 1 秒轮询的 interval 只在首渲染注册（空依赖 effect）。若回调直接读 state，
  // 捕获的是首帧闭包，runs 永远是初始值 []，实时日志整体失效——
  // 必须经 ref 读最新值（2026-11-07 审查 P0-2）。
  const runsRef = useRef<TaskRun[]>(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const refreshRunningOutput = async () => {
    if (!bridge) return;
    const runningRuns = runsRef.current.filter((run) => run.status === "running");
    if (runningRuns.length === 0) return;
    const patches = await Promise.all(
      runningRuns.map(async (run) => {
        const live = await bridge.getRunningTaskOutput(run.id).catch(() => "");
        return live && live !== run.output ? { id: run.id, output: live } : null;
      }),
    );
    const valid = patches.filter(
      (patch): patch is { id: string; output: string } => patch !== null,
    );
    if (valid.length > 0) {
      setRuns((current) =>
        current.map((run) => {
          const patch = valid.find((item) => item.id === run.id);
          return patch ? { ...run, output: patch.output } : run;
        }),
      );
    }
  };

  // 1 秒实时日志轮询：只补丁运行中任务的 output，与任务列表的 4s 轮询
  // （useAsyncData pollMs）职责不同，保留原 runsRef 读最新值的范式。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshRunningOutput();
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 任务名自动生成：同名任务按「基础名 N」取最大序号 +1；
  // 表单的名称预览与 save 落库共用这一规则
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
      setDraft(EMPTY_DRAFT);
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

  const edit = async (profile: TaskProfile) => {
    setEditing(profile);
    setDraft({
      projectId: profile.projectId,
      name: profile.name,
      command: profile.command,
      args: profile.args,
      taskType: profile.taskType,
      timeoutSeconds: profile.timeoutSeconds,
    });
    setActiveTab("create");
    const detected = await detectCommandsForProject(profile.projectId);
    const matched = detected.find((item) => item.command === profile.command);
    setCommandCustom(!matched);
    setArgsCustom(matched ? matched.args !== profile.args : true);
  };

  return (
    <div className="module-page">
      <div className="module-hero">
        <div className="module-icon">
          <ListTodo size={21} />
        </div>
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            TASK RUNNER
          </div>
          <h1>任务中心</h1>
          <p>配置构建、运行和打包命令，一键执行并查看实时日志。</p>
        </div>
      </div>
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === "create" ? "active" : ""}`}
          onClick={() => setActiveTab("create")}
        >
          {editing ? "编辑任务" : "新建任务"}
        </button>
        <button
          className={`settings-tab ${activeTab === "profiles" ? "active" : ""}`}
          onClick={() => setActiveTab("profiles")}
        >
          任务配置<span className="tab-count">{profiles.length}</span>
        </button>
        <button
          className={`settings-tab ${activeTab === "runs" ? "active" : ""}`}
          onClick={() => setActiveTab("runs")}
        >
          运行记录<span className="tab-count">{runs.length}</span>
        </button>
      </div>

      {activeTab === "create" && (
        <TaskForm
          projects={projects}
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          detectedCommands={detectedCommands}
          onProjectChange={handleProjectChange}
          commandCustom={commandCustom}
          setCommandCustom={setCommandCustom}
          argsCustom={argsCustom}
          setArgsCustom={setArgsCustom}
          save={save}
          generateTaskName={generateTaskName}
        />
      )}

      {activeTab === "profiles" && (
        <TaskProfilesList
          profiles={profiles}
          projects={projects}
          runningId={runningId}
          onStart={(profile) => void startTask(profile)}
          onEdit={(profile) => void edit(profile)}
          onDelete={(profile) => void deleteProfile(profile)}
          onReload={() => void load()}
        />
      )}

      {activeTab === "runs" && (
        <TaskRunsList
          runs={runs}
          stoppingId={stoppingId}
          onStop={(runId) => void stopRun(runId)}
          onReload={() => void load()}
        />
      )}
    </div>
  );
}
