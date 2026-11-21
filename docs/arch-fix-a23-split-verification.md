# A-23 拆分独立验证报告（git.ts → git/ 12 模块）

- 验证对象：`electron/main/services/git.ts`（HEAD `cdc50c8`，1136 行）→ `electron/main/services/git/{binary,branch,clone,compare,core,disk,history,index,operation,repo,status,tags}.ts`
- 验证者：独立验证 Agent（未参与实现，未修改任何业务代码）
- 验证时间：2026-11-21
- 唯一写入文件：本报告
- 交叉基准：`git show HEAD:electron/main/services/git.ts`（拆分前版本）

---

## 〇、结论

**结论：可提交（P0/P1 = 0），但需同步修 2 处非阻塞项（P2 文档口径、P3 格式化）。**

| 维度 | 判定 | 依据 |
| --- | --- | --- |
| 行为等价 | **PASS** | 42 个顶层函数中 20 个归一化后逐 token 完全一致；其余 22 个差异**全部**是「内联参数数组 → `buildXxxArgs` 抽取」，无一行判定条件/分支/返回值被改（见 §5） |
| 导出等价（原符号不丢） | **PASS** | `A \ B = ∅`（31 个原导出全部可从 `git/index.ts` 导入） |
| 导出等价（不扩张） | **FAIL（P2，非行为）** | `B \ A = 33`：32 个新增参数构建器 + `GIT_ARG_CHUNK`（HEAD 中为未导出的内部常量）。属**纯增量**，且 `index.ts` 头注释「零 API 面扩张 / 已公开的 64 个符号」与事实不符 |
| 内部符号封装 | **PASS** | 运行时导出面探针：64 个导出，`runGit / runGitProcess / runGitProcessRaw / MAX_BUFFER / registerProcessStopper / killProcessTree / assertDirectory / computeDiskSize` 全部**未泄漏** |
| 门禁（测试/类型/构建） | **PASS** | 278/278 用例、42/42 参数用例、`tsc -b`、`tsc -p tsconfig.electron.json`、`npm run build` 全部 exit 0 |
| 行数约束 | **PASS** | 12 个文件最大 251 行（≤300） |
| 编码/行尾 | **PASS**（有 P3） | 无 BOM、UTF-8 合法、U+FFFD=0、CRLF 与仓库一致；12 个文件缺文件末尾换行，`prettier --check` 红（CI 未执行该门禁） |
| 模块依赖 | **PASS** | `core` 仅依赖 `binary`；无环；子域不 import `index` |

> 一句话：**逻辑零漂移、测试全绿、可提交**；提交前建议把 `index.ts` 头注释改成事实（64 = 31 原符号 + 33 新增测试护栏符号），并跑一次 `prettier --write`（可选）。

---

## 一、验证方法与环境

| 项 | 值 |
| --- | --- |
| 平台 | Windows / PowerShell 5.1，Node v22.22.2 |
| 仓库 | `D:\github\gitool`，基线 `cdc50c8` |
| 静态对比 | `git show HEAD:electron/main/services/git.ts` 落到 `%TEMP%` 后与拆分后模块做 **token 级 LCS diff**（去注释、去 import/export、压缩空白，字符串字面量原样保留） |
| 运行期证据 | `npx vitest` / `npx tsc` / `npm run build`；另用 `rolldown` 打包真实模块做对抗性探针（非静态推断） |
| 工作区边界 | 未写入/修改任何仓库文件；脚本与产物全部位于 `%TEMP%\gitool-verify-a23`（报告外无仓库写入） |

> 注：角色协议要求的 `.resultverify/general_verification_result.json` 未单独落盘——本任务明确限定「唯一可写文件为 `docs/arch-fix-a23-split-verification.md`」，故按原子测试块格式把等价 JSON 内容内嵌于 §10。

---

## 二、门禁矩阵（6 条必验 + 2 条附加）

