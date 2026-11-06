# 全项目代码审查报告（2026-11-07）

> 审查范围：主进程（electron/、shared/，约 4.8k 行）、前端（src/，约 6.5k 行）、工程配置与构建链路。
> 审查方式：分区深读 + 本机确定性验证（typecheck / vitest / vite build 全绿起步）。
> 解析类问题均经真实 git / tar / node 实证复现；标注「已验证」的条目有可复现证据。
>
> **修复状态标记**：✅ 已修复（注明版本）｜⬜ 待修复（按优先级排入下轮）

## 结论摘要

- 构建/运行基础设施健康：typecheck、117（现 126）个单测、生产构建、CI 三门禁全部通过，本次发现的问题全部是功能性缺陷。
- 两个 P0（提交历史哈希损坏、任务实时日志失效）均为用户可直接感知的数据损坏/功能失效。
- 代码整体工程素养高于平均：安全防御点齐全、注释普遍解释动机、Conventional Commits 与 CHANGELOG 执行到位。主要系统性短板是「自造文本协议的解析代码」与「Windows 特有语义」，且恰好集中在无单测覆盖的文件里。

---

## P0 — 阻塞级

| # | 位置 | 问题 | 状态 |
| --- | --- | --- | --- |
| P0-1 | `electron/main/services/git.ts` listCommitHistory | 提交历史解析串位：记录分隔符 `\x1f` 放在格式串中间（%s 与 %b 之间），记录间只有换行。按 `\x1f` 切分后第 2 条起 hash = 上一条 body + 换行 + 真实 hash（已实证）。历史列表显示乱码短 hash；回退功能对除最新提交外全部被 `isValidCommitHash` 拒绝 | ✅ v0.5.3：格式串改为记录尾分隔符语义，解析抽入零依赖 `parseCommitHistory` 补 3 单测 |
| P0-2 | `src/components/TasksWorkspace.tsx` | 「实时日志」1 秒轮询 stale closure：空依赖 interval 捕获首帧闭包，`runs` 恒为 `[]`，`getRunningTaskOutput` 永不调用，实时输出整体失效 | ✅ v0.5.8：改经 ref 读最新值 |

## P1 — 重要

| # | 位置 | 问题 | 状态 |
| --- | --- | --- | --- |
| P1-1 | `backups.ts` | 备份排除规则失效：tar `--exclude` 每参数只接受一个模式，旧实现逗号拼接为单个字面量模式（GNU tar 1.35 与 Windows bsdtar 3.8.9 均实测复现） | ✅ v0.5.5 |
| P1-2 | `gitParsing.ts` buildCommitMessageArgs | 多行提交信息被改写成段落：按行拆多个 `-m`，git 以空行连接各段，列表/代码块换行结构被打散（已实证） | ✅ v0.5.3：单条 `-m` 保真传输 |
| P1-3 | `git.ts` runGitOperation | pull/sync 被任何未跟踪文件阻断：`listChangedFiles` 含 `??` untracked，而未跟踪文件不会被 pull 覆盖，典型仓库常年被误拦 | ✅ v0.5.4：只阻断已跟踪文件的未提交修改 |
| P1-4 | `tasks.ts` | `shell:true` 下 Node 仅空格拼接 command+args 交给 cmd.exe：带空格参数被重新拆开、`&` `\|` 被解释成新命令 | ✅ v0.5.6：新增零依赖 `quoteWindowsArg`（CommandLineToArgvW 约定）+ 6 单测，仅 win32 应用 |
| P1-5 | `useWorkspaces.ts` / `useProjects.ts` / `useRemotes.ts` | 三处切换竞态：快速切工作区/账号时慢响应后返回覆盖新数据，refreshProjects 还会把旧工作区数据串写存储分区 | ✅ v0.5.8：请求序号 / 工作区校验守卫 |
| P1-6 | `useProjects.ts` | `selectedProject ?? projects[0]` 兜底破坏「未选中」语义：「查看全部」实际选中第一个项目、resetView 清不掉、空态不可达 | ✅ v0.5.8：去掉兜底（消费方均为 optional 类型，已核实） |
| P1-7 | `useGitOperations.ts` + `GitActionsPanel.tsx` | 双轨 busy 互不感知：批量操作全程无锁、面板私有 busy，可对同一仓库并发 git 进程（index.lock 冲突） | ✅ v0.5.8：`gitBusyRef` 全局互斥 + `bulkRunning` UI 反馈，面板经 `externalBusy` 联动禁用 |
| P1-8 | `GitActionsPanel.tsx` | 各 tab 异步加载无取消标志（慢旧请求覆盖新 tab 数据）；切 tab 清空提交草稿；变更行 `key` 含易变 `staged` 导致整行重挂 | ✅ v0.5.8：每类数据加载序号守卫；草稿仅随项目切换清空；key 只用 `file.path` |
| P1-9（原报告编号 9/10） | `setup.ts` downloadInstaller | 写流无 error 监听：磁盘满/不可写时未捕获异常崩主进程或 Promise 永久挂起；非 200 分支泄漏 fd | ✅ v0.5.7：统一 fail 收口（关句柄 + 清理半成品） |
| P1-10（原报告编号 11） | `useEnvironment.ts` / `useRemotes.ts` | 进度消失倒计时的 setTimeout 未跟踪：2-4 秒内再次操作会被旧 timer 提前清空进行中的进度 | ✅ v0.5.8：ref 跟踪 + 卸载清理（useNotice 同范式） |
| P1-11（原报告编号 5/9） | `git.ts` computeDiskSize | 全同步遍历（readdirSync/statSync）大项目冻结主进程事件循环 | ✅ v0.5.9：fs/promises + mapLimit 分层并发，真实目录树验证与同步实现结果一致；修复过程中发现并修正 `total += (await ...)` 复合赋值并发丢加（复合赋值先读 LHS 旧值再求值右侧） |

