# 第 1 批（A-01 ~ A-05）独立验证报告

- 验证日期：2026-11-21
- 验证范围：工作区未提交改动（10 个修改文件 + 4 个新增测试文件），对应 `docs/architecture-review-2026-11-21.md` §7.1 的 A-01 ~ A-05
- 验证方式：独立执行命令 + 独立读取 diff + 对抗性实验（非静态阅读）
- 环境：Windows + PowerShell，Node/npm 可用；`git version 2.56.1.windows.1`；`node_modules` 已安装（`--ignore-scripts`）

---

## 一、结论摘要

**最终结论：可提交。**

| 项目 | 结果 |
| --- | --- |
| 门禁（类型 ×2 / 测试 / 构建） | ✅ 全部通过，退出码均为 0（返修后复跑：25 文件 / **231** 用例全绿） |
| A-01 安装路径加固 | ✅ 通过 |
| A-02 digest 完整性 | ✅ 通过 |
| A-03 凭据脱敏与备份排除 | ✅ 通过（含 tar 实测） |
| A-04 clone 凭据不落盘 | ✅ 通过（初验发现 F-01；返修后 `GIT_CONFIG_COUNT=2` 空值重置已验证，`credential fill` 129ms 即回） |
| A-05 死通道清理 | ✅ 通过 |

**理由**：初验提出的唯一 P1（F-01：系统级 `credential.helper=manager` 排在链首导致挂起）已在返修中收口，F-04 / F-05 两条 P3 亦已修复；返修后 6 条门禁全绿，且未发现「变异验证」留下的破坏性代码、临时跳过用例或调试残留。遗留 F-02 / F-03 / F-06 / F-07 均为非阻塞项，列入第 2 批。

---

## 二、门禁结果

| # | 命令 | 退出码 | 关键输出 |
| --- | --- | --- | --- |
| 1 | `npx tsc -b` | 0 | 无输出（通过） |
| 2 | `npx tsc -p tsconfig.electron.json` | 0 | 无输出（通过） |
| 3 | `npm run typecheck`（= 上述两条串联） | 0 | 仅打印脚本头，无错误 |
| 4 | `npx vitest run`（全量） | 0 | `Test Files 25 passed (25)` / `Tests 228 passed (228)` / 2.62s |
| 5 | `npx vitest run`（5 个目标文件） | 0 | `Test Files 5 passed (5)` / `Tests 54 passed (54)` / 668ms |
| 6 | `npm run build`（`tsc -b && vite build`） | 0 | client 1645 modules；`dist-electron/main.cjs` 211.78 kB；`dist-electron/preload.cjs` 4.21 kB；369ms/157ms/14ms |

> 构建门禁**未触发 Electron 二进制缺失**：本项目的 `vite build` 只做 JS 打包，不调用 electron-builder。故本次**不存在环境限制**，`dist/`、`dist-electron/` 已由 `.gitignore` 覆盖，`git status` 未出现构建产物污染。

> **返修后（二次验证）复跑**：`git.test.ts` **4 passed**、`updater.test.ts` **8 passed**、全量 **231 passed (25 files)**；`tsc -b` / `tsc -p tsconfig.electron.json` / `npm run build` 退出码均 0。详见「七、返修复验（F-01/F-04/F-05）」。

### 2.1 静态验收计数（PowerShell 实测）

