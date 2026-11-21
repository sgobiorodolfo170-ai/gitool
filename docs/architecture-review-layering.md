# 分层与耦合评审报告（Layering & Coupling Review）

- 评审对象：`D:\github\gitool`（Electron + Vite + React + TypeScript 桌面应用）
- 评审范围：`src/`（组件与 hooks 分层）、`electron/main/`（ipc / services / storage）、`shared/types.ts`、测试与实现的目录对应关系
- 评审方式：只读源码，逐文件阅读 + 全仓符号/调用点检索（IPC 调用点、SQL 语句、函数跨度、测试清单均由脚本核对）
- 约束：**未修改任何业务代码**；本文件是唯一新增产物
- 关联任务：team task id=2 (`arch_layering`)，与 `docs/architecture-review-structure.md`、`docs/architecture-review-security.md` 独立产出

---

## 一、分层判定（结论先行）

**当前架构风格：名义四层、实际两层——「以 IPC 为唯一耦合面的扁平渲染层 + 主进程内 service/storage 二分」。**

名义分层链路是：

```
Renderer(React) → preload bridge → ipc.ts(adapter) → services/*(domain) → storage/*(SQL) → node:sqlite / git CLI / HTTP
```

逐段判定：

| 边界 | 是否成立 | 判定依据（证据） |
| --- | --- | --- |
| `services` → `storage`（主进程内） | **基本成立** | 所有 SQL 都集中在 `electron/main/services/storage/*`（9 文件 998 行），`services/*.ts` 内无 `.prepare(`/`FROM` 语句；依赖方向单向（service 引 storage，storage 不反向引 service），仅 `credentials`/`serviceUtils` 被 storage 依赖（`storage/accounts.ts:2-3`） |
| `storage` 表级边界 | **局部破防** | `storage/accounts.ts:156` 直接 `DELETE FROM remote_repository_cache`（写别的域的表）；`storage/workspaces.ts:77` 直接 `SELECT COUNT(*) FROM projects`（读别的域的表）。详见 L-15 |
| `ipc.ts` 作为纯适配层 | **不成立** | `ipc.ts:417-477` 内含操作日志编排 + 跨 workspace 反查项目 ID（N+1 读全表）；`ipc.ts:329-333` 在 handler 里 `insertTaskRun`。详见 L-03 |
| Renderer → hook → bridge（组件不直连 IPC） | **不成立** | 14 个组件文件共 **53 处** `bridge.*` 直调；8 个 hook 共 49 处。Git 域最典型：`useGitOperations.ts` 只包了 3 个动作，其余 14 个动作在 4 个 tab 组件内直连。详见 L-01、L-11 |
| 渲染层不含业务规则 | **不成立** | 渲染层手工构造 `Project`/`TaskProfile` 实体 6+ 处（`useRemotes.ts:173-191/245-263/315-333`、`useImportFlow.ts:67-84/132-149/176-193`、`TasksWorkspace.tsx:160-171`）；并在 UI 内组装 LLM prompt（`OverviewPanel.tsx:99-134`）。详见 L-02、L-10 |
| `shared/types.ts` 是双向共享契约 | **成立且干净** | 主进程 `preload/index.ts:2-39`、`ipc.ts:2-7`、`services/*` 与渲染层 `src/hooks/*` 均 `import type` 自 `shared/types`；文件内**只有 `export type`，无运行时值/函数**（无污染）。但它已膨胀为 546 行、80+ 类型、`DesktopBridge` 88 个方法（`458-546`）——见 L-09 |
| 通道名单一来源 | **不成立** | 通道字符串在三处手工维护：`preload/index.ts:55-176`（76 个 invoke + 4 个事件）、`ipc.ts:126-414`（77 个 handler）、`shared/types.ts:458-546`（方法名）。已出现 2 个「有 handler 无桥接方法」的死通道（L-14） |
| 分层可执行性（有机制阻止越界） | **不成立** | 仓库内无 `dependency-cruiser`/ESLint 分层规则（`AGENTS.md` 第九节要求「合规与架构」护栏，当前仅有 CI 三门禁 + 覆盖率门禁）；即越界无任何自动拦截 |

**一句话结论**：主进程内部的「service/storage」二分是成立的、且 storage 基本守住了「唯一 SQL 入口」；破坏整体分层的根因在**渲染层**——没有数据访问边界，组件与 hook 平权直连 IPC，同时渲染层还保留了主进程业务规则的「影子实现」（localStorage 版），并且实体装配逻辑散落在 6 处以上。因此当前不是"可执行的分层架构"，而是"约定俗成的目录分层"。

---

## 二、规模与复杂度热点

### 2.1 各层规模（不含 `*.test.*`）

| 目录 | 文件数 | 行数 |
| --- | --- | --- |
| `src/components` | 37 | 5,758 |
| `src/hooks` | 12（另有 1 个测试文件） | 1,872 |
| `src/lib` | 11（另有 4 个测试文件） | 565 |
| `electron/main/services`（含 `storage/` 9 个文件 1,069 行） | 29 | 4,946 |
| `shared/types.ts`（单文件） | 1 | 546 |

### 2.2 最大 5 个组件文件与职责数

| 排名 | 文件 | 行数 | props 数 | 承担的职责（逐条可指认） | 判定 |
| --- | --- | --- | --- | --- | --- |
| 0（跨层） | `src/App.tsx` | 634 | — | ① 路由（7 个 AppView）；② 工作区状态 + 持久化键；③ 应用设置状态；④ 字号偏好；⑤ 意见（notice）通道；⑥ 环境体检/一键安装编排；⑦ 更新检查/下载/安装编排；⑧ 首启 bootstrap（desktop + 浏览器两份分支）；⑨ 跨域联动（新增账号→默认选中、删除账号→清缓存）；⑩ 详情清除的反向登记（`registerClearDetail`）；⑪ 全局外壳 JSX（侧栏/顶栏/内容区）；⑫ 安装进度浮层；⑬ 安装引导模态（100+ 行内联 JSX，545-629） | **上帝组件**（13 项职责，L-04） |
| 1 | `src/components/RemoteRepositoriesWorkspace.tsx` | 459 | 15 | ① 列表过滤（67-71）；② 星标/关注派生集合（87-108）；③ 打开外部页面并直调 IPC（127-138）；④ 创建/编辑表单状态机（73-82、140-157）；⑤ 表单校验（162-169）；⑥ 提交与失败提示（159-186）；⑦ 列表 + 空态 + 模态渲染（199-456） | **上帝组件**（7 项，L-11/L-01） |
| 2 | `src/components/ProjectsWorkspace.tsx` | 349 | 5（4 个域对象） | ① 页头动作（刷新/批量导入/初始化/导入）；② 筛选 tab + 搜索；③ 标签过滤条；④ 全局键盘快捷键（`window.addEventListener` 101-128）；⑤ 批量选择（99、134-152）；⑥ 分栏拖拽（97、231-283）；⑦ 列表渲染；⑧ 详情装配（284-303）；⑨ 批量操作条 | 偏胖但已按域收敛（8 项） |
| 3 | `src/components/TasksWorkspace.tsx` | 314 | 2 | ① 任务/运行列表加载 + 4s 轮询（51-66）；② 运行日志 1s 轮询（103-133）；③ 草稿状态机；④ 命令检测（68-93）；⑤ 任务命名规则（137-154，业务规则在组件内）；⑥ `TaskProfile` 实体装配（160-171）；⑦ 保存/删除/启动/停止编排（156-220）；⑧ tab 路由（46） | **上帝组件 + 缺 hook 层**（9 项，L-01/L-02） |
| 4 | `src/components/git/HistoryTab.tsx` | 282 | 11 | ① 历史加载（69-85）；② 版本清单加载（87-100）；③ loading/计数上报面板（64-67、77）；④ 跨 tab 重载登记（122-126）；⑤ 版本对比（143-163）；⑥ revert（128-141）；⑦ 列表/时间线双渲染（176-204、205-279） | **容器/展示未分离**（7 项，L-11） |
| 5 | `src/components/detail/OverviewPanel.tsx` | 269 | 6 | ① 摘要/标签编辑；② 统计展示；③ 7 个快捷入口；④ AI/本地摘要生成 + 上下文拼装（92-168）；⑤ 结构分析展示 | 含业务逻辑的视图（L-10） |