| # | 门禁 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| G1 | 旧文件已删除、无残留引用、路径可解析 | `Test-Path electron\main\services\git.ts`；`git grep -n "services/git\.ts"`；`npx tsc -b` | **PASS** | `False`；代码中 0 命中（仅历史 docs 提及）；`tsc -b exit=0` |
| G1b | 调用方仍按旧路径导入并解析到目录 index | `electron/main/ipc.ts:40`、`electron/main/services/environment.ts:8`、`git.test.ts:35`、`gitArgs.test.ts:50` 均为 `from "./services/git"` / `from "./git"` | **PASS** | `tsc` + `npm run build` + `git.test.ts`(5)、`gitArgs.test.ts`(42) 运行期通过 |
| G2 | 每个模块 ≤300 行 | `Get-ChildItem electron\main\services\git -Filter *.ts \| % { "$($_.Name): $((Get-Content $_.FullName).Count)" }` | **PASS** | 最大 `repo.ts: 251`（见 §3） |
| G3 | 导出集合双向等价 | 正则提取 HEAD 导出 + 解析 `index.ts` 具名重导出 + 运行时 `Object.keys(require(bundle))` | **FAIL(部分)** | `A\B = []`；`B\A = 33`（§4，P2，纯增量） |
| G3b | 反向检查：内部符号不得外泄 | 运行时导出面断言（打包后真实 import） | **PASS** | 64 导出中 `runGit/runGitProcess(Raw)/MAX_BUFFER/registerProcessStopper/killProcessTree/assertDirectory/computeDiskSize` 均不存在 |
| G4 | 真跑测试与构建 | `npx vitest run`；`npx vitest run electron/main/services/gitArgs.test.ts`；`npx tsc -b`；`npx tsc -p tsconfig.electron.json`；`npm run build` | **PASS** | 278/278、42/42、exit 0、exit 0、exit 0（§6） |
| G5 | 行为等价（含 5 个重点出口） | token 级 LCS diff + 关键调用点静态核验 | **PASS** | 22 处差异全部为参数抽取；5 个重点核验全过（§5） |
| G6 | 编码与行尾 | 字节级 BOM 检测 + `TextDecoder(fatal)` + CRLF 统计 | **PASS** | BOM 0/12、非法 UTF-8 0/12、U+FFFD 0、CRLF 100%（§7） |
| G7 | 模块依赖方向/无环 | import 图 DFS | **PASS** | `core -> binary` 唯一；0 环；0 反向 import（§8） |
| G8（附加） | 对抗性探针 | rolldown 打包真实模块后执行 9 项边界/幂等断言 | **PASS** | 9/9（§9） |

---

## 三、行数表

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `binary.ts` | 19 | git 可执行文件探测（叶子，无本地依赖） |
| `branch.ts` | 92 | 分支列表/新建/切换/删除 |
| `clone.ts` | 179 | URL/目标校验 + 克隆子进程 + 进度上报 + 进程登记 |
| `compare.ts` | 88 | 版本对比（stat 展示 + numstat 机器解析） |
| `core.ts` | 204 | 执行层双出口、脱敏出口、凭据环境、目录断言、共享参数 |
| `disk.ts` | 130 | 项目体积（TTL 缓存）+ README |
| `history.ts` | 122 | 提交历史/版本列表/revert |
| `index.ts` | 82 | 显式逐符号聚合出口（无 `export *`） |
| `operation.ts` | 111 | fetch/pull/push/sync |
| `repo.ts` | 251 | 识别/init/扫描/setRemoteUrl/搬迁 |
| `status.ts` | 236 | 快照/变更/单文件 diff/暂存/提交 |
| `tags.ts` | 94 | 标签列表/创建/删除 |
| **合计** | **1608** | 拆分前单文件 1136 行（+472，主要为模块头注释与 32 个参数构建器） |

**最大文件：`repo.ts` 251 行**，全部 ≤300。

---

## 四、导出等价性

### 4.1 集合规模

| 集合 | 定义 | 规模 |
| --- | --- | --- |
| A | `git show HEAD:electron/main/services/git.ts` 中 `export function/const/class/interface/type` 名称 | **31** |
| B（静态） | `git/index.ts` 具名重导出解析（无 `export *`，无需展开） | **64** |
| B（运行时） | rolldown 打包 `git/index.ts` 后 `Object.keys()` | **64**（与静态完全一致） |

### 4.2 差集

```
A \ B = []            ← 原 31 个公开符号一个都没丢
B \ A = 33            ← 32 个参数构建器 + GIT_ARG_CHUNK
```

`B \ A` 明细（33）：

```
GIT_ARG_CHUNK, buildOperationCommands, chunkFilesForGitArgs,
buildBranchListArgs, buildCloneArgs, buildCommitArgs, buildCommitHistoryArgs,
buildCreateBranchArgs, buildCreateTagArgs, buildCurrentBranchArgs,
buildDeleteBranchArgs, buildDeleteTagArgs, buildDiffNumstatArgs, buildDiffStatArgs,
buildFetchArgs, buildFileDiffArgs, buildGitCwdArgs, buildInitArgs,
buildLastCommitDateArgs, buildListTagsArgs, buildPullArgs, buildPushArgs,
buildRemoteAddArgs, buildRemoteListArgs, buildRemoteSetUrlArgs, buildRevertArgs,
buildShortHeadArgs, buildStageArgs, buildStatusBranchArgs, buildStatusPorcelainZArgs,
buildSwitchBranchArgs, buildUnstageArgs, buildUntrackedFilesArgs
```

