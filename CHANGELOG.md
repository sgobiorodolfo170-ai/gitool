# 版本迭代记录

> 每次迭代记一行摘要。版本号规则：主版本.次版本.修订号（SemVer）。
> - **主版本**：不兼容的 API 变更
> - **次版本**：向下兼容的功能新增
> - **修订号**：向下兼容的缺陷修复

## 版本迭代记录

| 版本号 | 日期 | 摘要 |
| --- | --- | --- |
| v0.1.0 | 2026-10-10 | Gitool 首个可发布版本：多工作区、项目/远程/任务/备份中心、Git 操作、凭据管理器 |
| v0.2.0 | 2026-10-19 | 新增一键安装 Git 与环境体检（Git/网络/数据目录/凭据四项检测 + 首启引导 + 浮动进度） |
| v0.2.1 | 2026-10-26 | 代码评估后的缺陷修复：部署任务无法保存、终端打开命令注入、撤销提交类型错标、版本对比参数注入、备份同日覆盖、更新包路径未校验；任务停止改杀进程树并记 stopped；备份恢复含 .git；新增 61 个单测与 CI |
| v0.2.2 | 2026-10-26 | 代码结构治理：App.tsx 3217→1494 行（抽 4 个 lib 模块、14 个组件、3 个 hook；格式化前 1228 行）；引入 prettier 统一格式；CSS 提取 26 个设计 token |
| v0.2.3 | 2026-10-29 | 阶段 C 完成：抽出 useProjects/useWorkspaces/useAccounts/useImportFlow/useGitOperations/useRemotes 六个领域 hook，App.tsx 1494→672 行（逻辑部分约 270 行） |
| v0.2.4 | 2026-10-29 | zod 收敛 IPC 入参校验：32 个手写 validator → 29 个 schema，ipc.ts 921→464 行，新增 22 个用例；至此技术债清单仅剩代码签名与更新包哈希（暂缓） |
| v0.3.0 | 2026-10-29 | 我的项目支持拖拽调节列表/详情宽度并记忆位置（双击恢复默认）；设置页「环境信息」新增前端字号调节（90%–180%）；左下角版号改为可点击的检查更新入口，仅在检测到新版本时显示更新按钮 |
| v0.4.0 | 2026-10-30 | 项目详情卡片拆分为「概览 / README / Git 操作」三个选项卡：面板首次访问才挂载并保持状态，切换项目自动回到概览，Git 有新输出时 tab 上显示提示点 |
| v0.5.0 | 2026-10-30 | README 阅读体验重做：可视高度 200→600px，换用 markdown-it 渲染器（补全表格/图片/引用/分隔线/任务列表/嵌套列表/裸链接），排版改为阅读级，新增全屏阅读层（Esc 关闭）；相对路径图片降级为占位而非裂图 |
| v0.5.1 | 2026-10-30 | 修复 dev 模式下向 `.workbuddy-ai/` 写文件会把运行中的窗口刷掉：vite 将该目录下新增的 .html 当作入口触发 page reload，现已在 server.watch 中排除 |
| v0.5.2 | 2026-11-07 | 全量替换应用图标为「炫彩 Git 同步开发图标」：build/icon.ico 重建为 16–256 共 7 尺寸多分辨率图标（原仅 256 单帧，覆盖安装包/exe/任务栏/标题栏），build/icon.png、public/icon.png（favicon）、dist/icon.png 更新为源图中心方形裁切的 256px 版本 |
| v0.5.3 | 2026-11-07 | 修复提交历史哈希损坏（记录分隔符错位导致第 2 条起全部串位、回退功能失效）：格式串改为记录尾分隔符语义，解析逻辑抽入零依赖 parseCommitHistory 并补 3 个单测；提交信息改为单条 -m 保真传输，不再把多行输入改写为段落（2026-11-07 审查 P0-1/P1-2） |
| v0.5.4 | 2026-11-07 | pull/sync 只阻断已跟踪文件的未提交修改，不再被未跟踪文件误拦（未跟踪文件不会被 pull 覆盖，2026-11-07 审查 P1-3） |
| v0.5.5 | 2026-11-07 | 修复备份排除规则完全失效：tar 的 --exclude 每参数只接受一个模式，旧实现把多条规则逗号拼接为单个字面量模式（GNU tar 与 Windows bsdtar 均复现，2026-11-07 审查 P1-1） |
| v0.5.6 | 2026-11-07 | 任务运行参数 Windows 转义：shell:true 下 Node 不替参数加引号，含空格参数被拆开、& | 等元字符会被 cmd 重新解释；新增零依赖 quoteWindowsArg 按 CommandLineToArgvW 约定转义并补 6 个单测；任务超时标注不再被 close 事件回填覆盖（2026-11-07 审查 P1-4/P2-1） |
| v0.5.7 | 2026-11-07 | 一键安装下载器健壮性：写流补 error 监听（磁盘满/不可写此前会崩主进程或永久挂起）、非 200/中断路径统一收口关闭句柄并清理半成品文件；PowerShell 命令对含单引号的 temp 路径做 '' 转义（2026-11-07 审查 P1-6/P2-6） |
| v0.5.8 | 2026-11-07 | 前端时序修复批次：任务实时日志 1 秒轮询 stale closure 失效（P0-2）；工作区切换/项目刷新/远程账号切换三处竞态加请求序号守卫；selectedProject 去掉 projects[0] 兜底恢复「未选中」语义；安装/克隆进度消失倒计时改 ref 跟踪防误清新进度；GitActionsPanel 各 tab 加载加序号守卫、切 tab 保留提交草稿、变更行 key 去掉易变状态；Git 操作全局互斥（busy 统一上收，批量执行中禁用面板写操作按钮） |
| v0.5.9 | 2026-11-07 | 磁盘体积计算异步化：readdirSync/statSync 同步遍历大项目会冻结主进程事件循环（全部 IPC 卡顿），改为 fs/promises + mapLimit 分层并发（与 analysis.ts 同纪律），同步/异步实现在真实目录树结果一致；移动项目成功后立即失效旧路径缓存；顺带修复合并赋值与 await 混用导致的并发累加丢失（复合赋值先读旧值再求值右侧，实测会少算 99% 体积）（2026-11-07 审查 P1-5/P2-13） |
| v0.6.0 | 2026-11-07 | 引入覆盖率度量与门禁：新增 @vitest/coverage-v8 与 test:coverage 脚本，纯函数层门槛 95/85/90/95（基线 97.9/89.0/92.7/97.8），CI 单测步骤升级为覆盖率门禁；服务层纳入门槛为下一里程碑（适配说明见 vitest.config.ts 注释，AGENTS.md 第八节） |
| v0.6.1 | 2026-11-07 | Git 解析加固批次（审查 P2-2/3/4/16 + P2-18）：status -z rename 成对解析（旧实现会产生幻影 staged 记录，已实证）；版本对比文件清单改用 --numstat 提取；stage/unstage/diff 路径加 :(literal) 关闭 glob（文件名含 [ ] * ? 不再误匹配）；stage/unstage 按 200 个一批分批执行（Windows 32K 命令行上限）；clone 命令加 -- 分隔并拒绝 - 开头 URL |
| v0.6.2 | 2026-11-07 | 操作记录 CSV 导出修复（审查 P2-10）：导出全量记录（原只导列表页的 500 条，库内保留 2000）；补 UTF-8 BOM（中文 Windows Excel 打开乱码）；csvEscape 对 = + - @ 开头的值前缀单引号防公式注入，补 1 组单测 |
| v0.6.3 | 2026-11-07 | IPC 加固批次（审查 P2-9/21）：操作审计 result 非法值不再静默美化成 ok（审计字段失真比拒绝写入更糟）；操作记录按路径反查 projectId（原恒为空串，按项目归组永远失效）；ai:saveKey 增加 4096 字符上限（zod 收敛）；IPC 字符串数组入参增加总量与单项长度上限 |
| v0.6.4 | 2026-11-07 | 远程平台交互修复（审查 P2-7/8）：GitHub/Gitee 的更新与删除端点 owner/name 补 URL 编码（与 GitLab 分支一致）；同步失败文案与实际行为一致（界面本就展示缓存，不再谎称"已加载"）；findRepository 网络异常不再吞成 null 被误报「仓库不存在」，改为明确的网络错误；删除不可达的缓存回退死分支 |
| v0.6.5 | 2026-11-07 | 死代码与假 UI 清理（审查 P2-12/14）：删除整页硬编码假数据的 ModuleWorkspace（路由 else 分支本就不可达）；移除无行为的铃铛按钮（红点恒亮）与「更多项目」按钮；Ctrl+K 提示仅在有其处理器的「我的项目」页显示并改用 Windows 键位标注；导航「任务中心」徽标移除（统计的 building 标签全库无处创建，恒为 0）；总览问候语改按时段生成（移除硬编码用户名占位）；installUpdate 改为返回 Promise，主进程拒绝执行时错误对用户可见 |
| v0.6.6 | 2026-11-07 | 重复代码下沉（审查 P2-12）：errorMessage（6 处逐字重复）与 assertDirectory（3 处且健壮性不一）收敛到零依赖 serviceUtils；openers 的断言原实现无 try/catch，目录不存在时会把原始 ENOENT 英文异常抛给渲染层，现已统一为中文文案 |
| v0.6.7 | 2026-11-07 | P2 收尾批次：saveProjects 注释与实现矛盾修正（审查 P2-11）；命令探测的 package.json 收敛为单次读取（原 npm 脚本与部署命令两条路径各读一次并各 JSON.parse，审查 P2-15）；更新检查 fetch 补 15 秒超时（挂起连接会让 30 分钟轮询堆叠）并加下载进行中守卫（重复触发会写同一临时文件互踩，审查 P2-17） |
| v0.6.8 | 2026-11-07 | storage 分域拆分①：抽出 storage/database.ts 公共基座（连接/建表/迁移/种子收口一处，域模块只经 openDatabase() 取连接），数据目录改为模块级可注入 initDatabase(dataDir)（不传参回退 userData，主进程行为不变），补 4 个连接注入冒烟测试；服务层从此在纯 Node 环境测真实 sqlite，不 mock electron（方案见 docs/refactor-storage-plan.md） |
| v0.6.9 | 2026-11-07 | storage 分域拆分②：workspaces 域迁出（list/create/rename/delete + 删除守卫原样搬移），ipc.ts 改从 storage/workspaces 导入；纯代码搬移 |
| v0.6.10 | 2026-11-07 | storage 分域拆分③：projects 域迁出（loadProjects/saveProjects 事务与 stale 清理逐字搬移，前端 saveQueueRef 串行落库语义不受影响），rowToProject 收入 database.ts；纯代码搬移 |
| v0.6.11 | 2026-11-07 | GitActionsPanel 组件拆分（治理轮-2①）：805 行面板按 tab 拆为 ChangesTab/BranchesTab/HistoryTab/TagsTab 四个子组件（数据与 loading 各自持有，per-kind 序号守卫随迁为 useLoadSequence hook），renderTimeline 移入 git/CommitTimeline.tsx；挂载沿用 ProjectDetail 的 visitedTabs 惰性挂载范式（首次访问才挂载、之后 hidden 隐藏保持状态），切 tab 保留数据与草稿、每次激活仍重载，UI 行为等价；提交/切分支的历史联动经 registerReload 登记入口跨 tab 触发，历史页未挂载时兜底拉取计数保持原角标行为 |
| v0.6.12 | 2026-11-07 | storage 分域拆分④：accounts 域迁出（增删改查 + 凭据一致性回滚原样搬移；删号级联清 remote_repository_cache 以内联 SQL 保留并注释原因——避免域间横向依赖），ipc/git/providers 调用方改从 storage/accounts 导入；顺带补 workspaces.ts 一处 prettier 格式 |
| v0.6.13 | 2026-11-07 | SettingsWorkspace 组件拆分（治理轮-2②）：文件内嵌的 AccountsWorkspace/AccountRow 拆至 settings/ 独立文件，设置页按 tab 拆为 AppSettingsTab/AiSettingsTab/EnvironmentTab；settings/notice/busy/aiKeyInput/hasAiKey 是应用与 AI 两 tab 共享同一 save() 的状态留父级，目录选择与 Key 清除等 tab 内交互随表单下沉；纯代码搬移，UI 行为等价 |
| v0.6.14 | 2026-11-07 | ProjectDetail 组件拆分（治理轮-2③）：未克隆视图整块抽为 UnclonedProjectPanel，概览 tab 下沉为 OverviewPanel（快捷动作/摘要生成/actionMessage 只被概览消费，随面板自持），Git tab 快捷区抽为 GitTabPanel，内嵌 AliasEditor/TagEditor/ReadmeSection/ProjectAnalysisPanel 拆至 detail/ 独立文件；tab 编排（DETAIL_TABS + visitedTabs 惰性挂载）与 README 阅读层留壳；纯代码搬移，UI 行为等价 |
| v0.6.15 | 2026-11-07 | storage 分域拆分⑤：tasks 域迁出（task_profiles/task_runs 七个函数与 rowToTaskProfile/rowToTaskRun 原样搬移），ipc 与任务执行服务 tasks.ts 改从 storage/tasks 导入；纯代码搬移 |
| v0.6.16 | 2026-11-07 | TasksWorkspace 组件拆分（治理轮-2④）：任务表单抽为 tasks/TaskForm（命令/参数候选项由 detectedCommands × draft 派生，留表单层），任务配置/运行记录两份列表抽为 TaskProfilesList/TaskRunsList（taskTypeLabel/runStatusMeta 随列表走）；draft 与 detectedCommands/customs 是跨 tab 状态（配置页编辑写入草稿、save 成功切页重置）按「跨 tab 共享才上提」留父级，1 秒实时日志轮询（runsRef 范式）与启停编排留壳；纯代码搬移，UI 行为等价 |
| v0.6.17 | 2026-11-07 | storage 分域拆分⑥：backups 域迁出（listBackups/insertBackup 原样搬移），ipc 与备份服务 backups.ts 改从 storage/backups 导入；纯代码搬移 |
| v0.6.18 | 2026-11-07 | storage 分域拆分⑦：operations 域迁出（审计记录写入/查询/清空/CSV 导出原样搬移，2000 条保留上限与 BOM 行为不变），ipc 改从 storage/operations 导入；纯代码搬移 |
| v0.6.19 | 2026-11-07 | storage 分域拆分⑧：settings 域迁出（loadSettings 缺键回退空默认/saveSettings 整体事务 upsert 原样搬移），ipc/ai/git/backups/setup 五处调用方改从 storage/settings 导入；纯代码搬移 |
| v0.6.20 | 2026-11-07 | storage 分域拆分⑨（收官）：remoteRepositoryCache 域迁出，storage.ts 删除——929 行单文件完成「database.ts 基座 + 8 域模块」拆分，调用方 7 文件全部显式指向域模块（方案 docs/refactor-storage-plan.md）；纯代码搬移 |