| 检查项 | 命令片段 | 实测值 | 期望 | 结果 |
| --- | --- | --- | --- | --- |
| IPC 通道数 | `[regex]::Matches((Get-Content electron\main\ipc.ts -Raw), 'ipcMain\.handle\(').Count` | **76** | 76 | ✅ |
| 无 cmd 拼接 | `Select-String updater.ts -Pattern 'spawn\("cmd"')` | **0** | 0 | ✅ |
| 无 `--config` 凭据 | `Select-String git.ts -Pattern 'credential\.helper=!f'` | **0** | 0 | ✅ |
| 有 GIT_CONFIG 注入 | `Select-String git.ts -Pattern 'GIT_CONFIG_COUNT'` | **3** | ≥1 | ✅ |
| CSV 出口脱敏 | `Select-String operationCsv.ts -Pattern 'redactSecrets'` | **3** | ≥1 | ✅ |
| install 返回 Promise | `Select-String ipc.ts -Pattern 'return installUpdate\(installerPath\)'` | **1** | 1 | ✅ |
| 死通道已删 | `Select-String ipc.ts -Pattern 'tasks:updateRun|operations:record'` | **0** | 0 | ✅ |
| digest 逻辑密度（A-02 附带） | `Select-String updater.ts -Pattern 'digest'` | **21** | ≥2 | ✅ |

---

## 三、5 条动作 × 验收信号矩阵

| 动作 | 验收信号（§7.1 原文） | 实际执行证据 | 判定 |
| --- | --- | --- | --- |
| **A-01** | `spawn("cmd")` 计数 = 0；`-t "rejects untrusted installer path"` 通过 | 计数 0；`1 passed | 5 skipped`（6 用例中精确命中 1 条，退出码 0） | ✅ 通过 |
| **A-02** | `-t "digest mismatch removes file"` 通过；`digest` 计数 ≥2 | `1 passed | 5 skipped`，退出码 0；计数 21 | ✅ 通过 |
| **A-03** | `-t "redactSecrets"` 通过；`operationCsv.ts` 中 `redactSecrets` ≥1 | `6 passed (6)`，退出码 0；计数 3。**额外**：用真实 `tar` 复刻 `backups.ts` 参数打包，归档成员仅 `demo/`、`demo/.git/`、`demo/a.txt`，`.git/config` 与 `.git/config.worktree` 被真实排除 | ✅ 通过 |
| **A-04** | `-t "does not persist credential helper"` 通过；克隆后 `git config --get credential.helper` 为空 | 初验：`1 passed`（真实 git 2.56.1，未跳过；用例内断言 `--local` 读取 `exitCode != 0` 且 `value === ""`，并二次读取 `.git/config` 原文确认无 helper/无 token）。返修后新增 `resets system credential helper chain`（真实 `git credential fill` + 10s 看门狗），`git.test.ts` **4/4 passed** | ✅ 通过（F-01 已收口） |
| **A-05** | `ipcMain.handle` 计数 = 76；`bridgeParity.test.ts` 通过 | 计数 76；`4 passed (4)`；测试内含 handler 唯一性 + bridge↔handler 双向差集 | ✅ 通过 |

### 3.1 逐条对抗性核验（不看计数，读实现）

**A-01**
- `installUpdate` 顺序正确：`resolve` → `isTrustedInstallerPath` → `existsSync` → 与 `cachedInstallerPath` 全等匹配 → `spawn(resolved, ["/S"], { detached: true, stdio: "ignore", shell: false })`。
- 只有收到 `"spawn"` 事件才 `unref()` + resolve；`"error"` 事件转 reject，不静默（有测试覆盖，并断言 `app.quit` 未被调用）。
- 白名单 `/^gitool-\d[\w.-]*-setup\.exe$/i` 与 `electron-builder.yml` 的 `artifactName: ${productName}-${version}-setup.${ext}` + `productName: Gitool` 真实产物 `Gitool-<version>-setup.exe` **匹配**（大小写不敏感）；测试夹具即用真实产物名。
- `..` 穿越被 `relative()` 判定拦下（已有单测真实执行），前缀绕过（`gitool-updates-evil`）会被 `startsWith("..")` 拦下。

**A-02**
- `downloadUpdate` 在**发起 fetch 之前**就检查 `cachedDigest`，缺失直接抛错（fail-closed）；不一致时 `await rm(filePath, { force: true })` 后才抛错；`cachedInstallerPath` 仅在摘要通过后设置。
- `parseSha256Digest` 严格校验 `sha256:` 前缀 + 64 位小写 hex，格式异常按"缺失"处理 → 拒装。
- 流式 sha256（`for await createReadStream`）+ `pipeline` 落盘，避免整包入内存与截断。

