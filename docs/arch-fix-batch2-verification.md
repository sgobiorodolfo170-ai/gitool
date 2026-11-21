# 第 2 批（A-21 / A-22 / A-24 第一阶段 / bridge null / recordOperation 不阻断 / projects.path 索引）独立验证报告

- 验证日期：2026-11-21
- 验证范围：工作区未提交改动 —— 6 个修改文件（`ipc.ts`、`storage/database.ts`、`storage/database.test.ts`、`storage/projects.ts`、`services/tasks.ts`、`src/lib/bridge.ts`）+ 7 个新增文件（`services/operations.ts`、`services/operations.test.ts`、`services/tasks.test.ts`、`src/lib/{bridge,projects,uiPrefs,workspaces}.test.ts`）
- 验证方式：独立执行命令 + 独立读 diff + **运行时对抗性探针**（临时目录内编译真实源码后真实开库 / 真实起子进程，非静态阅读、非采信实现方自评）
- 环境：Windows 10 + PowerShell 5.1，Node v22.22.2，`@types/node ^24`，git 工作区 `core.autocrlf=true`、无 `.gitattributes`
- 只读约束：未修改任何业务代码；唯一写入为本文件；临时脚本全部落在 `%TEMP%\gitool-idx-verify`，探针结束自清理（`CLEANUP_DONE=true`）

---

## 一、结论摘要

**结论：功能与运行时行为全部通过，可以提交；但验收指标有 1 项实际未达成（P1-1：`ipc.ts` 真实 427 行 ≥ 420），且该指标的既有取证数字（416）来自一次测量缺陷。**

| 验证项 | 判定 | 关键证据 |
| --- | --- | --- |
| 门禁：`npx vitest run` | ✅ | 32 文件 / **340** 用例全绿，退出码 0（期望 ≥338） |
| 门禁：`npx tsc -b` / `tsc -p tsconfig.electron.json` | ✅ | 均无输出，退出码 0 |
| 门禁：`npm run build` | ✅ | client 140 modules + main/preload 打包成功，退出码 0 |
| A-21 编排下沉 | ✅ | `ipc.ts` 内 `recordOperation` / `resolveProjectIdByPath` / `insertTaskRun` / `loadProjects(` 计数均为 **0**；编排与反查全部在 `services/operations.ts` |
| A-22 任务生命周期 | ✅ | `insertTaskRun` 在 `runningTasks.set` 之前（41 行 vs 67 行）；`persistRun` 失败降级写 failed（139–170 行）；真实子进程探针 7/7 PASS |
| A-24 第一阶段 `src/lib` 测试 | ✅ | 4 新文件 **49** 个 `it()`（12+16+12+9），≥18 |
| bridge null 修复 | ✅ | `?? undefined` + `Boolean(...)`，9 个用例覆盖，且 `null → 非桌面` 为新契约（旧实现会误判为桌面） |
| recordOperation 不阻断 | ✅ | 真实故障注入（DROP TABLE）→ 返回 false、不上抛、日志不含明文 detail |
| projects.path 索引 | ✅ | 真实临时库 `PRAGMA index_list('projects')` 含 `idx_projects_path`，`EXPLAIN QUERY PLAN` 为 `SEARCH ... USING INDEX`，老库补建幂等 |
| 范围与卫生 | ⚠️ | `projectMatch.test.ts` 已回退（未出现在 `git status`）；无乱码、无 BOM；prettier 通过；**但行尾 LF/CRLF 混合**（P2-2）、`.opencode/` 未 ignore（P2-3） |
| 指标真实性 | ❌ | `ipc.ts` = **427 行**（非 416），未达「< 420」；`416` 是 PowerShell 5.1 以 ANSI 解码 UTF-8 吞掉 11 个换行造成的读数（P1-1） |

**提交建议：功能层面建议提交；请先按 P1-1 二选一处置（瘦身 8 行 / 修正指标口径），并按 P2-1 修正一处自相矛盾的注释。其余 P2/P3 可作为下批清理项。**

---

## 二、门禁结果

| # | 命令 | 退出码 | 关键原始输出 |
| --- | --- | --- | --- |
| 1 | `npx vitest run` | **0** | `Test Files 32 passed (32)` / `Tests 340 passed (340)` / `Duration 3.62s` |
| 2 | `npx tsc -b` | **0** | 无输出 |
| 3 | `npx tsc -p tsconfig.electron.json` | **0** | 无输出 |
| 4 | `npm run build` | **0** | `dist/assets/index-CzdF9AF_.js 458.59 kB │ gzip: 148.91 kB`；`dist-electron/main.cjs 215.10 kB`；`dist-electron/main.cjs 171.14 kB`；`dist-electron/preload.cjs 4.21 kB` |
| 5 | `npx prettier --check --end-of-line auto <13 个改动/新增文件>` | **0** | `All matched files use Prettier code style!` |
| 6 | `npm run format:check`（全仓） | 1 | `Code style issues found in 140 files` —— **HEAD 既有状态**：报错清单含 `shared/types.ts`、`package.json`、`tsconfig*.json` 等本批未触碰文件；根因是 `.prettierrc.json` 显式 `"endOfLine": "lf"` 而仓库多数文件为 CRLF。非本批引入，见 P2-2 |

