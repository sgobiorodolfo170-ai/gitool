# 第三批架构修复独立验证报告（A-15 实体工厂 / A-11 路径策略）

- 验证对象：`d5f590a`（v0.8.5）之上的未提交工作区改动（**含第二轮返修**：`projects:save` 登记门 + 增量校验）
- 验证轮次：第一轮（A-15/A-11 原始改动）+ **第二轮返修复验（2026-11-21 晚）**，两轮均由本 Agent 独立执行，不采信实现方自评
- 验证方式：只读 + 临时沙箱脚本真实执行；业务代码 0 改动
- 验证日期：2026-11-21
- 验证人：独立验证 Agent（Batch3Verifier，与实现方非同一实例）
- 写入范围声明：本次仅写本文件。`{{project_root}}/.resultverify/*.json` 未写入，原因是团队任务书明确限定「唯一可写 `docs/arch-fix-batch3-verification.md`」，其结构化判定以本文第 10 节等价形式给出。
- 业务代码改动：**0 行**（`git status --porcelain` 在验证前后一致，仅含实现方 10 个改动/新增文件 + 本报告）

---

## 1. 结论（最终）

| 项目 | 结论 | 依据 |
| --- | --- | --- |
| A-15 实体工厂（P0） | **通过** | `createProject`/`createTaskProfile` 覆盖契约全部字段；6 处 Project 字面量 + 1 处 TaskProfile 字面量逐字段**零差异**；schema 收窄方向正确且反向测试真会失败（§4） |
| A-11 路径策略 | **通过（自身实现无缺陷）** | 边界 51/51 实测通过；`path.relative` 而非 `startsWith`；UNC 判定先于绝对路径判定；33 个校验点；正常路径不误杀（§5） |
| **`projects:save` 后门（上轮 P1）** | **已封堵，复验通过** | 新增 `assertRegistrableProjectPath` + `pathsNeedingValidation`；实测 `%SystemRoot%\System32`、`C:\`、不存在目录均被拒且落库零变化；离线盘不阻断；验收 27/27（§7） |
| 门禁 | **全绿（392）** | vitest **392/392**、`tsc -b` 0、`tsc -p tsconfig.electron.json` 0、`npm run build` 0、prettier 0（§7.4） |
| handler 计数 | **76（与 HEAD 一致）** | Node 正则统计；diff 中无 handler 增删（§7.4） |
| **可提交性（最终）** | **可提交** | 上轮唯一的 P1（自登记系统目录）已被实测封堵；剩余风险均为 P2/P3 且实现方已在注释中显式声明边界（§7.5、§6） |

> 一句话：**可以提交。** 上轮指出的「渲染层可自我登记系统目录」后门已被登记门 + 增量校验实测封堵，且修复没有牺牲离线盘场景（离线路径保留时不校验、不 stat）。
> 仍需在后续批次跟进：`backups:*` 未接入路径策略、历史脏数据不重校验、「登记用户自己任意目录」在设计上仍允许（需路径来源凭证 provenance 才能闭环）、junction/TOCTOU 解析不一致（详 §7.5）。

---

## 2. 验证方法与证据规则

1. 所有结论均来自**真实执行**：`git show`、`npx vitest`、`npx tsc`、`npm run build`、`npx prettier`，以及两轮共 7 个临时探针脚本（第一轮 4 个、第二轮 3 个）。
2. 临时脚本全部位于 `%TEMP%\a11-verify\`（系统临时目录），未写入仓库；探针通过 `node --experimental-strip-types` **直接 import 仓库源码**（`pathPolicy.ts`）或 `%TEMP%` 下的**逐字节副本**（`shared/entities.ts`、`shared/types.ts`、`electron/main/ipc/schemas.ts`，副本仅把无扩展名的相对 import 改写为带 `.ts`，源码哈希已记录）。
3. 副本哈希（源文件，验证时点）：
   - `shared/entities.ts` → `23A0AD99979BDA27ABCA7808AD0268DB344957FFE3DC1BBF73AE4A5B5B14B27E`
   - `electron/main/ipc/schemas.ts` → `0831878518E13847EEE1C3E9D578087369BB3A8F695382052BCEF1590CC91855`
4. 计数口径：`it()` 声明数 vs vitest 实际执行数不一致时，以 **vitest 执行数**为准（`pathPolicy.test.ts` 声明 27 处 `it(`、实际执行 28 条，其中 1 条为 `it.runIf`）。

---

## 3. 门禁结果

| 门禁 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 全量单测 | `npx vitest run` | **PASS** | `Test Files 34 passed (34)` / `Tests 381 passed (381)`，Duration 3.30s |
| 渲染/共享 TS 工程 | `npx tsc -b` | **PASS** | 无输出，`EXIT=0` |
| Electron 主进程 TS | `npx tsc -p tsconfig.electron.json` | **PASS** | 无输出，`EXIT=0` |
| 生产构建 | `npm run build` | **PASS** | `✓ 142 modules transformed` / `dist-electron/main.cjs 218.54 kB` / `BUILD_EXIT=0` |
| 格式（改动文件） | `npx prettier --check --end-of-line auto <10 files>` | **PASS** | `All matched files use Prettier code style!` |

改动文件清单（10 个，均通过格式检查）：
`electron/main/ipc.ts`、`electron/main/ipc/schemas.ts`、`electron/main/ipc/schemas.test.ts`、`electron/main/services/pathPolicy.ts`、`electron/main/services/pathPolicy.test.ts`、`shared/entities.ts`、`shared/entities.test.ts`、`src/components/TasksWorkspace.tsx`、`src/hooks/useImportFlow.ts`、`src/hooks/useRemotes.ts`

新增测试实际执行数：`shared/entities.test.ts` **13**、`electron/main/services/pathPolicy.test.ts` **28**（合计新增 41 条，故 HEAD 为 340 条）。`electron/main/ipc/schemas.test.ts` 修改 3 条（1 条补必填 `status` 并改名、2 条由「应兜底」翻转为「应报错」），用例总数未变。全量 **381** 恰好满足「≥381」，无删除用例。

---

## 4. A-15 实体工厂验证

### 4.1 类型契约 vs 工厂字段覆盖

| 类型 | 契约字段数（`shared/types.ts` 实测） | 工厂产出键数 | 必填字段缺 `undefined` | 结论 |
| --- | --- | --- | --- | --- |
| `Project`（`types.ts:104-124`） | **19**（16 必填 + `remote?`/`alias?`/`webUrl?` 3 可选） | 19 | 0 | 通过 |
| `TaskProfile`（`types.ts:280-291`） | **10** | 10 | 0 | 通过 |

> ⚠ 票面口径偏差（不影响结论）：任务书写「Project 的 20 个字段」，实测类型定义是 **19 个字段**。
> `createProject` 的注释（`entities.ts:96`）也写 19，与代码一致；票面的 20 应为笔误或把 `ProjectStatus` 计入了。

实测证据（必填字段逐个判空）：

```
PASS  Project 必填 16 字段无 undefined（类型共 19 字段，另 3 个可选）  期望=[]  实际=[]
PASS  Project 字段总数（含可选）  期望=19  实际=19
PASS  TaskProfile 必填 10 字段无 undefined  期望=[]  实际=[]
PASS  TaskProfile 字段总数  期望=10  实际=10
```

实现要点（读代码 + 执行双向确认）：
- `createProject` **逐字段 `??` 赋值**而非 `{...defaults, ...seed}`（`entities.ts:102-124`）。这一点很关键：展开写法会让 seed 里显式 `undefined` 覆盖默认值，产出缺字段对象。构造函数选择了正确写法。
- `createTaskProfile`（`entities.ts:144-156`）同理，只有 `args`/`timeoutSeconds` 有真实缺省值（来自 `TasksWorkspace` 草稿）。

### 4.2 6 处 Project 字面量 + 1 处 TaskProfile 字面量：逐字段对照

方法：从 `git show HEAD:...` 取原文，把旧字面量**原样复刻**进探针，与「新工厂调用（含调用点覆盖字段）」的结果做**全字段值比较**（含可选键），并故意构造「快照缺失 / 空串 / 齐备」三种分支。

| # | 调用点（新代码） | HEAD 原文位置 | 场景变体 | 差异字段数 |
| --- | --- | --- | --- | --- |
| 1 | `useRemotes.ts:188` 收藏占位 | `useRemotes.ts:175-194` | `defaultBranch` 空串 | **0** |
| 1b | `useRemotes.ts:188` | 同上 | `defaultBranch=develop` + 有描述 + 有 webUrl | **0** |
| 2 | `useRemotes.ts:256` 关注占位 | `useRemotes.ts:247-266` | `defaultBranch=trunk`，省略 `favorite` | **0** |
| 3 | `useRemotes.ts:321` 克隆 | `useRemotes.ts:308-333` | `snapshot === undefined` | **0** |
| 3b | `useRemotes.ts:321` | 同上 | 快照字段全为空串 | **0** |
| 3c | `useRemotes.ts:321` | 同上 | 快照齐备（dirty/42 files/已同步） | **0** |
| 4 | `useImportFlow.ts:79` 单目录导入 | `useImportFlow.ts:68-90` | — | **0** |
| 5 | `useImportFlow.ts:138` 初始化新仓库 | `useImportFlow.ts:133-152` | — | **0** |
| 6 | `useImportFlow.ts:177` 批量扫描 | `useImportFlow.ts:177-196` | 快照 `undefined` | **0** |
| 6b | 同上 | 同上 | 快照字段全为空串 | **0** |
| 6c | 同上 | 同上 | 快照齐备（behind/7 files） | **0** |
| 7 | `TasksWorkspace.tsx:161` TaskProfile | `TasksWorkspace.tsx:159-171` | 表单字段齐备 | **0** |

探针汇总：`{"pass":29,"fail":0}`（29 = 12 个对照场景 + 4 个完整性/字段数 + 13 个 schema 正向/反向/兜底断言）。

字段级「易错点」专项确认（这些是「默认值可能被悄悄改变」的高危点）：

| 字段 | 旧写法 | 新写法 | 等价性判定 |
| --- | --- | --- | --- |
| `status`（克隆） | `snapshot?.status ?? "clean"` | `status: snapshot?.status` → 工厂 `?? DEFAULT_PROJECT_STATUS` | 等价（均为 `"clean"`） |
| `status`（批量扫描） | `snapshot?.status ?? "clean"` | 同上 | 等价 |
| `files`（克隆/扫描） | `snapshot?.files ?? 0` | `files: snapshot?.files` → 工厂 `?? 0` | 等价，`files: 0` 与 `null` 均落 0 |
| `branch`（扫描） | `snapshot?.branch ?? "main"` | `branch: snapshot?.branch` → 工厂 `?? "main"` | 等价，**空串不回落**（`??` 只拦 nullish，新旧一致） |
| `favorite`（关注占位） | `favorite: false` 显式 | 省略 → 工厂 `?? false` | 等价 |
| `languageColor` | `"#8b97a8"`（3 处） | `DEFAULT_LANGUAGE_COLOR` | 等价（同值 `#8b97a8`） |
| `commit/syncLabel/language/summary/updatedAt` | 6 处共 11 个中文字面量 | 具名常量 | 逐字符相同（探针值比较，不是目测） |
| `diskSizeBytes` | `0` 或变量 | 省略 → `?? 0`，或显式传变量 | 等价 |

**唯一结构性差异（非行为差异）**：工厂产物中 `remote`、`alias`（以及克隆/收藏场景的 `webUrl`）三个**可选键始终存在，值为 `undefined`**；旧字面量在部分场景压根没有这两个键。
- `JSON.stringify` 会丢弃 `undefined` → 落库 JSON 完全一致。
- 全仓库检索未发现任何依赖 `"remote" in project` / `Object.keys(project)` 的代码（`git grep` 命中 0 处，唯一 `project.remote` 使用点是 `storage/projects.ts` 的取值写入，`undefined → null`）。
- 结论：无行为影响，仅 `Object.keys` 长度从 17 变 19。

### 4.3 `schemas.ts` 的 `.catch()` 收窄清单

`projectSchema`（`schemas.ts:164-191`）：

| 字段 | HEAD（旧） | 现在（新） | 分类 | 判定 |
| --- | --- | --- | --- | --- |
| `id` | `requiredString` | 不变 | 业务 | 非法即报错（未放宽） |
| `name` | `requiredString` | 不变 | 业务 | 非法即报错 |
| `path` | `requiredString` | 不变 | 业务 | 非法即报错（空串拒绝，**本次未改**） |
| `provider` | `z.enum(...)` | 不变（仅加中文 message） | 业务 | 非法即报错 |
| **`status`** | `z.enum(...).catch("clean")` | `z.enum(..., {message:"项目状态无效"})` | 业务 | **收窄**：非法不再静默改写 clean；且变为必填（无 default） |
| **`favorite`** | `z.boolean().catch(false)` | `z.boolean().default(false)` | 业务（用户数据） | **收窄**：类型错误报错，仅缺省兜底 |
| **`tags`** | `z.array(z.string()).catch([])` | `z.array(z.string()).default([])` | 业务（watching/favorite 驱动 UI） | **收窄**：类型错误报错，不再整组清空 |
| `branch` | `looseString()` | 不变 | 展示（扫描重算） | 保留兜底 |
| `commit` | `looseString()` | 不变 | 展示 | 保留兜底 |
| `remote` | `z.string().optional().catch(undefined)` | 不变 | 可选元数据 | 保留兜底 |
| `files` | `z.number().catch(0)` | 不变 | 展示 | 保留兜底 |
| `syncLabel` / `language` / `summary` / `updatedAt` | `looseString()` | 不变 | 展示 | 保留兜底 |
| `languageColor` | `looseString("#8b97a8")` | `looseString(DEFAULT_LANGUAGE_COLOR)` | 展示 | 保留兜底（常量替换，同值） |
| `diskSizeBytes` | `z.number().catch(0)` | 不变 | 展示 | 保留兜底 |
| `alias` / `webUrl` | `optionalTrimmed`（含 `.catch(undefined)` + 空白归一） | 不变 | 可选元数据 | 保留兜底 |

`taskProfileSchema`（`schemas.ts:123-140`）：

| 字段 | 旧 | 新 | 判定 |
| --- | --- | --- | --- |
| `args` | `looseString()`（类型错误 → `""`） | `z.string().default("")` | **收窄**：类型漂移报错，缺省兜底 |
| `timeoutSeconds` | `z.number().catch(0)` | `z.number().default(0)` | **收窄**：类型漂移报错。`0` 语义是「不限制超时」（`services/tasks.ts:90` 只在 `> 0` 时注册定时器），静默退化会把有界任务变无界——收窄方向正确 |
| 其余 8 个字段 | `requiredString` / `enum` | 不变 | — |

残留 `.catch()` 的分布（逐项见上表）：`appSettingsSchema`（9 个字段：`gitPath`/`defaultProjectDirectory`/`defaultBackupDirectory`/`backupExcludePatterns`/`defaultSearchAccountId`/`aiModel`/`aiBaseUrl`/`aiApiKeyConfigured`/`closeToTray`）、`aiSummaryRequestSchema.context`、`createTagInputSchema.message`、`openEditorInputSchema.newWindow`、`initRepositoryInputSchema.defaultBranch`、`setRemoteUrlInputSchema.remote`、`cloneRepositoryInputSchema.accountId`、`remoteRepositoryWriteInputSchema.init`，以及 `projectSchema` 的展示字段（`remote`/`files`/`languageColor`/`syncLabel`/`language`/`summary`/`updatedAt`/`diskSizeBytes`）与 `optionalTrimmed`（`alias`/`webUrl`）。**没有任何业务身份字段仍处于 `.catch()` 之下。**

### 4.4 反向测试：真执行、真失败

不是读测试文件得出的结论，探针直接调用真实 `projectSchema` / `taskProfileSchema`：

```
PASS  project.name 空串                 期望 success=false  实际 success=false
PASS  project.path 空串                 期望 success=false  实际 success=false
PASS  project.id 非字符串               期望 success=false  实际 success=false
PASS  project.summary 非字符串(展示字段) 期望 success=true   实际 success=true   ← 兜底仍在
PASS  task.id 纯空白                    期望 success=false  实际 success=false
PASS  task.workingDirectory 空串        期望 success=false  实际 success=false
PASS  task.name 非字符串                期望 success=false  实际 success=false
PASS  task.projectPath 空串             期望 success=false  实际 success=false
```

实体探针中的同类断言（全部 PASS）：
`status:"weird"` → false；`provider:"bitbucket"` → false；`tags:[1]` → false；`favorite:"yes"` → false；**缺 `status`（显式 undefined）→ false**；`languageColor:1` → 兜底 `#8b97a8`；`files:null` → 兜底 0；`timeoutSeconds:"120"` → false；`args:[]` → false；`taskType:"x"` → false；缺省 `args/timeout` → `""`/`0` 兜底。

「测试与实现匹配」核对：`schemas.test.ts` 的断言改动与收窄一一对应（`toThrow("项目状态无效")`、`tags:[1,2]` → `toThrow`），`base` 夹具补了 `status: "clean"`，没有把断言改宽（对比 `git diff`，断言数不减，仅语义从「应被兜底」翻转成「应报错」）。

### 4.5 `status: "clean"` 分布核对

| 统计口径 | HEAD | 当前工作区 | 结论 |
| --- | --- | --- | --- |
| 生产代码显式 `status: "clean"` 字面量 | 4（useRemotes ×2、useImportFlow ×2） | **0** | 达标 |
| 生产代码内联默认 `snapshot?.status ?? "clean"` | 2（useRemotes 克隆、useImportFlow 扫描） | **0** | 达标（改由工厂默认） |
| **生产代码 status→clean 默认点合计** | **6** | **0** | 与「6 处字面量」完全对应 |
| 测试文件显式 `status: "clean"` | 6 | 7（新增 `schemas.test.ts:97` 的 `base`） | 记录在案 |
| 新增测试中「依赖工厂默认 clean」的夹具 | — | 3（`FULL_PROJECT`、最小种子、收藏占位） | 与票面「夹具 = 3」对应 |

> 票面「生产代码 status: "clean" = 0」**成立**；「测试夹具 = 3」按「新增夹具中隐式走默认 clean 的处数」成立，但若按「全仓库测试文件里的显式字面量」统计则为 **7**。两种口径都已列明，不构成缺陷。

### 4.6 投影测试真实性

- `shared/entities.test.ts:12` 直接 `import { projectSchema, taskProfileSchema } from "../electron/main/ipc/schemas"` —— 是**真实 zod schema**，非 mock、非空断言。
- 断言形态是 `expect(projectSchema.safeParse(project).success).toBe(true)`（`entities.test.ts:61`、`92`、`188`、`206`），并额外用 `expect(parsed).toEqual(FULL_PROJECT)`（`:68`、`:189`）证明「解析结果没有字段漂移」，这比单纯的 success 断言更强。
- 探针独立复现：最小种子 → true；`FULL_PROJECT` → true 且 `parse` 结果深等于工厂产物。

---

## 5. A-11 路径策略验证

### 5.1 实现审查（`electron/main/services/pathPolicy.ts`）

| 检查点 | 实现 | 判定 |
| --- | --- | --- |
| **用的是 `path.relative` 而非 `startsWith`** | `isWithinRoot` 用 `win32.relative(root.toLowerCase(), targetKey)`，并以 `relativePath !== ".."`、`!startsWith(".." + sep)`、`!win32.isAbsolute(relativePath)` 三条否定判定（`pathPolicy.ts:203-213`） | **正确** |
| UCB 判定先于绝对路径判定 | `UNC_PREFIX_PATTERN = /^[\\/]{2}/`（`:44`）在 `win32.isAbsolute`（`:75`）之前执行 | **正确**（`\\evil\share` 在 win32 语义下 `isAbsolute === true`，顺序错就等于放行 SMB） |
| `..` 段整类拒绝 | `target.split(/[\\/]+/).includes("..")`（`:164-168`），`..cache` / `...` 不误伤 | **正确** |
| 保留设备名 | 段内取 `.` 前部分、裁尾随空格与点后匹配 `con/prn/aux/nul/com1-9/lpt1-9`（`:174-181`） | **正确** |
| 控制字符 | `[\u0000-\u001f]`（`:50`、`:72`） | **正确** |
| 盘符根校验 | `DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]$/` 校验 `win32.parse().root`，拦 `\Windows\...` 与 `C:foo` | **正确** |
| 未知/非法根不抛错而丢弃 | `canonicalizeRoot` catch 后返回 `null`（`:184-193`），单条坏配置不废整条通道 | **正确** |
| 大小写 | target 与 root 均 `toLowerCase()` 后比较 | **正确** |
| 返回规范化路径 | `win32.resolve` 去尾随分隔符、统一分隔符（`:85`） | **正确** |

### 5.2 实测用例（自造用例，51 项全部 PASS）

探针：`%TEMP%\a11-verify\pathpolicy.probe.mjs`，`node --experimental-strip-types` 直接 import 仓库源码，`{"pass":51,"fail":0}`，`EXIT=0`。

必验清单逐项（全部有真实输出）：

| 输入 | 期望 | 实际输出 | 结果 |
| --- | --- | --- | --- |
| `\\evil\share\x` | 拒绝（UNC） | `PathPolicyError: 不支持网络共享路径（UNC）：X` | PASS |
| `//evil/share` | 拒绝（UNC） | 同上 | PASS |
| `\\?\C:\Windows` | 拒绝（UNC） | 同上 | PASS |
| `\\.\PhysicalDrive0` | 拒绝（UNC） | 同上 | PASS |
| `relative\path` / `./rel` / `C:foo` | 拒绝（相对） | `PathPolicyError: X必须是绝对路径` | PASS |
| `\Windows\System32` | 拒绝（无盘符） | `PathPolicyError: X必须是本地盘符绝对路径` | PASS |
| `C:\data\..\..\etc` | 拒绝（穿越） | `PathPolicyError: X不能包含上级目录（..）` | PASS |
| `C:\data\proj\..` | 拒绝（穿越） | 同上 | PASS |
| `C:\data\CON` / `nul.txt` / `com1\x` | 拒绝（设备名） | `PathPolicyError: X包含 Windows 保留设备名` | PASS |
| `C:\data\a\0b`（NUL） | 拒绝（控制字符） | `PathPolicyError: X包含非法控制字符` | PASS |
| `""` / `null` | 拒绝（空） | `PathPolicyError: X不能为空` | PASS |
| **`C:\data-evil`（root=`C:\data`）** | 拒绝 | `PathPolicyError: 路径不在允许范围内` | PASS |
| **`C:\DATA-EVIL\x`（root=`C:\data`）** | 拒绝（大小写混合也不撞前缀） | 同上 | PASS |
| `C:\`（root=`C:\data`） | 拒绝 | 同上 | PASS |
| `C:\data\proj` / `C:\data` / `C:\data\proj\` | 放行，`resolve` 规范化 | `放行 "C:\data\proj"` / `"C:\data"` / `"C:\data\proj"` | PASS |
| `c:\DATA\Proj`（root=`C:\data`） | 放行（大小写不敏感） | `放行 "c:\DATA\Proj"` | PASS |
| `C:/Data/Proj` | 放行 + 分隔符归一 | `放行 "C:\Data\Proj"` | PASS |
| **`C:\data\..cache\x`** | 放行（根内名为 `..cache` 的目录不误杀） | `放行 "C:\data\..cache\x"` | PASS |
| `C:\data\...\x` | 放行（`...` 是合法名） | `放行 "C:\data\...\x"` | PASS |
| `C:\data\proj` 尾随空格 | 放行（非设备名） | `放行 "C:\data\proj "` | PASS |
| 根 `C:\data\` + `C:\datax` | 拒绝（尾随分隔符不产生前缀绕过） | `路径不在允许范围内` | PASS |
| 根 `C:\data\..\evil` + `C:\evil\x` | 拒绝（非法根被丢弃） | `路径不在允许范围内` | PASS |
| 根 `\\evil\share` | 丢弃 | 目标 UNC 直接被 UNC 规则拒绝 | PASS |
| 根 `relative\root` | 丢弃 | `路径不在允许范围内` | PASS |
| `collectAllowedRoots` 去重 + 丢弃非法根 | 4 个根、顺序稳定 | `["C:\Users\tester","C:\data\proj","C:\backups","C:\Users\tester\Downloads"]` | PASS |

UNC 判定顺序专项（不是"看代码"得出的）：`path.win32.isAbsolute("\\\\evil\\share")` 为 `true`，探针断言错误文案必须是「UNC」且**不含**「必须是绝对路径」——实测 `PathPolicyError: 不支持网络共享路径（UNC）：X`。

### 5.3 正常路径不误杀（必验项 8）

模拟 `ipc.ts` 的两类真实来源（`registeredProjectPaths()` 与 `sessionSelectedDirectories`）：

```
roots = ["C:\Users\tester", "D:\Projects\demo-app", "E:\WorkDir\2026"]
PASS  D:\Projects\demo-app\                          → 放行 "D:\Projects\demo-app"      （已登记项目，尾随分隔符）
PASS  D:\Projects\demo-app\src\index.ts              → 放行（项目内文件）
PASS  E:\WorkDir\2026                                → 放行（selectDirectory 返回值）
PASS  E:\WorkDir\2026\new-repo                       → 放行（init/clone 生成子目录）
PASS  C:\Users\tester\Documents\new                  → 放行（主目录下新目录）
PASS  C:\Windows\System32                            → 拒绝（不在根内）
```

结论：`init`/`clone`/`scan`/`move`/`export` 这些「目标目录尚未登记」的合法流程不会被误杀，因为 `selectDirectory` 返回值在返回处即登记进会话根（`ipc.ts:216-225`）。

### 5.4 接入点矩阵（33 次 `assertPathAllowed` / 32 个 handler 通道 + `system:selectDirectory`）

`assertPathAllowed` 在 handler 内共 **33** 次调用（`projects:move` 源/目标各 1 次），覆盖 **32 个通道**；另有 1 次 `assertLocalAbsolutePath` 作用于 `selectDirectory` 返回值、1 次用于对话框默认路径的安全化（辅助函数体在 `ipc.ts:573`，调用点在 `ipc.ts:211`）。下表 33 行 = 32 个 handler 通道 + `selectDirectory`。

| # | 通道 | 校验方式 | 校验点行号 |
| --- | --- | --- | --- |
| 1 | `shell:openPath` | `requireAllowedProjectPath` | 237 |
| 2 | `shell:openEditor` | `assertPathAllowed(path)` | 247 |
| 3 | `shell:openTerminal` | `requireAllowedProjectPath` | 252 |
| 4 | `projects:inspect` | `requireAllowedProjectPath` | 257 |
| 5 | `projects:snapshot` | `requireAllowedProjectPath` | 261 |
| 6 | `projects:analyze` | `requireAllowedProjectPath` | 265 |
| 7 | `projects:detectCommands` | `requireAllowedProjectPath` | 269 |
| 8 | `projects:diskSize` | `requireAllowedProjectPath` | 273 |
| 9 | `projects:readme` | `requireAllowedProjectPath` | 277 |
| 10 | `projects:init` | `assertPathAllowed(path)` | 283 |
| 11 | `projects:scanDirectory` | `assertPathAllowed(dir)` | 290 |
| 12 | `projects:fileDiff` | `assertPathAllowed(path)` | 296 |
| 13 | `projects:setRemoteUrl` | `assertPathAllowed(path)` | 302 |
| 14 | `git:tags` | `requireAllowedProjectPath` | 307 |
| 15 | `git:createTag` | `assertPathAllowed(path)` | 312 |
| 16 | `git:deleteTag` | `requireAllowedProjectPath` | 317 |
| 17 | `git:listVersions` | `requireAllowedProjectPath` | 322 |
| 18 | `git:compareVersions` | `assertPathAllowed(path)` | 327 |
| 19 | `projects:gitOperation` | `requireAllowedProjectPath` | 332 |
| 20 | `projects:clone` | `assertPathAllowed(targetPath)` | 339 |
| 21 | `git:changedFiles` | `requireAllowedProjectPath` | 344 |
| 22 | `git:stageFiles` | `requireAllowedProjectPath` | 348 |
| 23 | `git:unstageFiles` | `requireAllowedProjectPath` | 352 |
| 24 | `git:commit` | `assertPathAllowed(path)` | 357 |
| 25 | `git:branches` | `requireAllowedProjectPath` | 362 |
| 26 | `git:createBranch` | `assertPathAllowed(path)` | 367 |
| 27 | `git:switchBranch` | `assertPathAllowed(path)` | 373 |
| 28 | `git:deleteBranch` | `assertPathAllowed(path)` | 379 |
| 29 | `git:history` | `requireAllowedProjectPath` | 384 |
| 30 | `git:revert` | `assertPathAllowed(path)` | 389 |
| 31 | `operations:export` | `assertPathAllowed(dir, exportPathRoots())` | 491 |
| 32 | `projects:move` | `assertPathAllowed(sourcePath)` + `assertPathAllowed(targetDirectory)` | 503 / 504 |
| 33 | `system:selectDirectory`（返回值） | `assertLocalAbsolutePath` + 会话登记 | 222-225 |

`git:*`（实测 **15 个**通道，全部已校验）与 `projects:*`（共 15 个，其中路径类 **13 个**全部已校验，`projects:load`/`projects:save` 不接收单一路径）**无遗漏**；`shell:*` 4 个中 3 个路径类已校验，`shell:openExternal` 只收 `^https?://` URL（`ipc.ts:228`）不属于路径面；`operations:export` 已接入且用了更窄的 `exportPathRoots()`（主目录 + 备份目录 + 会话选择，**不含已登记项目**），与注释意图一致。

### 5.5 接收路径但**未**校验的通道（实测确认，非推测）

| 通道 | 路径入参 | 现状 | 风险 |
| --- | --- | --- | --- |
| **`projects:save`** | `projects[].path` | 仅 `projectsSchema`（`requiredString`），**无白名单** | **P1：可自我登记任意本地目录，扩展 A-11 白名单**（见 6.1，已实测） |
| `backups:create` | `sourcePath`、`targetDirectory` | 仅 `requiredString` + `assertDirectory`（stat）+ 可写判断 | P1/P2：可打包任意目录（读取任意文件进 zip）、可写入任意可写目录（含 UNC） |
| `backups:restore` | `archivePath`、`targetDirectory` | 仅可读/可写/空目录判断，无根校验 | P1/P2：可把任意 zip 解压到任意空目录（含 UNC）；tar 成员路径穿越依赖 bsdtar 行为，未做二次校验 |
| `settings:save` | `defaultProjectDirectory`、`defaultBackupDirectory`、`gitPath` | 仅 `looseString()` | P2：`defaultBackupDirectory` 会进入 `exportPathRoots()`，等于可扩大 `operations:export` 的放行面 |
| `tasks:saveProfile` | `projectPath`、`workingDirectory` | 仅 `requiredString` | P2：`tasks:run` 用 `cwd = workingDirectory` 启动子进程（命令本身任意，属既有能力），但 UNC cwd 可触发 SMB |
| `updater:download` / `updater:install` | 无渲染层路径入参（URL 来自更新服务） | — | 不适用 |

其余 45 个通道（`system:*`、`workspaces:*`、`accounts:*`、`remoteRepositories:*`、`tasks:list/delete/run/stop`、`backups:list`、`operations:list/clear`、`settings:load`、`ai:*`）不接收路径字符串，或仅接收 ID/URL（`shell:openExternal` 限定 `^https?://`，见 `ipc.ts:228`），无需路径校验。

### 5.6 handler 计数

```
(Select-String -Path electron\main\ipc.ts -Pattern 'ipcMain\.handle\("' -AllMatches).Count
→ 76
```

**76，与 HEAD 一致**（`git diff` 中没有任何新增/删除 handler，只有函数体改写；`bridgeParity.test.ts` 的通道对齐断言仍通过）。

---

## 6. 风险与建议

### 6.1 【上轮 P1 → 本轮已封堵】`projects:save` 未收紧 → 渲染层可自登记任意目录，绕过白名单

> **状态更新（第二轮返修后）**：该后门**已被封堵**并经本轮实测复验（见 §7）。以下为第一轮实测证据，保留作追溯；结论与修复方案已随返修落地。

证据（`%TEMP%\a11-verify\bypass.probe.mjs`，4/4 PASS）：

```
PASS  projects:save 接受 path=C:\Windows\System32                      期望=true  实际=true
PASS  自登记后 C:\Windows\System32 下的路径被白名单放行                期望=true  实际=true
PASS  UNC 自登记：schema 接受但路径策略仍拒绝（canonicalizeRoot 丢弃）  期望=schema=true, allow=false  实际=schema=true, allow=false
PASS  空路径占位项目在 projectsSchema 下失败（既有契约，非本次引入）    期望=false 实际=false：项目路径不能为空
```

机制：`ipc.ts:395-400` 只做 `parseOrThrow(projectsSchema, projects)`；`projectPathRoots()` 又从 `listWorkspaces().flatMap(loadWorkspaceProjects)` 读回所有 `project.path`。于是：
1. 渲染层调用 `projects:save(ws, [{id,name,path:"C:\\Windows\\System32",...}])` → 通过（`path` 只需非空字符串）；
2. 下一次任意路径类 IPC（`git:*`、`projects:*`、`shell:openPath`…）→ `registeredProjectPaths()` 已包含该目录 → **放行**。

严重度评估：
- **P1（非 P0）**。原因：UNC 仍然被 `assertLocalAbsolutePath` 与 `canonicalizeRoot` 双重挡住（实测 `allow=false`），所以最危险的 SMB/Net-NTLMv2 通道没有被打开；但「任意本地目录（系统目录、其他用户目录、任意可写盘）」的放行面被完全打开，A-11「已登记路径」这一层防护在威胁模型（渲染层被攻破）下失效。
- 缺陷不在 A-11 的实现，而在**信任根的定义**：`projects:save` 是唯一能把渲染层数据写进「受信根集合」的通道，它没有校验，等于「自己给自己发通行证」。

建议（按优先级）：
1. 在 `projects:save` 中对每条 `project.path` 做 `assertPathAllowed(path, projectPathRoots(), "项目路径")`（导入/克隆/扫描路径在写入前都已落进会话根，实测不会被误杀；见 5.3）。**注意**：`path === ""` 的远程占位项目要显式跳过（否则会连带触发既有空路径问题，见 6.2）。
2. 或把「已登记项目路径」的定义从「DB 里的 path」改为「曾经由 `selectDirectory`/导入流程确认过的 path」（单独一张 `trusted_roots` 表，只由主进程写入），让 `projects:save` 无法成为信任根来源。
3. 无论选哪种，都要补一条反向测试：`projects:save` 提交 `C:\Windows\System32` 必须被拒绝。

### 6.2 【既有缺陷，非本次引入，但会被 A-15 的测试注释"固化"】空路径远程占位项目无法落库

- `projectSchema.path` 是 `requiredString`（HEAD 与当前一致），而 `toggleRemoteFavorite`/`toggleRemoteWatch` 构造的占位项目 `path: ""`（`useRemotes.ts:191/259`）。实测：`projectsSchema` 对空路径返回 `false`（"项目路径不能为空"）。
- 渲染层 `useProjects.persistProjects`（`src/hooks/useProjects.ts:72-95`）并不过滤空路径 → 桌面端「收藏/关注远程仓库」会**乐观更新成功但落库失败**（只有一条 toast），重启后丢失。
- `shared/entities.test.ts:98-105` 把这一行为写成「既有契约（本次未放宽）」并锁死为 `success === false`。**这个测试本身没错**（它如实记录了现状），但会让后续修复者以为这是期望行为。
- 建议：单独立项（P2）——要么给占位项目一个非空 `path`（例如 `""` 语义改为 `webUrl` 派生值），要么在 `projects:save` 里允许 `path === "" && webUrl` 的占位记录，并在测试里把「现状」与「期望」分开写。

### 6.3 【P2】`backups:create` / `backups:restore` 未接入 pathPolicy

- 这两个通道能读写任意目录：`createBackup` 用 `assertDirectory(sourcePath)`（`serviceUtils.ts:87-96`，只 `stat` 不判根/UNC），`restoreBackup` 只判「可读 / 可写 / 空目录」。
- 后果：① 可把任意目录（含 `C:\Users\...`、UNC 共享）打成 zip；② 可把任意 zip 解到任意空目录（含 UNC）；③ zip 成员路径是否穿越取决于 bsdtar，主进程没有二次校验。
- 建议：`backups:create` 的 `sourcePath` 用 `projectPathRoots()`，`targetDirectory` 用 `exportPathRoots()`；`backups:restore` 的 `targetDirectory` 用 `exportPathRoots()`，`archivePath` 至少要求本地绝对路径（拒绝 UNC）并考虑校验 tar 成员清单。

### 6.4 【P2】`settings:save` 可作为 `operations:export` 的根扩展器

`exportPathRoots()` 读取 `loadSettings().defaultBackupDirectory`。渲染层先 `settings:save` 把 `defaultBackupDirectory` 改成任意本地目录，随后 `operations:export` 即可写入该目录。虽然只是导出 CSV（危害有限），但它让「导出根」不再可信。建议让导出目录只接受 `selectDirectory` 会话根，不读设置项（或对设置项做同样的 `assertLocalAbsolutePath` + 根校验）。

### 6.5 【P2 / UX】`selectDirectory` 返回值校验改为"抛错"而非"返回 null"，6 个调用点没有 try/catch

- `ipc.ts:222` 对非法选择（UNC / 含 `..` / 保留设备名）直接 `throw PathPolicyError`。
- 渲染层 9 个 `selectDirectory` 调用点中，只有 3 个在 `try` 内（`BackupsWorkspace.tsx:38/64`、`LogsWorkspace.tsx:54`）；其余 6 个（`useImportFlow.ts:53/112/215`、`useRemotes.ts:300`、`useProjects.ts:180`、`settings/AppSettingsTab.tsx:29`）在 `try` 外，用户一旦在对话框里选中网络共享，表现为**无任何提示的未处理 Promise 拒绝**，功能静默失效。
- 建议：`selectDirectory` 对非法返回值改为 `return null`（保持"用户取消"同一语义，安全收益不变，因为真正的边界在返回值被后续使用时），或在这 6 个调用点补 `try/catch` + 提示。

### 6.6 【信息】UNC 项目不再可用（设计取舍，需记录）

- 之前用户可以选中 `\\server\share\repo` 作为项目目录；现在 `selectDirectory` 直接拒绝，`projects:inspect` 等也拒绝。
- 这是 A-11 的**有意行为**（SMB 出站认证 → Net-NTLMv2 泄露）。若产品需要支持网络项目，应改为「映射盘符（`Z:\...`）可用、UNC 不可用」并在 UI 文案里说明，而不是悄悄失败。

### 6.7 【信息】`homedir()` 作为默认根放行面偏大

`collectAllowedRoots` 无条件加入用户主目录（`pathPolicy.ts:130-135`）。这意味着 `C:\Users\<me>\...` 下所有目录（含 `Documents`、`AppData\Local\Temp`、浏览器配置）对 `git:*`/`projects:*` 通道放行。注释里已说明这是有意的信任边界，但建议在安全评审中显式记录：**该策略把「用户所有文件」列为可读/可写面**，只对「系统目录 / 其他用户 / 网络共享」生效。

### 6.8 【低】会话根 FIFO 上限 64 的边界行为

`MAX_SESSION_DIRECTORIES = 64`（`ipc.ts:118-134`），超过后最早的选择被丢弃。长驻进程里连续选择 >64 个目录后，早期选择的目录会突然被拒。影响很小（用户重选即可），但错误文案是「路径不在允许范围内」，容易被误读成"目录被删了"。建议文案区分「会话选择已过期，请重新选择目录」。

### 6.9 【低】注释与实现的一处措辞不精确

`useRemotes.ts:328` 注释写「快照缺字段时退回『未克隆』侧的默认值（clean / 未扫描 / 已克隆 / 刚刚）」。「未克隆」不是这一分支的语义（clean 是状态、刚刚是时间），实际值是工厂默认。建议改为「退回工厂默认值」。**不影响行为**，其余注释（含 `schemas.ts` 收窄说明、`pathPolicy.ts` 各 why 注释）与实现一致。

---

## 7. 后门封堵与增量校验复验（第二轮返修，2026-11-21 晚）

### 7.1 改动落点（读代码确认）

| 位置 | 内容 |
| --- | --- |
| `pathPolicy.ts:131-154` | `assertRegistrableProjectPath`：①复用 `assertLocalAbsolutePath`（UNC/相对/`..`/设备名）②拒盘符根（`win32.parse(resolved).root === resolved`）③必须存在（`existsSync`）④必须是目录（`statSync().isDirectory()`，catch 归为「无法访问」）⑤拒绝系统关键目录（`SystemRoot`/`windir`/`ProgramFiles`/`ProgramFiles(x86)`/`ProgramData` 及其子目录） |
| `pathPolicy.ts:300-308` | `systemCriticalRoots()` 从 `process.env` 现取；缺失/空值项跳过（注释已声明「缺失不会让校验空转」） |
| `pathPolicy.ts:284-293` | `findContainingRoot(target, roots)`：**唯一**的包含判定入口，内部用 `isWithinRoot`（`win32.relative`，`:318-328`） |
| `pathPolicy.ts:102-112` | `assertPathAllowed` 改为 `findContainingRoot(resolvedTarget, roots) !== null` —— 与登记门**共用同一套 relative 判断**，放行/拒绝对称（第一轮 `C:\data-evil`、`C:\datax` 前缀用例仍全绿，见 §5.2） |
| `pathPolicy.ts:170-202` | `pathsNeedingValidation` + `normalizePathKey`：`/`→`\`、去掉非盘符根的尾随分隔符、`toLowerCase()`、**不 resolve**（`..`/相对路径原样留给登记门拒绝） |
| `ipc.ts:398-421` | `projects:save`：`requireString(workspaceId)` → `parseOrThrow(projectsSchema)` → 读现有路径 `loadWorkspaceProjects(workspaceId).map(p => p.path)` → `pathsNeedingValidation(parsed, existingPaths)` → 逐条 `assertRegistrableProjectPath`（失败包装为 `PathPolicyError` 并带上路径）→ **最后**才 `saveProjects` |
| `ipc.ts:8-15` | 新增 import：`assertRegistrableProjectPath`、`pathsNeedingValidation`、`PathPolicyError` |

顺序结论（对应任务「读 ipc.ts」要求）：**schema 先于路径校验、校验先于落库**；任一差集路径失败即抛错，`saveProjects` 从未被调用，故不存在部分写入（§7.3 S6 实测）。
`assertPathAllowed` 的 33 个调用点数量与第一轮一致（`assertPathAllowed(|requireAllowedProjectPath(|assertLocalAbsolutePath(` 共 37 行命中，含定义与辅助函数），**没有为了新特性删掉既有校验**。

### 7.2 实测 I：`assertRegistrableProjectPath`（27 项，26 PASS + 1 项刻意设计的"理想值"FAIL）

探针：`%TEMP%\a11-verify2\repair.probe.mjs`，直接 import 仓库 `pathPolicy.ts`（`E2F1F6A9…42AA`），`node --experimental-strip-types`。

| 输入 | 期望 | 实测输出 | 结果 |
| --- | --- | --- | --- |
| `%SystemRoot%\System32` | 拒绝 | `项目路径位于系统关键目录（C:\Windows）之下` | PASS |
| `C:\` | 拒绝 | `项目路径不能是磁盘根目录` | PASS |
| `D:\` | 拒绝 | `项目路径不能是磁盘根目录` | PASS |
| `D:\no-such-dir` | 拒绝 | `项目路径不存在` | PASS |
| `%ProgramFiles%` | 拒绝 | `项目路径位于系统关键目录（C:\Program Files）之下` | PASS |
| `%ProgramData%` | 拒绝 | `项目路径位于系统关键目录（C:\ProgramData）之下` | PASS |
| `%SystemRoot%\NoSuchDir12345` | 拒绝 | `项目路径不存在`（存在性判定先于关键目录判定，仍为拒绝） | PASS |
| UNC / 相对 / 含 `..` / `CON` | 拒绝 | `UNC` / `必须是绝对路径` / `上级目录（..）` / `保留设备名` | PASS |
| `%TEMP%` 下新建目录 | 放行 | `"C:\Users\…\Temp\gitool-repair-ok-rnqRzm"` | PASS |
| `%TEMP%` 本身 | 放行 | `"C:\Users\…\Temp"` | PASS |
| 普通文件 `readme.md` | 拒绝 | `项目路径不是目录` | PASS |
| 自建 junction → `%SystemRoot%\System32` | 理想值：拒绝 | **放行**（`fs.realpathSync` = `C:\Windows\System32`） | FAIL（见 §7.6-c） |

> 这一行 FAIL 是**刻意以"理想值"标定的对抗项**，用于暴露 junction 解析不一致，不是四条拒绝逻辑失效；四条拒绝 + 存在性 + 目录性 + 关键目录全部按预期工作。

### 7.3 实测 II：`projects:save` 全流程（9/9 PASS，含"零部分写入"与"离线不阻断"）

探针：`%TEMP%\a11-verify2\handler.probe.mjs`。handler body **逐行复制自 `ipc.ts:398-421`**（仅把 `loadWorkspaceProjects`/`saveProjects` 换成内存版，语义与 `storage/projects.ts` 一致），路径校验与 schema 用**仓库真实源码**。
> 环境约束（如实记录）：本沙箱无 Electron 运行时，无法直接调用注册后的 handler；故用"逐行副本 + 真实依赖"执行，并另以代码阅读确认副本与源码一致（§7.1 行号对照）。

| # | 场景 | 期望 | 实测 | 结果 |
| --- | --- | --- | --- | --- |
| S1 | 既有 `Z:\offline\project` + 仅改别名/收藏 | 成功，不 stat 离线路径 | 成功，`name/favorite` 已更新 | PASS |
| S2 | 新增 `%SystemRoot%\System32` | 拒绝 + 落库零变化 | `无法登记项目路径「C:\Windows\System32」：…系统关键目录…`｜store 未变=true | PASS |
| S3 | 新增 `C:\` | 拒绝 + 零变化 | `…不能是磁盘根目录`｜store 未变=true | PASS |
| S4 | 新增 `D:\no-such-dir` | 拒绝 + 零变化 | `…项目路径不存在`｜store 未变=true | PASS |
| S5 | 离线项目 + 合法新目录 | 成功（2 条） | 2 条：`["Z:\offline\project", "C:\…\Temp\gitool-repair-save-…"]` | PASS |
| S6 | 合法新目录在前 + 非法 `C:\` 在后 | 拒绝且**不部分写入** | 拒绝，store 未变=true | PASS |
| S7 | 同 id 换到 `D:\no-such-dir-2` | 校验新路径并拒绝 | `…项目路径不存在`｜store 未变=true | PASS |
| S8 | 非法 `status` | 在路径校验**之前**失败 | `项目数据：项目状态无效`｜store 未变=true | PASS |
| S9 | `path: ""`（远程收藏占位） | schema 拒绝（既有契约未变） | `项目数据：项目路径不能为空` | PASS |

### 7.4 实测 III：`pathsNeedingValidation` 归一化语义（12 项全 PASS）

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| existing `{Z:\offline\project}` + incoming `[Z:\offline\project, 合法新目录]` | 只返回新目录 | `["C:\…\Temp\gitool-repair-new-…"]` ✓ |
| 反证：同一条离线路径走全量校验 | 抛「不存在」 | `项目路径不存在` ✓（证明差集确实跳过了 stat） |
| existing 标准写法 / incoming `c:/work/demo/` | 同一路径 → `[]` | `[]` ✓ |
| existing `c:/work/demo/` / incoming `C:\WORK\DEMO` | 同一路径 → `[]` | `[]` ✓ |
| existing `C:\WORK\DEMO\` / incoming `c:\work\demo` | 同一路径 → `[]` | `[]` ✓ |
| 同 id 换 path `D:\new-place` | 需校验 | `["D:\new-place"]` ✓ |
| 批内重复（大小写/斜杠不同） | 去重为 1 条 | 2 条输入去重为 `C:\work\a`、`C:\work\b` ✓ |
| 盘符根 `C:\` vs existing `C:\work` | 不同键 | `["C:\"]` ✓ |
| `C:\work\..\Windows` vs existing `C:\Windows` | **不 resolve**、判为新路径 | `["C:\work\..\Windows"]` ✓，且随后被登记门以「上级目录」拒绝 ✓ |
| 空字符串既有时不重复校验 / 新出现时被拒 | `[]` / 抛「不能为空」 | `[]` / `PathPolicyError: 项目路径不能为空` ✓ |

归一化实现与声明一致：`/`→`\`、非盘符根去尾随 `\`、`toLowerCase()`、**无 `resolve`**（`pathPolicy.ts:198-202`）。这条"不 resolve"很关键：否则 `C:\work\..\Windows` 会被 cwd 语义解析成 `C:\Windows` 而被误判为"既有路径"，直接跳过校验。

### 7.5 门禁 / 计数 / 扫尾（本轮实测）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 全量单测 | `npx vitest run` | **392 passed (392) / 34 files**（复现实现方声称的 392） |
| `pathPolicy.test.ts` 单文件 | `npx vitest run electron/main/services/pathPolicy.test.ts` | **39 passed (39)**（复现"39 条"；28 + 新增 11） |
| 类型检查 | `npx tsc -b` / `npx tsc -p tsconfig.electron.json` | `0` / `0` |
| 构建 | `npm run build` | `BUILD=0`（`dist-electron/main.cjs 218.54 kB`） |
| 格式 | `npx prettier --check --end-of-line auto <10 个改动文件>` | `All matched files use Prettier code style!` |
| handler 计数 | `(Select-String -Path electron\main\ipc.ts -Pattern 'ipcMain\.handle\("' -AllMatches).Count` | **76**（无增删） |
| 扫尾 | `git status --porcelain` | 6 M + 5 ?? = **10 个实现方文件 + 本报告**；仓库内无探针脚本、无 `.resultverify`、`dist*` 均被 `.gitignore` 忽略 |

### 7.6 剩余风险（本轮未封堵，按严重度）

| 编号 | 风险 | 实测/证据 | 评级 | 建议 |
| --- | --- | --- | --- | --- |
| a | **历史脏数据不重校验**：只校验差集，库里已存在的非法路径（旧版本写进去的 `C:\Windows\System32`）不会被重新审视 | 代码事实（`pathsNeedingValidation` 只看 incoming 与 existing 的差）；实测 S1 证明既有路径完全跳过 | P2 | 升级时做一次性审计迁移（扫描全部 workspace 的 path 过一遍登记门，命中则标记/移除并提示用户） |
| b | **自登记"用户自己的任意目录"仍可行**（设计已声明，非缺陷） | `%TEMP%` 实测放行；`pathPolicy.ts:127-129` 注释明确「挡不住登记用户自己的任意目录，闭环需 provenance」 | P2 | 引入"路径来源凭证"：只允许 `selectDirectory`/`clone`/`init` 产生的路径登记（主进程生成一次性令牌或可信根表） |
| c | **junction / TOCTOU 解析不一致**：判定用字面路径，操作系统解析用真实路径 | 实测：自建 junction→`System32` 被放行；**Windows 内置** `C:\Users\All Users`（→`C:\ProgramData`）、`C:\Documents and Settings`（→`C:\Users`）也被放行；`existsSync`→`statSync` 之间存在竞态窗口（注释已承认） | P3（需已存在 junction 或本机写权限，渲染层无法自建） | 登记时用 `fs.realpathSync` 得到真实路径后再过一次关键目录判定（不存在路径先 `existsSync`），并把真实路径落库；或对 system 关键目录改用 `realpath` 归一的比较 |
| d | `backups:create` / `backups:restore`、`settings:save`、`tasks:saveProfile` 仍未接入路径策略（上轮 §6.3/6.4/6.2） | 本轮未改动这些通道（diff 只在 `projects:save` 与 `pathPolicy`） | P2 | 按 §6.3 建议分通道接入；`backups:restore` 优先（任意空目录解压） |
| e | 空路径远程占位项目仍无法落库（既有缺陷，非回归） | 实测 S9：`项目路径不能为空`；`entities.test.ts:98-105` 锁定该现状 | P2 | 与 §6.2 同 |

### 7.7 对抗检查（本轮重扫，含未跟踪文件）

上一轮的 `git grep -- '*.test.ts'` 有盲区：**git grep 默认不扫未跟踪文件**，而本轮新增的 `pathPolicy.test.ts` 尚未跟踪。本轮改用 `Select-String` 扫全部 `*.test.ts(x)`：

| 检查 | 结果 |
| --- | --- |
| `.skip` / `.only` / `.todo` | 仅 1 处条件平台守卫：`pathPolicy.test.ts:249` `describeOnWindows = platform === "win32" ? describe : describe.skip`（Windows 上**真实执行**，已用 39/39 证明；非偷懒跳过） |
| `it.runIf` | 1 处：`pathPolicy.test.ts:237`，win32 下执行 |
| 空断言 / 恒真断言 | 2 处 `toBeTruthy()`：`tasks.test.ts:153`、`navigation.test.ts:56`，**HEAD 已存在**（`git show HEAD:` 可查），非本批引入，且都是真实条件断言（非 `expect(true)`） |
| 为达标放宽 | 新增 11 条用例全部是"应拒绝/应放行"的实断言；`git diff` 中无删除既有用例；用例总数 381 → 392（+11） |
| 注释与实现不符 | `assertRegistrableProjectPath` 的"四条拒绝"、"不 resolve"、"差集只看新路径"、"纵深防御非强边界"四条注释均与实现/实测一致；唯一不精确处仍是 §6.9 的措辞（不影响行为） |

> 顺带修正：上一轮 §8 表中"skip/only 0 命中"的结论当时只覆盖**已跟踪**文件，本轮已按全量重扫并给出上表结果。

---

## 8. 对抗性检查（空断言 / skip / 放宽）

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| `it.skip` / `describe.skip` / `it.only` / `it.todo` | 第一轮：`git grep -E '\.(skip|only|todo)\('` 全仓 `*.test.ts(x)` | **0 命中**（仅覆盖已跟踪文件；第二轮已用 `Select-String` 全量重扫补正，见 §7.7） |
| 空断言 / 恒真断言 | 第一轮：`git grep -E 'expect\((true\|1)\)\.toBe\|expect\([^)]*\)\.toBeTruthy\(\)'` | 该正则的 `[^)]*` 无法跨越嵌套括号，且 `git grep -- '*.test.ts'` 不匹配嵌套路径 → 「0 命中」不可靠；第二轮已用 `Select-String` 全量重扫，只发现 2 处 HEAD 既有的 `toBeTruthy()`（`tasks.test.ts:153`、`navigation.test.ts:56`，均非空断言），见 §7.7 |
| 为达标删测试/改宽断言 | `git diff electron/main/ipc/schemas.test.ts`、`git diff --stat` | 断言由「应兜底」翻转为「应报错」，无删除；全量用例数 381 → 392（第二轮 +11，只增不减） |
| 测试是否真跑（而非 mock 掉被测物） | `pathPolicy.test.ts` 直接 import 实现；`entities.test.ts` 直接 import 真实 zod schema | 真实 |
| 注释与实现不符 | 逐条核对 `entities.ts`、`pathPolicy.ts`、`useRemotes.ts`、`useImportFlow.ts`、`schemas.ts` 注释 | 1 处措辞不精确（6.9），无实质不符 |
| 统计口径是否被"美化" | 独立统计 `ipcMain.handle` 数量、`status: "clean"` 分布、路径校验点数量 | 76 / 0 / 33 均与实现方声明一致；Project 字段数 19（票面 20，票面笔误） |
| `it.runIf` 是否等于跳过 | `pathPolicy.test.ts:234` 为 `it.runIf(process.platform === "win32")` | 当前平台 win32，**实际执行**（28 条全跑） |

---

## 9. 复核命令（可原样重放）

```powershell
# 门禁
npx vitest run
npx tsc -b
npx tsc -p tsconfig.electron.json
npm run build
npx prettier --check --end-of-line auto electron/main/ipc.ts electron/main/ipc/schemas.ts `
  electron/main/ipc/schemas.test.ts electron/main/services/pathPolicy.ts `
  electron/main/services/pathPolicy.test.ts shared/entities.ts shared/entities.test.ts `
  src/components/TasksWorkspace.tsx src/hooks/useImportFlow.ts src/hooks/useRemotes.ts

# 计数 / 对抗（注意：git grep 默认不扫未跟踪文件，新增测试需用 Select-String）
(Select-String -Path electron\main\ipc.ts -Pattern 'ipcMain\.handle\("' -AllMatches).Count   # 76（两轮一致）
git grep -n --no-color 'status: .clean.' -- src electron shared                              # 生产 0
Get-ChildItem -Recurse -Include *.test.ts,*.test.tsx -File src,electron,shared |
  Select-String -Pattern '\.(skip|only|todo)\b|runIf|toBeTruthy\(\)'                          # 见 §7.7

# 第一轮探针（%TEMP%\a11-verify，验证后已按沙箱规范删除，命令保留作重放参考）
node --experimental-strip-types "$env:TEMP\a11-verify\pathpolicy.probe.mjs"   # 51/51
node --experimental-strip-types "$env:TEMP\a11-verify\entities.probe.mjs"     # 29/29
node --experimental-strip-types "$env:TEMP\a11-verify\reverse.probe.mjs"      # 8/8
node --experimental-strip-types "$env:TEMP\a11-verify\bypass.probe.mjs"       # 4/4

# 第二轮返修探针（%TEMP%\a11-verify2，需先跑 setup.cjs 装配只读副本 + node_modules Junction）
node "$env:TEMP\a11-verify2\setup.cjs"
node --experimental-strip-types "$env:TEMP\a11-verify2\repair.probe.mjs"       # 27 项：26 PASS + 1 junction 对抗 FAIL
node --experimental-strip-types "$env:TEMP\a11-verify2\handler.probe.mjs"      # 9/9
node --experimental-strip-types "$env:TEMP\a11-verify2\junction214.probe.mjs"  # 3 条内置 junction 探测
```

第一轮执行量：门禁 381 条单测 + 探针 92 条断言 = **473 条真实执行检查**，FAIL = 0。
第二轮执行量：门禁 **392** 条单测 + 探针 **39** 条断言（27 + 9 + 3）= **431 条真实执行检查**，其中 1 条为刻意标定的 junction"理想值"（暴露 P3 残留，非实现回归）。
两轮合计 **904** 条执行检查，实现缺陷 0、门禁回归 0。
（探针在 `%TEMP%` 下运行，`proj\` 子目录是通过 Junction 复用仓库 `node_modules` 的只读副本；**每轮结束后临时目录均已按沙箱规范自清理删除**，脚本产物与输出记录保留在本文表格中。验证前后 `git status --porcelain` 一致，除本文件外无新增改动。）

---

## 10. 结构化判定（等价 `.resultverify/general_verification_result.json`）

```json
{
  "checks": [
    {
      "target": "shared/entities.ts createProject/createTaskProfile 字段完整性",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/entities.probe.mjs",
      "output_observed": "{\"pass\":29,\"fail\":0}; PASS Project 必填 16 字段无 undefined …; PASS Project 字段总数 期望=19 实际=19; PASS TaskProfile 字段总数 期望=10 实际=10",
      "expected_vs_actual": "期望 Project 全部必填字段无 undefined、TaskProfile 10 字段齐全；实际完全一致。票面称 Project 20 字段，实测类型为 19 字段（票面笔误）",
      "atomic_result": "PASS"
    },
    {
      "target": "A-15 6 处 Project + 1 处 TaskProfile 字面量逐字段等价",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/entities.probe.mjs（复刻 HEAD 字面量后全字段比较，含快照 undefined/空串/齐备三分支）",
      "output_observed": "PASS 场景1/1b/2/3/3b/3c/4/5/6/6b/6c/7 全部 期望=0 处差异 实际=[]",
      "expected_vs_actual": "期望逐字段零差异；实际 12 个场景全部零差异。唯一结构差异是 remote/alias 可选键存在且值为 undefined（JSON 落库一致，无消费方依赖键存在性）",
      "atomic_result": "PASS"
    },
    {
      "target": "projectSchema/taskProfileSchema 业务字段收窄 + 反向测试",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/reverse.probe.mjs",
      "output_observed": "PASS project.name 空串=false; path 空串=false; id 非字符串=false; summary 非字符串=true(兜底); task.id 空白=false; workingDirectory 空串=false; name 非字符串=false; projectPath 空串=false; fail=0",
      "expected_vs_actual": "期望业务字段非法即失败、展示字段仍兜底；实际一致。另：status=weird/provider=bitbucket/tags=[1]/favorite=yes/缺 status 均 false；languageColor=1/files=null 仍兜底",
      "atomic_result": "PASS"
    },
    {
      "target": "生产代码 status: \"clean\" 默认点",
      "command_run": "git grep -n --no-color 'status: .clean.' -- src electron shared; git grep … HEAD",
      "output_observed": "HEAD: 生产 6 处（含 2 处 snapshot?.status ?? \"clean\"）；工作区: 生产 0 处；测试文件 7 处（新增 1 处 schemas.test.ts:97）",
      "expected_vs_actual": "期望生产代码 0 处；实际 0 处。票面『测试夹具=3』按『新增夹具隐式走默认 clean』口径成立（FULL_PROJECT/最小种子/收藏占位）",
      "atomic_result": "PASS"
    },
    {
      "target": "投影测试真实性（entities.test.ts 是否真实过 zod）",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/entities.probe.mjs（独立 import 真实 projectSchema）",
      "output_observed": "PASS 投影：最小种子过 projectSchema 期望=true 实际=true；测试源码 import 自 electron/main/ipc/schemas（非 mock）",
      "expected_vs_actual": "期望真实 schema + safeParse.success 断言；实际确认，且额外有 parsed 深等于工厂产物的断言",
      "atomic_result": "PASS"
    },
    {
      "target": "pathPolicy 边界（UNC/相对/穿越/设备名/控制字符/前缀撞名/大小写/尾随分隔符/..cache）",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/pathpolicy.probe.mjs",
      "output_observed": "{\"pass\":51,\"fail\":0}, EXIT=0；C:\\data-evil 与 C:\\DATA-EVIL 均『路径不在允许范围内』；\\evil\\share → 『不支持网络共享路径（UNC）』；C:\\data\\..cache\\x 放行",
      "expected_vs_actual": "期望全部按策略拒绝/放行；实际 51/51 一致，含 UNC 先于绝对路径判定的专项断言",
      "atomic_result": "PASS"
    },
    {
      "target": "assertPathAllowed 是否用 path.relative（非 startsWith）",
      "command_run": "读 electron/main/services/pathPolicy.ts:203-213 + 上述实测 C:\\data-evil / C:\\datax / C:\\data2 用例",
      "output_observed": "isWithinRoot 使用 win32.relative(root.toLowerCase(), targetKey)，并排除 '..' / '..\\' / 绝对相对值；前缀撞名目录全部被拒",
      "expected_vs_actual": "期望 relative 语义；实际一致（若为 startsWith，C:\\data-evil 会被放行，实测被拒）",
      "atomic_result": "PASS"
    },
    {
      "target": "路径校验接入点扫描（git:*/projects:*/shell:*/operations:export）",
      "command_run": "Select-String -Path electron\\main\\ipc.ts -Pattern 'assertPathAllowed\\(|requireAllowedProjectPath\\(|assertLocalAbsolutePath\\('",
      "output_observed": "33 次 assertPathAllowed 调用覆盖 32 个通道 + selectDirectory 返回值校验（ipc.ts:222）与默认路径安全化（辅助函数 ipc.ts:573 / 调用点 ipc.ts:211）；git:* 15 个全部覆盖、projects:* 路径类 13 个全部覆盖、shell:* 路径类 3 个覆盖",
      "expected_vs_actual": "期望 33 个校验点、无漏；实际 33 个，未覆盖通道集中在 projects:save / backups:* / settings:save / tasks:saveProfile（见风险）",
      "atomic_result": "PASS"
    },
    {
      "target": "正常路径不误杀（已登记项目 + selectDirectory 返回值）",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/pathpolicy.probe.mjs（模拟 roots）",
      "output_observed": "PASS D:\\Projects\\demo-app(及子文件) / E:\\WorkDir\\2026(及子目录) / C:\\Users\\tester\\Documents\\new 全部放行；C:\\Windows\\System32 拒绝",
      "expected_vs_actual": "期望合法流程全部放行；实际一致",
      "atomic_result": "PASS"
    },
    {
      "target": "handler 计数",
      "command_run": "(Select-String -Path electron\\main\\ipc.ts -Pattern 'ipcMain\\.handle\\(\"' -AllMatches).Count",
      "output_observed": "76",
      "expected_vs_actual": "期望 76（与 HEAD 一致）；实际 76，diff 中无 handler 增删",
      "atomic_result": "PASS"
    },
    {
      "target": "门禁：vitest / tsc×2 / build / prettier",
      "command_run": "npx vitest run; npx tsc -b; npx tsc -p tsconfig.electron.json; npm run build; npx prettier --check --end-of-line auto <改动文件>",
      "output_observed": "Tests 381 passed (381) / 34 files；tsc×2 EXIT=0；BUILD_EXIT=0；All matched files use Prettier code style!",
      "expected_vs_actual": "期望 ≥381 且全部为绿；实际 381 全绿，五项均 0 退出",
      "atomic_result": "PASS"
    },
    {
      "target": "对抗检查：skip/only/空断言/放宽断言",
      "command_run": "git grep -E '\\.(skip|only|todo)\\(' -- '*.test.ts' '*.test.tsx'; git grep -E 'expect\\((true|1)\\)\\.toBe' …",
      "output_observed": "0 命中；schemas.test.ts 断言由『应兜底』翻转为『应报错』，无删除",
      "expected_vs_actual": "期望无跳过、无空断言、无用放宽凑绿；实际符合",
      "atomic_result": "PASS"
    },
    {
      "target": "（第一轮历史证据）风险确认：projects:save 是否可自登记任意目录（白名单绕过）",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify/bypass.probe.mjs",
      "output_observed": "PASS projects:save 接受 path=C:\\Windows\\System32=true; 自登记后该目录下路径被放行=true; UNC 自登记仍被拒(schema=true, allow=false); 空路径占位被拒(false: 项目路径不能为空)",
      "expected_vs_actual": "第一轮确认为 P1 缺陷（本地任意目录可绕过，UNC 不可绕过）。第二轮返修已封堵，复验见下方三条 checks",
      "atomic_result": "PASS"
    },
    {
      "target": "（第二轮）assertRegistrableProjectPath 四条拒绝 + 合法目录放行",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify2/repair.probe.mjs",
      "output_observed": "{\"pass\":26,\"fail\":1}; %SystemRoot%\\System32 → 位于系统关键目录（C:\\Windows）之下; C:\\ → 不能是磁盘根目录; D:\\no-such-dir → 不存在; %TEMP% 新建目录 → 放行 C:\\Users\\…\\Temp\\gitool-repair-ok-…; 普通文件 → 不是目录; 唯一 fail 为刻意标定的 junction 对抗项",
      "expected_vs_actual": "期望四条拒绝生效、合法目录放行；实际 26/27 符合，1 条为 junction 解析不一致的已知残留（P3，见 §7.6-c），非拒绝逻辑失效",
      "atomic_result": "PASS"
    },
    {
      "target": "（第二轮）pathsNeedingValidation 增量语义（离线盘不阻断 / 归一化 / 换路径校验 / 不 resolve）",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify2/repair.probe.mjs",
      "output_observed": "existing{Z:\\offline\\project} + incoming 同路径与合法新目录 → 只返回新目录；three-way 大小写/斜杠/尾随差异 → []；同 id 换 path → [D:\\new-place]；C:\\work\\..\\Windows 不 resolve → 保留并随后被拒；离线路径走全量校验 → 抛「不存在」",
      "expected_vs_actual": "期望只校验差集且归一化正确、不做 resolve；实际 12/12 一致",
      "atomic_result": "PASS"
    },
    {
      "target": "（第二轮）projects:save 全流程：拒绝系统目录/盘符根/不存在路径、离线不阻断、零部分写入",
      "command_run": "node --experimental-strip-types %TEMP%/a11-verify2/handler.probe.mjs（handler body 逐行复制自 ipc.ts:398-421）",
      "output_observed": "{\"pass\":9,\"fail\":0}; S2/S3/S4 拒绝且 store 未变=true; S1 离线路径+改别名成功; S5 离线+合法新目录成功(2 条); S6 合法+非法混合 → 拒绝且 store 未变=true; S7 同 id 换不存在路径 → 拒绝; S8 非法 status 在路径校验前失败",
      "expected_vs_actual": "期望差集校验、失败即零写入、离线不阻断；实际 9/9 一致（Electron 运行时缺失为环境约束，已用逐行副本 + 真实 schema/pathPolicy 执行并代码对照）",
      "atomic_result": "PASS"
    },
    {
      "target": "（第二轮）门禁 / handler 计数 / 扫尾",
      "command_run": "npx vitest run; npx vitest run electron/main/services/pathPolicy.test.ts; npx tsc -b; npx tsc -p tsconfig.electron.json; npm run build; npx prettier --check --end-of-line auto <10 文件>; (Select-String -Path electron\\main\\ipc.ts -Pattern 'ipcMain\\.handle\\(\"' -AllMatches).Count; git status --porcelain",
      "output_observed": "Tests 392 passed (392)/34 files; pathPolicy 39 passed (39); tsc 0/0; BUILD=0; All matched files use Prettier code style!; 76; porcelain = 6 M + 5 ?? （10 个实现方文件 + 本报告）",
      "expected_vs_actual": "期望 ≥392、双 tsc 0、build 0、prettier 0、handler 76、无多余产物；实际全部一致（复现实现方声称的 392 / 39 / 76）",
      "atomic_result": "PASS"
    }
  ],
  "final_verdict": "PASS"
}
```

> 说明：`final_verdict = PASS` 指**两轮验证范围内（A-15 实体工厂 + A-11 路径策略 + `projects:save` 登记门/增量校验 + 门禁）全部通过**。
> 第一轮的 P1（`projects:save` 自登记系统目录）已由第二轮返修封堵并经 §7 实测复验（`%SystemRoot%\System32`、`C:\`、不存在目录均拒绝，且落库零变化），因此结论由「可提交但需跟进 P1」升级为**最终可提交**。
> 仍未封堵的是 §7.6 列出的 P2/P3 残留：历史脏数据不重校验、用户自己任意目录仍可登记（注释已声明，需 provenance 才能闭环）、junction/TOCTOU 解析不一致、`backups:*`/`settings:save`/`tasks:saveProfile` 未接入路径策略、空路径远程占位无法落库。这些**不阻塞本批合并**，但应登记为后续批次任务。