> 正面样例（说明项目里已有正确范式）：`ProjectDetail.tsx:25-89`（tab 声明表 + `visitedTabs` 惰性挂载）、`ProjectsPage.tsx:28-118`（编排层只做装配）、`useAsyncData.ts:53-94`（零依赖核心状态机 + hook 薄接线）、`GitTabPanel.tsx:9-30`（纯透传）。这些文件的分层手法是正确的，可反向作为整改模板。

### 2.3 文件 >300 行清单

| 文件 | 行数 |
| --- | --- |
| `electron/main/services/git.ts` | 991 |
| `electron/main/services/providers.ts` | 753 |
| `src/App.tsx` | 634 |
| `shared/types.ts` | 546 |
| `electron/main/ipc.ts` | 499 |
| `src/components/RemoteRepositoriesWorkspace.tsx` | 459 |
| `src/hooks/useRemotes.ts` | 428 |
| `electron/main/services/storage/database.ts` | 406 |
| `electron/main/services/commandDetection.ts` | 395 |
| `src/components/ProjectsWorkspace.tsx` | 349 |
| `src/components/TasksWorkspace.tsx` | 314 |

### 2.4 函数 >50 行清单（花括号配对实测）

| 位置 | 函数 | 行跨度 |
| --- | --- | --- |
| `electron/main/ipc.ts:125-415` | `registerIpcHandlers`（77 个 handler 全塞在一个函数） | 291 行 |
| `electron/main/services/storage/database.ts:39-163` | `openDatabase`（连接生命周期 + 全量内联 DDL） | 125 行 |
| `electron/main/services/git.ts:624-712` | `cloneRepository`（URL/目标校验 + spawn + 进度解析 + 事件推送 + 失败清理） | 89 行 |
| `src/components/detail/OverviewPanel.tsx:92-168` | `generateSummary`（4 路并发取数 + prompt 拼装 + AI 调用 + 本地回退） | 77 行 |
| `electron/main/services/git.ts:886-952` | `moveProject`（跨设备复制 + 删除 + 回滚） | 67 行 |
| `electron/main/services/git.ts:323-383` | `getProjectSnapshot`（分支/状态/冲突/ahead-behind/提交/文件数/时间 7 类信息） | 61 行 |
| `electron/main/services/git.ts:385-443` | `runGitOperation`（前置拦截 + 多命令串行 + snapshot 回填） | 59 行 |
| `electron/main/services/git.ts:785-840` | `computeDiskSize`（并发 64 的目录遍历 + 忽略规则 + 缓存） | 56 行 |

### 2.5 参数 ≥6 的函数

**未发现**：全仓（`electron/`、`src/`、`shared/`）参数最多的函数为 4 个参数（`electron/main/ipc.ts:442` `recordOperation(operation, path, detail, result)`），其余复杂入参均采用输入对象（`shared/types.ts` 的 `*Input` 类型）。

> 但复杂度并未消失，而是**转移到了 props 透传**：`RemoteRepositoriesWorkspace` 15 props、`HistoryTab` 11 props、`SettingsWorkspace` 14 props，且其中 4 个是 setter（`setBusy`/`setOutput`/`onLoadingChange`/`onCountChange`）——见 L-11。

---

## 三、问题清单

> 严重度口径：**P0** = 架构边界已被击穿且正在产生静默错误风险，应先于功能迭代修复；**P1** = 边界成立性受损、改动成本随规模上升，需排期治理；**P2** = 可维护性/一致性缺陷，随邻近改动顺手修复。
> 所有位置均为实测行号；无法验证的一律标注「需确认」，不作推断性结论。