> 构建门禁未调用 electron-builder，不存在「Electron 二进制缺失」类环境限制，故本次无 PARTIAL。

### 2.1 计数型验收（UTF-8 正确读取）

> ⚠️ **测量陷阱（本次验证的关键教训）**：PowerShell 5.1 的 `Get-Content` 默认按 ANSI（GBK）解码 UTF-8 文件，当某个多字节汉字的尾字节落在 GBK 引导字节区间时，会把其后的 `0x0A` 一并吃掉。同一份 `ipc.ts`：
> - `(Get-Content electron\main\ipc.ts).Count` → **416**（吞掉 11 个换行，**错误**）
> - `node -e "fs.readFileSync(...).match(/\n/g).length"` → **427**（字节级 `0x0A` 计数，**正确**）
>
> 因此本报告所有计数均改用 UTF-8 正确解码（Node 脚本 `%TEMP%\gitool-idx-verify\audit.cjs`）复核。

| 检查项 | 实测（UTF-8） | 期望 | 判定 |
| --- | --- | --- | --- |
| `ipc.ts` 行数 | **427**（非空 408；HEAD 为 490 / 非空 466） | < 420 | ❌ **P1-1** |
| `ipc.ts` 中 `loadProjects(` 出现 | **0** | 0 | ✅（`loadProjects` 裸串 1 次，为 import 别名） |
| `ipc.ts` 中 `recordOperation` | **0** | 0 | ✅ |
| `ipc.ts` 中 `resolveProjectIdByPath` | **0** | 0 | ✅ |
| `ipc.ts` 中 `insertTaskRun` | **0** | 0 | ✅ |
| `ipc.ts` 中 `ipcMain.handle(` | **76** | 76（与第 1 批基线一致，未丢通道） | ✅ |
| `ipc.ts` 剩余本地 helper | 仅 `requireString`(407) / `requireStringArray`(418) | 只校验工具 | ✅ |
| `src/lib` 4 个新测试 `it()` | **49**（projects 12 / workspaces 16 / uiPrefs 12 / bridge 9） | ≥ 18 | ✅ |
| `operations.test.ts` / `tasks.test.ts` `it()` | 8 / 4 | — | ✅ |
| 全仓 `it.skip`/`only`/`todo`/`x*`/`expect(true)` 扫描 | **NONE**（`it.skipIf`/`describe.skipIf` 仅存于既有 `git.test.ts`，git 缺失时不失败，属合理降级） | 0 | ✅ |

---

## 三、代码审阅证据（原文片段）

### 3.1 `electron/main/services/operations.ts`（新增 113 行）

失败路径 **返回 false + `console.error`，无 `throw`**（69–94 行）：

```ts
export function recordOperation(
  operation: string,
  path: string,
  detail: string,
  result: "ok" | "failed",
): boolean {
  try {
    insertOperationRecord({
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      operation,
      projectId: resolveProjectIdByPath(path),
      projectPath: path,
      detail: redactSecrets(detail).slice(0, MAX_DETAIL_LENGTH),
      result,
      createdAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error(
      `[operations] 审计写入失败 operation=${operation} path=${path} err=${errorMessage(error)}`,
    );
    return false;
  }
}
```

- ✅ 全函数仅 `try/catch` 一个出口，`catch` 内**无 throw**；`redactSecrets` **先于** `.slice(0, 500)`（顺序正确，代码注释与实现一致）。
- ✅ 日志只拼 `operation` / `path` / `errorMessage(error)`，**不含 `detail`**（82–83 行的脱敏发生在落库前，日志不引用它）。
- 反查降级路径（106–113 行）：`findByPath(path)?.id ?? ""`，`catch` 只 `console.error` + 返回 `""`，**非空 catch**。
- 三个编排函数（32–53 行）均为「执行 git → `recordOperation` → 返回 git 结果」，**忽略返回值**（见 P2-4）。

### 3.2 `electron/main/ipc.ts`（490 → 427 行，`git diff --stat`：109 行改动，其中净减 63 行）

handler 只剩「校验 → 调服务 → 返回」：