### 4.3 定性

1. **无删除、无重命名、无签名变化**：31 个原符号全部可从 `index.ts` 导入，`ipc.ts`（26 个符号）与 `environment.ts`（`getActiveGitBinary`）无需任何改动。
2. **33 个新增全部是「测试护栏」符号**：`gitArgs.test.ts` 从 `./git` 导入 33 个符号并对整个参数数组做 `toEqual`（42 条用例）。它们是 A-23 计划里「拆分前先补命令拼装测试」的产物。
3. **`GIT_ARG_CHUNK` 是唯一「原内部符号被提升为公开」的**：HEAD 中为 `const GIT_ARG_CHUNK = 200;`（未导出），现由 `core.ts` 导出并经 `index.ts` 公开，供分批单测断言边界值。
4. **头注释与事实不符（P2）**：`index.ts:1-9` 写「只列『拆分前 git.ts 已经公开』的 64 个符号……零 API 面扩张」，但拆分前只有 31 个。注释需改为「31 个原符号 + 33 个拆分同期新增的参数护栏符号」，或把 `gitArgs.test.ts` 改为从子模块导入以保持对外面 31 个。

> 说明：任务要求的「两边差集都为空」在本实现下**不成立**，但差异方向只有「增量」，且增量符号均为纯函数（无副作用、不启动进程），不构成行为风险，故判 P2 而非 P1。

---

## 五、行为等价审查（核心）

### 5.1 对比方法

1. 从 HEAD 文件与 12 个新模块中各抽取**顶层函数**（含 `function` 声明与 `const f = (...) =>`），共 HEAD 42 个 / 新模块 75 个。
2. 归一化（去注释、去 `export`、去 `import` 行、压缩空白、字符串字面量原样保留）后做 **token 级 LCS diff**。
3. 结果：**20 个完全一致**、**22 个存在差异**、**HEAD 有但新模块缺失 = 0**。

### 5.2 完全一致（20）

`getActiveGitBinary`、`inspectLocalProject`、`scanDirectoryForRepositories`、`listVersions`、`revertCommit`、`assertDirectory`、`buildCredentialEnv`、`redactGitOutput`、`assertNoCredentialInUrl`、`assertCloneUrl`、`assertCloneTarget`、`runGitProcess`、`getDiskSize`、`invalidateDiskSizeCache`、`computeDiskSize`、`readProjectReadme`、`moveProject`、`isCrossDeviceError`、`removeQuietly`、`countFiles`

> 其中 `buildCredentialEnv`（含 `GIT_CONFIG_COUNT="2"` + 第 0 条空值重置）、`runGitProcess`（脱敏出口）、`assertNoCredentialInUrl` 三者**逐 token 一致**。

### 5.3 存在差异（22）——全部为「内联参数数组 → 构建器」