| ID | 严重度 | 位置 | 问题 | 为什么是问题 | 影响 | 改进建议 | 修复成本 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **L-01** | **P0** | `src/components` 14 文件 53 处直调：`TasksWorkspace.tsx:36,55-56,79,109,173,191,204,212`、`ChangesTab.tsx:63,77,110,112,126,149`、`BranchesTab.tsx:53,80,94,110`、`HistoryTab.tsx:74,91,133,147`、`TagsTab.tsx:54,84,105`、`BackupsWorkspace.tsx:17,26,37,42,66`、`LogsWorkspace.tsx:23,45,54,56`、`SettingsWorkspace.tsx:71,85-86,101,105`、`OverviewPanel.tsx:45,54,67,85,100-103,139`、`RemoteRepositoriesWorkspace.tsx:128`、`RemoteRepositorySearch.tsx:20`、`AppSettingsTab.tsx:25`、`UnclonedProjectPanel.tsx:20`、`GitActionsPanel.tsx:35,62,93` | 渲染层没有数据访问边界：组件与 hook 平权直连 preload bridge。Git 域最割裂——`useGitOperations.ts` 只包了 `runGitOperation/runBulkGitOperation/analyzeProject` 3 个动作，其余 14 个 Git 动作全部写在 tab 组件里 | 分层的第一条约束「UI 只依赖抽象、不依赖传输」被绕过。同一个 bridge 方法在不同组件里各自处理错误（有的 `catch` 后吞掉：`TasksWorkspace.tsx:82-85`、`HistoryTab.tsx:95-99`；有的提示：`BackupsWorkspace.tsx:52-54`），错误语义无法统一；bridge 方法签名变更时无处集中适配，只能逐组件改 | ① 新增 Git/tasks/backups/logs/settings 五个领域 hook（复制已验证的 `useProjects`/`useRemotes` 范式）；② 给组件加 `import { getDesktopBridge } from` 的 ESLint 禁入规则（只允许 `src/hooks/**` 与 `src/lib/bridge.ts` 引用）；③ 先做 Git 域（53 处中 17 处在 4 个 git tab 内，另 2 处在 `GitActionsPanel`） | **L** |
| **L-02** | **P0** | 实体字面量 6 处 + 静默兜底：`src/hooks/useRemotes.ts:173-191`、`245-263`、`315-333`；`src/hooks/useImportFlow.ts:67-84`、`132-149`、`176-193`；`src/components/TasksWorkspace.tsx:160-171`；`electron/main/ipc/schemas.ts:185-198`（`.catch()` 兜底）、`124`（`timeoutSeconds: z.number().catch(0)`） | `Project`（20 个字段）、`TaskProfile`（10 个字段）的构造逻辑在渲染层被复制 6 次；同一实体的校验在 `shared/types.ts`、`projectSchema`（`schemas.ts:178-199`）、`projectFromSnapshot`（`src/lib/projectMatch.ts`）三处独立维护 | 字段漂移**不会报错而是被静默改写**：`schemas.ts:185` 非法状态回退 `clean`、`193` 语言色回退默认值、`196` 磁盘大小回退 0 —— 渲染层漏字段/写错类型时，DB 里落的是"看似成功"的错误数据，无任何告警。新增字段必须同步改 6 处，漏改即静默丢数据 | ① 在 `shared/` 增实体工厂（`createProject(partial)`、`createTaskProfile(draft)`）作为唯一构造点；② 把 `projectSchema` 的 `.catch()` 收窄为「仅派生展示字段兜底，业务字段报错」；③ 6 处字面量分别替换为工厂 + 补单测（`src/lib/projectMatch.test.ts` 已有模板） | **M** |
| **L-03** | **P1** | `electron/main/ipc.ts:417-426`（`recordGitOperation`）、`428-433`（`recordClone`）、`435-440`（`recordCommit`）、`442-463`（`recordOperation`）、`465-477`（`resolveProjectIdByPath`）、`329-333`（`tasks:run` 内 `insertTaskRun`） | IPC 适配层承载领域编排与持久化：每次 Git 操作成功后，为反查 `projectId` 遍历**全部工作区**并逐区 `loadProjects`（465-477），是 N+1 次全表读；追加操作日志、写任务运行记录也在 handler 内完成 | 适配层本应只做「校验入参 → 调服务 → 返回」。现在它依赖 `storage/workspaces` 与 `storage/projects`（`ipc.ts:58,59-64`），使 `ipc.ts` 直接耦合两个表；任何非 IPC 触发路径（托盘、启动时自动更新、未来定时任务）都无法复用这些编排，只能复制粘贴 | 每次 git pull/fetch/commit/clone 后，主进程做 `1 + N_workspaces` 次 SQL 全量项目读（项目数 × 工作区数级）；审计日志与业务动作不具备事务性（`ipc.ts:448-462` 失败静默吞掉），且渲染层无法通过服务层直接记录操作 | ① 把 `recordOperation/resolveProjectIdByPath` 下沉为 `services/operations.ts`（新增），`ipc.ts` 只留一行转发；② `resolveProjectIdByPath` 改为 `storage/projects.findByPath(path)` 单条索引查询（`projects.ts:21` 已有按 workspace 查询范式）；③ `insertTaskRun` 移入 `services/tasks.ts`，与 `updateTaskRun`（`tasks.ts:118`）同层 | **M** |
| **L-04** | **P1** | `src/App.tsx:35-39`（4 个顶层 state）、`43-205`（8 个领域 hook 编排）、`225-287`（首启 bootstrap）、`264-282`（浏览器分支重复实现）、`137-143`（`resetView` 强制 `setWorkspace("overview")`）、`248`（`setSelectedId(storedProjects[0]?.id ?? "")`）、`545-629`（内联安装模态） | App 组件承担 13 项职责（见 2.2），且首启加载逻辑在 desktop/浏览器两条分支各写一遍（`230-263` 与 `265-281` 逻辑等价：读 activeWorkspace → 选首个 → 灌项目）；`resetView` 把「切换工作区」与「强制回到总览页」硬绑定 | ① 双份 bootstrap 已经漂移：浏览器分支不读 `ACTIVE_WORKSPACE_KEY` 之外的任何状态、不设置 `selectedId`，desktop 分支设置（247-248）——两套初始化语义不一致；② `App.tsx:248` 首启默认选中第一个项目，与 `useProjects.ts:97-99` 明确写下的领域规则「不做 projects[0] 兜底」相互矛盾，同一规则两处相反实现；③ 任何新增页面都要改 App 的 if-else 路由链（430-502） | 每加一个工作区都要动核心文件；安装引导模态的 100+ 行 JSX 与业务状态耦合，无法单测；`resetView` 的副作用使"切工作区保留当前页"这类需求无法实现 | ① 抽出 `useBootstrap()` 统一两条分支（`src/hooks/useBootstrap.ts`），浏览器态只做 `isDesktopRuntime()` 内部分支；② `SetupModal`/`SetupProgressFloat` 抽为 `src/components/setup/*`（`App.tsx:513-629`）；③ 路由改为 `Record<AppView, ReactNode>` 映射表；④ 首启是否选中首项由 `useProjects` 决策，App 只消费 | **M** |
| **L-05** | **P1** | `electron/main/services/git.ts` 全文件（991 行 / 38 个顶层函数）：`76-100`（二进制探测）、`102-161`（仓库检查/init/扫描）、`163-321`（diff/tags/versions/compare）、`323-443`（snapshot/operation）、`445-557`（暂存/提交/分支）、`559-619`（历史/revert）、`624-739`（clone + 校验）、`741-783`（进程封装 + 磁盘缓存）、`785-885`（磁盘统计/README）、`886-990`（移动/文件计数） | 单个 service 覆盖 8 个不相关子域：环境探测、仓库生命周期、状态查询、提交图操作、克隆、磁盘度量、README 读取、文件系统搬迁 | 无法按需测试或替换任一子域；`getActiveGitBinary`（76-100）被 `environment.ts:8` 依赖，而 `environment.ts` 又反向属于体检域——git.ts 的加载会连带整个服务图；磁盘统计（785-840）与 git 命令无关却共享同一模块级缓存（767-768） | 任何一处修改的爆炸半径 = 991 行；新人定位"分支操作"要在 30+ 函数中筛 | 按子域拆分：`git/binary.ts`、`git/repo.ts`（inspect/init/scan/move）、`git/status.ts`（snapshot/changedFiles）、`git/history.ts`（log/revert/compare/tags）、`git/branch.ts`、`git/clone.ts`、`git/disk.ts`（getDiskSize/readme/countFiles），用 `git/index.ts` 重新导出保持 ipc 不变 | **L** |
| **L-06** | **P1** | `electron/main/services/tasks.ts:116-122`（`persistRun` → `updateTaskRun`）、`electron/main/ipc.ts:331`（`insertTaskRun`）、`electron/main/ipc.ts:341-344`（`tasks:updateRun` handler）、`src/components/TasksWorkspace.tsx:191-192`（`runTask` 结果直接 `setRuns`） | 任务运行记录的持久化被切在三处：**首次插入**在 IPC 适配层、**状态/输出更新**在 service、**UI 侧**另有一份内存态可被 `tasks:updateRun` 覆盖（该通道实际无桥接方法，见 L-14） | 「谁负责一次运行的完整生命周期」没有唯一答案。若将来给任务加"人工修改状态"，UI 可绕过 service 直接改库；`persistRun` 的错误被 `catch{}` 完全吞掉（`tasks.ts:119-121`），运行记录可能永久停在 `running` 而无任何提示 | 任务中心显示的历史与真实执行结果可能不一致（DB 与内存双源）；后续接入异步/重试机制时无处下手 | ① `runTask` 内部完成 insert（`runningTasks.set` 之前写入），IPC 只返回；② 删除 `tasks:updateRun` 通道与 `taskRunSchema`（`schemas.ts:128-141`）在写路径上的使用；③ `persistRun` 失败改为写入一条 `failed` 记录或抛出到 UI | **S** |
| **L-07** | **P1** | 规则双份：`src/lib/workspaces.ts:59`「至少保留一个工作区」↔ `electron/main/services/storage/workspaces.ts:67`；`src/lib/workspaces.ts:71`「该工作区还有 N 个项目」↔ `storage/workspaces.ts:82`；`src/lib/workspaces.ts:25,42`「工作区名称不能为空」↔ `ipc/schemas.ts:204,209`；`src/lib/projects.ts:14`（`as Project[]` 直接信 `localStorage`）↔ `schemas.ts:178-199` | 渲染层保留了一整套「浏览器态存储实现」（`src/lib/projects.ts`、`src/lib/workspaces.ts`、`src/lib/uiPrefs.ts`、`src/lib/storageKeys.ts`），把主进程的工作区业务规则**逐字复制**了一份 | 两份实现在无共享代码、无共享测试的情况下维护。当前已可指认的差异：主进程版用 SQL 计数（`storage/workspaces.ts:77`），渲染版用 `JSON.parse` + 数组长度且对损坏数据静默放行（`lib/workspaces.ts:66-81`）；渲染版 `loadProjects` 对任何非数组直接返回 `[]`（`lib/projects.ts:14`），主进程版会按 schema 校验并兜底字段 | 桌面版与浏览器预览的行为不一致（删除保护时机、脏数据容忍度），且这种不一致只在浏览器预览下暴露；规则变更必须双份同步 | ① 抽出 `shared/workspaceRules.ts`（纯函数：`assertCanDelete` / `assertName`），两端共用——与 `shared/types.ts` 零运行时逻辑的现状相符；② 浏览器态实现改为「经同一纯函数 + localStorage adapter」；③ 若浏览器预览非产品目标，则删除 `src/lib/projects.ts` / `workspaces.ts` 的双实现，改单一 mock 数据源 | **M** |
| **L-08** | **P1** | `src/hooks/useProjects.ts:74-77,144-147,170-173`；`src/hooks/useWorkspaces.ts:54-56,71-73,88-92,109-113`；`src/hooks/useRemotes.ts:68,107-110,197,288-291,372-375`；`src/hooks/useImportFlow.ts:38-42`（浏览器用 `window.prompt` 代替目录选择）、`63-65`、`101-104`；`src/App.tsx:228-282` | 传输层没有被抽象：每个业务 hook 内部都用 `isDesktopRuntime()` 分叉，桌面走 bridge、浏览器走 localStorage / `window.prompt` / 固定环境对象 | 业务 hook 同时承担「业务编排 + 运行环境判断 + 传输实现」。13 个分叉点分布在 5 个文件，新增一条能力就要再写一次双分支；`window.prompt`（`useImportFlow.ts:42`）这类浏览器专用 API 混进了产品逻辑 | 浏览器态的每处行为都要单独推理（例如 `useProjects.ts:145` 在浏览器态直接 `return` 并提示"演示数据"，而 `applyProjects` 仍可被调用）；单测必须 mock `window.gitool` 才能覆盖桌面路径 | ① 定义 `ProjectRepository`/`WorkspaceRepository`/`ShellGateway` 接口，提供 `desktop` 与 `web` 两个实现，在 `App` 启动时注入（或 `src/lib/bridge.ts` 内做一次环境适配）；② hooks 只依赖接口，删除 hook 内的 `isDesktopRuntime()` 分叉 | **M** |
| **L-09** | **P1** | `shared/types.ts`:1-546（80+ export type），`458-546`（`DesktopBridge` 88 个方法）；通道名三处硬编码：`electron/preload/index.ts:55-176`、`electron/main/ipc.ts:126-414`、`shared/types.ts:458-546`；双别名：`src/types.ts:1`（`export * from "../shared/types"`）与直接引用 `../../shared/types`（`useRemotes.ts:2`）并存 | 契约文件已从"共享领域模型"演化成"上帝类型文件"：领域实体、IPC 方法面、事件 payload、UI 视图枚举（`AppView`）、后端环境结构（`EnvironmentStatus`）混在一处；通道字符串没有任何单一常量源 | 88 个方法无分组、无注释分层，定位成本高；通道名任一字符改动（如 `projects:clone` vs `git:cloneProgress` 前缀不一致）不会被编译期发现，只能靠运行时 500 式报错（`ipc.ts:150` 手动 `throw` 才暴露）；两套 import 别名使"契约来源"在代码里看起来像两个模块 | ① `shared/types.ts` 按域拆为 `shared/types/{project,git,account,task,backup,settings,ipc}.ts` + `index.ts` 重导出;② 新增 `shared/channels.ts` 常量表，preload/ipc 两侧都引用（可配合 `satisfies Record<keyof DesktopBridge, string>` 做编译期完整性检查）；③ 统一 import 入口（删除 `src/types.ts` 别名或全仓改用别名） | **M** |
| **L-10** | **P1** | `src/components/detail/OverviewPanel.tsx:92-168`，尤其 `99-104`（4 路并发取数）、`105-134`（prompt 上下文拼接）、`136-146`（AI 调用 + 回退决策）、`148-159`（本地摘要模板） | 「生成摘要」的业务逻辑（取哪些数据、截断多少字符、如何拼成 LLM 上下文、AI 失败后如何本地回退、回退文案模板）全部写在展示组件里 | 这是明确的领域逻辑（提示词工程 + 降级策略），却被绑在 React 生命周期与 `bridge` 直调上：无法单测、无法复用于"批量生成摘要"、无法调整模型参数而不动 UI | 摘要质量与提示词迭代必须改组件文件；`slice(0,400)`、`slice(0,5)`、`slice(0,120)` 等 magic number 硬编码（`106,117,153`），违反 `AGENTS.md` 第七节「禁止 magic number」 | ① 抽 `src/lib/aiContext.ts`（纯函数：`buildSummaryContext(project, readme, history, analysis, disk)`）并补单测；② 抽 `src/hooks/useAiSummary.ts` 承载"AI→本地"降级编排；③ `OverviewPanel` 只保留 `actionMessage` 展示与按钮 | **S** |
| **L-11** | **P1** | `src/components/git/HistoryTab.tsx:17-47`（11 props，其中 4 个是 setter：`39-44`）、`src/components/GitActionsPanel.tsx:35,52-54,58-69,197-199`（`historyReloadRef` 登记式联动）、`src/components/git/ChangesTab.tsx:13`（同类 11 props 结构，直调 6 处 IPC） | Git tab 组件同时是「数据容器」「业务编排」「展示」：loading/计数通过回调上报面板（`HistoryTab.tsx:64-67`），跨 tab 联动通过 `registerReload` ref 反向登记（`GitActionsPanel.tsx:54,197-199`），写操作互斥通过 4 个 setter 逐层下传 | 组件间通信绕过了单一数据源：面板要"刷新历史"必须先问 ref 里登记过谁，未挂载时还要走兜底拉取（`GitActionsPanel.tsx:58-75`）；任何新 tab 都要复制这套 props 契约（11 个） | 4 个 tab 文件重复同一套 props 骨架（`active/refreshSeq/busy/isBusy/setBusy/setOutput/onLoadingChange/onCountChange`），新增一个上报字段要改 5 个文件；`eslint-disable react-hooks/exhaustive-deps` 出现 9 处（`BranchesTab:67,73`、`ChangesTab:96,102`、`HistoryTab:107,117,125`、`TagsTab:71,77`），说明依赖关系已难以显式表达 | ① 建 `useGitPanel(projectPath)` 收敛「当前 tab / shared output / busy / 计数 / reload 触发器」到单一 store（`useReducer` 或轻量 store）；② tab 组件改为只接 `projectPath` + 2-3 个回调；③ 用 key 或显式 `reloadToken` 替代 ref 登记 | **M** |
| **L-12** | **P1** | 覆盖率白名单 `vitest.config.ts:22-43`（include 仅 19 个文件）；服务层无测试文件：`electron/main/services/{git,providers,tasks,backups,analysis,commandDetection,environment,setup,ai,updater,credentials,openers,events}.ts`（`git.ts` 991 行 / `providers.ts` 753 行均无 `*.test.ts`）；渲染层仅 `src/hooks/useAsyncData.test.ts` 一个 hook 测试，`src/components` 5,758 行**零测试** | 测试分层与实现分层错位：测试集中在「零 IO 纯函数 + storage 域」，而最重的两层（services 4,946 行、components 5,758 行 + hooks 1,872 行）几乎无覆盖；`vitest.config.ts:35-37` 注释已自认「git.ts 等其余服务层（下一里程碑）」 | 覆盖率门槛（95/85/90/95）是对**白名单子集**生效的，给人的信号是"达标"；实际风险最高的 git 命令拼装/解析、provider HTTP 拉取、任务进程生命周期、备份 tar 流程全部无回归保护。`AGENTS.md` 第八节要求「核心业务模块 ≥90%」，当前 Git 域为 0 | `gitParsing.test.ts`（256 行）覆盖的只是纯函数，`git.ts` 中真正的编排（如 `getProjectSnapshot:323-383`、`cloneRepository:624-712`）未被测试 | ① 下一里程碑把 `git.ts` 拆完后按新文件纳入覆盖率（拆分本身即测试前置）；② 先给「零依赖但未被覆盖」的模块补测：`src/lib/{projects,workspaces,uiPrefs}.ts`、`src/lib/bridge.ts`（可用注入的假 bridge）；③ 组件层引入 `@testing-library/react` 后从 `common.tsx`、`TaskProfilesList` 等纯展示件起步 | **L** |
| **L-13** | **P2** | `src/hooks/useGitOperations.ts:44`（模块级 `gitBusyRef`）、`src/components/GitActionsPanel.tsx:39,52`（本地 `busy` + `externalBusy`）、`src/components/detail/GitTabPanel.tsx:36,41-42`（用 `activeOperation !== null` 判禁用） | Git 写操作互斥存在 **3 个状态源**：模块级锁（跨挂载）、hook 内 `activeOperation` state、面板内 `busy` state。正确性完全依赖 `externalBusy` 从 `ProjectsWorkspace.tsx:298` → `ProjectDetail.tsx:60` → `GitTabPanel.tsx:26` → `GitActionsPanel.tsx:52` 四层 props 透传 | 透传链任一环断裂（新增入口忘记传、或详情从其它路由挂载）就会让"批量操作执行中仍可提交/切分支"重新出现（正是 `useGitOperations.ts:35-43` 记录的历史缺陷）。三套状态还需各自复位，`useGitOperations.ts:99,150` 与 `GitActionsPanel.tsx:91-99` 是两份 finally | 并发 git 进程争用 `index.lock` 的风险以"约定"而非"机制"被防护 | ① 把"是否 busy"下沉为单一 store（同 L-11 的 `useGitPanel`）并让所有入口只读它；② 或把互斥放到 main：`git.ts` 对项目路径加进程内串行队列，忽略渲染层状态 | **S** |
| **L-14** | **P2** | 死通道：`electron/main/ipc.ts:341-344`（`tasks:updateRun`）、`ipc.ts:359-361`（`operations:record`）——`electron/preload/index.ts:54-176` 与 `shared/types.ts:458-546` 均无对应方法（实测：77 个 handler vs 76 个 invoke 通道，差集恰为这两个）；死代码：`electron/main/services/providers.ts:157-159`（`loadCachedRemoteRepositories` 全仓无调用），实际由 `ipc.ts:285-289` 直连 `storage/remoteRepositoryCache.loadRemoteRepositoryCache` | 契约（bridge 方法）与实现（handler）之间没有编译期一致性检查，导致「注册了但没人能调」的通道长期存在；同域能力还出现"service 有包装但绕过它直连 storage"的分裂 | 死通道扩大了 IPC 攻击面（`operations:record` 允许任意 `OperationRecord` 写库，`schemas.test.ts` 还为其维护了 schema），审计日志可被伪造却无合法调用方；`providers` 的同名函数误导读者以为缓存读取走服务层 | ① 删除两个死通道与其 schema/测试用例；② 若保留（见附录"需确认"），则补 bridge 方法与类型；③ 添加单测：`Object.keys(bridge)` 与 `ipcMain` 注册表双向差集为空（可基于 worker + mock 实现）；④ 统一走 `providers.loadCachedRemoteRepositories`，`ipc.ts` 不直接 import storage 的缓存模块 | **S** |
| **L-15** | **P2** | `electron/main/services/storage/accounts.ts:156`（`DELETE FROM remote_repository_cache WHERE accountId = ?`）、`electron/main/services/storage/workspaces.ts:76-84`（`SELECT COUNT(*) FROM projects` + `DELETE FROM workspaces`） | 表所有权破防：accounts 域直接写 `remote_repository_cache` 表（所有者是 `storage/remoteRepositoryCache.ts`），workspaces 域直接读 `projects` 表（所有者是 `storage/projects.ts`） | 「storage 是唯一 SQL 入口」成立，但「一个表只有一个 owner 模块」不成立。表的列名/语义变更时会被兄弟模块悄悄破坏（例如给 cache 表加分区键，accounts 的级联删除将失效或不完整） | 删除账号时的缓存清理、删除工作区时的"仍有项目"保护，是两条**跨域不变量**，目前没有单点表达；`foreign_keys = ON`（`database.ts:47`）也未用于这两张表（`projects`/`remote_repository_cache` 未见 FK 声明） | ① 把级联删除与计数暴露为 owner 模块的 API：`remoteRepositoryCache.deleteByAccount(accountId)`、`projects.countByWorkspace(workspaceId)`，由 accounts/workspaces 调用；② 或补真 FK + `ON DELETE CASCADE/RESTRICT` 让数据库承担不变量 | **S** |
| **L-16** | **P2** | provider 联合：`shared/types.ts:64`（`RemoteProvider`）↔ `shared/types.ts:108`（手写 `"github"\|"gitee"\|"gitlab"\|"local"`）↔ `ipc/schemas.ts:182,213,253`；visibility 联合：`shared/types.ts:249` ↔ `src/hooks/useRemotes.ts:37` ↔ `src/components/RemoteRepositoriesWorkspace.tsx:60,78`；TaskType：`shared/types.ts:278` ↔ `ipc/schemas.ts:119`；`RemoteRepositoryWriteInput` 形状在 `useRemotes.ts:31-40` 与 `RemoteRepositoriesWorkspace.tsx:53-63` 各抄一份 | 同一联合类型/对象形状在契约、校验、渲染三处各写一遍，没有 `Pick`/`Omit`/类型引用 | 增删平台（如加 `coding`）或可见性枚举时，编译器只会报"部分位置"，漏改处由 `.catch()`/`as` 静默吸收（见 L-02）。`Provider` 在 types 里出现 4 次，是最典型的漂移入口 | ① `Project.provider` 改为 `RemoteProvider \| "local"`（`types.ts:108`）；② schema 的枚举用 `z.enum` 从常量数组派生（`shared/types.ts` 可导出 `const REMOTE_PROVIDERS = [...] as const`，再 `type RemoteProvider = typeof REMOTE_PROVIDERS[number]`——注意这会引入运行时值，需按 L-09 的拆分规划放到 `shared/constants.ts`）；③ 组件/hook 直接引用 `RemoteRepositoryWriteInput` 与 `Partial<RemoteRepositoryWriteInput>` | **M** |
| **L-17** | **P2** | `electron/main/services/gitParsing.ts:36-53`（`parseChangeStatus`：`U`/`AA`/`DD` → conflicted）↔ `electron/main/services/git.ts:335-339`（`getProjectSnapshot` 内联：`line[0]==="U" \|\| line[1]==="U" \|\| startsWith("AA ") \|\| startsWith("DD ")`） | 冲突判定在两处独立实现：一处解析 porcelain `-z`（`gitParsing.ts:151-189`），一处解析带 branch 的人类可读行（`git.ts:332-339`） | 两处对"冲突"的定义必须永远一致，否则会出现「详情页显示 conflicted，项目卡片显示 dirty」。当前实现细节已不同（一个看两个字符位，一个额外用 `startsWith` 带空格，覆盖 `??`→untracked 的差异靠注释维持） | 状态展示在同一仓库的两个视图间可能矛盾（列表快照 vs 详情变更列表） | 在 `gitParsing.ts` 增 `parseStatusEntryLine(line)` / `isConflictStatus(status)`，`git.ts:335-339` 改为调用；两处共用同一组常量（`"AA"`,`"DD"`,`"U"`） | **S** |
| **L-18** | **P2** | 渲染层拼路径：`src/hooks/useRemotes.ts:297`（`` `${parentDirectory}\\${repository.name}` ``）、`src/hooks/useImportFlow.ts:115`（`` `${directory}\\${projectName}` ``）；对比主进程正确做法：`git.ts:14` `import { basename, dirname, isAbsolute, join } from "node:path"` | 目录拼接属于"平台相关文件系统语义"，却在渲染层用硬编码反斜杠实现 | ① 渲染层与主进程的路径规则会分叉（主进程 `moveProject` 用 `join`+规范化，渲染层用字符串拼接）；② 名称中含尾随空格/保留字（`CON`, `aux.`）时两处结果不同；③ 浏览器预览下 `\\` 也是错的（尽管预览不落盘） | 跨平台/边缘命名的行为不可预期；后续任何"目标目录策略"变更（如按 provider 分子目录）要改渲染层 | ① 新增 IPC `resolveTargetPath({ parent, name })` 或直接让 `initRepository`/`cloneRepository` 接受 `parentDirectory` + `name`，由主进程 `join` 并做合法性校验（`git.ts:726-739` 已有 `assertCloneTarget`）；② 渲染层只传语义入参，不构造路径 | **S** |
| **L-19** | **P2** | `src/App.tsx:38`（`appSettings` state）、`src/App.tsx:239`（首启写入）、`src/components/SettingsWorkspace.tsx:72`（第二份 `settings` state）、`SettingsWorkspace.tsx:81-94`（自己再 `loadSettings`）、`SettingsWorkspace.tsx:105-109`（保存后单向回写 App）、`SettingsWorkspace.tsx:19-29`（`INITIAL_SETTINGS` 第三份字段形状） | 应用设置存在两份运行时状态（App 与设置页各自持有），依赖一次单向 `onSettingsChange` 同步 | 任一入口修改设置（目前只有设置页，但 `BackupsWorkspace.tsx:37` 已读设置、`OverviewPanel.tsx:103` 也读设置）后，App 侧状态不会自动刷新；字段形状在 `AppSettings` 类型、`INITIAL_SETTINGS`、`schemas.ts:57-67` 三处维护，加字段要改三处 | App 顶部/总览依赖的 `defaultSearchAccountId` 可能与设置页显示的值不一致（直到重进设置页） | ① 设置纳入单一 store/`useSettings()` hook（可复用 L-11 的 store 方案）；② `INITIAL_SETTINGS` 从 `shared` 导出默认值常量，与 schema `.catch()` 兜底共用同一份 | **S** |
| **L-20** | **P2** | 事件发送三路径：`electron/main/index.ts:12`（`window.webContents.send("updater:available")`）、`electron/main/ipc.ts:400`（`win?.webContents.send("updater:progress")`）、`electron/main/services/events.ts:3-8`（`notifyRenderer` 被 `git.ts:50`、`setup.ts:8` 使用）；隐性单例：`window.gitool`（`src/lib/bridge.ts:7`）、`gitBusyRef`（`useGitOperations.ts:44`）、`cachedDownloadUrl`/`updateDownloadInFlight`（`ipc.ts:121-124`）、`runningTasks`/`stopRequested`（`tasks.ts:8,11`）、`diskSizeCache`（`git.ts:767-768`）、`database` 连接（`storage/database.ts:35`） | 同一类"主→渲染"推送有三种实现；模块级可变状态共 7 处，无生命周期契约 | ① 三路径中只有 `notifyRenderer` 会广播到所有窗口（`events.ts:5-7`），`index.ts:12`/`ipc.ts:400` 只发某窗口——多窗口/托盘场景下事件会丢；② 模块级状态无统一重置入口（`cachedDownloadUrl` 跨"检查→下载"两次 IPC 保持，`updateDownloadInFlight` 仅在 finally 复位，异常退出路径靠 try/finally），无法在测试中隔离 | 事件订阅方（渲染层 `useUpdater`/`useEnvironment`）行为随窗口拓扑变化；单例状态使主进程逻辑难以单测（需 `vi.resetModules`） | ① 事件统一走 `services/events.ts`（新增 `sendToWindow(window, channel, payload)` 供定向场景）；② 把 `cachedDownloadUrl`/`updateDownloadInFlight` 收进 `updater.ts` 的"一次更新会话"对象，IPC 只持有 id；③ 为模块级状态补 `reset*ForTest()`，或在 `beforeEach` 用依赖注入替换 | **M** |
| **L-21** | **P2** | `electron/main/services/storage/database.ts`：`39-163`（连接生命周期 + 9 张表内联 DDL）、`194-284`（`ensureIndexes` + 3 个迁移 + 种子函数）、`285-406`（7 个 `rowToX` 行映射）；`electron/main/ipc.ts:125-415`（291 行单函数 77 个 handler） | 单文件混合三类不相关职责：连接管理、schema DDL/迁移、行记录→领域对象映射；IPC 注册全塞在一个函数里（77 个 `ipcMain.handle`，仅用空行做视觉分组） | 改 schema 需动 406 行文件的 DDL 区与迁移区；行映射与 DDL 必须手工保持一致（列名改动无编译期检查，靠 `as unknown as SqlRow` 遮盖，见 L-22）；`registerIpcHandlers` 291 行无法定位"我改的通道在第几段"，也无法按域拆分测试 | 每次新增实体都会继续膨胀 `database.ts`（已是 406 行 9 表）；IPC 层难以做"按域注册"的路由表校验 | ① `database.ts` 拆为 `database/connection.ts` + `database/schema.ts`（DDL）+ `database/migrations/*` + `database/rows/*`；② `ipc.ts` 按域拆 `ipc/{system,projects,git,accounts,remotes,tasks,backups,settings,updater}.ts`，各自导出 `register(ipcMain)`，`ipc.ts` 只做聚合（同时为 L-14 的双向差集校验提供天然入口） | **M** |
| **L-22** | **P2** | `as unknown as SqlRow[]`／`as unknown as SqlRow \| undefined` 共 17 处：`storage/accounts.ts:21,34,120`、`storage/backups.ts:16`、`storage/database.ts:203,225,242`、`storage/operations.ts:22`、`storage/projects.ts:23,76`、`storage/remoteRepositoryCache.ts:32,48`、`storage/settings.ts:14`、`storage/tasks.ts:18,26,86`、`storage/workspaces.ts:22`；另有 `src/lib/projects.ts:14`（`parsed as Project[]`）、`electron/preload/index.ts:41-43`（`invoke<T>` 内 `as T`）与事件 payload `as InstallProgress/CloneProgressEvent/{version}/UpdateProgress`（`58-61,81-84,158-161,167-170`） | 类型安全的两个收口点都靠断言而非校验：DB 行 → 领域对象（`rowToX` 内字段逐个 `String(...)` 强转）、IPC 返回值 → 渲染层类型（preload 直接 `as T`） | ① `node:sqlite` 返回 `unknown`，`as unknown as` 把"列名写错/类型不符"变成运行时 `undefined`，再由 `String(undefined)` 变成字符串 `"undefined"` 落库或展示；② preload 的 `as T` 意味着 **主进程返回结构的任何变化在渲染层不会报错**，只会让 UI 读到 `undefined`（例如新增字段后旧 preload 版本） | 数据完整性依赖"写代码时小心"；跨进程契约无运行时护栏（`ipc/schemas.ts` 只校验入参，**出参完全不校验**） | ① 为 `rowToX` 增加运行时断言（例如断言必填列为 `string/number`，失败抛带表名/列名的错误）；② 在 preload 为高频返回值（`Project[]`、`GitSnapshot`、`EnvironmentStatus`）加轻量校验（可复用 `ipc/schemas.ts` 的子 schema，需把 schema 移到 `shared/` 以避免 electron 依赖）；③ `lib/projects.ts:14` 用 schema 校验 localStorage 数据 | **M** |