```ts
ipcMain.handle("projects:gitOperation", (_event, projectPath: unknown, operation: unknown) =>
  recordGitOperation(
    requireString(projectPath, "项目路径"),
    parseOrThrow(gitOperationSchema, operation, "Git 操作"),
  ),
);
ipcMain.handle("projects:clone", (_event, input: unknown) =>
  recordClone(parseOrThrow(cloneRepositoryInputSchema, input, "克隆参数")),
);
ipcMain.handle("git:commit", (_event, input: unknown) =>
  recordCommit(parseOrThrow(commitRequestSchema, input, "提交参数")),
);
// running 记录的 insert 已移入 runTask（A-22）……
ipcMain.handle("tasks:run", (_event, profileId: unknown) =>
  runTask(requireString(profileId, "任务 ID")),
);
```

- ✅ 本地 `recordGitOperation` / `recordClone` / `recordCommit` / `recordOperation` / `resolveProjectIdByPath`（含 `for (const workspace of listWorkspaces()) { loadProjects(...).find(...) }` 1+N 反查）已整体删除（diff 尾部 -70 行）。
- ✅ 校验逻辑从 helper 内联到 handler，**载荷校验未被削弱**（schema 相同：`gitOperationSchema`/`cloneRepositoryInputSchema`/`commitRequestSchema`）。
- ⚠️ 「`loadProjects(` = 0」是**通过 import 别名**达成的（52 行 `import { loadProjects as loadWorkspaceProjects, saveProjects }`），注释自陈「A-21 门禁要求 ipc 不再出现直接调用工作区项目列表 API 的路径反查代码」。真实目标（消灭路径反查的 1+N）已达成，但指标被形式化（P2-5）。

### 3.3 `electron/main/services/tasks.ts` 生命周期单点

`insertTaskRun` **在 `runningTasks.set` 之前**（相邻代码）：

```ts
40:  // 「任务未启动」比留下一条永不完成的 running 记录更可信。
41:  insertTaskRun(run);
42:
43:  const parsedArgs = splitCommandLine(profile.args);
...
50:  let child: ReturnType<typeof spawn>;
51:  try {
52:    child = spawn(profile.command, args, { cwd: …, windowsHide: true, shell: process.platform === "win32" });
57:  } catch (error) {
58:    // spawn 同步抛错（参数非法、cwd 在检查后被删等）：running 行已落库，必须立刻定稿
60:    const summary = errorMessage(error);
61:    run.status = "failed";
62:    run.finishedAt = new Date().toISOString();
63:    run.output = `[启动失败] ${summary}`;
64:    persistRun(run);
65:    throw new Error(`任务启动失败：${summary}`);
66:  }
67:  runningTasks.set(run.id, { process: child, output: () => output });
```

- ✅ 顺序正确：41 行 insert → 52 行 spawn → 67 行登记。`assertWorkingDirectory`（22 行）在 insert **之前**，非法 cwd 不会残留 running 行（良好的边界处理）。
- ✅ `persistRun`（154–170 行）：首次 `updateTaskRun` 失败 → 用同一行再写 `status=failed` + `[记录写入失败] …`；**降级再失败**才 `console.error`（注释解释：事件回调里再抛会变成主进程未捕获异常）。旧实现的 `catch {}` 已消除。
- ✅ 全仓 `insertTaskRun(` 的生产调用点只剩 `tasks.ts:41` 一处（另 2 处为 `storage/tasks.test.ts`），`ipc.ts` 无残留 → **无双写**；`runTask` 调用方仅 `ipc.ts:327`。

---

## 四、索引真实性（真实开库，不看测试断言）

**方法（自证非静态阅读）**：把仓库**未修改**的 `electron/main/services/storage/database.ts` 用 `tsc --ignoreConfig` 编译到 `%TEMP%`，再用独立 Node 脚本 require 编译产物，在真实临时 sqlite 文件上执行 PRAGMA。

```
cd D:\github\gitool
npx tsc --ignoreConfig electron/main/services/storage/database.ts --outDir %TEMP%\gitool-idx-verify\build \
       --module commonjs --target es2022 --moduleResolution bundler --skipLibCheck --esModuleInterop
node %TEMP%\gitool-idx-verify\probe.cjs
```

**原始输出（退出码 0，`FAILURES=0`）**：

