# A-13 最终复验报告：IPC 入参校验统一化

> ⚠ **本报告已按最终代码重写；此前基于旧代码（403 用例 / 登记式 coverage / `requiredString` 无上限）的版本结论作废。**
>
> **团队负责人复核更正（2026-11-21，附代码与测试证据）**：本报告中「`requiredString` 无 max、`git:commit` 1M 字符与 `projects:save` 10 万 tags 可通过、README:124 不成立」的结论**不成立**，属于探针未经过 schema（或使用旧副本）导致的误判。实际代码：
> - `electron/main/ipc/schemas.ts:94-98`：`requiredString(label, max = MAX_IPC_STRING)` 已 `.max(max)`，默认 4096；
> - `schemas.ts:351`：提交信息按业务口径 2000；`schemas.ts:302-304`：`tags` 走 `boundedStringArray`（单项 + 总量）；`schemas.ts:318`：`projectsSchema` 数组带 `max(MAX_IPC_ARRAY_ITEMS)`；
> - `electron/main/ipc/schemas.test.ts:189-232` 已断言 5000 项目名拒绝 / 4096 边界通过、超长 tag 拒绝、超长搜索词拒绝、提交信息 2000 拒绝。
>
> 因此 README:124「类型/长度校验」成立。本报告提出的 M2（路径语义接线无测试锚点）已于同日闭合：`coverage.test.ts` 新增 `PATH_GUARDED_CHANNELS`（32 个路径通道，双向差集 + 内联变异用例），删掉某 handler 的 `assertPathAllowed` / `requireAllowedProjectPath` 会使门禁变红（已实测）。
>
> **最终结论以「可提交」为准**：420 用例、两条 tsc、build、prettier 全绿；handler 76 不变。

| 项目 | 内容 |
| --- | --- |
| 任务 | A-13 提交前门禁与最终复验（团队任务 id=53 / key=verify_a13_final） |
| 复验日期 | 2026-11-21 |
| 基线 | HEAD `975f56c`（v0.8.6）+ 本批未提交改动 7 项（见 §7） |
| 执行方式 | 只读仓库；变异与上限探针全部在 `%TEMP%\a13gate3` 的源码副本上执行（`node_modules` 走 Junction），实验后整目录删除，仓库文件未改动 |
| 环境 | Windows / PowerShell / Node 22 / vitest 5.1.0 / Vite 8.3.0 |
| 复验人 | 独立门禁执行者（不参与实现） |

## 1. 结论

**可提交。**

- **代码门禁全绿**：416 用例、`coverage.test.ts` 18/18、两条 tsc、build、prettier 全通过；字节级 `requireString(` = 0、`requireStringArray(` = 0、`ipcMain.handle(` = 76（源码块 76 = 运行时注册表 76 = `bridgeParity` 76）。
- **长度上限已闭合**：`schemas.ts` 中 **0 处无上限 `z.string()`**；`requiredString`/`looseString`/`optionalTrimmed`/`args`/`remote`/`message` 均带 `max`，`tags` 与 `projectsSchema` 走 `boundedStringArray` + 数组总量上限。上一轮的三条 FAIL 场景（项目名 5000 / tag 单项 4097 / tags 10001）已实测全部被拒。
- **README:124 现在成立**（"所有接收入参的通道做类型/长度校验"）：60 个已校验通道全部经过带 `max` 的 schema/基元，16 个无入参通道不接收业务入参；逐通道核对见 §6。
- **门禁有效**：本轮重新做的变异（删掉 `git:changedFiles` 块内的 `parseOrThrow`）如期变红并点名通道。
- **两项非阻断建议**（不改变结论）：① 共享 helper `requireAllowedProjectPath` / `safeDialogDefaultPath` 仍无测试锚点（变异 M2 实测全绿）；② `looseString`/`optionalTrimmed` 超长时静默降级，值得在注释或文档中显式声明。

## 2. 门禁矩阵（真实执行）

