# F-03 独立复验报告（非 clone 域出口脱敏）

- 复验日期：2026-11-21
- 复验对象：`electron/main/services/git.ts`、`electron/main/services/serviceUtils.ts` 及其测试（工作区 4 个改动文件）
- 复验方式：独立读 diff / 读代码 + 独立执行门禁 + 独立复现泄漏源（未修改任何业务代码）
- 环境：Windows + PowerShell，`git 2.56.1.windows.1`，Node/npm 可用

---

## 一、结论

**结论：可提交。**

| 项目 | 结果 |
| --- | --- |
| 声明核对（5 条） | ✅ 全部属实（唯 `commitChanges` 为「统一出口 + 调用点再脱敏一次」的双保险，非冗余错误） |
| 门禁（测试 ×2 / 类型 ×2 / 构建） | ✅ 退出码全部为 0，全量 **234 passed**（复现声明） |
| `git.ts` 编码 | ✅ 无 BOM、无 U+FFFD、无乱码；**全 CRLF（1136 CR / 0 LF）**，与仓库 `w/crlf` 一致 |
| 测试文件行尾 | ⚠️ 两个测试文件为全 LF（320 / 99），与仓库 `core.autocrlf=true` 下工作区习惯不一致（P3，不影响提交/运行） |
| F-03 是否真正关闭 | ✅ 是：`pull/push/fetch/sync/commit/revert/diff` 等对外文本统一经 `redactGitOutput`；新用例打在真实泄漏源上且具备变异鉴别力 |
| 副作用（`getFileDiff`） | ✅ **本批接受**：只读展示、不参与写入；误伤面窄（要求 `key=` 紧邻，代码中 `token = x` 带空格不命中） |
| 变异残留 / 掩盖性跳过 | ✅ 未发现（无 `it.skip` / `xit` / `describe.skip` / `.only` / `.todo`，无调试输出，无被注释的校验） |
| 改动范围 | ✅ `git diff --name-only` 恰好 4 个文件 |

---

## 二、门禁结果（实测）

| # | 命令 | 退出码 | 关键输出 |
| --- | --- | --- | --- |
| 1 | `npx vitest run` | 0 | `Test Files 25 passed (25)` / **`Tests 234 passed (234)`** / 2.77s |
| 2 | `npx vitest run electron/main/services/git.test.ts electron/main/services/serviceUtils.test.ts` | 0 | `Test Files 2 passed (2)` / `Tests 13 passed (13)` / 1.20s |
| 3 | `npx tsc -b` | 0 | 无输出 |
| 4 | `npx tsc -p tsconfig.electron.json` | 0 | 无输出 |
| 5 | `npm run build` | 0 | client 378ms；`dist-electron/main.cjs` 212.26 kB；`preload.cjs` 4.21 kB；152ms / 15ms |
| 6 | `git diff --name-only` | — | `git.test.ts` / `git.ts` / `serviceUtils.test.ts` / `serviceUtils.ts`（4 个） |

用例数从 231 → **234**（`git.test.ts` +1、`serviceUtils.test.ts` +2），与实现方声明一致，无 skipped。

---

## 三、声明核对表