**A-03**
- 入口拦截：`assertCloneUrl` 与 `setRemoteUrl` 都调用 `assertNoCredentialInUrl`（`URL.username/password` 非空即拒），且位置在启动 git 之前。
- 出口脱敏：clone 进度、clone 成功/失败 `output`、`recordOperation` 落库 `detail`（**先脱敏后截 500 字**）、CSV `csvEscape` 五处均已覆盖。
- 备份排除实测有效（见上表），且用户把备份排除规则清空也无法移除安全排除项（安全项先于用户规则加入）。
- 渲染层 `src/**` 中 `console.log/error/warn` 数量为 **0**，无新增敏感输出。

**A-04**
- `git.ts` 中已无 `--config`；token 只出现在 `env`（`GITOOL_ASKPASS_TOKEN`），`args` 仅 `clone --progress -- <url> <target>`；`buildCredentialEnv` 的 `GIT_CONFIG_*` 只在 `spawn` 的 `env` 对象内构造。
- 真实复现：`git.test.ts` 用例 3 用本地 bare 仓库 + `insteadOf` 真实克隆，读回 `--local credential.helper` 为空、`.git/config` 原文无 helper / 无 token。
- 初验发现的 F-01（注入为追加、系统 `manager` 在链首）已由返修收口：`INJECTED_CONFIG_COUNT="2"`，第 0 条 `credential.helper=""` 重置列表、第 1 条注入脚本。返修后的 `credential fill` 实测见「七」。**注意**：`insteadOf → file://` 本身不走 helper 链，单靠用例 3 仍是假绿；新增 `resets system credential helper chain` 才是 F-01 的真正守门用例。

**A-05**
- `ipc.ts` 已删除 `tasks:updateRun`、`operations:record` 两个 handler 及对应 schema（`taskRunSchema` / `operationRecordSchema`）与对应测试块；`schemas.ts` 的类型 import 同步删除，`looseString` 仍被 18 处使用（无残留死代码）。
- `remoteRepositories:loadCached` / `cacheMeta` 改由 `providers.ts` 暴露的 `loadCachedRemoteRepositories` / `loadRemoteRepositoryCacheMeta` 承接，ipc 不再直接 import `storage/remoteRepositoryCache`。
- `bridgeParity.test.ts` 同时锁定：76 条 handler、无重复注册、双向差集为空、`on*` 单向上报不混入 invoke。
- 全仓检索：`updateTaskRun` 仅剩 `services/tasks.ts:118`（服务层内部持久化，符合分层）与测试文件；`operations:record` 仅剩测试注释。渲染层无任何调用残留。

---

## 四、对抗性检查发现

> **返修状态（2026-11-21 二次验证）**：F-01、F-04、F-05 已由实现方修复并复验收口（证据见「七」）；F-02、F-03、F-06、F-07 未在本批处理，仍为第 2 批后续项。下表保留初验原文以维持证据可追溯。