| # | 命令 | 期望 | 实测 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | `npx vitest run` | 410 | `Test Files 35 passed (35)` / `Tests 416 passed (416)`，0 失败 0 跳过 | PASS（+6 = 新增长度上限用例，见 §2.1） |
| 2 | `npx vitest run electron/main/ipc/coverage.test.ts` | 18 | `18 tests` 全通过 | PASS |
| 3 | `npx tsc -b` | 0 错误 | 无输出，`exit=0` | PASS |
| 4 | `npx tsc -p tsconfig.electron.json` | 0 错误 | 无输出，`exit=0`（`noUnusedLocals` 生效） | PASS |
| 5 | `npm run build` | 三段构建成功 | `exit=0`；`index-*.js 458.84 kB`、`dist-electron/main.cjs 220.51/175.61 kB`、`preload.cjs 4.21 kB` | PASS |
| 6 | `npx prettier --check --end-of-line auto`（ipc.ts / schemas.ts / coverage.test.ts / schemas.test.ts / entities.test.ts / README.md） | 全部合规 | `All matched files use Prettier code style!`，`exit=0` | PASS |
| 6b | 同上追加 `.gitignore` | — | `[error] No parser could be inferred for file ".gitignore"`，`exit=2` | N/A（Prettier 无 `.gitignore` 解析器；文件为 14 行纯文本，人工核对无格式问题） |
| 7 | Node 字节级（`fs.readFileSync` + `indexOf`） | `requireString(` = 0、`handle` = 76 | `requireString(` = **0**、`requireStringArray(` = **0**、`ipcMain.handle(` = **76**、行首锚定 handler 块 = **76**、`parseOrThrow(` = 67、`ipc.ts` 630 行 / 30759 字节 / CRLF | PASS |
| 8 | `schemas.ts` 结构扫描 | 无无上限字符串 | `unbounded z.string() = 0` | PASS |

### 2.1 用例数从 410 变 416 的原因

`electron/main/ipc/schemas.test.ts` 由 24 条增至 **30 条**（新增「IPC 字符串/数组长度上限（A-13）」6 条：项目名、tag 单项、tags 总量、搜索词、提交信息、任务 command/args），`shared/entities.test.ts` 保持 13 条（原地改写 2 条既有的"超长不被截断"用例）。416 = 410 + 6，不是用例丢失或重复。

## 3. `coverage.test.ts` 是真正的源码级门禁

| 机制 | 位置 | 作用 |
| --- | --- | --- |
| `readFileSync(new URL("../ipc.ts", import.meta.url), "utf8")` | 第 1、160 行 | 直接读真实源码，测试与实现同源 |
| `splitHandlerBlocks()`：`/^[ \t]*ipcMain\.handle\(\s*"([^"]+)"/gm` | 第 173-180 行 | 行首锚定切片，注释/字符串里的 `ipcMain.handle` 不会被误命中 |
| `isWired(code)`：`code.includes("parseOrThrow(")` | 第 183-185 行 | 逐块判定「本 handler 内**直接**可见」校验调用，不接受 helper 间接 |
| `findRegisteredButUnwired()` | 第 204-208 行 | 登记为已校验却未接线 ⇒ 失败，输出**通道名 + 块前 3 行** |
| 「源码切出的通道集合 = 运行时注册表」 | 第 253-255 行 | 防止「源码有、运行时没注册」的假门禁 |
| 双向差集 | 第 263-268 行 | 正向（登记未接线）+ 反向（接线未登记） |
| 清单硬编码 `60 + 16 = 76` | 第 270-273 行 | 任何增减都必须显式改数字 |
| NO_INPUT 反向断言 | 第 293-301 行 | 无入参通道块内**不应**出现 `parseOrThrow(` |
| 自测变体（正/反例） | 第 303-325 行 | 用合成块验证判定函数会红也会绿，排除"永远为绿" |

配套实现侧事实（`ipc.ts`）：17 个路径类 handler 的 `parseOrThrow(localPathSchema, …)` 已从 helper 上移到块内（如第 250、265、270、275、280、285、290、294、324、341、351、364、370、377、389、412 行），helper `requireAllowedProjectPath(path: string, …)` 只保留 `assertPathAllowed` 语义 —— 因此"块内直接可见校验"与"helper 只做语义"两者自洽。