```
INDEX_LIST=[{"name":"idx_projects_path","unique":0},{"name":"idx_projects_workspace","unique":0},{"name":"sqlite_autoindex_projects_1","unique":1}]
INDEX_INFO=["path"]
QUERY_PLAN=["SEARCH projects USING INDEX idx_projects_path (path=?)","USE TEMP B-TREE FOR ORDER BY"]
PASS index_list contains idx_projects_path :: ["idx_projects_path","idx_projects_workspace","sqlite_autoindex_projects_1"]
PASS idx_projects_path covers [path] :: ["path"]
PASS query plan uses idx_projects_path (no SCAN projects) :: ["SEARCH projects USING INDEX idx_projects_path (path=?)","USE TEMP B-TREE FOR ORDER BY"]
PASS after DROP INDEX the index is gone :: ["idx_projects_workspace","sqlite_autoindex_projects_1"]
PASS re-initDatabase recreates idx_projects_path (old-db upgrade path) :: ["idx_projects_path","idx_projects_workspace","sqlite_autoindex_projects_1"]
PASS re-init is idempotent :: ["idx_projects_path","idx_projects_workspace","sqlite_autoindex_projects_1"]
CLEANUP_DONE=true
FAILURES=0
```

| 断言 | 期望 | 实测 | 判定 |
| --- | --- | --- | --- |
| `PRAGMA index_list('projects')` 含 `idx_projects_path` | 存在 | 存在，`unique=0` | ✅ |
| 索引列 | `path` | `["path"]` | ✅ |
| `findByPath` 的 SQL 是否走索引 | 索引检索 | `SEARCH projects USING INDEX idx_projects_path (path=?)`（`ORDER BY` 另用临时 B 树，因 `updatedAt` 不在索引内；结果集已被 `path=?` 收敛，代价可忽略） | ✅ |
| 老库补建（`DROP INDEX` 后重新 `initDatabase`） | 幂等补回 | 补回成功，二次重开亦成功 | ✅ |
| 与新库 DDL 一致 | `CREATE INDEX IF NOT EXISTS` 在所有迁移之后 | `database.ts` 中 `migrationDropPathUniqueConstraint` → `seedDefaultWorkspace` → `ensureIndexes` 顺序正确（避免 DROP TABLE 连带删索引） | ✅ |

> 注：`sqlite_autoindex_projects_1` 是 `id TEXT PRIMARY KEY` 的隐式唯一索引，与本次改动无关；`projects.path` 仍**允许重复**（无 UNIQUE），与第七节语义差异相关。

---

## 五、测试质量对抗检查

### 5.1 新增用例分布

| 文件 | `it()` | 是否真实后端 |
| --- | --- | --- |
| `src/lib/projects.test.ts` | 12 | 纯函数/纯逻辑 |
| `src/lib/workspaces.test.ts` | 16 | 纯函数/纯逻辑 |
| `src/lib/uiPrefs.test.ts` | 12 | 纯函数 + localStorage stub |
| `src/lib/bridge.test.ts` | 9 | `window` stub |
| `electron/main/services/operations.test.ts` | 8 | **真实 node:sqlite + 临时目录**，仅 `./git` 与写入失败开关被 mock |
| `electron/main/services/tasks.test.ts` | 4 | **真实 node:sqlite + 临时目录**，仅 `node:child_process` / `processCleanup` 被 mock |
| 合计（`src/lib` 部分） | **49** | ≥18 ✅ |

### 5.2 bridge 的 null 断言是新契约（不是为通过而补的断言）

`bridge.ts` 变更：`return window.gitool ?? undefined;` / `return Boolean(getDesktopBridge());`

- 旧行为：`window.gitool = null` → `getDesktopBridge()` 返回 `null`（违反 `DesktopBridge | undefined`），`isDesktopRuntime()` 用 `!== undefined` 判定 → **返回 true（误判为桌面环境）**，随后 `bridge.xxx()` 在渲染层 TypeError。
- 新行为：归一为 `undefined` + 真假值判定 → 非桌面。
- 测试确实锁死新契约：`bridge.test.ts:73` 「getDesktopBridge 把 null 归一为 undefined，isDesktopRuntime 判定为 false」，并另有 `requireDesktopBridge` 在 `null` 时抛错（`toThrow(NOT_DESKTOP_MESSAGE)`）。**是真行为变更对应的新断言** ✅
- 消费方全部是 `if (!isDesktopRuntime())` / `if (!bridge)` 形态（50+ 处，overview/backups/git/tasks/settings/hooks），`null → undefined` 不引起回归 ✅

### 5.3 「只断 mock 次数、不断行为」的排查结果