### 3.1 严重度分布

| 严重度 | 数量 | 条目 |
| --- | --- | --- |
| **P0** | **2** | L-01、L-02 |
| **P1** | **10** | L-03、L-04、L-05、L-06、L-07、L-08、L-09、L-10、L-11、L-12 |
| **P2** | **10** | L-13、L-14、L-15、L-16、L-17、L-18、L-19、L-20、L-21、L-22 |
| 合计 | **22** | — |

---

## 四、七个评审维度的逐条核对

### 4.1 渲染层组件划分逻辑（Workspace 大类 vs `detail/` `git/` `settings/` `tasks/` 子域）

| 观察 | 结论 |
| --- | --- |
| 目录分层客观存在：根级 16 个文件（其中 8 个 `*Workspace/Page` 页面组件 + `common.tsx`/`GitActionsPanel.tsx`/`ProjectDetail.tsx` 等共用件）+ 子域目录 `detail/`(7)、`git/`(6)、`settings/`(5)、`tasks/`(3) | **方向正确**：按页面（路由）+ 页内子域两级划分，符合「路由级容器 + 子域组件」的常见做法 |
| 子域拆分深度不一致：`detail/` 拆得最细（`OverviewPanel`/`ReadmeSection`/`AliasEditor`/`TagEditor`/`GitTabPanel`/`ProjectAnalysisPanel`/`UnclonedProjectPanel` 各自独立）；`settings/` 拆出 4 个 tab 文件（`SettingsWorkspace:13-16`）；`git/` 拆出 4 个 tab；但 `RemoteRepositorySearch.tsx`(190) 独立、`RemoteRepositoriesWorkspace.tsx`(459) 仍内含 100 行模态表单（`372-456`） | **需收敛**：同层级组件"体量差 3 倍"，说明拆分标准是"历史迁移结果"而非统一规则。判据应是「是否 >1 个职责」，`RemoteRepositoriesWorkspace` 的创建/编辑表单应移至 `remotes/RepositoryForm.tsx`（同 L-11） |
| 上帝组件：`App.tsx`(634)、`RemoteRepositoriesWorkspace`(459)、`TasksWorkspace`(314) | **确认存在**（见 2.2、L-04、L-11） |
| 正面：`ProjectDetail.tsx:25-89` 用 `DETAIL_TABS` 声明表 + `visitedTabs` 惰性挂载；`ProjectsPage.tsx` 只做编排装配 | **可作为整改模板** |