## P2 — 建议（待排期）

**解析与数据正确性**
- ✅ v0.6.1 `git.ts` listChangedFiles：`status -z` 的 rename 成对路径未按对解析，旧路径第 3 字符为空格时产生幻影 staged 记录。
- ✅ v0.6.1 `git.ts` compareVersions：依赖 `--stat` 人读格式解析文件名（含 `|`、`=>`、超长路径均错），应改用已有 `--numstat`。
- ✅ v0.6.1 `git.ts` stage/unstage/diff：pathspec 未加 `:(literal)` 前缀，文件名含 `[ ] * ?` 时匹配错误文件。
- ✅ v0.6.3 `ipc/schemas.ts`：审计 `result: z.enum(...).catch("ok")` 把非法状态静默美化成成功。
- ✅ v0.6.2 `storage.ts` + `operationCsv.ts`：CSV 导出只取前 500 条（库存 2000）、无 BOM（中文 Excel 乱码）、未防公式注入。
- ✅ v0.6.3 `ipc.ts` recordOperation：`projectId` 写死空串，操作日志无法按项目归组。

**安全加固（纵深防御补齐）**
- ✅ v0.6.1 `git.ts` clone：URL 未加 `--` 分隔、ssh 正则允许 `-` 开头 URL（当前靠 git 选项表偶然兜底）。
- ✅ v0.5.7 `setup.ts`：PowerShell 单引号字符串对路径做 `''` 转义。
- ✅ v0.6.4 `providers.ts`：GitHub update/delete 端点 owner/name 未 `encodeURIComponent`（同文件其他分支已做）。
- ✅ v0.6.1 `git.ts` stageFiles IPC：无数组长度上限，Windows 32K 命令行限制下大变更集 spawn 失败。
- ⚠️ 审查勘误：`index.html` 的 `<!--CSP-->` 并非缺失 CSP——`vite.config.ts` 的 `contentSecurityPolicyPlugin` 在 dev/build 注入完整策略，初版报告此条按误报撤销。

**死代码与假 UI**
- ✅ v0.6.5 `ModuleWorkspace.tsx`：整页硬编码假数据且路由 else 分支不可达（死代码）。
- ✅ v0.6.5 `App.tsx`：铃铛无 onClick 且红点恒亮；「⌘ K」提示多数页面无效且 Windows 显示 ⌘；「更多项目」按钮无 onClick；徽标统计 `tags.includes("building")` 但无处创建该标签（恒 0）；Overview 硬编码「早上好，Leo」。
- ⬜ `analysis.ts` invalidateAnalysisCache 仍无调用方（v0.5.9 已接入磁盘体积缓存的失效），待接入分析路径或删除。
- ✅ v0.6.5 `preload` installUpdate 未 return Promise，主进程拒绝路径时渲染层不可见。
- ✅ v0.6.4 `providers.ts` loadRemoteRepositories：错误文案与实际行为不符 + 不可达分支；findRepository 吞网络异常误报「仓库不存在」。