| 编号 | 位置 | 问题 | 严重度 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- |
| **F-01** | `electron/main/services/git.ts` `buildCredentialEnv` / `cloneRepository` | **GIT_CONFIG_* 注入的 `credential.helper` 是追加，不覆盖系统配置**。Windows 默认 Git 安装（`C:/Program Files/Git/etc/gitconfig`）带 `credential.helper=manager`，git 会**先**调用 GCM。实测复刻 `cloneRepository` 的 env（`GIT_TERMINAL_PROMPT=0` + GIT_CONFIG_* + token）执行 `git credential fill` 时**挂起 45s 无输出**，需 `Stop-Process` 强杀（残留 PID 11060）。影响：私有 HTTPS 仓库克隆可能弹 GCM 窗口或无 GUI 环境直接卡死；若用户 GCM 里已存凭据，所选账号 token 根本不会被使用。`GIT_TERMINAL_PROMPT=0` 只抑制 git 自身终端提示，抑制不了 GCM。 | **P1（阻塞本批 A-04 收口）** | ① `git config --show-origin --get-all credential.helper` 输出三行：`file:C:/Program Files/Git/etc/gitconfig  manager`、`file:.git/config  !f()…`、`command line:  !f()…`（注入为第 3 条，顺序在 manager 之后）；② 复刻 env 的 `git credential fill` 超时 120s/45s；③ 加 `GIT_CONFIG_NOSYSTEM=1` + 空 `GIT_CONFIG_GLOBAL` 后同一注入**立即**返回 `username=x-access-token` / `password=tok-abc123`；④ 验证修复方向：`git -c credential.helper= -c credential.helper='!f()…' credential fill` 在保留系统配置时**立即**返回注入凭据 —— 空值可重置 helper 列表。 | 本批内修：在 `clone` 参数前加 `-c credential.helper=`（进程级、不落盘、不含 token），或改为 `GIT_CONFIG_COUNT=2`（第 0 条 `credential.helper=""` 清空，第 1 条注入脚本）。并补一条**真正走 HTTPS 凭据链路**的测试（本地 HTTP 服务或 `credential fill` 级断言），避免 `insteadOf`→`file://` 造成的假绿。 |
| **F-02** | `D:\github\gitool\.git\config`（仓库自身） | 本仓库 config 中已存在 `[credential] helper = "!f() { echo username=x-access-token; echo password=\"$GITOOL_ASKPASS_TOKEN\"; }; f"`（mtime 2026-11-21 16:10:16）。说明旧实现（或复现实验）确实把 helper 写进了仓库级配置，而本次修复**只防新增、不清理存量**。升级用户的既有仓库仍带这条可执行配置。 | P2 | `git config --local --get-all credential.helper` 返回该脚本；`Select-String .git\config -Pattern credential` 命中 L8-L9。 | ① 第 2 批加迁移：启动时检测 `.git/config` 中的 `credential.helper`，若是本工具特征值则告警/提供一键清理；② 至少在文档给出 `git config --unset-all credential.helper` 指引；③ 本仓库自身 config 需人工确认后清理（验证者不修改仓库配置）。 |
| **F-03** | `electron/main/services/git.ts` `runGitOperation` / `commitChanges` | 脱敏覆盖不一致：clone 域所有对外文本都过 `redactSecrets`，但 `pull/push/fetch/sync/commit` 的 `output` **直接返回渲染层**。若历史仓库 `remote.origin.url` 内嵌凭据，git 错误输出会把该 URL 原样回显到 UI（虽已不落库）。另外 `redactSecrets` 不覆盖 `?access_token=xxx` / `token=xxx` 形态。 | P2 | 代码阅读 + 全仓检索确认 `recordOperation` 是唯一落库口（已脱敏），但 `runGitOperation` 返回值未经脱敏。 | 第 2 批：在 `runGitProcess` 出口统一 `redactSecrets(output)`（或至少对 `runGitOperation` / `commitChanges` 的返回值），并扩展正则覆盖 `(token\|access_token\|password\|private_token)=...`。 |
| **F-04** | `electron/main/ipc.ts:396` | 陈旧注释：「该入参最终会被 cmd start 执行，必须限制在下载目录内且为 exe」——A-01 已改为直接 spawn，注释与实现矛盾，会误导后续维护者认为仍存在 cmd 链路。 | P3 | `ipc.ts:396` 原文。 | 改为「该入参最终由 spawn 直接执行，必须限制在下载目录内且命中文件名白名单」。 |
| **F-05** | `electron/main/services/updater.ts` `downloadUpdate` | 下载中途失败（`pipeline` 抛错）不删除半包文件，只有 digest 不一致才 `rm`。残留文件不影响安装（`cachedInstallerPath` 未设置），但会在临时目录堆积。另：`resolveFileName` 的非法字符替换可能产出不命中白名单的文件名（fail-closed，用户无法自动安装）。 | P3 | 代码路径：`pipeline` 抛错时无 `finally` 清理；`resolveFileName` 将非 `[A-Za-z0-9._-]` 替换为 `_`。 | 下载失败分支加 `rm(filePath, { force: true })`；`resolveFileName` 失败时回退到标准产物名（仍受 digest 保护）。 |
| **F-06** | `updater.ts` / 测试 | 路径校验只做静态 `resolve`，不解析 symlink；校验通过到 `spawn` 之间文件可被同用户进程替换（TOCTOU）。属同用户威胁模型的已知限制，非本次引入。 | P3 | `isWithinDirectory` 用 `relative`，未 `realpath`；`installUpdate` 无二次 hash。 | 第 2 批：install 前用独占句柄打开或重新校验 digest，或 `realpath` 后再次判定根目录。 |
| **F-07** | 测试覆盖 | ① `operationCsv.test.ts` **没有** CSV 脱敏用例（实现有、测试无）；② `isTrustedInstallerPath` 未测 UNC / 大小写 / 8.3 短名 / 符号链接；③ `checkForUpdates` 未测 digest 格式非法（`sha256:zzz`、长度不足）；④ `downloadUpdate` 未测 HTTP 非 200 / 流中断 / 无 content-length。 | P3 | 读取 4 个测试文件逐条比对实现分支；`describe.skipIf(!hasGit)` 在无 git 环境会静默跳过（本次环境有 git 2.56.1，3 条真实执行，未跳过）。 | 第 2 批补上述用例；`git.test.ts` 的 skip 条件建议在 CI 中改为「无 git 直接失败」，避免验收信号静默变绿。 |