### 4.2 `src/hooks` 是否承担过多业务逻辑

- 规模：12 文件 1,872 行，其中 `useRemotes.ts` 428 行 / 14 处 IPC / 11 个 state、`useImportFlow.ts` 240 行 / 12 处 IPC、`useProjects.ts` 218 行 / 5 处 IPC、`useWorkspaces.ts` 137 行 / 4 处 IPC。
- 过多业务逻辑的判据不是行数，而是「是否包含领域构造与领域规则」：
  - **是**：`useRemotes.ts:173-191,245-263,315-333` 直接构造 `Project` 实体（含 20 个字段、默认色值 `#8b97a8`、`"未克隆"` 文案、id 生成规则 `${name}-${Date.now()}`）；`TasksWorkspace.tsx:137-154` 的「任务名 N+1」规则在组件里而非 hook。
  - **是**：`useProjects.ts:150-161` 的刷新编排（4 并发 + snapshot 映射 + workspace 竞态守卫）本身合理，但把「浏览器预览返回演示数据」的提示（`145`）也写在数据层。
  - **否（设计良好）**：`useAsyncData.ts`(165)、`useNotice.ts`(49)、`useSplitWidth.ts`(109)、`useReadme.ts`(46) —— 单一职责、可测（`useAsyncData.test.ts` 已验证）。
