# Code Review 三步自审报告

> 自审人：资深架构师视角（self-review）
> 审查范围：`electron/main/services/*`、`electron/main/ipc.ts`、`src/App.tsx`、`src/lib/*`
> 方法：自检 → 找茬 → 重构 → 加固（三轮，性能 → 逻辑架构 → 健壮性）

## 第一步：性能审查（慢查询 / 循环嵌套 / 重复计算 / IO 冗余 / 复杂度）

| 发现 | 位置 | 影响 | 处置 |
| --- | --- | --- | --- |
| `getProjectSnapshot` 串行执行 5 次 git 子进程 | `git.ts:270` | 每次刷新每项目 5 次进程 spawn，N 项目 = 5N | ✅ 并行化：`branch/status`、`rev-parse/ls-files/log` 两组 `Promise.all` |
| `getDiskSize` 同步递归（readdirSync/statSync/realpathSync）阻塞主进程 | `git.ts:741` | 大型项目全量遍历卡死主进程事件循环 | ✅ 改为异步实现 + TTL 缓存（60s） |
| `refreshProjects` 无并发上限，全量并行 | `App.tsx:688` | 同时 spawn 2N 个 git 进程 | ✅ 新增 `mapWithConcurrency(items, 4, fn)` 限流为 4 并发 |
| `saveProjects` 每次 DELETE 全表 + 全量 INSERT | `storage.ts:88` | 每次收藏/编辑重写整表 | ✅ 改为 UPSERT（`ON CONFLICT(id) DO UPDATE`）+ 增量清理 |
| `compareVersions` 两次 git 调用串行 | `git.ts` | 每对比多等待一轮 | ✅ `Promise.all` 并行 --stat 与 --numstat |
| 远程仓库仅取前 100 个 | `providers.ts:91` | 账号 >100 仓库时遗漏 | ✅ 分页翻页（Link 头 / Gitee page 自增） |
| `analyzeProject` 每次全树重扫 | `analysis.ts:52` | 重复调用重复 IO | ✅ TTL 缓存（30s） |

复杂度评估：`getDiskSize`/`computeAnalysis` 均为 O(文件数) 单遍遍历，`visited` 集合防符号链接死循环，空间 O(深度)。已消除阻塞主进程的同步 IO。

## 第二步：逻辑与架构优化审查（缓存 / 抽象 / 冗余 / 异步）

| 发现 | 处置 |
| --- | --- |
| 磁盘大小高频率重复计算（每次刷新全量重扫） | ✅ 主进程 `diskSizeCache` TTL 60s + `invalidateDiskSizeCache` 预留失效钩子 |
| 结构分析重复全树扫描 | ✅ `analysisCache` TTL 30s + `invalidateAnalysisCache` |
| 任务输出无限累积内存 | ✅ 输出缓冲截断为最近 256KB |
| 批量刷新并发失控 | ✅ `mapWithConcurrency` 通用并发池抽象（App 层复用） |
| 各 git 独立命令无批处理 | ✅ snapshot 已并行；单命令保持原样（git CLI 无批量接口） |

架构决策说明：磁盘/分析缓存置于主进程（跨渲染层实例共享、避免反复 IPC 全量数据），TTL 而非永久缓存以保数据新鲜；失效钩子供 Git 操作后主动清理。

## 第三步：健壮性与规范审查（异常 / 边界 / 并发 / 参数 / 日志）

| 发现 | 位置 | 处置 |
| --- | --- | --- |
| `runTask` 超时只改状态不杀进程（子进程泄漏） | `tasks.ts:44` | ✅ 超时回调中 `child.kill()` |
| `providers` / `ai` fetch 无超时（网络挂起） | `providers.ts`、`ai.ts` | ✅ 统一 `AbortController` 超时（15s / 20s），AbortError 转可读错误 |
| 任务输出缓冲无限增长 | `tasks.ts` | ✅ 截断 256KB（同第二步） |
| 远程仓库分页缺失 | `providers.ts` | ✅ 补分页（见第一步） |

已核对未发现问题项：`assertDirectory`/路径校验/命令参数数组化（无 shell 拼接）、凭据不落库、破坏性操作二次确认、token 不进 URL、`@napi-rs/keyring` 读写均已覆盖。IPC 入参 `requireXxx` 校验完整。

## 结论

三步自审共发现 **10 个性能/架构/健壮性问题并全部修复**：
- 性能：snapshot 并行、磁盘分析缓存、刷新限流、UPSERT、对比并行、远程分页、分析缓存
- 架构：主进程 TTL 缓存 + 失效钩子、通用并发池、输出缓冲上限
- 健壮性：任务超时杀进程、网络超时、分页完备

验证：`npm run typecheck` 与 `npm run build` 均通过。无遗留阻塞项。