| # | 声明 | 实测 | 判定 |
| --- | --- | --- | --- |
| 1 | `serviceUtils.ts` 新增 `SENSITIVE_PARAM_PATTERN`，插入脱敏链第 3 环 | `L58-59` 正则与声明逐字一致；`redactSecrets` 顺序为 URL → Bearer → **敏感键值** → 平台裸令牌（L76-80） | ✅ |
| 2 | `redactCloneOutput` 改名 `redactGitOutput` | `Select-String git.ts -Pattern 'redactCloneOutput'` = **0**；`redactGitOutput(` 调用点 **8** 处 + 定义 1 处 | ✅ |
| 3 | `runGitProcess` 为统一出口，内部 `runGitProcessRaw` 保留原文 | `runGitProcess`（L888-891）= `runGitProcessRaw` 后 `redactGitOutput`；`runGitProcessRaw`（L894-909）不脱敏且**未导出**，仅同文件使用（3 处调用点） | ✅ |
| 4 | `compareVersions` 的 `--numstat` 改走 raw | L343 `runGitProcessRaw(input.path, ["diff","--numstat",range])`；L339 的 `--stat` 仍走脱敏出口（仅展示） | ✅ |
| 5 | `commitRevertProcess` 两处单独脱敏 | success L671 `redactSecrets(output)`；failure L675 `redactSecrets(output \|\| failure.message \|\| …)` | ✅ |
| 6 | `commitChanges` 两处 output 已脱敏 | L557 失败分支 `redactGitOutput(result.output \|\| "提交失败")`；L561 成功分支 `redactGitOutput(result.output)` | ✅ |
| 7 | 新用例 `redacts token in operation output` 打在真实泄漏源 | L245-271；见 §五 | ✅ |

补充核对：
- `runGitProcess` 的其它调用点（`initRepository`/`getFileDiff`/`setRemoteUrl`/`createTag`/`deleteTag`/`runGitOperation`/`switchBranch`/`deleteBranch`）全部走统一出口，**错误与输出文本**均脱敏，`success` 判定不受影响。
- clone 域 5 个出口（进度、error、成功、失败、`error.message`）均改为 `redactGitOutput`。

---

## 四、编码与行尾检查

| 文件 | BOM | U+FFFD | 乱码序列（锛/銆/鈥/鐨/鏄/涓） | CRLF | 纯 LF | `git ls-files --eol` | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `git.ts` | False | 0 | 0 | 1136 | 0 | `i/lf w/crlf` | ✅ 与仓库一致 |
| `serviceUtils.ts` | False | 0 | 0 | 97 | 0 | `i/lf w/crlf` | ✅ 与仓库一致 |
| `git.test.ts` | False | 0 | 0 | 0 | 320 | `i/lf w/lf` | ⚠️ 工作区为 LF |
| `serviceUtils.test.ts` | False | 0 | 0 | 0 | 99 | `i/lf w/lf` | ⚠️ 工作区为 LF |

- 证据命令：`[IO.File]::ReadAllBytes(...)` 前 3 字节（`69 6D 70` = `"imp"`，非 `EF BB BF`）、`[IO.File]::ReadAllText(...)` + 正则统计 U+FFFD / 乱码、`git ls-files --eol`、CR/LF 计数。
- 仓库无 `.gitattributes`、`core.autocrlf=true`，既有源文件工作区均为 CRLF；两个测试文件是 LF，`git diff` 会打印“LF will be replaced by CRLF”。
- **影响评估**：提交时 git 会按 `autocrlf` 规范化为 index LF（`i/lf`），不会污染仓库、不影响构建与测试；仅工作区行尾与其它文件不一致。**P3，不阻塞**。
- 说明：此前 `git diff` 在控制台显示的“锛/銆”类乱码是 PowerShell 输出编码问题，**文件本身无乱码**（U+FFFD=0、mojibake=0，`read` 工具读取中文正常）。

---

## 五、新用例质量与变异鉴别力

`it("redacts token in operation output")`（`git.test.ts:245`）：

1. **真实泄漏源**：临时 `git init` 仓库 + `remote add origin https://127.0.0.1:1/repo.git?access_token=opaqueOperationToken123`，再执行真实 `runGitOperation(repoPath, "fetch")`。不是 mock。
2. **独立复现泄漏源**（本次另跑，未经被测代码）：
   ```powershell
   git -C <tmp> fetch
   # fatal: unable to access 'https://127.0.0.1:1/repo.git?access_token=opaqueOperationToken123/':
   # TLS connect error: ...   (exit 128)
   ```
   证明 `access_token=<token>` 会原样出现在 git stderr，泄漏源真实存在。
3. **断言对象是返回文本**：`result.output`（不是 mock 调用次数）——
   - `expect(result.output).not.toContain(secret)`；
   - `expect(result.output).toContain("access_token=***")`；
   - `expect(result.output).toContain("127.0.0.1:1")`（保留可诊断信息）。