- 结构性缺口：**6 个领域没有 hook**（tasks / backups / logs / settings / remote-search / detail 动作），对应 5,758 行组件里承担了本应属于 hook 的编排（L-01）。hooks 覆盖度：projects、remotes、import、workspaces、accounts、environment、updater、git-operations（8 个域）vs 组件内直管 14 个组件。

### 4.3 组件 → hook → IPC 调用链一致性

| 域 | 链路 | 一致性 |
| --- | --- | --- |
| projects / workspaces | 组件 → `useProjects`/`useWorkspaces` → bridge | ✅ 一致（`useProjects.ts` 5 处、`useWorkspaces.ts` 4 处） |
| remotes / accounts | 组件 → `useRemotes`/`useAccounts` → bridge | ⚠️ 主体一致，但 **`RemoteRepositoriesWorkspace.tsx:128` 绕过 hook 直调 `openExternal`**；`RemoteRepositorySearch.tsx:20` 整块直连（3 处） |
| import / environment / updater | 组件 → hook → bridge | ✅ 一致 |
| **git-operations** | `ProjectsWorkspace` → `useGitOperations`（3 个动作）**＋** `GitTabPanel`/`GitActionsPanel`/4 个 tab → bridge（19 处） | ❌ **链路断裂**：同一域两套通路 |
| **tasks** | `TasksWorkspace` → bridge（8 处） | ❌ 无 hook 层 |
| **backups** | `BackupsWorkspace` → bridge（6 处） | ❌ 无 hook 层（含 `loadSettings` 读设置） |
| **logs** | `LogsWorkspace` → bridge（4 处） | ❌ 无 hook 层 |
| **settings** | `SettingsWorkspace`（5 处）+ `AppSettingsTab`（1 处） | ❌ 无 hook 层 + 状态双份（L-19） |
| **detail 动作** | `OverviewPanel`（5 处）+ `UnclonedProjectPanel`（1 处） | ❌ 无 hook 层（含 AI prompt 组装，L-10） |