### 4.1 已排除的怀疑（确认无问题）

- **空断言 / 跳过用例**：4 个新测试文件全部为行为级断言（断言 `spawn` 的 `command/args/options` 具体值、文件是否被删除、`app.quit` 调用次数、真实 git config 内容），未发现 `expect(true).toBe(true)`、无 `it.skip`（仅 `describe.skipIf` 且本次真实执行）。
- **渲染层敏感输出**：`src/**` 中 `console.*` 计数为 0。
- **日志泄露**：`electron/main` 仅 2 处 `console.error`（页面加载失败、安装程序启动失败），均不含 token/detail。
- **脱敏可绕过点（落库侧）**：`insertOperationRecord` 全仓仅 `ipc.ts:438` 一处生产调用，已 `redactSecrets` 后截断。
- **schema 残留**：`schemas.ts` 删除后无未使用 import；`looseString` 仍被 18 处使用。
- **构建污染**：`npm run build` 后 `git status` 未新增源码/产物改动。

---

## 五、建议后续动作

**已在本批收口（复验通过）**
1. **F-01** ✅：改用 `GIT_CONFIG_COUNT=2`（第 0 条空值重置 + 第 1 条脚本注入），真实 `credential fill` **129ms** 返回 `username=x-access-token` / 注入 token；新增 `resets system credential helper chain` 守门用例（10s 看门狗 + 15s 用例超时）。
2. **F-04 / F-05** ✅：`ipc.ts:396` 注释改为「由 spawn 直接执行」；下载失败分支 `rm(filePath, { force: true }).catch(() => undefined)` 后 `throw error`（保留原始错误）；`resolveFileName` 不命中白名单时回退 `gitool-setup-<ts>.exe`；新增 2 条用例。

**第 2 批处理（仍未解决）**
3. **F-02**：既有仓库 `.git/config` 的 `credential.helper` 存量清理（检测 + 告警 + 一键清理），并清理本仓库自身 config。
4. **F-03**：`runGitOperation` / `commitChanges` 出口统一脱敏；`redactSecrets` 扩展 `key=value` 形态。
5. **F-06**：install 前二次完整性校验（TOCTOU / symlink）。
6. **F-07**：补齐 CSV 脱敏、路径边界、digest 格式、下载异常等测试；CI 中把 `skipIf(!hasGit)` 改为硬失败。