4. **变异鉴别力**：token 为 `opaqueOperationToken123`，**不带** `ghp_/gho_/glpat-/[REDACTED_SLACK_TOKEN]` 等平台前缀，也不含 `user:pass@` 形态 → 旧三轮脱敏规则全部兜不住，只有新增的 `SENSITIVE_PARAM_PATTERN` 能挡。
5. **去掉出口脱敏是否会红**：会。若 `runGitProcess` 直接返回 raw output，`result.output` 将含 `?access_token=opaqueOperationToken123/`，第 267 行 `not.toContain` 立即失败。逻辑闭环成立。

`serviceUtils.test.ts` 新增 2 条用例（`query/form` 脱敏 + 不误伤）覆盖：URL 中单参数、`token=`、百分号编码值、多个敏感键、大小写不敏感但保留键名、CSV 逗号截断、`token_type`/`mytoken`/`tokens` 不误伤、空值保持原样、幂等。

---

## 六、副作用评估：`getFileDiff` 经统一出口脱敏

- 调用链：`getFileDiff` → `runGitProcess` → `redactGitOutput`。diff 正文若含 `key=value`（`token=`、`password=`、`access_token=` 等），值会被替换为 `***`。
- **功能影响：无**。`getFileDiff` 仅返回字符串给渲染层做只读展示（`ipc.ts:192`），不参与 `stage/commit/写入`（后者只传文件路径，不读 diff 内容）。
- **误导风险：存在但窄**：
  - 误伤要求键名与 `=` **紧邻**：`token=abc`、`TOKEN=abc`、`.env` 文件会打码；而代码里常见的 `const token = "abc"`（带空格）、JSON `"token": "abc"`（带引号/冒号）**不命中** → 对普通代码 diff 影响很小；
  - 真正受影响的是 `.env`、测试夹具、文档中的 `key=value` 示例，用户可能误以为源码写的就是 `***`。
- **建议：本批接受**。安全优先（diff 会被截图/分享，属于渲染层可见出口），无需本批为 diff 单开 raw。第 2 批可选优化：为 `getFileDiff` 提供 raw 出口 + UI 标注「敏感值已脱敏」，或仅对 `.env`/凭据类文件脱敏。

---

## 七、残留泄漏面清单

### P1（无）

### P2

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| R-1 | `git.ts` `runGit`（L869-875）及其无 `catch` 的调用方：`stageFiles`(L525)、`unstageFiles`(L536)、`createBranch`(L583)、`getProjectSnapshot`(L382-383，ipc:171 直连) | `runGit` 失败时**直接抛 execFile 原始 error**，`error.message` 含 stderr 原文（`Command failed: git -C ...\n<stderr>`），未经 `redactGitOutput`。若 stderr 回显带凭据的 remote/URL（如仓库配置内嵌 token），会绕过 F-03 的统一出口。 | 让 `runGit` 也走同一脱敏策略：失败时抛 `new Error(redactSecrets(...))` 或改为 `runGitProcessRaw` + 统一包装；对 `stageFiles/unstageFiles/createBranch` 的错误做脱敏。 |

### P3

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| R-2 | `listTags`（L258-272，ipc:198） | `%(contents:subject)` 作为 `message` 直出渲染层，未脱敏；tag 注解可能含 `token=`。 | 对 `message` 过 `redactGitOutput`（解析不变，仅展示字段脱敏）。 |
| R-3 | `listCommitHistory`（L622，ipc:239） | `subject` / `message` 为用户可控文本，直出未脱敏；提交信息误贴 token 时会在 UI 显示。 | 展示前对 `subject/message` 脱敏（解析仍用原文）。 |
| R-4 | `listChangedFiles` / `compareVersions.changedFiles` | 变更文件**路径**直出；文件名形如 `token=xxx` 时未脱敏。 | 展示层可选脱敏；优先级低（路径本身已由用户可见）。 |
| R-5 | `redactSecrets` 覆盖形态 | JSON `"token": "abc"`、带空格的 `token = abc`、header `X-Api-Key: abc`、`?sig=` 等未覆盖。 | 第 2 批扩展 `["']?key["']?\s*[:=]` 形态与常见自定义头；注意避免 diff 过度打码。 |
| R-6 | 两个测试文件行尾 | `git.test.ts` / `serviceUtils.test.ts` 全 LF，与仓库工作区 CRLF 不一致。 | 提交前 `git add --renormalize` 或编辑器统一 CRLF；不阻塞。 |