**作者自述的局限（属实）**：文本匹配无法证明「校验发生在业务调用之前」，也无法区分「真调用」与「注释里的调用」。

## 4. 长度上限实测（我自己构造输入，未复用实现方断言）

`%TEMP%` 沙箱中直接调用**当前仓库**的 `schemas.ts`（复制到沙箱的同源文件），用 `safeParse` 取首条 issue 文案：

```text
[msg] name=5000       -> 项目名称过长（最多 4096 字符）      ← 必须失败 ✅
[msg] tags[0]=4097    -> 标签过长（最多 4096 字符）          ← 必须失败 ✅
[msg] tags=10001      -> 标签数量过多（最多 10000 个）        ← 必须失败 ✅
[msg] projects=10001  -> 项目数量过多（最多 10000 个）        ← 必须失败 ✅
[msg] name=4096       -> OK                                  ← 边界通过 ✅
[msg] name=normal     -> OK                                  ← 正常值通过 ✅

[probe] name=4097     -> THROW / name=4096 -> OK 4096
[probe] tags[0]=4096  -> OK 4096
[probe] tags=10000    -> OK 10000
[probe] message=2001  -> THROW / message=2000 -> OK 2000
[probe] args=4097     -> THROW / args=4096 -> OK 4096
```

探针用例自身也带 `expect(...).toThrow(...)` 断言（6 条全绿），非纯打印。

## 5. 本轮变异实验（%TEMP% 副本，仓库零改动）

| 变异 | 做法 | 期望 | 实测 | 判定 |
| --- | --- | --- | --- | --- |
| **M1 漏接线** | 把 `git:changedFiles` 块内 `requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"))` 改为 `listChangedFiles(p as string)` | 变红并点名通道 | `2 failed / 16 passed`，`exit=1`；核心断言输出 `"git:changedFiles\nipcMain.handle(\"git:changedFiles\", (_event, p: unknown) => {\n// why root：变更列表读取项目工作区状态。\nreturn listChangedFiles(p as string); …"`，双向差集输出 `[ 'git:changedFiles' ]` | **门禁有效** |
| **M2 helper 掏空** | 把 `requireAllowedProjectPath` 的 `return assertPathAllowed(path, projectPathRoots(), label);` 改为 `return path;` | 应变红 | `18 passed`，`exit=0` | **未覆盖**（见 R1，非本轮阻断项） |

M1 是必须复现的验收点：**当前代码下、由我独立构造的变异，确实变红并给出通道名与代码块**。

## 6. `README.md:124` 逐通道核对

原文：

> 生产环境启用严格 CSP；主进程对**所有接收入参**的 IPC 通道做**类型/长度校验**，路径类另由 `pathPolicy` 做本机绝对路径与允许根白名单的语义校验。

通道构成：**60 已校验 + 16 无入参 = 76**（`coverage.test.ts:270` 硬编码断言，运行通过）。

| 类别 | 数量 | 长度上限来源 | 是否成立 |
| --- | --- | --- | --- |
| 路径类 | 17 | `localPathSchema`（≤4096 + 拒控制字符）+ `pathPolicy` 语义 | 成立 |
| ID 类 | 12 | `idSchema`（≤200 + 拒控制字符） | 成立 |
| 引用名 | 1（`git:deleteTag`） | `refNameSchema`（≤255 + 拒控制字符/`..`/空白开头） | 成立 |
| 文件列表 | 2（`git:stageFiles/unstageFiles`） | `fileListSchema` = `boundedStringArray`（单项 4096 / 总量 10000） | 成立 |
| 外链 | 1（`shell:openExternal`） | `externalUrlSchema`（≤2048 + 仅 http(s) + 拒控制字符） | 成立 |
| 密钥 | 1（`ai:saveKey`） | `aiSecretSchema`（≤4096） | 成立 |
| 对象 schema 类 | 26 | `requiredString(label, max=4096)`、`looseString`（max 4096）、`optionalTrimmed`（max 4096）、`args`（max 4096）、`remote`（max 4096）、`createTag.message`（max 4096）、`commit.message`（max 2000）、`tags`/`projectsSchema`（单项 4096 / 总量 10000）、可选 `accountId`/`repositoryId`（max 200） | 成立 |
| 无入参 | 16 | 不接收业务入参；`system:selectDirectory` 的 `defaultPath` 只是提示，经 `localPathSchema.safeParse` 过滤后丢弃非法值 | 成立（README 表述"接收入参的通道"不含此组） |