**建议保留的验证证据**
- `updater.test.ts` 6 条用例已覆盖 A-01/A-02 的核心分支，可作为回归基线；
- `bridgeParity.test.ts` 的 76 通道基线可作为后续 IPC 改动的门禁；
- `git.test.ts` 用例 3 的「真实 clone + 读回 config」模式值得在其他落盘类改动中复用（但需按 F-01 补 HTTPS 链路）。

---

## 六、执行摘要（原始输出摘录）

```
npx tsc -b                                  -> EXITCODE=0
npx tsc -p tsconfig.electron.json            -> EXITCODE=0
npm run typecheck                            -> EXITCODE=0
npx vitest run                               -> Test Files 25 passed (25)
                                                Tests 228 passed (228)
npm run build                                -> EXITCODE=0 (vite 8.3.0, dist-electron/main.cjs 211.78 kB)

[ipcMain.handle]=76   [spawn cmd]=0   [credential.helper=!f]=0
[GIT_CONFIG_COUNT]=3  [redactSecrets operationCsv]=3
[installUpdate call]=1 [deadchannels]=0  [digest]=21

git credential fill (复刻 clone env, 保留系统配置)        -> 挂起 45s，超时强杀
git credential fill (GIT_CONFIG_NOSYSTEM=1 + 空 global)   -> username=x-access-token / password=tok-abc123
git -c credential.helper= -c credential.helper='!f()…' …  -> username=x-access-token / password=tok-abc123
tar -a -c -f out.zip --exclude .git/config --exclude '*/.git/config' … -> 成员仅 demo/ demo/.git/ demo/a.txt

# ── 返修复验（二次验证）──
git credential fill (返修 COUNT=2，保留系统配置)      -> EXIT=0 / 129ms / username=x-access-token / password=tok-abc123
git credential fill (对照 COUNT=1，回归态)           -> TIMEOUT 10005ms（GCM 挂起，强杀）
npx vitest run electron/main/services/git.test.ts    -> 4 passed (4)
npx vitest run electron/main/services/updater.test.ts-> 8 passed (8)
npx vitest run                                       -> Test Files 25 passed / Tests 231 passed
npx tsc -b / tsc -p / npm run build                  -> 全部 EXITCODE=0
```

---

## 七、返修复验（F-01 / F-04 / F-05）

- 复验日期：2026-11-21（二次验证）
- 前提：两名实现方针对初验 F-01（P1）、F-04、F-05 做了返修，并声称使用「变异验证（临时改坏 → 确认测试变红 → 还原）」。本节除验证修复本身，还专项排查变异残留与掩盖性跳过。
- 环境不变：`git 2.56.1.windows.1`、系统配置含 `credential.helper=manager`、Windows + PowerShell。

### 7.1 F-01：实现核对（`buildCredentialEnv`）

| 核对点 | 实测 | 结果 |
| --- | --- | --- |
| 注入条目数 | `INJECTED_CONFIG_COUNT = "2"`（`git.ts:105`） | ✅ |
| KEY_0 / VALUE_0 | `credential.helper` / `""`（`CREDENTIAL_HELPER_RESET_VALUE`，空值重置整条 helper 列表） | ✅ |
| KEY_1 / VALUE_1 | `credential.helper` / `!f() { echo username=x-access-token; echo password="$GITOOL_ASKPASS_TOKEN"; }; f` | ✅ |
| token 位置 | 仅 `env[GITOOL_ASKPASS_TOKEN]`；`git.ts` 全文 13 处 `token` 命中均为注释 / env / 函数签名 | ✅ |
| `args` 内容 | 仅 `["clone", "--progress"]` + `["--", url, targetPath]`（无 token、无 `--config`） | ✅ |
| 注入作用域 | `GIT_CONFIG_*` 只在 `spawn(..., { env: { ...process.env, ...buildCredentialEnv(token) } })` 中构造，不落任何配置文件 | ✅ |