| 函数 | 差异内容（HEAD 独有 → NEW 独有） | 判定 |
| --- | --- | --- |
| `initRepository` | `const args=["init","-b",branch]; ...runGitProcess(path,args)` → `buildInitArgs(branch)` | 等价 |
| `getFileDiff` | `["diff","--",toLiteralPathspec(file)]` → `buildFileDiffArgs(file)` | 等价 |
| `setRemoteUrl` | `["remote"]` / `["remote","set-url",…]` / `["remote","add",…]` → 三个 builder | 等价 |
| `listTags` | 内联 `for-each-ref` 格式串 → `buildListTagsArgs()` | 等价（格式串逐字符一致：4 行、`--sort=-creatordate`、`iso8601-strict`、`contents:subject`） |
| `createTag` | `message.length>0 ? ["tag","-a",name,"-m",msg] : ["tag",name]` → `buildCreateTagArgs(name,msg)` | 等价（builder 内保留同一三元） |
| `deleteTag` | `["tag","-d",trimmed]` → `buildDeleteTagArgs(trimmed)` | 等价 |
| `compareVersions` | `const range=\`${base}..${head}\`` + 两个内联数组 → `buildDiffStatArgs/buildDiffNumstatArgs`；**`--numstat` 仍走 `runGitProcessRaw`** | 等价（两点语法、raw 出口均保持） |
| `getProjectSnapshot` | 5 个内联数组 → `buildCurrentBranchArgs/buildStatusBranchArgs/buildShortHeadArgs/buildUntrackedFilesArgs/buildLastCommitDateArgs` | 等价 |
| `runGitOperation` | `OPERATION_COMMANDS[operation]` → `buildOperationCommands(operation)` | 等价（fetch/pull/push/sync 序列逐项一致，`revert` 仍 `undefined`） |
| `listChangedFiles` | `["status","--porcelain=v1","-z"]` → builder | 等价 |
| `stageFiles` | 手写 `for (start=0; start+=GIT_ARG_CHUNK) slice(...)` → `for (const chunk of chunkFilesForGitArgs(files))` + `buildStageArgs` | 等价（切片边界 200、`slice(start,start+200)` 同式） |
| `unstageFiles` | 同上（`restore --staged`） | 等价 |
| `commitChanges` | `["commit", ...buildCommitMessageArgs(message)]` → `buildCommitArgs(message)`；`["rev-parse","--short","HEAD"]` → `buildShortHeadArgs()` | 等价（`buildCommitArgs` 内部仍 spread 同一个 `buildCommitMessageArgs`） |
| `listBranches` | `["branch","-vv"]` → builder | 等价 |
| `createBranch` | `["checkout","-b",name]` → builder | 等价 |
| `switchBranch` | `["checkout",name]` → builder | 等价 |
| `deleteBranch` | `["branch","--show-current"]` / `["branch","-D",name]` → 两个 builder | 等价 |
| `listCommitHistory` | `["log", \`-n ${limit}\`, format]` → `buildCommitHistoryArgs(limit)` | 等价（`-n ${limit}` 仍是带空格的单参数，未「顺手修」） |
| `commitRevertProcess` | `["-C",path,"revert","--no-edit",hash]` → `buildRevertArgs(path,hash)` | 等价（`-C` 仍在最前） |
| `cloneRepository` | `const args=["clone","--progress"]; args.push("--",url,targetPath)` → `buildCloneArgs(url,targetPath)` | 等价（顺序 `clone,--progress,--,url,target` 一致；`--` 恰 1 个） |
| `runGit` | `["-C",cwd,...args]` → `buildGitCwdArgs(cwd,args)` | 等价 |
| `runGitProcessRaw` | 同上 | 等价（**未脱敏**语义不变） |

**新增顶层函数 33 个**：32 个参数构建器 + `compareRange`（私有，未导出）。

### 5.4 五个重点核验

| 核验点 | 结果 | 证据 |
| --- | --- | --- |
| `runGitProcessRaw`（原文，仅供解析）与 `runGitProcess`（对外脱敏）仍分离 | **PASS** | `core.ts:174-177` 只做 `redactGitOutput(raw.output)`；`core.ts:180-196` 原样返回。**唯一** `runGitProcessRaw` 业务调用点 = `compare.ts:55`（`--numstat`） |
| `compareVersions` 的 `--numstat` 仍走 raw | **PASS** | `compare.ts:55` `runGitProcessRaw(input.path, buildDiffNumstatArgs(base, head))`；`--stat` 展示侧 `compare.ts:51` 走脱敏出口 |
| `getFileDiff` 仍走脱敏出口 | **PASS** | `status.ts:110` `runGitProcess(projectPath, buildFileDiffArgs(file))` |
| `cloneRepository` 仍登记/注销进程清理 | **PASS** | `clone.ts:132` `registerProcessStopper(() => killProcessTree(child))`；`clone.ts:154`（error）、`162`（close）两处 `unregisterStopper()`，与 HEAD 一致 |
| `buildCredentialEnv` 的 COUNT=2 空值重置仍在 | **PASS** | `core.ts:56 INJECTED_CONFIG_COUNT="2"`、`59 CREDENTIAL_HELPER_RESET_VALUE=""`、`116-129` 先 KEY_0 空值再 KEY_1 脚本；归一化后与 HEAD 逐 token 一致 |
| `assertNoCredentialInUrl` 仍被 `setRemoteUrl` / `assertCloneUrl` 调用 | **PASS** | `repo.ts:135`（"远程地址"）、`clone.ts:68`（"克隆地址"） |

**未发现任何一行逻辑被「顺手改」。P0/P1 行为漂移 = 0。**

### 5.5 常量与外部依赖等价