量化：组件 53 处（14 文件）vs hooks 49 处（8 文件）——**近一半 IPC 调用绕过 hook**。

### 4.4 主进程 service 划分与 storage 唯一入口

- service 按领域拆分：`git`(991)、`providers`(753)、`commandDetection`(395)、`setup`(233)、`analysis`(186)、`backups`(139)、`tasks`、`ai`、`updater`、`environment`、`openers`、`credentials`、`events`、`concurrency`、`commandLine`、`gitParsing`、`operationCsv`、`processCleanup`、`serviceUtils`、`version`（含单文件 9 行的 `events.ts`，拆分粒度已经不整齐）。
  - **判定**：领域划分方向成立，但 `git` 与 `providers` 两个"超级 service"（合计 1,744 行，占 services 总量 4,946 行的 35%）破坏了粒度一致性（L-05）。
- storage 是否唯一数据访问入口：**成立**。全仓 `SELECT/INSERT/UPDATE/DELETE` 仅出现在 `electron/main/services/storage/*`（9 文件）与测试中；`services/*.ts` 内无 SQL 字符串。例外：`ipc.ts` 直接 import 8 个 storage 模块（`ipc.ts:53-80`）做纯 CRUD 转发——作为组合根可接受，但导致 L-14 的"绕过 service 包装"。
- 跨模块访问其他 storage 表：2 处（L-15）。其余 storage 模块均只操作自表（`projects`→projects、`tasks`→task_profiles/task_runs、`settings`→settings、`backups`→backup_records、`operations`→operation_records、`workspaces`→workspaces，除 `projects` 计数）。
- service 依赖方向：`service → storage`（6 个 service 引用 storage），未发现 `storage → service` 反向依赖（`storage/accounts.ts:2` 依赖 `credentials` 属基础设施，可接受）。

### 4.5 重复与漂移

| 关注点 | 结论 |
| --- | --- |
| **git 逻辑是否在 `git.ts` / `gitParsing.ts` / `commandLine.ts` 间重复** | **基本无重复且分工正确**：`gitParsing.ts`(256) 是零依赖纯函数层，`git.ts:51-65` 引用了其中 10 余个符号（`isValidRefName`、`isValidCommitHash`、`bracketValue`、`parseCloneProgress`、`parseStatusPorcelainZ`、`parseChangeStatus`、`toLiteralPathspec`、`parseBranchLine` 等，均实测有调用点）；`commandLine.ts`(83) 只被 `tasks.ts:4` 使用（`splitCommandLine`/`quoteWindowsArg`），与 git 无关（git 走 `execFile` 数组参数，无 shell 拼接）——**不是重复，是"被误认为重复"的正确分离**。唯一真实重复：冲突状态判定（L-17）。 |
| **备份逻辑（`services/backups.ts` vs `storage/backups.ts`）职责是否混淆** | **不混淆**：`backups.ts`(139) 负责 tar 打包/恢复/文件名消毒/目录校验（`17-105`），`storage/backups.ts`(35) 只负责 `backup_records` 表读写（`listBackups`/`insertBackup`）。但有两处命名/分层小瑕疵：① 同名文件不同职责，靠目录区分，阅读成本高；② `backups.ts:124-126` 把 `serviceUtils.assertDirectory` 再包一层（仅为改中文 label），属可接受的薄适配。ipc 侧 `backups:list` 直连 storage（`ipc.ts:65,346`）与"列表是纯读"的定位一致。 |
| **类型在 `shared/types.ts` 与 `src/electron.d.ts` 间是否重复漂移** | **未漂移**：`src/electron.d.ts:1-7` 仅声明 `Window.gitool?: DesktopBridge` 并从 `shared/types` 引入，无重复定义；`src/types.ts:1` 是 `export *` 转发（双别名问题见 L-09）。真正的类型重复在 union 字面量与对象形状（L-16）。 |
| **渲染层重复实现主进程规则** | 见 L-07（工作区）与 L-02（实体）。 |
| **prompt / 文案类重复** | `OverviewPanel.tsx:148-159` 本地摘要模板、`useRemotes.ts:187,259` 占位摘要文案、`useImportFlow.ts:76,146,190` 三种"待分析/刚初始化/批量扫描"摘要 —— 三处业务文案策略，无统一来源（P2 级，已并入 L-02 的工厂建议）。 |

### 4.6 状态管理

- **全局状态位置**：无全局 store / Context。分布为：`App.tsx`（`workspace`、`activeWorkspaceId`、`appSettings`、`fontScale`，36-39）；领域状态在各自 hook（projects/remotes/accounts/…）；页面内状态在页面组件（筛选、批量选择、tab）；设置页另有一份 settings（L-19）。
- **workspace 切换与数据刷新耦合**：`useWorkspaces.switchWorkspace`（`47-66`）在一次调用里串了 5 件事：写 state、写 `localStorage`（52）、按环境选加载源（54-56）、序号守卫后灌项目（57-58）、最后 `onResetView()`（63）；而 `App.resetView`（`137-143`）又包含 `setSelectedId("")` + `clearDetail()` + `setWorkspace("overview")`。即"切工作区"= "换项目集 + 清详情 + 强制离开当前页"，三件事无法分别控制。
- **隐式全局单例**：7 处（见 L-20 清单）。其中对分层影响最大的是 `window.gitool`（`src/lib/bridge.ts:7`）——所有组件通过全局对象拿传输层，使依赖注入与测试隔离都退化为"打桩 window"。
- **竞态守卫是分散实现**：`useProjects.ts:59-62,160`（workspace 版本）、`useRemotes.ts:99,112-139`（seq）、`useWorkspaces.ts:45,50,57`（switchSeq）、`useAsyncData.ts:54,64-82`（seq）、`git/loadSequence.ts`(18) —— 5 套同构机制各自维护（`useAsyncData.ts:11-14` 注释已自认"对齐既有范式"），是"应抽取而未抽取"的信号（与 L-11 的 store 方案合并处理）。

### 4.7 测试分层与实现目录的对应关系

21 个测试文件，分布如下：