注释中还记录了「为什么不用 `-c credential.helper=`」：实测 `-c` 与 env 注入同处命令行层，空值会把同层注入脚本一并清掉（exit 128）；该结论与初验实验 C 的差异（初验把两条都放在 `-c`，脚本最后生效）可解释，采用 env 双条目是更稳妥的实现。

### 7.2 F-01：真实 `git credential fill` 复刻实验（10s 看门狗）

方法：`System.Diagnostics.Process` 启动 `git credential fill`，stdin 写入 `protocol=https\nhost=example.com\n\n`（空行结束），环境仅显式提供 `PATH` + 被测变量，**保留系统/全局 git 配置**（不设 `GIT_CONFIG_NOSYSTEM`），`WaitForExit(10000)`，超时则 Kill。

| 场景 | 注入 env | 实测输出 | 判定 |
| --- | --- | --- | --- |
| **A. 返修方案** | `COUNT=2`；`KEY_0=credential.helper` / `VALUE_0=""`；`KEY_1=credential.helper` / `VALUE_1=脚本`；`GITOOL_ASKPASS_TOKEN=tok-abc123` | `EXIT=0`，**129ms**，stdout = `protocol=https \| host=example.com \| username=x-access-token \| password=tok-abc123` | ✅ 秒回，且应答者只能是注入脚本 |
| **B. 回归态对照** | `COUNT=1`；仅注入脚本（不加重置） | **TIMEOUT after 10000 ms**（elapsed 10005ms），需强杀 | ✅ 复现初验挂起 |
| （初验补充）| 回归态 + `GIT_CONFIG_NOSYSTEM=1` + 空 global | 立即返回注入凭据 | 证明注入本身一直有效，问题在链首 manager |

**结论**：F-01 已收口——系统级 `manager` 被第 0 条空值条目重置，注入脚本成为唯一应答者，129ms 返回；不再等待 GCM。

### 7.3 门禁复跑（返修后）

| # | 命令 | 退出码 | 关键输出 |
| --- | --- | --- | --- |
| 1 | `npx vitest run electron/main/services/git.test.ts` | 0 | `Test Files 1 passed (1)` / `Tests 4 passed (4)` / 622ms（含新用例 `resets system credential helper chain`） |
| 2 | `npx vitest run electron/main/services/updater.test.ts` | 0 | `Test Files 1 passed (1)` / `Tests 8 passed (8)` / 330ms（含 `removes partial file on download failure`、`falls back to standard installer name`） |
| 3 | `npx vitest run`（全量） | 0 | `Test Files 25 passed (25)` / **`Tests 231 passed (231)`** / 3.10s（228 → 231，净增 3 条） |
| 4 | `npx tsc -b` | 0 | 无输出 |
| 5 | `npx tsc -p tsconfig.electron.json` | 0 | 无输出 |
| 6 | `npm run build` | 0 | client 374ms；`dist-electron/main.cjs` 211.99 kB；`preload.cjs` 4.21 kB；143ms / 12ms |

无 skipped 用例；`git.test.ts` 中 `describe.skipIf(!hasGit)` 在本次环境（git 存在）真实执行 4/4。

### 7.4 F-05：`downloadUpdate` 清理与文件名回退

| 核对点 | 实测（`updater.ts`） | 结果 |
| --- | --- | --- |
| 半包清理 | L234-246：`pipeline` 置于 `try`，`catch` 内先 `await rm(filePath, { force: true }).catch(() => undefined)`，随后 `throw error` —— 清理失败不掩盖原始错误（断流/磁盘满） | ✅ |
| 文件名回退 | L272-283：`sanitized` 仅当 `isInstallerFileName(sanitized)` 为真才采用，否则 `standardInstallerFileName()` → `gitool-setup-${Date.now()}.exe`（命中白名单第 1 条） | ✅ |
| 安全常量未松动 | `SHA256_HEX_LENGTH=64`、`DIGEST_PREFIX`、两条白名单正则、`INSTALLER_SILENT_FLAG="/S"`、`shell: false`、`cachedInstallerPath` 全等校验均保持原状 | ✅ |
| 用例真实性 | `removes partial file on download failure`：桩**先 enqueue 一块再 `controller.error`**（真实半包），断言 `rejects(/连接中断/)` 且 `existsSync === false`；`falls back to standard installer name`：断言 `basename` 匹配 + `isTrustedInstallerPath === true` + 真实 `spawn(installerPath, ["/S"], { shell:false })` | ✅ 行为级断言，非空断言 |