**架构与拆分**
- ⬜ `storage.ts`（928 行）八个数据域挤在一个文件，按域拆分（projects/accounts/tasks/backups/settings）。
- ⬜ IPC 校验双轨：zod schema 与手写 requireString 并存（如 `ai:saveKey` 无长度上限），收敛到 zod 单轨。
- ⬜ 超长组件拆分：GitActionsPanel（759 行/19 useState，按 tab 拆）、SettingsWorkspace（698 行内嵌 4 组件）、ProjectDetail（713 行）、TasksWorkspace（603 行）。
- ⬜ App.tsx 编排中心：ProjectsWorkspace 20+ props，projects 域建议下沉。
- ⬜ 重复代码：`errorMessage()` 6 处、`assertDirectory` 3 处、本地 toast 4 处与全局 useNotice 双轨、`load()` 模板 4 处且普遍无 try/catch（unhandled rejection 风险）→ 抽 useAsyncData/usePolling。
- ⬜ 远程匹配逻辑三处口径不一（`lib/projectMatch.ts` vs 两处 `provider:name` 键）。
- ⬜ 内联色值（TasksWorkspace 等）收入 styles.css token 体系。

**收尾补录（第二轮修复）**
- ✅ v0.6.7 `storage.ts` saveProjects：注释声称「软删除语义」实为硬删除，注释纠偏（P2-11）。
- ✅ v0.6.7 `commandDetection.ts`：package.json 由两次读取 + 两次 JSON.parse 收敛为 readPackageScripts 单次读取（P2-15）。
- ✅ v0.6.7 `updater.ts`：checkForUpdates 的 fetch 补 15 秒超时；updater:download 加进行中守卫（P2-17）。

**工程流程**
- ✅ v0.6.0 覆盖率度量与门禁落地（纯函数层 95/85/90/95，CI 已接入）；服务层纳入门槛为下一里程碑。
- ✅ 2026-11-07 已按第五条款补适配记录块与「适配标记」列（无架构性变更）。
- ⬜ `electron-builder.yml` files 显式含 `node_modules/**/*`，建议跑一次 `npm run dist` 核对安装包体积是否混入 devDependencies（CI 未覆盖 dist 环节）。

## 修复轮次记录

| 版本 | 内容 | 提交 |
| --- | --- | --- |
| v0.5.3 | P0-1 历史解析 + P1-2 提交信息保真 | `fix(git): 修复提交历史哈希损坏与多行提交信息被改写` |
| v0.5.4 | P1-3 pull 误拦 | `fix(git): pull/sync 不再被未跟踪文件误拦` |
| v0.5.5 | P1-1 备份排除 | `fix(backup): 备份排除规则逐条生效` |
| v0.5.6 | P1-4 任务参数转义 + P2-1 超时标注 | `fix(tasks): 任务参数按 Windows 约定转义，超时标注不再被覆盖` |
| v0.5.7 | P1-6 下载流收口 + P2-6 PS 转义 | `fix(setup): 下载器补全 error 收口，防主进程崩溃/挂起` |
| v0.5.8 | P0-2 + P1-5/6/7/8 + P1-10 前端批次 | `fix(ui): 前端时序修复批次——轮询失效、切换竞态与 Git 操作互斥` |
| v0.5.9 | P1-11 磁盘体积异步化 + P2-13 缓存失效 | `perf(git): 磁盘体积计算异步化，不再冻结主进程` |
| v0.6.0 | 覆盖率门禁 | `test(coverage): 引入覆盖率度量与门禁` |
| v0.6.1 | P2-2/3/4/16/18 解析加固 | `fix(git): 解析加固批次——rename 成对解析、numstat、literal pathspec、clone 加固` |
| v0.6.2 | P2-10 CSV 导出 | `fix(export): 操作记录 CSV 导出全量、补 BOM、防公式注入` |
| v0.6.3 | P2-9/21 IPC 加固 | `fix(ipc): 审计字段严格化、projectId 反查归组、入参上限` |
| v0.6.4 | P2-7/8 providers | `fix(providers): URL 编码统一、同步失败文案纠偏、网络错误不再误报仓库不存在` |
| v0.6.5 | P2-12/14 死代码与假 UI | `fix(ui): 死代码与假 UI 清理，installUpdate 补错误可见性` |
| v0.6.6 | P2-12 重复代码下沉 | `refactor(services): errorMessage/assertDirectory 下沉零依赖 serviceUtils` |
| v0.6.7 | P2-11/15/17 收尾 | `fix: P2 收尾批次——注释纠偏、命令探测单次读包、更新检查超时与下载守卫` |

> 验证基线：v0.6.7 时 typecheck ✓、138 单测 ✓、覆盖率门禁 ✓、生产构建 ✓。
>
> **仍遗留（大拆分类，留待独立轮次）**：storage.ts 按域拆分；GitActionsPanel/SettingsWorkspace/ProjectDetail/TasksWorkspace 组件拆分；App.tsx 编排下沉；useAsyncData/usePolling 与 toast 双轨统一；远程匹配三处口径统一；`npm run dist` 安装包体积验证。
