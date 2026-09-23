# Gitool 功能对齐规划（参考 GitDock）

## 1. 背景

GitDock（https://github.com/gitdock-dev/gitdock）是开源的本地 Git 仓库管理面板，核心是"一个界面管理所有 GitHub 仓库"。Gitool 是 Electron 桌面应用，底座更接近现有 PRD（docs/requirements.md）。本文只吸收 GitDock 的功能清单，不照搬其 Node+浏览器 的架构。

## 2. GitDock 功能盘点 vs gitool 现状

| GitDock 功能 | gitool 现状 |
| --- | --- |
| 多账号 / 仓库卡片（语言、星标、可见性、分支、磁盘大小） | 部分：卡片已有，缺星标与磁盘大小 |
| 高级筛选（账号、可见性、状态、排序） | 部分：只有 all / favorite / attention |
| 实时搜索 + `/` 快捷键 | 有搜索，无快捷键 |
| 收藏（★）、自定义别名 | 收藏有，别名无 |
| 休眠仓库检测（1/3/6/12 月） | 无 |
| Open PRs / Issues 计数胶囊 | 无 |
| 需要关注面板 + 侧栏统计 | 有指标卡，无独立面板 |
| README 查看器（Markdown 渲染） | 无 |
| 克隆（一键 / SSH 别名） | 只有按钮占位，未实现 |
| Pull 安全校验（有未提交变更时阻止） | 无 |
| Pull All / 批量多选操作栏 | 无 |
| Commit 弹窗（选文件、写消息、提交） | 无 |
| Push（含 set-upstream）、Branch 管理 | 无（只有 fetch/pull/push/sync 四按钮） |
| Revert、详细状态（变更文件列表） | 无 |
| 账户间 Transfer / 仓库迁移 | 无（PRD FR-307 已规划移动） |
| 打开 VS Code / Cursor / 终端 / 复制路径 | 无 |
| 暗色主题、模态框（Esc / 点击关闭） | 只有表单，无模态体系 |
| Toasts、键盘快捷键 | 有 Toast，无快捷键 |

## 3. 路线图

### 阶段 A — 核心 Git 闭环（最高优先，对齐 FR-401~415）✅ 已完成

- A-1 克隆远程仓库落地（选目录、进度、失败清理） — FR-207 / FR-304
- A-2 Commit 工作流：变更文件列表（增删改/未跟踪）+ 暂存选择 + 提交消息 + 提交 — FR-401 / FR-403
- A-3 分支管理：创建 / 切换 / 删除，阻止删除当前分支 — FR-408 / FR-409
- A-4 提交历史时间线 + 详情 + Revert — FR-801 / FR-802 / FR-803
- A-5 远程仓库创建 / 修改 / 删除 — FR-203 / FR-204 / FR-205

> 实现说明：克隆使用 GIT_ASKPASS 令牌注入（凭据不进 URL、argv 与日志），失败自动清理不完整目录。Git 操作面板在项目详情页新增「变更 / 分支 / 历史」三个标签页。远程仓库页支持创建、编辑、删除。新增 IPC 通道：`projects:clone`、`git:changedFiles/stageFiles/unstageFiles/commit/branches/createBranch/switchBranch/deleteBranch/history/revert`、`remoteRepositories:create/update/delete`。已完成 `npm run typecheck` 与 `npm run build` 验证。

### 阶段 B — 工作台体验（GitDock 最有辨识度的部分）✅ 已完成

- B-1 需要关注面板（未提交 / 领先 / 落后 / 冲突）+ 侧栏动态统计
- B-2 仓库卡片增强：磁盘大小、语言、README 查看器
- B-3 自定义别名（内联编辑）、休眠检测（默认 3 个月）
- B-4 快捷键（`/` 聚焦搜索、`Esc` 清空/关闭）+ 批量多选操作栏（fetch / pull / push / 全选）

> 实现说明：总览页新增「需要关注」面板，侧栏导航计数改为动态。项目卡片显示磁盘大小与休眠标记；详情页新增 README 阅读器与别名编辑。项目数据库新增 `diskSizeBytes`、`alias` 两列并带迁移。全选 + 多选项目支持批量 fetch/pull/push。已通过 `npm run typecheck` 与 `npm run build`。

### 阶段 C — 集成与安全

- C-1 打开 VS Code / Cursor / 终端 + 复制路径（复用现有 IPC 模式）
- C-2 Pull 前安全校验（有未提交变更时阻止）
- C-3 暗色主题

### 阶段 D — 占位页转正（当前 tasks / backups / logs 为假数据）

- D-1 任务中心（FR-901）
- D-2 备份 ZIP（FR-1001）
- D-3 操作记录（FR-412 / FR-1104）

## 4. 执行原则

- 每个功能走「shared/types → 主进程 service → IPC → Preload → 渲染层」完整链路。
- 参数使用结构化数组，禁 shell 拼接；路径规范化并防目录穿越。
- 破坏性操作（删除分支、删除远程仓库）必须二次确认。
- 每个阶段完成后跑 `npm run typecheck`。