| 测试文件 | 被测实现 | 层级 | 规模比 |
| --- | --- | --- | --- |
| `electron/main/ipc/schemas.test.ts`(203) | `ipc/schemas.ts`(303) | 校验（纯） | ✅ 完整 |
| `electron/main/services/gitParsing.test.ts`(256) | `gitParsing.ts`(256) | 纯函数 | ✅ 完整 |
| `commandLine.test.ts`(75) / `concurrency.test.ts`(55) / `operationCsv.test.ts`(72) / `processCleanup.test.ts`(121) / `version.test.ts`(41) | 对应纯函数/基础设施（`commandLine` 83 / `concurrency` 31 / `operationCsv` 37 / `processCleanup` 78 / `version` 42） | 纯函数 | ✅ |
| `storage/*.test.ts`（9 个，共 886 行） | `storage/*.ts`（9 个，1,069 行） | 存储域（真实 `node:sqlite` + 临时目录） | ✅ 覆盖率高 |
| `src/hooks/useAsyncData.test.ts`(200) | `useAsyncData.ts`(165) | 渲染层核心状态机 | ✅（唯一被覆盖的 hooks 文件） |
| `src/lib/{format,markdown,navigation,projectMatch}.test.ts`（522 行） | `src/lib/*`（11 个实现文件，共 565 行） | 纯函数 | ⚠️ 缺 `projects.ts`/`workspaces.ts`/`uiPrefs.ts`/`bridge.ts` 测试 |

**服务层缺测试的模块清单（按风险/体量排序）**：`git.ts`(991)＞`providers.ts`(753)＞`commandDetection.ts`(395)＞`setup.ts`(233)＞`analysis.ts`(186)＞`updater.ts`(152)＞`tasks.ts`(150)＞`backups.ts`(139)＞`ai.ts`(128)＞`environment.ts`(83)＞`openers.ts`(51)＞`credentials.ts`(50)＞`events.ts`(9)。

**渲染层**：`src/components`(5,758 行)、`src/hooks`(1,872 行，除 useAsyncData 的 165 行外)、`electron/main/ipc.ts`(499 行)、`electron/main/index.ts`(192) 均无测试。覆盖率门槛（`vitest.config.ts:47-52`，95/85/90/95）只对 19 个白名单文件生效（`vitest.config.ts:22-43`），口径与实际风险区不重合（L-12）。

---

## 五、若只改 3 件事，改哪 3 件

### 第 1 件：给渲染层建数据访问边界（L-01 + L-11）

- **做什么**：新增 `useTasks`/`useBackups`/`useLogs`/`useSettings`/`useGitPanel` 五个域 hook（照 `useProjects`/`useAsyncData` 的既有范式），把 14 个组件里的 53 处 `bridge.*` 全部收起；再加一条 ESLint `no-restricted-imports` 规则，禁止 `src/components/**` 引用 `lib/bridge`（仅 `src/hooks/**`、`src/lib/bridge.ts` 允许）。
- **为什么是第 1**：这是"分层不成立"的唯一根因。其它问题（互斥三源 L-13、设置双份 L-19、错误处理不一致）都是它的派生。
- **验收信号（可机器判定）**：`grep -r "getDesktopBridge\|requireDesktopBridge" src/components | wc -l` 由 53 → 0；`npx eslint src/components` 无越界告警；现有 21 个测试全绿（纯删除 + 迁移，不改行为）。
- **成本**：L（约 5 个 hook、~600 行迁移）；**风险**：中（迁移期需逐一核对错误提示文案与 loading 时序）。

### 第 2 件：实体与规则收敛为单点（L-02 + L-07）

- **做什么**：在 `shared/` 增 `createProject`/`createTaskProfile`（纯工厂）+ `workspaceRules`（`assertCanDelete`/`assertName`）；替换 6 处实体字面量与 2 份工作区规则副本；把 `ipc/schemas.ts` 的 `.catch()` 收窄到仅"派生展示字段"。
- **为什么是第 2**：这是唯一会**静默写坏数据**的问题（P0）。字段漂移被 `.catch()` 吸收，用户看不到错误，只会看到"奇怪的项目状态/语言色"。
- **验收信号**：新增单测「投影测试」——对工厂产物逐一跑 `projectSchema`/`taskProfileSchema`，断言 `safeParse.success === true`（当前会因为漏字段失败，正好捕获 6 处漂移）；`grep "status: \"clean\"" src/hooks/*.ts src/components/*.tsx` 结果归零。
- **成本**：M；**风险**：低（纯函数 + 单测保护）。

### 第 3 件：拆 `git.ts` 并把编排从 `ipc.ts` 归还服务层（L-05 + L-03）

- **做什么**：`services/git.ts`(991) 按 7 个子域拆到 `services/git/*`（binary/repo/status/history/branch/clone/disk），`git/index.ts` 重导出保持 `ipc.ts` import 不变；`ipc.ts:417-477` 的 `recordOperation`/`resolveProjectIdByPath` 下沉 `services/operations.ts`，`resolveProjectIdByPath` 改用单条按路径查询；`insertTaskRun` 移入 `services/tasks.ts`。
- **为什么是第 3**：991 行的单一 service 是后续一切测试/审阅成本的放大器（L-12 里"服务层无测试"最难解的就是它）；且拆完后每个子模块才能纳入覆盖率门槛，形成正向循环。
- **验收信号**：`git.ts` 无单文件 >250 行；`ipc.ts` 行数 <200 且不再 import `storage/*`（除组合根必需的 `settings`）；`git/*.test.ts` 覆盖 `parse/拼装/校验` 路径；`npx vitest run --coverage` 中 `services/git` 子模块进入 include 白名单且达标。
- **成本**：L；**风险**：中高（Git 行为对参数顺序极敏感，`gitParsing.test.ts` 已覆盖解析层，但命令拼装层需新增测试后再拆）。

> 排序理由：**先立边界（1）→ 再止漏（2）→ 后拆巨块（3）**。若资源只够做一件，做第 1 件；若只够做一天，做第 2 件（成本 M、直接消除 P0 的静默数据风险）。

---

## 六、需确认项与未覆盖范围

### 需确认（评审中无法从代码判定的前提）

1. **浏览器预览（`isDesktopRuntime()===false`）是否仍是产品目标？** 决定 L-07/L-08 是"两端共用规则"还是"直接删除渲染层影子存储"（`src/lib/projects.ts`、`workspaces.ts`、`App.tsx:264-282`）。
2. **`tasks:updateRun`（`ipc.ts:341`）是否曾用于调试或计划给用户"人工修正运行状态"？** 若是，应补 bridge 方法而非删除（L-14）。
3. **`providers.loadCachedRemoteRepositories`（`providers.ts:157`）是否为废弃遗留？** 若是，删除；若计划启用，则 `ipc.ts:288` 改走服务层。
4. **`IPC 出参`是否需要运行时校验？** 当前零校验（L-22）。若团队认为"主进程可信"，则把 L-22 降级为 P3 文档化豁免，但需在 `AGENTS.md` 第九节留痕。
5. **是否存在多窗口场景？**（`notifyRenderer` 广播 vs 定向发送的选择依赖此前提，L-20）。

### 未覆盖（属其它任务范围，避免重复结论）

- 工程配置（`package.json`、`vite.config.ts`、`tsconfig*`、`electron-builder.yml`）与覆盖率门槛口径 —— 见 security 任务。
- Electron 安全边界（`webPreferences`、CSP、shell 注入、凭据存储）—— 见 security 任务。
- 完整 IPC 通道清单与模块依赖图（mermaid）—— 见 structure 任务。
- CSS/样式分层：全仓为单一样式表（组件内使用语义化 class 名，如 `remote-list`/`git-output`），未做 CSS Modules/作用域隔离；本次未评审其组织方式。

### 复核方法（保证结论可重跑）

| 结论 | 复核命令/方法 |
| --- | --- |
| 组件 53 处 / hooks 49 处 bridge 调用 | 对 `src/components/**/*.tsx`、`src/hooks/*.ts` 统计 `bridge\.` 与 `requireDesktopBridge()\.` 出现次数 |
| 77 个 handler、2 个死通道 | 比对 `ipcMain.handle("…")` 提取的通道集合与 `preload/index.ts` 中 `invoke<…>("…")` 集合的双向差集（注意 `remoteRepositories:loadCached` 为多行写法，需正则跨行匹配） |
| 函数行跨度 | 从函数签名行起做花括号配对，配对归零行即结束行 |
| storage 是唯一 SQL 入口 | 在 `electron/main/**` 检索 `SELECT\|INSERT\|UPDATE\|DELETE\|\.prepare(`，命中文件应全部位于 `services/storage/` |
| 文件行数 | `(Get-Content <file> -Encoding UTF8).Count`（`Measure-Object -Line` 会少算，本次已改用前者） |