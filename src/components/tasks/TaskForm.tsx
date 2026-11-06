import { useMemo } from "react";
import { CircleAlert, ListTodo } from "lucide-react";
import type { DetectedCommand, Project, TaskProfile, TaskType } from "../../types";

/** 任务表单的草稿形状（projectId/name/command/args/taskType/timeoutSeconds）。 */
export type TaskDraft = {
  projectId: string;
  name: string;
  command: string;
  args: string;
  taskType: TaskType;
  timeoutSeconds: number;
};

/**
 * 「新建/编辑任务」表单：项目关联、任务分类、命令/参数选择（含自定义回退）、
 * 超时设置。draft 与 detectedCommands 是跨 tab 状态——profiles 页的「编辑」
 * 会写入草稿、save 成功后切页并重置——因此归 TasksWorkspace 所有，本组件
 * 只接收值与回调；命令/参数候选项由 detectedCommands × draft 派生（useMemo），
 * 派生逻辑属表单展示关注点，留在这里。
 */
export function TaskForm({
  projects,
  draft,
  setDraft,
  editing,
  detectedCommands,
  onProjectChange,
  commandCustom,
  setCommandCustom,
  argsCustom,
  setArgsCustom,
  save,
  generateTaskName,
}: {
  projects: Project[];
  draft: TaskDraft;
  setDraft: (draft: TaskDraft) => void;
  editing: TaskProfile | null;
  /** 项目切换：父级统一处理（清命令/参数、重置自定义态、重新探测命令） */
  onProjectChange: (projectId: string) => void;
  detectedCommands: DetectedCommand[];
  commandCustom: boolean;
  setCommandCustom: (value: boolean) => void;
  argsCustom: boolean;
  setArgsCustom: (value: boolean) => void;
  save: () => Promise<void>;
  /** 任务名自动生成规则（读 projects + profiles，父级在 save 时也要用） */
  generateTaskName: (projectId: string) => string;
}) {
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
    return detectedCommands.filter(
      (item) => item.command === draft.command && item.category === draft.taskType,
    );
  }, [detectedCommands, draft.command, draft.taskType]);

  const incompatibleCommands = useMemo(() => {
    return detectedCommands.filter(
      (item) => item.category === draft.taskType && !item.osSupport.includes("windows"),
    );
  }, [detectedCommands, draft.taskType]);

  return (
    <form
      className="account-form settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="panel-heading">
        <div>
          <h2>{editing ? `编辑任务 · ${editing.name}` : "新建任务"}</h2>
          <span>命令将在项目目录执行</span>
        </div>
        <ListTodo size={16} />
      </div>
      <div className="form-body">
        <label>
          关联项目
          <select
            value={draft.projectId}
            onChange={(event) => onProjectChange(event.target.value)}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {!editing && draft.projectId && (
          <div className="task-name-preview">
            <ListTodo size={13} />
            任务名称将自动生成为「{generateTaskName(draft.projectId)}」
          </div>
        )}
        <label>
          任务分类
          <select
            value={draft.taskType}
            onChange={(event) => {
              const value = event.target.value as TaskType;
              setDraft({ ...draft, taskType: value, command: "", args: "" });
              setCommandCustom(false);
              setArgsCustom(false);
            }}
          >
            <option value="build">构建</option>
            <option value="run">运行</option>
            <option value="package">打包</option>
            <option value="deploy">部署</option>
          </select>
        </label>
        {incompatibleCommands.length > 0 && (
          <div
            className="conflict-wizard"
            style={{ background: "#fef9e7", borderColor: "#f0d78a" }}
          >
            <div className="conflict-heading" style={{ color: "#9a6b1f" }}>
              <CircleAlert size={14} />
              <strong>检测到 {incompatibleCommands.length} 个当前系统不支持的命令</strong>
            </div>
            <p style={{ color: "#8a6d2f" }}>
              以下命令不支持 Windows 系统，仅支持：
              {incompatibleCommands[0].osSupport.join("、")}
              。可在其他系统上执行，或使用自定义命令手动配置。
            </p>
            <div className="conflict-files">
              {incompatibleCommands.map((item) => (
                <code key={`${item.command}-${item.args}`}>
                  {item.label}（仅 {item.osSupport.join("/")}）
                </code>
              ))}
            </div>
          </div>
        )}
        <label>
          命令
          {commandOptions.length > 0 && (
            <select
              value={commandCustom ? "__custom__" : draft.command}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "__custom__") {
                  setCommandCustom(true);
                  return;
                }
                setCommandCustom(false);
                setDraft({ ...draft, command: value, args: "" });
                setArgsCustom(false);
              }}
            >
              <option value="">选择命令</option>
              {commandOptions.map((item) => (
                <option value={item.command} key={`${item.command}-${item.category}`}>
                  {item.command} — {item.description ?? item.label}（{item.source}）
                </option>
              ))}
              <option value="__custom__">自定义…</option>
            </select>
          )}
          {(commandCustom || commandOptions.length === 0) && (
            <div
              className="secret-input"
              style={{ marginTop: commandOptions.length > 0 ? 6 : 0 }}
            >
              <input
                value={draft.command}
                onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                placeholder="例如：npm（选择项目后自动读取）"
              />
            </div>
          )}
        </label>
        <label>
          参数
          {argOptions.length > 0 && draft.command && (
            <select
              value={argsCustom ? "__custom__" : draft.args}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "__custom__") {
                  setArgsCustom(true);
                  return;
                }
                setArgsCustom(false);
                setDraft({ ...draft, args: value });
              }}
            >
              <option value="">选择参数</option>
              {argOptions.map((item) => (
                <option value={item.args} key={`${item.command}-${item.args}`}>
                  {item.args} — {item.description ?? item.label}
                </option>
              ))}
              <option value="__custom__">自定义…</option>
            </select>
          )}
          {(argsCustom || argOptions.length === 0 || !draft.command) && (
            <div
              className="secret-input"
              style={{ marginTop: argOptions.length > 0 && draft.command ? 6 : 0 }}
            >
              <input
                value={draft.args}
                onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                placeholder="例如：run dev"
              />
            </div>
          )}
        </label>
        <label>
          超时（秒）
          <input
            type="number"
            value={draft.timeoutSeconds}
            onChange={(event) =>
              setDraft({ ...draft, timeoutSeconds: Number(event.target.value) || 0 })
            }
          />
        </label>
        <button
          className="button primary form-submit"
          disabled={!draft.projectId || !draft.command}
        >
          {editing ? "保存修改" : "创建任务"}
        </button>
      </div>
    </form>
  );
}