`MAX_BUFFER=10*1024*1024`、`GIT_ARG_CHUNK=200`、`DISK_SIZE_CACHE_TTL_MS=60*1000`、`DIRECTORY_SCAN_CONCURRENCY=8`、`FILE_STAT_CONCURRENCY=64`、`IGNORED_SIZE_DIRECTORIES`（8 项）、`README_FILE_NAMES`（6 项）、`OPERATION_COMMANDS` 四项命令序列、credential helper 脚本字面量——逐值比对一致。

`gitParsing.ts` / `serviceUtils.ts` / `processCleanup.ts` 在工作区**零改动**（`git diff HEAD -- <这三个文件>` 无输出），故 `buildCommitMessageArgs`、`redactSecrets`、`toLiteralPathspec`、进程回收实现均沿用 HEAD。

---

## 六、门禁数值（原始输出）

| 命令 | 结果 |
| --- | --- |
| `npx vitest run` | `Test Files 26 passed (26)` / **`Tests 278 passed (278)`** / 2.75s |
| `npx vitest run electron/main/services/gitArgs.test.ts` | **`42 passed (42)`** / 238ms |
| `npx tsc -b` | `exit=0`（无输出） |
| `npx tsc -p tsconfig.electron.json` | `exit=0`（无输出） |
| `npm run build` | `exit=0`；`dist-electron/main.cjs 170.24 kB`、`preload.cjs 4.21 kB`、139 modules transformed |
| `npx prettier --check electron/main/services/git/*.ts` | **红（13 个文件 warn）** — CI 未执行该门禁，见 P3 |

其中 `git.test.ts`（5 tests，未改动）仍经 `./git` → `git/index.ts` 解析并通过，是路径解析的**运行期**证据（不止 `tsc`）。

---

## 七、编码与行尾

| 文件 | BOM | UTF-8 合法（fatal 解码） | U+FFFD | CRLF | 纯 LF 行 | 末尾换行 |
| --- | --- | --- | --- | --- | --- | --- |
| binary.ts | 无 | 是 | 0 | 18 | 0 | 无 |
| branch.ts | 无 | 是 | 0 | 91 | 0 | 无 |
| clone.ts | 无 | 是 | 0 | 178 | 0 | 无 |
| compare.ts | 无 | 是 | 0 | 87 | 0 | 无 |
| core.ts | 无 | 是 | 0 | 203 | 0 | 无 |
| disk.ts | 无 | 是 | 0 | 129 | 0 | 无 |
| history.ts | 无 | 是 | 0 | 121 | 0 | 无 |
| index.ts | 无 | 是 | 0 | 81 | 0 | 无 |
| operation.ts | 无 | 是 | 0 | 110 | 0 | 无 |
| repo.ts | 无 | 是 | 0 | 250 | 0 | 无 |
| status.ts | 无 | 是 | 0 | 235 | 0 | 无 |
| tags.ts | 无 | 是 | 0 | 93 | 0 | 无 |

- 对照仓库既有文件：`gitParsing.ts` 256/256 CRLF、`credentials.ts` 50/50 CRLF → **行尾一致**。
- 中文注释解码正常（`git/index.ts` 头部 why 注释读回为正常中文，PowerShell 控制台此前显示的乱码仅为控制台代码页，非文件内容）。
- **P3**：12 个文件均无文件末尾换行，`prettier --check` 报 13 个文件（含 `gitArgs.test.ts`）；`core.ts` 另有 2 处 `execFileAsync(...)` 调用超出行宽（Prettier 要求拆行，`182`、`189` 附近）。HEAD 旧文件同样缺末尾换行，故属**延续既有风格**而非新增劣化。

---

## 八、模块依赖图

```
binary.ts    -> (无本地依赖)
core.ts      -> binary
branch.ts    -> core
status.ts    -> core
tags.ts      -> core
compare.ts   -> core
disk.ts      -> core
clone.ts     -> binary, core
operation.ts -> core, status
repo.ts      -> clone, core, disk, status
history.ts   -> binary, branch, core, status, tags
index.ts     -> binary, core, repo, status, operation, tags, compare, branch, history, clone, disk
```

| 检查 | 结果 |
| --- | --- |
| `core.ts` 是否 import 子域 | **否**（仅 `binary`） |
| `binary.ts` 是否 import 子域 | **否**（仅 `../storage/settings`） |
| 循环依赖（DFS 环检测） | **无** |
| 子域是否反向 import `index.ts` | **无** |
| 依赖方向合理性 | `index`（聚合）→ 子域 → `core` → `binary`（叶子）；`history→branch/tags/status`、`repo→status/disk/clone`、`operation→status` 均为单向「上层复用」，无交叉回指 |