> 说明：`readProjectReadme`（ipc:183）直出 README 正文，**不属于 git 输出**，脱敏会破坏文档展示，判定为合理不处理。

---

## 八、变异实验残留与掩盖性跳过检查

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| `it.skip` / `xit(` / `describe.skip(` / `test.skip` / `.only(` / `.todo(` | `grep` 全仓 `electron/**`、`src/**`、`shared/**` | **0 命中** |
| `describe.skipIf` | `grep *.test.ts` | 仅 `git.test.ts:181`（既有环境门槛）；本次 git 可用，5 条真实执行，无 skipped |
| 实现文件调试残留（`console.log`/`TODO`/`FIXME`/`HACK`/`XXX`/`MUTANT`/`BREAK_ME`） | `git.ts`、`serviceUtils.ts` grep | **0 命中**（命中「xxx」者仅为注释里的示例占位符） |
| 空断言 | `expect(true)` / `expect(1).toBe` / `toBeTruthy()` | **0 命中** |
| 被注释/短路的校验 | 关键调用点 grep | `redactGitOutput` 8 处、`redactSecrets` 2 处（revert）、`runGitProcessRaw` 3 处均在位，未被注释 |
| 输出污染 | `git status --porcelain` | 仅 4 个目标文件 + `.opencode/`；`dist*` 被 gitignore |

**结论**：未发现变异实验遗留或掩盖性跳过。

---

## 九、建议后续动作

1. **本批可提交**：F-03 的对外出口（clone 域 + 操作域 + commit/revert/diff）已统一收口，测试具备真实鉴别力。
2. **第 2 批（按优先级）**：
   - R-1：`runGit` 错误出口脱敏（同类问题的最后一条未收口路径）；
   - R-2 / R-3：`listTags.message`、`listCommitHistory.subject/message` 展示前脱敏；
   - R-5：扩展 JSON / 带空格 / 自定义头等形态，并补 `getFileDiff` 的误伤回归测试；
   - R-6：测试文件行尾统一 CRLF。
3. **可选**：为 `getFileDiff` 增加 raw 出口或 UI「已脱敏」提示，兼顾代码审查可读性。

---

## 十、原始输出摘录

```
npx vitest run
  Test Files  25 passed (25)
       Tests  234 passed (234)

npx vitest run electron/main/services/git.test.ts electron/main/services/serviceUtils.test.ts
  Test Files  2 passed (2)
       Tests  13 passed (13)

npx tsc -b                              -> EXITCODE=0
npx tsc -p tsconfig.electron.json       -> EXITCODE=0
npm run build                           -> EXITCODE=0 (main.cjs 212.26 kB / preload 4.21 kB)

git diff --name-only                    -> 4 files

[redactCloneOutput in git.ts]=0
[redactGitOutput( call sites]=8
[runGitProcessRaw( call sites]=3

git.ts               BOM=False FFFD=0 CR=1136 LF=0
serviceUtils.ts      BOM=False FFFD=0 CR=97   LF=0
git.test.ts          BOM=False FFFD=0 CR=0    LF=320
serviceUtils.test.ts BOM=False FFFD=0 CR=0    LF=99

真实泄漏源复现（独立执行，未经被测代码）:
  git -C <tmp> fetch
  fatal: unable to access 'https://127.0.0.1:1/repo.git?access_token=opaqueOperationToken123/':
  TLS connect error: ... (exit 128)
```