| 关注点 | 结论 |
| --- | --- |
| `operations` 的「单条 SQL」 | 用 Proxy 统计 `.prepare` 次数（`prepareCalls === 1`），**但同时断言真实返回值**（`=== "p-b"` / `=== ""` / 重复行 `=== "p-new"`），行为与调用次数双证据 ✅ |
| `tasks` 的「insert 早于 spawn」 | **真实顺序探针**：mock 的 `spawn` 在被调用瞬间读取 `listTaskRuns()` 状态（`harness.statusAtSpawn`），断言表现为 `"running"` 且 `harness.events.slice(0,2) === ["insert","spawn"]`；同时 mock 内部转发真实 `actual.insertTaskRun/updateTaskRun`，写入不打折 ✅ |
| `persistRun` 失败 | `failUpdates = 1` 制造真实 UPDATE 失败 → 断言库里该行 `status === "failed"` 且 `output` 含 `[记录写入失败] 磁盘写入失败`（断言的是**落库结果**，不是 mock 被调用） ✅ |
| 断言强度 | 无 `expect(true)` / `expect(1).toBe(1)` / `it.skip` / `it.only` / `todo`（全仓 UTF-8 扫描结果 `NONE`） ✅ |
| 是否存在「为达标放宽的断言」 | `operations.test.ts` 断言 `detail` 长度恰为 500、`not.toContain("alice"/"secretpw"/"ghp_…"/"tok-…")`、`toContain("https://***@example.com")` —— 均比「跑通」更严，非放宽 ✅ |

### 5.4 已有 git 条件跳过（非本批引入）

`electron/main/services/git.test.ts:181 describe.skipIf(!hasGit)(...)`：本机未装 git 时整组跳过，属既有合理降级；本机 git 可用，本次 340 用例无 skip。

---

## 六、运行时对抗性探针（不依赖仓库测试）

### 6.1 真实子进程生命周期（A-22 核心场景：进程瞬间结束）

同一编译方式编译 `services/tasks.ts`，用**真实 `node` 子进程**（非 mock）跑 4 个场景：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 进程瞬间 `process.exit(0)`（旧实现 UPDATE 会打到不存在的行） | 行最终 `succeeded`，不卡 `running` | `PASS :: {"status":"succeeded","exitCode":0}`；`status_after_return=running`（契约正确：调用返回时仍在跑） |
| 短任务真实输出 | output 落库 | `PASS :: {"status":"succeeded","output":"12345"}` |
| 命令不存在 | 可观测失败，不静默 | `PASS`（落库 `failed`） |
| 重复运行同 profile | 无卡死行、无重复 id | `PASS :: ["succeeded","failed","succeeded","succeeded"]`；`3 -> 4` |

`runningTasks` 注册/注销、`stopRequested`、`registerProcessStopper` 均被真实路径覆盖。

> 探针自我修正记录（对抗性要求）：初始版本假设「命令不存在时 `spawn` 会同步抛错」。实测 Windows `shell: true` 下 `spawn` **不会**同步抛错，而是由 cmd 返回非 0 退出码走 `close` 分支。据此**修正探针期望**（断言「可观测地失败」），而不是修改代码去迎合探针；`tasks.test.ts` 中「spawn 同步抛错」用例通过 mock 覆盖真实 `shell:false`/参数非法场景，两条失败路径因此都被覆盖，不存在虚测。

### 6.2 审计不阻断 + 反查降级（真实故障注入）

用真实 sqlite 制造**真实**失败（`DROP TABLE`），不使用 mock：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| `findByPath` 跨工作区命中 | 命中最新行 | `PASS :: {"id":"p-new"}` |
| 重复路径（跨工作区脏数据） | 确定性取 `updatedAt` 最新 | `PASS`（`resolveProjectIdByPath === "p-new"`） |
| 未命中 | `""` | `PASS` |
| `recordOperation` 成功 | 返回 true、落 1 条、detail 截断 500 | `PASS :: [{"len":500,"projectId":"p-new"}]` |
| detail 脱敏 | 无明文凭据 | `PASS :: remote: https://***@example.com/repo.git?access_token=*** Authorization: Bearer …` |
| **`DROP TABLE operation_records`** | 返回 false、**不上抛**、留日志 | `PASS :: threw=null result=false`；日志 `[operations] 审计写入失败 operation=commit path=C:\work\dup err=no such table: operation_records` |
| 日志不含未脱敏 detail | 无凭据/无正文 | `PASS`（不含 alice/secretpw/ghp_/tok-/zzz…） |
| **`DROP TABLE projects`** 后反查 | 降级 `""`、不上抛、留日志 | `PASS :: threw=null value=`；日志 `[operations] 按路径反查项目失败：no such table: projects` |

全部 14 条 PASS，`PROBE_EXIT=0`，`CLEANUP_DONE=true`。

---

## 七、范围与卫生

### 7.1 `git status --porcelain`（原样）

```
 M electron/main/ipc.ts
 M electron/main/services/storage/database.test.ts
 M electron/main/services/storage/database.ts
 M electron/main/services/storage/projects.ts
 M electron/main/services/tasks.ts
 M src/lib/bridge.ts
?? .opencode/
?? electron/main/services/operations.test.ts
?? electron/main/services/operations.ts
?? electron/main/services/tasks.test.ts
?? src/lib/bridge.test.ts
?? src/lib/projects.test.ts
?? src/lib/uiPrefs.test.ts
?? src/lib/workspaces.test.ts
```