### 7.5 F-04：陈旧注释

- `electron/main/ipc.ts:396` 现为：「该入参最终由 spawn 直接执行（已移除 cmd 链路），必须限制在下载目录内且命中文件名白名单。」
- `Select-String ipc.ts -Pattern 'cmd start|cmd /c start'` = **0**。

### 7.6 变异残留与掩盖性跳过检查（重点）

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| `it.skip` / `xit(` / `describe.skip(` / `test.skip` / `.todo(` | 全仓 `src/**` + `electron/**` + `shared/**` grep | **0 命中** |
| `describe.skipIf` | 仅 `git.test.ts:180`（既有环境门槛）；本次 git 可用，4 条真实执行，无 skipped | ✅ 非掩盖 |
| `.only(` | 全仓测试文件 grep | **0 命中** |
| `console.log` / `TODO` / `FIXME` / `HACK` / `XXX` / `MUTANT` / `BREAK_ME` | `git.ts` / `updater.ts` / `ipc.ts` grep | **0 命中**（命中「临时」者仅为「临时目录」「临时文件」的业务注释） |
| 被注释掉的校验行 | 关键调用点 grep：`assertNoCredentialInUrl`（L245 远程地址、L840 克隆地址、导出定义 L815）、`redactCloneOutput`（L707 进度、L750 error、L756 成功、L764 失败、定义 L804） | 全部在调用且未被注释/短路 |
| 空断言 | `expect(true)` / `expect(1).toBe` / `.todo` 全仓扫描 | **0 命中**；唯一 `toBeTruthy()` 在既有 `navigation.test.ts:56`，非本次文件 |
| 安全常量被放宽（变异迹象） | 逐项核对 7.4 常量表 | 未被修改 |
| 构建/产物污染 | `git status --porcelain` | 仅原有 10 个 M + 4 个新增测试 + docs；`dist/`、`dist-electron/` 被 gitignore |

**结论**：未发现变异验证遗留的破坏性改动、临时跳过用例、调试输出或被注释掉的校验行。测试为行为级断言，具备真实守门能力（7.2 的 B 组实验即回归态，新用例的 10s 看门狗会在该状态下抛错转红）。

### 7.7 仍未解决的遗留项（非阻塞，移交第 2 批）

1. **F-02（P2）仓库自身 `.git/config` 存量 helper**：复验时再次确认仍存在——`git config --local --get-all credential.helper` 返回 `!f() { … "$GITOOL_ASKPASS_TOKEN" … } f`，`.git/config:9` 保留该行。返修未触碰（正确：属存量迁移，需人类确认后 `git config --unset-all credential.helper` 清理）。已升级用户的旧仓库同样受影响。
2. **F-03（P2）非 clone 域脱敏**：`runGitOperation` / `commitChanges` 的 output 仍直接回渲染层；`redactSecrets` 仍不覆盖 `?access_token=xxx` / `token=xxx` 形态；`operationCsv.test.ts` 仍无 CSV 脱敏用例。
3. **F-06（P3）TOCTOU / symlink**：`isTrustedInstallerPath` 只做静态 `resolve`，install 前无二次 digest 校验。
4. **F-07（P3）其余测试缺口**：`isTrustedInstallerPath` 的 UNC / 短名 / symlink，`checkForUpdates` 的 digest 格式非法，`downloadUpdate` 的 HTTP 非 200 / 无 content-length。