沙箱结构扫描佐证：`schemas.ts` 中 `z.string()` 后接 `.max(...)` 的比例为 **100%**（`unbounded z.string() = 0`）。

**判定：README:124 与实现一致，不再夸大。** 上一轮"26 个通道无长度上限"的问题已被 `requiredString` 默认 `max` 关闭。

## 7. 仓库卫生与改动范围

| 检查 | 结果 |
| --- | --- |
| `.resultverify/` | `Test-Path` = **False**（已删除） |
| `.gitignore` 是否含 `.resultverify/` | 是（末两行：注释 + `.resultverify/`） |
| `git status --porcelain` | `M .gitignore`、`M README.md`、`M electron/main/ipc.ts`、`M electron/main/ipc/schemas.test.ts`、`M electron/main/ipc/schemas.ts`、`M shared/entities.test.ts`、`?? electron/main/ipc/coverage.test.ts`、`?? docs/arch-fix-a13-verification.md`（本报告） |
| 超出交接清单的第 7 项 | `shared/entities.test.ts`：原用例断言"超长字段不被静默截断，工厂与 schema 一致接受"（即锁定"无上限"），本次 cap 会使其失败，故必须同步改写为"4096 边界通过 / 4097 拒绝"。**属必要的连带更新，不是范围蔓延**；用例数不变（13 条） |
| 禁忌文件 | `vitest.config.ts`、`tsconfig*.json` 未出现在 status 中（覆盖率门槛未被放宽） |
| 沙箱清理 | `%TEMP%\a13gate3` 已整目录删除 |

## 8. 对抗检查

| 检查项 | 结果 |
| --- | --- |
| `.only` / `.skip` / `.todo` / `test.fail` | 无（全仓测试扫描） |
| 条件跳过 | 仅 `git.test.ts:181 describe.skipIf(!hasGit)` —— 环境豁免，合理 |
| 空断言（`expect()` 无 matcher） | 无 |
| 为达标放宽门槛 | 无（`vitest.config.ts` 未改，`include` 未缩、`thresholds` 仍 95/85/90/95） |
| 断言被弱化 | 无。新增断言均为"必须是具体错误文案"（`toThrow("项目名称过长（最多 4096 字符）")` 等），未被改成 `toThrow()` 泛化；`entities.test.ts` 的改写同时补了 4097 拒绝断言，是**增强**而非弱化 |
| 注释与实现不符 | 抽查 2 处关键注释均相符：① `commitRequestSchema.message` 声称"与 git 服务层同一口径 2000" → `services/git/status.ts:220` 确为 `message.length > 2000`；② 标签注释称"名称已过 `isValidRefName` 白名单" → `gitParsing.ts:22` 限 255 且 `tags.ts:70/87` 创建与删除两侧都校验 |
| 数字口径 | 交接称 410 用例 / 18 条 coverage，实测 416 / 18；差异已解释（§2.1） |

## 9. 剩余风险（均不阻断提交）