- ✅ `src/lib/projectMatch.test.ts` **未出现在 modified**（已回退成功）。
- ✅ 改动面与任务书一致（6 改 7 增），无构建产物污染（`dist/`、`dist-electron/` 被 `.gitignore` 覆盖）。
- ⚠️ `?? .opencode/`：Agent 工具运行数据（如 `.opencode/data/cag/.../preference.json`），`.gitignore` 未含该条目 → 有误提交风险（P2-3）。

### 7.2 编码与行尾（字节级校验）

| 文件 | UTF-8 合法 | U+FFFD | BOM | CRLF | 裸 LF |
| --- | --- | --- | --- | --- | --- |
| `electron/main/ipc.ts` | ✅ | 0 | 无 | 0 | **427** |
| `electron/main/services/operations.ts` | ✅ | 0 | 无 | 0 | **113** |
| `electron/main/services/tasks.ts` | ✅ | 0 | 无 | 198 | 0 |
| `electron/main/services/storage/database.ts` | ✅ | 0 | 无 | 411 | 0 |
| `electron/main/services/storage/projects.ts` | ✅ | 0 | 无 | 131 | 0 |
| `electron/main/services/storage/database.test.ts` | ✅ | 0 | 无 | 151 | 0 |
| `src/lib/bridge.ts` | ✅ | 0 | 无 | 23 | 0 |
| `operations.test.ts` / `tasks.test.ts` | ✅ | 0 | 无 | 0 | 218 / 175 |
| `src/lib/{bridge,projects,uiPrefs,workspaces}.test.ts` | ✅ | 0 | 无 | 0 | 80 / 157 / 150 / 208 |

- ✅ **无乱码**：13 个文件全部通过严格 UTF-8 解码（`UTF8Encoding(false, true)` 未抛错），U+FFFD 计数全为 0，无 BOM。
- ✅ prettier（`--end-of-line auto`）13/13 通过。
- ⚠️ **行尾混合**：7 个新增文件为 LF；4 个被修改的既有文件（`tasks.ts`/`database.ts`/`projects.ts`/`bridge.ts`）保持 CRLF。任务书写的是「CRLF」，但项目 `.prettierrc.json` 明确 `"endOfLine": "lf"` —— **以项目配置为准，LF 才是合规方向**，既有 CRLF 文件才是偏差（P2-2）。

---

## 八、语义风险评估（F）

### 8.1 审计失败不再上抛 → 是否「不可观测」

| 问题 | 结论 |
| --- | --- |
| `recordOperation` 返回 `false` 是否被误用？ | **无生产消费方**：`operations.ts:37/44/51` 三个调用点全部忽略返回值（全仓 `= recordOperation(` 仅出现在测试）。即「false」目前是**无消费者的返回值**。 |
| 是否退化为不可观测？ | **没有**。失败路径必有 `console.error`（含 `operation` / `path` / 错误摘要），运行时探针实测到该日志。可观测性成立，但只落在主进程控制台：终端用户看不到「审计缺失」。 |
| 是否影响业务语义？ | **不影响**。git 动作先执行再记录，审计失败不回滚、不改写返回结果（探针 `threw=null result=false`）。设计正确。 |
| 风险评估 | **P2-4（可维护性）**：返回 boolean 却无人使用，容易让后续维护者误以为「调用方已处理」。建议二选一：① 把 `recordOperation` 改为 `void`，把可观测性收敛到日志；② 在 `recordGitOperation/recordClone/recordCommit` 里对 `false` 做一次「审计缺失」计数或 `console.warn` 汇总，避免只靠单行 error。**非阻塞**。 |
| 敏感信息出口 | 日志不打印 `detail`（探针验证无凭据），符合 A-03 出口清单要求。脱敏在截断之前，边界不残留半截凭据（单测用 480+ 边界用例锁定）。✅ |

### 8.2 `findByPath` 的同路径取最新 vs 旧实现遍历顺序

| 维度 | 旧实现（`ipc.ts` 本地 `resolveProjectIdByPath`） | 新实现（`storage/projects.findByPath`） |
| --- | --- | --- |
| 查询形态 | `listWorkspaces()` → 每个区 `loadProjects(ws.id)` → 数组 `find()`，1+N 次全表读 | `SELECT … WHERE path = ? ORDER BY updatedAt DESC LIMIT 1`，1 条 SQL 走索引 |
| 工作区选择顺序 | `workspaces ORDER BY createdAt ASC, name ASC` → **最早创建的工作区优先** | 无工作区维度 |
| 区内顺序 | `projects ORDER BY favorite DESC, updatedAt DESC, name ASC` → 取该区排序第一 | 全局 `updatedAt DESC` → **最新更新行优先** |
| 差异触发条件 | 仅当**同一绝对路径存在于 ≥2 个工作区** | 同 |
| 差异方向 | 早建工作区的项目 ID | 最后更新过的项目 ID |

