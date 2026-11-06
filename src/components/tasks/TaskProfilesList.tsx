import { ListTodo, RefreshCw, Trash2 } from "lucide-react";
import type { Project, TaskProfile } from "../../types";

/** 任务类型的展示元数据：图标首字与徽标文案。只有任务配置列表消费。 */
const taskTypeLabel: Record<TaskProfile["taskType"], string> = {
  build: "构建",
  run: "运行",
  package: "打包",
  deploy: "部署",
};

/**
 * 「任务配置」列表：每个任务的运行/编辑/删除操作。
 * 纯展示列表——profiles 数据、运行互斥（runningId）与动作回调都由
 * TasksWorkspace 下发；load 刷新按钮对应父级的 listTaskProfiles/listTaskRuns。
 */
export function TaskProfilesList({
  profiles,
  projects,
  runningId,
  onStart,
  onEdit,
  onDelete,
  onReload,
}: {
  profiles: TaskProfile[];
  projects: Project[];
  runningId: string | null;
  onStart: (profile: TaskProfile) => void;
  onEdit: (profile: TaskProfile) => void;
  onDelete: (profile: TaskProfile) => void;
  onReload: () => void;
}) {
  return (
    <section className="account-list-panel settings-form">
      <div className="panel-heading">
        <div>
          <h2>任务配置</h2>
          <span>{profiles.length} 个任务</span>
        </div>
        <div className="panel-heading-actions">
          <button className="bare-button" onClick={onReload}>
            <RefreshCw size={16} />
          </button>
          <span className="secure-label">
            <ListTodo size={13} />
            可执行
          </span>
        </div>
      </div>
      {profiles.length ? (
        <div className="account-list">
          {profiles.map((profile) => (
            <div className="account-row" key={profile.id}>
              <div className="account-provider-icon github">
                <span>{taskTypeLabel[profile.taskType].slice(0, 1)}</span>
              </div>
              <div className="account-main">
                <div className="account-title">
                  <strong>{profile.name}</strong>
                  <span className="status-pill status-clean">
                    <span className="status-dot" />
                    {taskTypeLabel[profile.taskType]}
                  </span>
                </div>
                <p>
                  {profile.command} {profile.args}
                </p>
                <small>
                  {projects.find((project) => project.id === profile.projectId)?.name ??
                    profile.projectPath}
                </small>
              </div>
              <div className="account-actions">
                <button
                  className="button secondary compact-button"
                  onClick={() => onStart(profile)}
                  disabled={runningId !== null}
                >
                  {runningId === profile.id ? "启动中..." : "运行"}
                </button>
                <button
                  className="button secondary compact-button"
                  onClick={() => onEdit(profile)}
                >
                  编辑
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => onDelete(profile)}
                  aria-label="删除任务"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="accounts-empty">
          <ListTodo size={21} />
          <strong>还没有任务配置</strong>
          <span>在「新建任务」标签页创建第一个任务。</span>
        </div>
      )}
    </section>
  );
}
