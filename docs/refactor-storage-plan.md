# storage.ts 分域拆分方案

> 2026-11-07 专项治理（指令：2026-11-07 专项治理-storage拆分）。目标：把
> electron/main/services/storage.ts（929 行、九个数据域）拆为「公共层 + 域模块」，
> 行为等价、依赖单向，服务层可脱离 electron 直接测试。

## 目标文件结构（electron/main/services/storage/）

- `database.ts` — 连接管理（openDatabase / initDatabase / closeDatabase）、建表、迁移、种子、索引、
  SqlRow 类型、各域 rowToX 映射、parseStringArray、DATABASE_FILE_NAME。
- `workspaces / projects / accounts / tasks / backups / operations / settings / remoteRepositoryCache`
  八个域文件 — 各域 SQL 与业务规则。

## 方案选择：B（直接更新调用方 import，最终删除 storage.ts）

调用方仅 7 个文件（ipc / ai / git / providers / backups / tasks / setup），全部在授权范围内一次到位。
方案 A 的 re-export 兼容层会让「谁在用哪个域」继续不可见，等于保留旧耦合中心，违背拆分初衷，不采用。

## 依赖方向（单向，禁止域间横向 import）

八个域模块 ──→ database.ts（shared/types 仅类型；credentials / operationCsv / serviceUtils 为既有零依赖工具）。
唯一例外：accounts.deleteAccount 级联清理 remote_repository_cache 表，一行内联 SQL + 注释说明，属账号删除语义。

## 可测性改造（随第 1 步落地）

- `initDatabase(dataDir?)`：显式注入数据目录（测试用 mkdtemp），重复初始化先关旧连接再开新；不传参
  回退默认路径，主进程现有调用点行为不变（惰性打开 userData）。
- `closeDatabase()`：测试 afterEach 先关连接再删临时目录（Windows 文件锁）。
- database.ts 不顶层 import electron——纯 Node 下 electron 包导出的是二进制路径字符串，具名导入抛
  "does not provide an export named 'app'"（vite.config.ts 头部有同因注释）；仅在需要默认路径时
  require("electron")，测试注入目录后永不触发。测试不 mock electron 模块本身。
- 第 1 步附带最小注入冒烟测试，先验证 vitest + node:sqlite + 注入基座，再批量迁移。

## 迁移顺序（每步一个提交：迁一个域 → 三门禁 → commit）

1. 抽 database.ts + initDatabase/closeDatabase 注入
2. workspaces → 3. projects → 4. accounts → 5. tasks → 6. backups → 7. operations →
   8. settings → 9. remoteRepositoryCache，并删除 storage.ts

每步等价性验证：typecheck + test:coverage + build 三门禁全绿，git diff 仅函数整体搬移（SQL、文案、
表结构、迁移逻辑零改动）。projects 域：saveProjects 事务（BEGIN/COMMIT + stale 清理）逐字搬移；
前端 useProjects 的 projectsRef + saveQueueRef 串行落库语义不受影响（串行在渲染层，后端只保证单次
写入的事务性与等幂覆盖）。

## 测试与覆盖率门槛

- 测试提交（mkdtemp 注入，afterEach 关连接再删目录）：database（注入生效 / 旧库 UNIQUE path 迁移 /
  种子默认工作区）、projects（round-trip / stale 清理 / 排序 / 跨工作区隔离 / 坏 tags 容错）、
  operations（顺序 / limit / 2000 条裁剪 / clear / CSV 导出 BOM）、settings（默认值 / round-trip /
  upsert）、workspaces（增改删 / 最后工作区与有项目守卫）。
- 门槛提交：已覆盖文件（database / projects / workspaces / operations / settings）加入
  vitest.config.ts coverage.include，注释如实记录已纳入与仍缺（accounts / tasks / backups /
  remoteRepositoryCache）；数值 95/85/90/95 不下调。

## 提交与版本

refactor 每步修订号 +1 并写 CHANGELOG 一行；测试 + 门槛纳入按 v0.6.0 先例记 feat(test) 次版本 +1。
尾注：Agent: ZCode (GLM-5.3-Flash) | 指令: 2026-11-07 专项治理-storage拆分 | Loop: 治理轮-1