- **数据约束现状**：`projects.path` 只有 `NOT NULL`，没有 UNIQUE（`projects` 表唯一索引只有 `id TEXT PRIMARY KEY` 的隐式 `sqlite_autoindex_projects_1`）；`workspaceId` 维度也无复合唯一约束。因此「同路径多行」在脏数据/历史迁移下**可能真实出现**。
- **影响面**：`projectId` 只用于**操作日志归组展示**的装饰字段；不影响项目列表、git 行为、持久化状态。历史日志已写入的 `projectId` 不会被重算；只有新写入的记录可能从「早建工作区的项目」改挂到「最近更新的项目」。
- **一致性**：新语义是**确定性**的（不依赖 SQLite 默认行序），且代码注释 + 单测（`operations.test.ts:130` 「同一路径存在重复历史行时按 updatedAt 取最新」）+ 本次真实库探针三重锁定。
- **判定：可接受（P3-1，已文档化）。** 建议后续：`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workspace_path ON projects(workspaceId, path)` 或一次性去重脚本，把「同路径多行」从可能变为不可能，从而让两种语义彻底等价。

### 8.3 其他语义点复核

| 检查 | 结论 |
| --- | --- |
| `recordGitOperation` 的路径来源 | git/commit 用 `path`/`projectPath`、clone 用 `input.targetPath` —— 与旧 IPC 实现逐字一致，未改变审计字段语义 ✅ |
| `tasks:run` 返回值 | handler 由 `async (...) => { const run = await runTask(...); insertTaskRun(run); return run; }` 变为直接 `runTask(...)`；`runTask` 仍返回 `TaskRun`，IPC 契约不变 ✅ |
| `runTask` 抛错语义变化 | 旧：spawn 已启动后 insert 失败 → 进程在跑但库里无行；新：insert 失败 → 直接上抛、**不启动进程**（`harness.events === []`，探针/单测双证）。这是**改进**，但属行为变更，已在 `tasks.ts:39-40` 注释与 `tasks.test.ts:157` 用例中明示 ✅ |
| `loadWorkspaceProjects` 别名 | 仅重命名绑定点，`projects:load` 仍按工作区列出项目，无行为变化 ✅ |
| 索引创建时机 | 在 `migrationDropPathUniqueConstraint` 之后（`DROP TABLE` 会连带删索引），顺序正确 ✅ |

---

## 九、发现项汇总与提交建议

| 编号 | 级别 | 发现 | 建议 |
| --- | --- | --- | --- |
| **P1-1** | **P1（验收指标未达成 + 取证失真）** | `ipc.ts` 真实 **427 行**，未达「< 420」。此前记录的「416 行」是 PowerShell 5.1 以 ANSI/GBK 解码 UTF-8 时吞掉 11 个换行所致（字节级 `0x0A` = 427，非空 408）。功能无影响，仅指标层未达成。 | 二选一：① 再瘦身 ≥8 行（可把 `requireString`/`requireStringArray`/`parseOrThrow` 落到 `electron/main/ipc/validate.ts`，预计可减 15+ 行）；② 正式把指标修订为「< 430 行」并在评审文档注明「行数必须用 UTF-8 计数（`node` 或 `Get-Content -Encoding UTF8`）」。**不得继续沿用 416 这个读数。** |
| **P2-1** | P2（文档自相矛盾，会误导维护者） | `storage/projects.ts` 中 `findByPath` 注释写「⚠ 索引缺口（已知遗留）：`projects.path` 目前没有显式索引……不在本次改动范围」，而同批 `database.ts` 已新增 `idx_projects_path`，注释与事实相反。 | 删除该「索引缺口」段落，改为「已有 `idx_projects_path`，反查为索引单点查询（database.ts `ensureIndexes`）」。 |
| **P2-2** | P2（卫生/一致性） | 行尾 LF/CRLF 混合：7 个新文件 LF、4 个被改既有文件 CRLF；`npm run format:check` 全仓 140 文件失败（**HEAD 既有**，`.prettierrc.json` 为 `endOfLine: "lf"`）。任务书要求的「CRLF」与项目配置相反。 | 以 `.prettierrc.json` 为准统一为 LF：对本批 4 个既有文件执行 `prettier --write`（会产生大 diff，建议单独 `chore(format)` 提交），或加 `.gitattributes`（`* text=auto eol=lf`）一劳永逸；同时把 `format:check` 恢复为绿色门禁。 |
| **P2-3** | P2（卫生） | `.opencode/` 处于 untracked 且未在 `.gitignore` 中，误提交会带入 Agent 运行数据（含偏好文件）。 | 在 `.gitignore` 追加 `.opencode/`。 |
| **P2-4** | P2（可维护性） | `recordOperation` 返回 `boolean`，生产调用点 3 处全部忽略；可观测性只靠 `console.error`，终端用户不可见。 | 改为 `void`，或在编排函数中对 `false` 增加一次汇总告警/计数（见 8.1）。 |
| **P2-5** | P2（指标形式化） | 「`ipc.ts` 中 `loadProjects(` = 0」仅靠 import 别名达成（`loadWorkspaceProjects`），代码注释亦自陈是为满足门禁。真实目标（删除 1+N 路径反查）已达成。 | 把该门禁改为结构性断言：`ipc.ts` 内不得出现「`listWorkspaces()` + `loadProjects()`」组合（或对「按路径反查」加 lint 规则），避免下一个人用改名绕过。 |
| **P3-1** | P3（语义，已文档化） | `findByPath` 的 `ORDER BY updatedAt DESC LIMIT 1` 与旧「早建工作区优先」在**同路径跨工作区重复**时结果不同；仅影响操作日志归组，且新语义更确定。 | 保持现状；后续加 `UNIQUE(workspaceId, path)` 或去重脚本收敛脏数据（见 8.2）。 |