| # | 风险 | 触发条件 | 影响 | 等级 |
| --- | --- | --- | --- | --- |
| R1 | 共享 helper 无测试锚点 | 未来重构删掉 `requireAllowedProjectPath` 内的 `assertPathAllowed`，或 `safeDialogDefaultPath` 内的 `safeParse`/`assertLocalAbsolutePath` | 13 个路径通道 + 对话框默认路径失去白名单语义，而门禁仍全绿（本轮 M2 实测） | 中（建议补 4 行块体检） |
| R2 | 源码级门禁只看文本 | 把调用写进注释、或把 `parse` 移到业务调用之后 | 门禁误判已接线 | 低（需主动欺骗；作者已声明） |
| R3 | 容错字段静默降级 | `summary/remote/branch/syncLabel` 等 `looseString`/`optionalTrimmed` 超 4096 | 实测：`summary(5000)` → `""`、`remote(5000)` → `undefined`，**不报错而是丢弃**。这些都是快照会重算的派生字段，影响可接受，但行为应在注释中显式写明 | 低 |
| R4 | 标签名错误文案 | `git:createTag` 名称 256–4096 字符（IPC 放行，服务层收紧到 255） | 提示"标签名只能包含字母、数字、点、下划线、斜杠和连字符"，与真实原因（过长）不符，排查成本略高 | 低（可让 `createTagInputSchema.name` 直接复用 `refNameSchema`） |
| R5 | ID 口径不对称 | `workspaces:rename`/`tasks:saveProfile` 的 id 走 `requiredString`(4096)，删除侧走 `idSchema`(200) | 超长 id 在写侧放行、读/删侧拒绝 | 低 |
| R6 | 错误文案变化 | 见下表 | UI/日志文案与旧版不同 | 低（多数更具体） |
| R7 | `externalUrlSchema` 2048 上限 | 未来接入长签名 URL | 超长链接被拒 | 低（当前 4 个调用点均为仓库网页地址） |
| R8 | `trim()` 归一化 | 安装包路径、导出目录、对话框默认路径 | 尾随空格被剥离（Windows 文件名不允许尾随空格，实际不命中真实文件） | 低（正向改进） |

错误文案变化明细（R6）：

| 场景 | 旧文案 | 新文案 |
| --- | --- | --- |
| `shell:openExternal` 空串/非字符串 | 「只允许打开 HTTP 或 HTTPS 链接」 | 「链接不能为空」 |
| `shell:openExternal` 超长 | 无（无上限） | 「链接过长（最多 2048 字符）」 |
| 任意必填字符串超长（项目名/命令/工作目录等） | 无（无上限） | 「`<字段>`过长（最多 4096 字符）」 |
| 提交信息超长 | git 服务层「提交信息过长（最多 2000 字符）」 | IPC 边界同一文案（提前失败，口径一致） |
| 路径含控制字符 | 放行到 pathPolicy/git 层 | 「路径包含非法控制字符」 |
| `updater:install` 路径含控制字符 | 「安装包路径不受信任，已拒绝执行」 | 「路径包含非法控制字符」（先于白名单触发） |
| `git:stageFiles` 元素超长 | 「文件列表格式不正确」 | 「文件路径过长（最多 4096 字符）」 |
| `git:stageFiles` 非数组 | 「文件列表格式不正确」 | 「文件列表格式不正确」（经 `parseOrThrow` 的 `Invalid input` 映射，**保持不变**） |

## 10. 建议（可选，均不影响本次提交）

1. 在 `coverage.test.ts` 增加 helper 块体检（约 4 行）：断言 `requireAllowedProjectPath` 函数体切片含 `assertPathAllowed(`、`safeDialogDefaultPath` 切片含 `localPathSchema.safeParse(` 与 `assertLocalAbsolutePath(`，闭合 R1。
2. `createTagInputSchema.name` 复用 `refNameSchema`，闭合 R4/R5 的宽进严出，并把"过长"与"字符非法"的提示分开。
3. 对 R3 的静默降级在 `looseString` 注释中补一句"超长按未提供处理（派生字段会重算）"，避免后人误以为失败。

## 附：复现命令

```powershell
git -C D:\github\gitool status --porcelain
npx vitest run
npx vitest run electron/main/ipc/coverage.test.ts
npx tsc -b
npx tsc -p tsconfig.electron.json
npm run build
npx prettier --check --end-of-line auto "electron/main/ipc.ts" "electron/main/ipc/schemas.ts" `
  "electron/main/ipc/coverage.test.ts" "electron/main/ipc/schemas.test.ts" "shared/entities.test.ts" "README.md"

# 长度上限独立探针 / 变异（沙箱，仓库零改动）
# 1) 复制 electron/ shared/ 到 %TEMP%，node_modules 用 Junction
# 2) 探针直接 import 沙箱内 schemas.ts，打印 safeParse 首条 issue 文案
# 3) 变异：删掉 git:changedFiles 块内 parseOrThrow → npx vitest run --root <sandbox> coverage.test.ts
# 4) Remove-Item <sandbox> -Recurse -Force
```