---

## 九、对抗性探针（真实执行）

用 `rolldown` 把 `electron/main/services/git/index.ts` 打包为 CJS（`electron`/`better-sqlite3`/`@napi-rs/keyring` 置为 external，`NODE_PATH` 指向项目 `node_modules`）后执行，**不是静态推断**：

| 探针 | 断言 | 结果 |
| --- | --- | --- |
| 运行时导出面 | 64 个导出；8 类内部符号（`runGit`/`runGitProcess`/`runGitProcessRaw`/`MAX_BUFFER`/`registerProcessStopper`/`killProcessTree`/`assertDirectory`/`computeDiskSize`）0 泄漏 | PASS |
| 分批边界 | 0→`[]`、1→`[1]`、199→`[199]`、200→`[200]`、201→`[200,1]`、401→`[200,200,1]`、5000 展平后与原数组完全相等 | PASS |
| 幂等/纯度 | 同输入两次调用 `toEqual` 且**非同一引用**；外部 `push` 不污染后续调用 | PASS |
| pathspec 注入 | 含空格/中文/`*?[]`/`-` 前缀/`\n` 的 6 个路径：`--` 紧贴 pathspec、逐字加 `:(literal)`、无转义字符 | PASS |
| clone 参数注入 | option-like URL（`https://h/--upload-pack=evil.git`）仍落在 `--` 之后；`--` 计数 = 1 | PASS |
| 超长输入 | 100,000 字符 commit message 单条 `-m` 原样；50,000 字符路径不截断 | PASS |
| 空/空白输入（观察项） | `buildCreateTagArgs("v1","   ")` = `["tag","-a","v1","-m","   "]`；`buildCommitArgs("   ")` = `["commit"]`；`buildCreateBranchArgs("")` = `["checkout","-b",""]` | PASS（记录为 P3 契约风险） |
| 操作序列 | `revert → undefined`；`sync = fetch → pull`（顺序不可倒） | PASS |
| `-C` 前置 | `buildRevertArgs` = `["-C", path, "revert","--no-edit",hash]`；`buildGitCwdArgs` 前缀一致 | PASS |

**9/9 通过。** 副作用说明：探针经 `require("electron")` 触发该包在 `node_modules` 下的二进制自下载（原 `dist` 缺失），仅影响 `node_modules`，未触碰仓库源码。

---

## 十、差异与风险清单

| 级别 | 项 | 说明 | 建议 |
| --- | --- | --- | --- |
| **P0** | 无 | — | — |
| **P1** | 无 | 未发现行为漂移、未发现原导出丢失 | — |
| **P2-1** | `index.ts` 导出面 31 → 64，头注释声称「零 API 面扩张」 | 32 个 `buildXxxArgs` + `buildOperationCommands` + `chunkFilesForGitArgs` 新增导出；`GIT_ARG_CHUNK` 由内部常量升为公开。纯增量、无副作用，但违反「不新增原未公开导出」的严格口径，且注释误导后续读者 | 二选一：① 改注释为「31 原符号 + 33 拆分同期新增的参数护栏符号」并在 CHANGELOG 记录导出面增量；② `gitArgs.test.ts` 改从 `./git/core|status|…` 直接导入，`index.ts` 收敛回 27+4 原符号（保持 31）。建议 ① |
| **P3-1** | `prettier --check` 红（13 文件） | 12 个文件缺末尾换行；`core.ts` 2 处 `execFileAsync` 超行宽。CI（`.github/workflows/ci.yml` 只跑 typecheck/test:coverage/build）未执行该门禁，HEAD 旧文件同样缺末尾换行 | 合并前跑 `npx prettier --write "electron/main/services/git/*.ts" "electron/main/services/gitArgs.test.ts"`，避免下次 `npm run format:check` 报红 |
| **P3-2** | 新公开的参数构建器把「前置校验」留给调用方 | `buildCreateTagArgs` 对 `"   "` 仍产出 `-a ... -m "   "`；`buildCreateBranchArgs("")` 直接产出空名。当前所有调用点都已 `trim` + `isValidRefName`，运行行为与 HEAD 一致 | 在这两个 builder 的 JSDoc 注明 precondition（message 已 trim / name 已白名单），或内部再 `trim` 一次 |
| 提示 | 提交范围 | 工作区另有 `storage/{accounts,projects,remoteRepositoryCache,workspaces}(.test).ts` 的 `M` 与 `.opencode/` 未跟踪目录，属其他任务 | 提交 A-23 时只 `git add` 删除的 `electron/main/services/git.ts`、新增 `electron/main/services/git/`、`electron/main/services/gitArgs.test.ts`，勿混入 storage 改动 |
| 提示 | 历史文档引用 | `docs/*.md` 中仍有 `services/git.ts:123` 形式的行号引用（历史审查报告） | 属存档记录，不必改；新报告请引用模块路径 |