### 提交建议

- **功能层面：建议提交。** 6 条门禁中 5 条绿（vitest 340 / tsc ×2 / build / prettier 目标文件），两条索引与两条生命周期对抗性探针（真实库 + 真实子进程 + 真实故障注入）全部 PASS，未发现行为回归、未发现空断言或为达标放宽的断言、未发现破坏性残留。
- **验收层面：建议先处置 P1-1 + P2-1 再归档本批。** P1-1 是「指标口径/取证方式」问题而非代码缺陷，但继续以 416 行作为达标证据会让后续批次的验收可信度一起失真；P2-1 的注释若不改，会把「索引已补齐」误传为「仍是全表扫描」，直接影响后续排期判断。
- 建议提交信息（依 AGENTS.md 第五节，含追溯尾注）：

```
refactor(ipc,tasks): A-21 编排下沉 + A-22 任务生命周期单点 + A-24 首阶段测试

- A-21: 新增 services/operations.ts（recordGitOperation/recordClone/recordCommit/recordOperation/
  resolveProjectIdByPath），ipc.ts 删除本地编排与 1+N 路径反查（490→427 行）
- A-22: insertTaskRun 移入 runTask 且早于 spawn；persistRun 失败降级写 failed
- A-24: 新增 src/lib/{projects,workspaces,uiPrefs,bridge}.test.ts（49 例）与
  services/{operations,tasks}.test.ts（12 例）
- fix(bridge): getDesktopBridge 归一 null → undefined，isDesktopRuntime 用 Boolean
- perf(db): 新增 idx_projects_path，操作日志按路径反查走索引

验证：vitest 340/32 files；tsc -b / tsc -p tsconfig.electron.json / build 全绿
生成模型：deepseek-v4.1-flash-1017（独立验证：Batch2Verifier，task 35）
```

---

## 附：本次验证用到的命令清单（可复现）

```powershell
# 门禁
npx vitest run
npx tsc -b
npx tsc -p tsconfig.electron.json
npm run build
npx prettier --check --end-of-line auto <13 个改动/新增文件>
npm run format:check            # 全仓（HEAD 即红，见 P2-2）

# 计数（必须 UTF-8；Get-Content 默认 ANSI 会吞行）
node %TEMP%\gitool-idx-verify\audit.cjs   # ipc 行数/关键词、it() 计数、skip/only/空断言扫描

# 索引真实性（真实临时库）
npx tsc --ignoreConfig electron/main/services/storage/database.ts --outDir %TEMP%\gitool-idx-verify\build --module commonjs --target es2022 --moduleResolution bundler --skipLibCheck --esModuleInterop
node %TEMP%\gitool-idx-verify\probe.cjs

# 生命周期 / 审计 运行时探针（真实子进程 + 真实故障注入）
npx tsc --ignoreConfig electron/main/services/tasks.ts --outDir %TEMP%\gitool-idx-verify\build2 --module commonjs --target es2022 --moduleResolution bundler --skipLibCheck --esModuleInterop
node %TEMP%\gitool-idx-verify\probe-tasks.cjs
npx tsc --ignoreConfig electron/main/services/operations.ts --outDir %TEMP%\gitool-idx-verify\build3 --module commonjs --target es2022 --moduleResolution bundler --skipLibCheck --esModuleInterop
$env:NODE_PATH="D:\github\gitool\node_modules"; node %TEMP%\gitool-idx-verify\probe-ops.cjs
```