---

## 十一、原子测试块（等价 JSON，供归档）

```json
{
  "checks": [
    {
      "target": "旧文件删除与路径解析",
      "command_run": "Test-Path electron\\main\\services\\git.ts ; git grep -n \"services/git\\.ts\" ; npx tsc -b",
      "output_observed": "False ; 代码 0 命中（仅 docs 历史引用） ; tsc -b exit=0",
      "expected_vs_actual": "期望旧文件不存在且无代码引用、类型检查可解析新目录 -> 实际一致",
      "atomic_result": "PASS"
    },
    {
      "target": "调用方路径运行期解析（ipc.ts / environment.ts / git.test.ts / gitArgs.test.ts）",
      "command_run": "npx vitest run",
      "output_observed": "Test Files 26 passed (26); Tests 278 passed (278); git.test.ts 5 tests; gitArgs.test.ts 42 tests",
      "expected_vs_actual": "期望 >=278 用例全绿且旧路径导入可解析 -> 实际 278/278",
      "atomic_result": "PASS"
    },
    {
      "target": "git/ 模块行数 <=300",
      "command_run": "Get-ChildItem electron\\main\\services\\git -Filter *.ts | ForEach-Object { \"$($_.Name): $((Get-Content $_.FullName).Count)\" }",
      "output_observed": "binary:19 branch:92 clone:179 compare:88 core:204 disk:130 history:122 index:82 operation:111 repo:251 status:236 tags:94",
      "expected_vs_actual": "期望全部 <=300 -> 实际最大 251",
      "atomic_result": "PASS"
    },
    {
      "target": "导出等价性 A(HEAD git.ts) vs B(index.ts 静态+运行时)",
      "command_run": "node analyze.mjs ; node -e \"rolldown bundle -> Object.keys\"",
      "output_observed": "A=31 B=64 B\\A=[buildXxxArgs x32, GIT_ARG_CHUNK] A\\B=[]",
      "expected_vs_actual": "期望双向差集为空 -> 实际 A\\B 为空、B\\A 有 33 个纯增量符号（P2，非行为影响）",
      "atomic_result": "FAIL"
    },
    {
      "target": "内部符号封装（反向检查）",
      "command_run": "node probe-bundle.cjs",
      "output_observed": "PASS | export-surface=64 且不含内部符号 | 导出 64 个；内部符号 0 泄漏",
      "expected_vs_actual": "期望 runGit/runGitProcess(Raw)/MAX_BUFFER/registerProcessStopper 等不外泄 -> 实际 0 泄漏",
      "atomic_result": "PASS"
    },
    {
      "target": "gitArgs 参数拼装全数组断言",
      "command_run": "npx vitest run electron/main/services/gitArgs.test.ts",
      "output_observed": "Test Files 1 passed (1); Tests 42 passed (42)",
      "expected_vs_actual": "期望 42 通过 -> 实际 42 通过",
      "atomic_result": "PASS"
    },
    {
      "target": "类型检查（web/共享 + electron 项目）",
      "command_run": "npx tsc -b ; npx tsc -p tsconfig.electron.json",
      "output_observed": "tsc -b exit=0（无诊断）; tsc electron exit=0（无诊断）",
      "expected_vs_actual": "期望 0 错误 -> 实际 0 错误",
      "atomic_result": "PASS"
    },
    {
      "target": "生产构建",
      "command_run": "npm run build",
      "output_observed": "build exit=0; dist-electron/main.cjs 170.24 kB; preload.cjs 4.21 kB; 139 modules transformed",
      "expected_vs_actual": "期望构建成功 -> 实际成功",
      "atomic_result": "PASS"
    },
    {
      "target": "函数体归一化逐 token 对比（42 个顶层函数）",
      "command_run": "node analyze.mjs ; node diff.mjs",
      "output_observed": "identical=20 differ=22 missing=0 added=33; 22 处差异全部为内联数组->buildXxxArgs / buildGitCwdArgs 抽取",
      "expected_vs_actual": "期望仅允许 import/位置/顺序/参数抽取差异 -> 实际无判定条件/分支/返回值改动",
      "atomic_result": "PASS"
    },
    {
      "target": "五个安全出口（raw/脱敏/diff/进程清理/凭据重置/URL 凭据拦截）",
      "command_run": "Select-String -Path electron\\main\\services\\git\\*.ts -Pattern 'runGitProcessRaw\\(|runGitProcess\\(|redactGitOutput\\(|assertNoCredentialInUrl\\(|registerProcessStopper'",
      "output_observed": "runGitProcessRaw 业务调用仅 compare.ts:55; getFileDiff status.ts:110 走 runGitProcess; commitChanges status.ts:231/235 显式脱敏; clone.ts:132/154/162 登记与注销; repo.ts:135 + clone.ts:68 调 assertNoCredentialInUrl; core.ts:56/59/122-126 COUNT=2 + 空值重置",
      "expected_vs_actual": "期望与 HEAD 语义一致 -> 实际一致",
      "atomic_result": "PASS"
    },
    {
      "target": "编码与行尾",
      "command_run": "node graph.mjs（字节级 BOM + TextDecoder fatal + CRLF 统计）",
      "output_observed": "12 文件 BOM=no / utf8Valid=true / U+FFFD=0 / CRLF 100% / LF-only=0；参照 gitParsing.ts CRLF 256/256",
      "expected_vs_actual": "期望无 BOM、无乱码、行尾一致 -> 实际一致（仅缺末尾换行，P3）",
      "atomic_result": "PASS"
    },
    {
      "target": "模块依赖图（core 不 import 子域 / 无环）",
      "command_run": "node graph.mjs",
      "output_observed": "core.ts -> binary only；core 子域依赖违规: 无；循环依赖: 无；子域反向 import index: 无",
      "expected_vs_actual": "期望 core 仅依赖叶子且无环 -> 实际一致",
      "atomic_result": "PASS"
    },
    {
      "target": "对抗性探针（边界/幂等/注入/超长）",
      "command_run": "node probe-bundle.cjs",
      "output_observed": "9 项断言全部 PASS; SUMMARY: 9/9 pass",
      "expected_vs_actual": "期望覆盖分批 199/200/201/401/5000、恶意路径、10 万字符 message、option-like URL -> 实际全部符合预期",
      "atomic_result": "PASS"
    }
  ],
  "final_verdict": "FAIL",
  "fail_details": {
    "what_failed": "导出等价性的反向检查：git/index.ts 对外导出 64 个符号，拆分前 git.ts 只有 31 个；新增 33 个（32 个 buildXxxArgs/buildOperationCommands/chunkFilesForGitArgs + 内部常量 GIT_ARG_CHUNK）。任务口径要求双向差集为空。",
    "exact_error_output": "=== A (HEAD 导出) 数量: 31\n=== B (index 实际导出) 数量: 64\n=== A\\B: []\n=== B\\A: [\"GIT_ARG_CHUNK\",\"buildBranchListArgs\",\"buildCloneArgs\",...共 33 项]",
    "reproduction_steps": "git show HEAD:electron/main/services/git.ts | Select-String '^\\s*export\\s+(async\\s+)?(function|const|class|interface|type)' 取 31 个；解析 electron/main/services/git/index.ts 的具名重导出取 64 个；取差集；另 rolldown 打包 index.ts 后 Object.keys 复核为 64。",
    "fail_reason_analysis": "A-23 同期引入的参数拼装护栏（gitArgs.test.ts 42 条用例从 ./git 导入 33 个符号）需要对外导出，导致对外 API 面增加 33 个纯函数符号，并使头注释『零 API 面扩张』失效。差异全为增量、无副作用、无删除，故不构成行为风险，定级 P2；建议改注释承认增量，或让测试改从子模块导入以维持原 31 个对外符号。"
  }
}
```

> 说明：`final_verdict` 严格按协议取 `FAIL`（存在一项未达成的检查），但**该项为 P2 文档/API 面问题，非行为缺陷**；若验收口径把「新增测试护栏符号」视为允许项，则整体可视为 `PASS` 可提交。

---

## 附录：验证产物位置（均在系统临时目录，任务结束即弃）

`%TEMP%\gitool-verify-a23\`：`git-head.ts`（HEAD 基准）、`analyze.mjs`、`diff.mjs`、`graph.mjs`、`prettier-diff.mjs`、`probe-entry.mjs`、`probe-bundle.cjs`、`vitest-full.txt`、`tsc-b.txt`、`tsc-electron.txt`、`build.txt`、`diff-out.txt`、`graph-out.txt`、`probe-out.txt`。