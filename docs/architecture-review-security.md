# Electron 安全与工程配置评审报告

> 评审对象：`D:\github\gitool`（Electron 43+/Vite/React 19/TypeScript 桌面 Git 工作台，v0.8.0）
> 评审角度：Electron 安全边界、IPC 攻击面、命令执行、凭据与不可信内容、构建与供应链配置
> 评审方法：**纯静态只读**（源码与配置逐行核对 + 通道计数脚本），不修改任何业务代码
> 评审日期：2026-11-21
> 证据约定：所有结论附 `文件:行号`；静态无法确认的运行时行为显式标注 **「需运行期验证」**，不推定可利用性

---

## 〇、结论摘要

| 维度 | 判定 | 一句话 |
| --- | --- | --- |
| BrowserWindow 安全基线 | ✅ 达标 | `contextIsolation:true / nodeIntegration:false / sandbox:true / webSecurity:true` 全项到位，加载本地文件，无 shell 注入式 Git 调用 |
| preload 暴露面 | ✅ 基本达标 | 80 个显式方法，未暴露 `ipcRenderer`/`shell`/`fs` 原语；与 `src/electron.d.ts` 类型同源，**无结构漂移** |
| IPC 入参校验 | ⚠ 部分达标 | 78 个 handler 中仅 30 个走 zod；**33 个有入参通道未走 schema**，其中 30 个仅做"非空字符串"校验（无长度/格式上限） |
| 命令执行 | ⚠ 部分达标 | Git 域全 `execFile` 数组传参（优秀）；但 `updater:install`、任务执行、UAC 安装存在拼接/`shell:true` 面 |
| 凭据存储 | ✅ 达标 | PAT / AI Key 走 `@napi-rs/keyring`（Windows 凭据管理器），SQLite 只存 `credentialRef` |
| 凭据外泄通道 | ❌ 未达标 | 远程 URL 允许内嵌 `user:token@`，Git 输出未脱敏即落库与导出 CSV，与 README 承诺不符 |
| CSP 与不可信内容 | ⚠ 部分达标 | README 渲染链（markdown-it `html:false` + 协议白名单）安全；CSP 生产最小化良好，但缺权限策略与签名校验 |
| 工程与供应链配置 | ❌ 未达标 | **无代码签名**、更新包**无哈希/签名校验**、CI 无依赖漏洞扫描 |

**当前未发现 P0（无需任何前置条件即可远程利用的问题）。最严重的 1 个问题是 P1 级「更新链未签名校验」**：应用会自行从第三方个人 GitHub 仓库拉取 release 资产并在本地执行安装包，全程只校验"路径在临时目录内 + 后缀 `.exe`"，一旦该账号/仓库被接管或资产被替换，即为所有终端用户的一键 RCE，且应用自身安装包同样未签名（用户无法通过签名差异察觉异常）。详见 SEC-01。

---

## 一、安全基线判定（对照 Electron 官方 Security Checklist）

| # | 检查项 | 判定 | 实际取值 / 证据 |
| --- | --- | --- | --- |
| 1 | `contextIsolation` 开启 | ✅ | `true` — `electron/main/index.ts:95` |
| 2 | `nodeIntegration` 关闭 | ✅ | `false` — `index.ts:96` |
| 3 | `sandbox` 开启 | ✅ | `true` — `index.ts:97`（preload 只依赖 `electron` 少量 API，与 sandbox 兼容） |
| 4 | `webSecurity` 开启 | ✅ | `true` 显式声明 — `index.ts:98` |
| 5 | `allowRunningInsecureContent` 关闭 | ✅ | 未显式设置，取 Electron 默认 `false`；**需运行期验证**（无任何代码覆盖该默认值） |
| 6 | 生产环境不加载远程 URL | ✅ | `loadFile(join(currentDirectory, "../dist/index.html"))` — `index.ts:149`；远程 URL 仅 `VITE_DEV_SERVER_URL`（开发态，`index.ts:20,147`） |
| 7 | 禁止 `will-navigate` 跳出应用 | ✅ | 仅放行 dev server 前缀，其余 `preventDefault` — `index.ts:139-144` |
| 8 | `window.open` 收口 | ✅ | `setWindowOpenHandler` 一律 `deny`，http(s) 转系统浏览器 — `index.ts:132-137` |
| 9 | 禁用 `<webview>` | ⚠ | 未显式设置 `webviewTag:false`，依赖默认 `false`；全仓库无 `webviewTag` / `will-attach-webview` 代码（grep 结果为空）。**需运行期验证**（Electron 大版本默认值变动时无兜底） |
| 10 | 禁用 remote 模块 | ✅ | 未使用 `@electron/remote`，`enableRemoteModule` 在 Electron ≥14 已移除（`package.json:38` 为 Electron 44） |
| 11 | preload 不泄漏 Node 原语 | ✅ | 仅 `contextBridge.exposeInMainWorld("gitool", bridge)` — `electron/preload/index.ts:178`，`bridge` 为 80 个显式方法（`preload/index.ts:54-176`），无 `ipcRenderer`、无 `fs`/`shell` 直通 |
| 12 | preload 与渲染层类型一致 | ✅ | `src/electron.d.ts:1-9` 直接引用 `shared/types.ts` 的 `DesktopBridge`（`shared/types.ts:458-546`），preload 以 `const bridge: DesktopBridge` 实现（`preload/index.ts:54`），结构漂移会被 `tsc -b` 拦截 |
| 13 | CSP 存在且生产最小化 | ⚠ | 生产：`script-src 'self'`；开发：`'unsafe-inline'` + 允许 `ws://localhost:1420` — `vite.config.ts:21-34`；缺 `frame-ancestors`、`worker-src` |
| 14 | 权限请求（摄像头/麦克风/通知/地理位置）显式拒绝 | ❌ | 全仓库无 `setPermissionRequestHandler` / `setPermissionCheckHandler`（grep 结果为空）→ **沿用 Electron 默认放行策略**，需运行期验证默认值 |
| 15 | IPC 入参全部校验 | ⚠ | 30/78 走 zod，48 未走（详见第三节） |
| 16 | 错误信息不泄露内部细节 | ⚠ | `ipc.ts:159`、`database.ts:106`、`providers.ts:61/96` 直接透传底层 message；未泄露 stack（Electron 只回传 message，`preload/index.ts:41-52` 仅剥前缀） |
| 17 | 敏感数据用系统安全存储 | ✅ | `@napi-rs/keyring`（Windows Credential Manager）— `credentials.ts:1-13` |
| 18 | 代码签名 / 更新完整性校验 | ❌ | `electron-builder.yml` 无 `certificateFile`/`signtool`/`forceCodeSigning`（全文 39 行）；`updater.ts` 无哈希/签名校验 |

**判定汇总**：窗口层与进程隔离层**完全达标**（这是本项目最扎实的部分）；失分集中在 **① 更新与安装链路完整性、② IPC 校验一致性、③ 凭据外泄通道、④ 依赖与签名工程配置**。

### 1.1 窗口安全实测细节（`electron/main/index.ts:83-152`）

```ts
// electron/main/index.ts:93-99 —— 实测取值
webPreferences: {
  preload: join(currentDirectory, "preload.cjs"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
}
```

- 窗口 `show: false` + `ready-to-show` 再显示（`index.ts:90,102`），避免白屏闪烁；
- `did-fail-load` 会把 `url` 写入主进程日志（`index.ts:106-108`）——仅本地 `file://`/dev URL，不涉及远程输入，可接受；
- 托盘与单实例锁（`index.ts:155-191`）不构成安全面；
- `before-quit` 统一回收子进程（`index.ts:34-45,168`），避免孤儿进程残留——**对「任务命令」这类 shell 子系统是必要的正向控制**。

---

## 二、preload 暴露面全量清单

### 2.1 暴露方式

```ts
// electron/preload/index.ts:41-52
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try { return (await ipcRenderer.invoke(channel, ...args)) as T; }
  catch (error) { throw new Error(cleanMessage(error)); }   // 剥离 "Error invoking remote method 'x':"
}
// :178
contextBridge.exposeInMainWorld("gitool", bridge);
```

`invoke` 是**模块内私有函数**，未注入 window；因此渲染层**无法**构造任意 channel（这是本设计的关键优点，避免了 `ipcRenderer.invoke` 直通型漏洞）。

### 2.2 80 个暴露方法（按域分组，`:行号` 为 `preload/index.ts`）

| 域 | 方法（channel） | 数量 |
| --- | --- | --- |
| system（55-57） | `environment`(system:environment)、`refreshEnvironment`、`installGit` | 3 |
| system 事件（58-66） | `onInstallProgress`(setup:installProgress) | 1 |
| system 目录选择（67） | `selectDirectory`(system:selectDirectory) | 1 |
| shell（68-71） | `openExternal`、`openPath`、`openInEditor`(shell:openEditor)、`openInTerminal` | 4 |
| projects 读取（72-77） | `inspectProject`、`getProjectSnapshot`、`analyzeProject`、`detectProjectCommands`、`getDiskSize`、`readProjectReadme` | 6 |
| projects 变更（78-80, 139-145） | `runGitOperation`、`cloneRepository`、`moveProject`、`initRepository`、`setRemoteUrl` | 5 |
| projects 其他（141-143） | `scanDirectoryForRepositories`、`getFileDiff`、`onCloneProgress`(git:cloneProgress) | 3 |
| git（90-99, 146-150） | `listChangedFiles`、`stageFiles`、`unstageFiles`、`commitChanges`、`listBranches`、`createBranch`、`switchBranch`、`deleteBranch`、`listCommitHistory`、`revertCommit`、`listTags`、`createTag`、`deleteTag`、`listVersions`、`compareVersions` | 15 |
| projects 持久化（100-101） | `loadProjects`、`saveProjects` | 2 |
| workspaces（102-105） | `listWorkspaces`、`createWorkspace`、`renameWorkspace`、`deleteWorkspace` | 4 |
| accounts（106-109） | `loadAccounts`、`createAccount`、`testAccount`、`deleteAccount` | 4 |
| remoteRepositories（110-124） | `load`、`loadCached`、`cacheMeta`、`search`、`interact`、`create`、`update`、`delete` | 8 |
| tasks（125-130, 144） | `listProfiles`、`saveProfile`、`deleteProfile`、`run`、`stop`、`listRuns`、`getRunningOutput` | 7 |
| backups（131-133） | `list`、`create`、`restore` | 3 |
| operations（134-136） | `list`、`clear`、`export` | 3 |
| settings（137-138） | `load`、`save` | 2 |
| ai（151-154） | `generateSummary`、`saveApiKey`、`deleteApiKey`、`hasApiKey` | 4 |
| updater（155-175） | `check`、`download`、`install`、`onUpdateAvailable`、`onUpdateProgress` | 5 |
| **合计** | 76 个 `invoke` 通道 + 4 个事件订阅 = **80 个方法** | **80** |

**暴露面评价**：均为"业务语义方法"，**没有一个方法接受任意 channel 名或任意命令字符串**（`runTask` 只接受 `profileId`，命令由主进程从 DB 读出——这一点比常见 Electron 应用更严）。真正的风险不在"暴露了什么原语"，而在**这些语义方法内部对参数的校验强度**（第三节）。

### 2.3 `src/electron.d.ts` 与实际暴露的一致性

- **结构漂移：无**。`electron.d.ts:1-9` 使用 `interface Window { gitool?: DesktopBridge }`，`DesktopBridge`（`shared/types.ts:458-546`）为 preload 的显式实现类型；缺方法 → `tsc -b` 直接失败。
- **语义漂移（需关注）**：
  1. `gitool?` 为可选，渲染层所有调用必须先 `requireDesktopBridge()`（`src/lib/bridge.ts:14-20`），异常文案"该功能需要在 Gitool 桌面应用中使用"会掩盖真因（桥接注入失败 vs web 模式），排障成本高；
  2. **主进程存在 2 个"隐藏通道"未在桥接层暴露**：`tasks:updateRun`（`ipc.ts:341-344`）与 `operations:record`（`ipc.ts:359-361`）。当前渲染层不可达，但它们是**可写审计表/任务表的 IPC 端点**，一旦后续有人"顺手"补进 preload，将出现"渲染层可伪造操作审计记录"的越权面。建议在 `registerIpcHandlers` 内改为直接函数调用（不经 IPC），或显式注释"仅供主进程内部使用"。
  3. 反向漂移：**0** 个桥接通道缺少 handler（76 个 invoke 通道全部有 `ipcMain.handle`）。

---

## 三、IPC 校验覆盖对比（本节为重点）

### 3.1 数量对比（脚本核对，可复现）

| 指标 | 数量 | 证据 |
| --- | --- | --- |
| 主进程注册的 IPC 通道（`ipcMain.handle`） | **78** | `ipc.ts:126-414`（`[regex] ipcMain\.handle\("..."` 命中 78） |
| 走 zod schema（`parseOrThrow`）的通道 | **30** | `parseOrThrow(` 命中 30 次：`ipc.ts:164,190,196,199,205,214,234,237,240,246,254,260,263,294,297,306,314,324,342,348,351,360,365,368,371,374` + 3 个 helper（`421-422` gitOperation、`429` clone、`436` commit） |
| **未走 schema 的通道** | **48** | 78 − 30 |
| 其中：**完全无入参**（异常安全） | 15 | `system:environment`、`system:refreshEnvironment`、`system:installGit`、`workspaces:list`、`accounts:load`、`tasks:listProfiles`、`tasks:listRuns`、`backups:list`、`operations:list`、`operations:clear`、`settings:load`、`ai:deleteKey`、`ai:hasKey`、`updater:check`、`updater:download` |
| 其中：有内联检查但非 schema | 3 | `system:selectDirectory`（`typeof` 判定，`ipc.ts:134-141`）、`shell:openExternal`（`/^https?:\/\//i`，`ipc.ts:148-153`）、`updater:install`（路径白名单，`ipc.ts:407-413`） |
| **其中：接收渲染层入参、仅 `requireString`/`requireStringArray`** | **30** | 见 §3.2 清单 |

### 3.2 仅做"非空字符串"校验的 30 个通道（`requireString` 无长度上限）

```ts
// electron/main/ipc.ts:479-484 —— 只有"非空"约束，无长度上限、无格式白名单
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value;
}
```

| 通道 | 入参 | 行号 |
| --- | --- | --- |
| `shell:openPath` | 任意路径（**核心风险**：无根目录白名单、不拒 UNC） | `ipc.ts:155-161` |
| `shell:openTerminal` | 任意路径 | `ipc.ts:167-169` |
| `projects:inspect` / `snapshot` / `analyze` / `detectCommands` / `diskSize` / `readme` / `scanDirectory` | 任意路径 | `ipc.ts:171-194` |
| `git:tags` / `git:listVersions` / `git:changedFiles` / `git:branches` / `git:history` | 任意路径 | `ipc.ts:201-203, 210-212, 220-222, 230-232, 242-244` |
| `git:deleteTag` | 路径 + 标签名（名称在 service 内 `isValidRefName` 兜底，`git.ts:254`） | `ipc.ts:207-209` |
| `git:stageFiles` / `git:unstageFiles` | 路径 + 字符串数组（有总量/单项上限，`ipc.ts:487-499`；文件项在 service 侧 `:(literal)` 转义，`gitParsing.ts:221-223`） | `ipc.ts:223-228` |
| `projects:load` / `projects:save` | workspaceId（`save` 的 payload 走 schema） | `ipc.ts:248-256` |
| `workspaces:delete` | id | `ipc.ts:265-267` |
| `accounts:test` / `accounts:delete` | accountId | `ipc.ts:276-281` |
| `remoteRepositories:load` / `loadCached` / `cacheMeta` / `delete` | accountId（+ repoId） | `ipc.ts:282-304` |
| `tasks:deleteProfile` / `tasks:run` / `tasks:stop` / `tasks:getRunningOutput` | id | `ipc.ts:326-340` |
| `operations:export` | 任意目录（决定 CSV 落盘位置） | `ipc.ts:356-358` |

### 3.3 影响判断（不过度推定）

- 渲染层当前**没有** `fs` 直通能力，任意路径类通道是否"可被恶意利用"**完全取决于渲染层能否被攻破**（README 渲染链是主要入口，见第六节，该链路已做 `html:false` + 协议白名单，未发现 XSS 路径）。因此这些通道应视为**纵深防御缺口（P1/P2）**，而非现成的远程漏洞。
- 但有两类问题**不依赖 XSS**：
  1. **参数缺失校验导致的稳定性/审计失真**：`requireString` 无长度上限，`operations:export` 目录、`saveProjects` 之外的大字符串（如超长 `projectPath`）可直达 DB/文件系统；
  2. **README 与实现不符**：README:124 声称"主进程校验所有 IPC 入参"，实际 48/78 未走 schema、30 个仅有非空判定 —— 这是**安全承诺失真**，会误导后续维护者与安全评审（本身即一条 P1 治理问题，SEC-04）。

---

## 四、命令执行面分析（`child_process` 逐点核对）

| # | 调用点 | 方式 | `shell` | 渲染层可控输入 | 注入评估 |
| --- | --- | --- | --- | --- | --- |
| 1 | `git.ts:741-747` `runGit` / `751-765` `runGitProcess` | `execFile(binary, ["-C", cwd, ...args])` | 否 | 仓库路径、分支/标签名（`isValidRefName`）、文件名（`:(literal)`） | ✅ 无 shell 注入；选项注入已在 `gitParsing.ts:15`（拒绝 `-` 开头）+ 各调用点 `--` 隔离处处理 |
| 2 | `git.ts:597-617` `commitRevertProcess` | `execFile(... ["-C", p, "revert", "--no-edit", hash])` | 否 | hash（`isValidCommitHash`：7-40 hex + `^~N`） | ✅ |
| 3 | `git.ts:632-712` `cloneRepository` | `spawn(binary, args)` | 否 | URL（`assertCloneUrl`）、目标路径（绝对路径 + 空目录） | ✅ 无 shell；`--` 在 `:643` 隔离 URL |
| 4 | `openers.ts:39-50` `spawnDetached` | `spawn(command, args, {shell:false, cwd})` | 否 | 路径仅作为 `cwd`（注释明确规避 `-Command "Set-Location '<path>'"` 的引号逃逸，`openers.ts:24-28`） | ✅ 设计正确 |
| 5 | `openers.ts:33` `where <command>` | `execFile` | 否 | command 为常量 | ✅ |
| 6 | `processCleanup.ts:68` `taskkill` | `execFile(taskkill, ["/PID", String(pid), ...])` | 否 | pid 为数字 | ✅ |
| 7 | `environment.ts:62` `git --version` | `execFile` | 否 | **binary 来自 `settings.gitPath`**（渲染层可写） | ⚠ 见 SEC-08 |
| 8 | `backups.ts:43-55` `tar -a -c ...` / `:79` `tar -xf` | `execFile("tar", args)` | 否 | 归档路径/目标目录/排除规则 | ⚠ 无 shell 注入，但解包路径穿越见 SEC-12 |
| 9 | `setup.ts:126-136` `powershell -Command "Start-Process ... -Verb RunAs"` | `spawn("powershell", args)` | 否 | 路径由 `app.getPath("temp")` 生成（非渲染层直控），单引号已 `''` 转义（`:120`） | ⚠ 提权执行 + 无哈希校验，见 SEC-13 |
| 10 | `updater.ts:144-148` `spawn("cmd", ["/c","start","","/wait", installerPath])` | `spawn`（`shell:false` 但**命令本身是 cmd**） | 否 | **`installerPath` 来自渲染层**（`useUpdater.ts:77`） | ❌ cmd 元字符注入，见 SEC-02 |
| 11 | `tasks.ts:39-43` `spawn(profile.command, args, {shell: win32 ? true : false})` | **`shell:true`（Windows）** | **是** | **`profile.command` 由渲染层 `tasks:saveProfile` 写入 DB**（`ipc.ts:323-324`） | ❌ 设计内宿主任意命令执行面，见 SEC-07；args 已 `quoteWindowsArg`（`commandLine.ts:58-83`）但 **command 本身未转义** |

### 4.1 结论

- **Git 域（本项目最高频的命令执行场景）做法是正确的**：`execFile` + 数组 + `--`/`(literal)` + ref 白名单 + `--config` 传凭据（而非 URL 内联）。这是明显的"做对了"的部分，值得保留。
- 真正的命令执行风险集中在 **3 个非 Git 调用点**（#10 cmd 拼接、#11 任务 shell、#13 #9 UAC 提权链），其中 `updater:install` 的 `cmd start` 拼接可在**不依赖任务功能被使用**的前提下被触发，优先级最高。

---

## 五、凭据与数据安全

### 5.1 存储侧（达标）

- PAT / AI Key：`new Entry("com.gitool.desktop", credentialRef).setPassword(secret)`（`credentials.ts:6-13`），底层 Windows Credential Manager，**不落 SQLite**；
- accounts 表只存 `credentialRef`（`database.ts:76-88`，`accounts.ts:42-110`），且"先写凭据后写库、入库失败回滚删凭据"（`accounts.ts:104-106`）——一致性设计合理；
- 启动体检会探测凭据管理器可用性（`credentials.ts:40-49`、`environment.ts:72`），用户可提前知情；
- DB 位于 `app.getPath("userData")`（`database.ts:180-192`），即 `%APPDATA%\Gitool\gitool.sqlite3`，**明文 SQLite、无加密**——但其中只有路径、项目名、提交摘要、任务命令等，凭据不在此处，风险可接受（P2 记录，不单列问题）。

### 5.2 外泄通道（未达标）

1. **远程 URL 允许内嵌凭据**：`setRemoteUrl` 的 `httpsPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i`（`git.ts:185`）与 `assertCloneUrl`（`git.ts:715`）都放行 `https://user:token@host/x.git`。一旦写入：
   - 落进 `.git/config`（`git.ts:197-198` `remote set-url`/`add`）；
   - `git` 失败输出会回显该 URL（`git.ts:759-762` 合并 stderr）；
   - 经 `recordOperation` 写入 `operation_records.detail`（`ipc.ts:442-463`，`detail.slice(0,500)`）；
   - 由 `buildOperationRecordsCsv` 原样导出（`operationCsv.ts:17-36`，**只做 CSV 公式注入防护，无敏感字段脱敏**）。
2. **克隆进度事件同样回显**：`emitProgress(..., accumulated.slice(-400), ...)` 把 git stderr 尾部推给渲染层（`git.ts:672-688`），失败时 `output: accumulated.trim()` 进入操作日志（`ipc.ts:431`）。
3. 与 README:121「Token 不写入远程 URL、操作日志或界面状态」**直接矛盾**。

### 5.3 AI Key

- Key 只从 keyring 或 `GITOOL_AI_API_KEY` 读取（`ai.ts:83-93`），仅作为 `Authorization: Bearer` 头发送（`ai.ts:35-40`），**不进 URL**（正确）；
- 但目标主机由 `settings.aiBaseUrl` 决定且**完全由渲染层写入**（`ipc.ts:364-366` → `settings.ts:47`），无 scheme/host 白名单 → 组合成"改指向即可把 Key 发到任意主机"的外传链（SEC-09）。

---

## 六、CSP 与不可信内容处理

### 6.1 CSP（生产最小化，基本合格）

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self' data:; img-src 'self' data:; connect-src 'self';
object-src 'none'; base-uri 'self'; form-action 'none'
```

来源：`vite.config.ts:21-34`（通过 `transformIndexHtml` 注入 `index.html:8` 的 `<!--CSP-->` 占位）。开发态额外放行 `'unsafe-inline'` + `ws://localhost:1420`（`:21-22`），仅在 `vite` server 存在时生效（`:20`）。

不足：无 `frame-ancestors 'none'`、无 `worker-src`、无 `manifest-src`（缺口小，`object-src 'none'` 已挡住插件类）；`style-src 'unsafe-inline'` 为 React 内联样式所需，可接受。副作用：`img-src 'self' data:` 会**阻断 README 中的远程图片**（`markdown.ts:69` 放行 https 图片，但 CSP 会拦截）——安全上是加分，功能上是缺陷，应在文档中说明而非放宽 CSP。

### 6.2 README 渲染链（安全）

- `markdown-it` 配置 `html: false`（`src/lib/markdown.ts:35`）→ 原文 HTML 全部转义；
- `validateLink` 协议白名单 `https?|mailto|data:image`（`markdown.ts:28-48`）；
- `link_open` 强制 `target="_blank" rel="noreferrer noopener"`（`markdown.ts:56-60`）；
- 图片相对路径降级为占位文本且经 `escapeHtml`（`markdown.ts:66-79`）；
- 全仓库仅 2 处 `dangerouslySetInnerHTML`，输入均为 `renderMarkdownSafe`（`ReadmeOverlay.tsx:57`、`ReadmeSection.tsx:42`）；
- **无** `eval` / `new Function` / `innerHTML` 直写 / `srcdoc`（grep 全仓为空）。

唯一细节：`data:image/` 放行包含 `image/svg+xml`（`markdown.ts:30`）。SVG 在 `<img>` 上下文中不执行脚本，**风险低**；若要更保守可缩到 `image/(png|jpe?g|gif|webp)`，属 P2 加固项（并入 SEC-14 之外的说明，不单列）。

---

## 七、工程与供应链配置

| 项 | 现状 | 风险 |
| --- | --- | --- |
| `electron-builder.yml` | `asar: true`、`asarUnpack: **/*.node`、`npmRebuild:false`、`nodeGypRebuild:false`（`:18-23`）；NSIS x64（`:25-39`） | **无签名配置**（无 `win.certificateFile`/`signingHashAlgorithms`/`forceCodeSigning`），用户侧 SmartScreen 警告，且**无法据此区分官方包与伪造包** |
| 更新源 | `REPO_OWNER = "sgobiorodolfo170-ai"`（`updater.ts:11`） | 个人账号持有更新分发权；资产替换 = 全量用户 RCE |
| 更新校验 | 仅"路径在 `%TMP%\gitool-updates` 内 + `.exe` 后缀"（`updater.ts:30-35`）；GitHub 返回的 `digest` 字段未使用（`:56-62`） | 无完整性校验 |
| CI | `ci.yml:14-33`：`npm ci` + `typecheck` + `test:coverage` + `build` | 无 `npm audit`/依赖漏洞扫描、无 SARIF/CodeQL、无签名产物归档、无 secret 扫描 |
| 依赖 | `package.json:23-45`：全部 `^` 区间；`electron ^44.4.3`、`vite ^8.3.0`、`typescript ^7.0.2` | 有 `package-lock.json` 锁定，但 `npmRebuild:false` + `^` 组合使"重装即漂移"的窗口变大；`ELECTRON_MIRROR` 指向 npmmirror（`ci.yml:24`，第三方镜像）属供应链依赖 |
| tsconfig 严格性 | `strict: true`、`noUnusedLocals/Parameters`（`tsconfig.app.json:13-15`、`tsconfig.electron.json:10-12`） | **未开** `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`；`skipLibCheck: true`。索引越界在 `sqlite` 行映射（`database.ts` 大量 `String(row.x)`）与 `preload` 参数解构处只能靠运行时兜底 |
| 类型单一来源 | `shared/types.ts` 为唯一契约（`458-546`）；`src/types.ts` 只是 `export * from "../shared/types"`（1 行） | ✅ 无双份定义。仅 `noUncheckedIndexedAccess` 缺失导致索引访问仍按 `T` 处理（`database.ts` 行映射、`preload` 参数解构处依赖运行时兜底） |

---

## 八、问题清单

### 8.1 概览

> 严重度定义：**P0** = 无前置条件即可被远程利用 / 默认配置下必然泄露；**P1** = 需一个可达成的前置条件（渲染层被攻破、攻击者控制更新源或恶意归档）即可造成代码执行或凭据泄露；**P2** = 需组合条件或主要为纵深防御/治理缺口。
> 修复成本：**S** ≤ 0.5 人日；**M** 1-3 人日；**L** > 3 人日（含回归与验收）。

| ID | 严重度 | 位置（文件:行号） | 问题 | 修复成本 |
| --- | --- | --- | --- | --- |
| SEC-01 | **P1** | `electron/main/services/updater.ts:11-13, 56-62, 83-123, 140-150`；`electron-builder.yml:25-39` | 更新链无哈希/签名校验，分发权在第三方个人 GitHub 账号，应用自身亦未签名 | M |
| SEC-02 | **P1** | `electron/main/services/updater.ts:144-148`（配合 `:30-35`） | `updater:install` 把渲染层路径拼进 `cmd /c start`，cmd 元字符可注入命令 | S |
| SEC-03 | **P1** | `electron/main/ipc.ts:155-161, 167-169, 171-194`；`services/git.ts:133-161, 865-884` | 路径类通道无根目录白名单、不拒 UNC → 出站 NTLM 凭据外泄与任意位置探测 | M |
| SEC-04 | **P1** | `electron/main/ipc.ts:126-414`（30 个 `requireString` 通道，清单 §3.2）；`ipc/schemas.ts` 缺失对应 schema；`README.md:124` | 33 个有入参通道未走 schema（30 个仅"非空"校验），与安全承诺不符 | M |
| SEC-05 | **P1** | `services/git.ts:185-198, 672-688, 715`；`ipc.ts:442-463`；`operationCsv.ts:17-36` | 允许 URL 内嵌凭据，Git 输出未脱敏即落库/导出 CSV → 令牌持久化泄露 | S |
| SEC-06 | **P1** | `services/git.ts:636-640` | `git clone -c credential.helper='!f(){...}'` 会把可执行 shell 片段持久化进克隆仓库 `.git/config` | S |
| SEC-07 | **P1** | `services/tasks.ts:32-43`；`ipc.ts:323-324` | 任务执行 `shell:true` 且 `profile.command` 未转义/未白名单 → 宿主任意命令执行面 | M |
| SEC-08 | P2 | `ipc.ts:364-366`；`services/git.ts:76-83`；`environment.ts:62` | 渲染层可改 `settings.gitPath`，该值被当作可执行二进制调用 | S |
| SEC-09 | P2 | `services/ai.ts:10, 35-40`；`ipc.ts:364-366` | `aiBaseUrl` 无 scheme/host 白名单 → 改指向即可外传 AI Key，并可作主进程 SSRF | S |
| SEC-10 | P2 | `services/providers.ts:169-177, 204-216` | 分页 URL 信任服务端 `Link` 头并携带 Token 请求任意主机 | S |
| SEC-11 | P2 | `electron/main/index.ts:83-100`（无 session 配置） | 未注册 `setPermissionRequestHandler`，权限请求沿用默认策略；`webviewTag` 未显式关闭 | S |
| SEC-12 | P2 | `services/backups.ts:67-86`；`ipc.ts:350-352` | `tar -xf` 解包渲染层指定归档，无路径穿越/来源校验 → 目录外写入 | S |
| SEC-13 | P2 | `services/setup.ts:64-110, 116-137` | 安装包下载到 `%TEMP%` 后 UAC 提权执行，无哈希校验、文件名可预测（TOCTOU 替换 → 本地提权） | M |
| SEC-14 | P2 | `ipc.ts:159, 481`；`storage/database.ts:106`；`services/providers.ts:61, 96`；`preload/index.ts:41-52` | 底层错误 message（含绝对路径/原始 DB 错误）直接透传到 UI，无错误码映射 | S |
| SEC-15 | P2 | `tsconfig.app.json:5-20`；`tsconfig.electron.json:4-12` | 未开 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`，`skipLibCheck:true` → 类型安全缺口 | M |
| SEC-16 | P2 | `electron-builder.yml:18-23`；`ci.yml:21-33`；`package.json:23-45` | asar 内 `**/*.node` 外置、`npmRebuild:false`、CI 无漏洞扫描/签名产物、依赖全 `^` | M |
| SEC-17 | P2 | `services/openers.ts:15-18, 31-50` | `spawn` 启动失败被静默吞掉；`code`/`cursor` 在 Windows 为 `.cmd`，无 shell 时可能静默不启动（**需运行期验证**） | S |
| SEC-18 | P2 | `ipc.ts:341-344, 359-361` | 主进程存在 2 个未暴露的"隐藏可写通道"（`tasks:updateRun`、`operations:record`），桥接层收口不闭合 | S |

**合计 18 条：P1 × 7，P2 × 11，P0 × 0。**

### 8.2 逐条详情

#### SEC-01（P1）更新链无完整性校验 + 分发权在个人账号

- **证据**
  - `updater.ts:11-13`：`REPO_OWNER = "sgobiorodolfo170-ai"`、`REPO_NAME = "gitool"`；
  - `updater.ts:56-62`：只取 `tag_name` 与 `assets[].browser_download_url`，**GitHub 返回的 `digest`（`sha256:...`）字段被丢弃**；
  - `updater.ts:83-123`：`fetch(downloadUrl)` → `pipeline` 直接写盘，无任何摘要/签名比对；
  - `updater.ts:30-35`：唯一"信任"判定是 `resolve(path).startsWith(%TMP%\gitool-updates\)` 且后缀 `.exe`；
  - `electron-builder.yml` 全文 39 行，无 `certificateFile` / `signtool` / `forceCodeSigning` → 发布的 setup.exe 未签名。
- **攻击面与利用条件**
  - 前置条件：该 GitHub 账号被接管 / 仓库被转移 / release 资产被替换（无需接触终端）。触发点：应用每 30 分钟自动检查（`CHECK_INTERVAL_MS` 定义于 `updater.ts:13`，轮询于 `index.ts:176`），提示后用户点击"安装"即执行。
  - 因应用自身未签名，用户无法通过"签名者不同"察觉异常；NSIS 静默参数使安装过程无交互，落到 `%LOCALAPPDATA%` 用户态即拿到完整用户权限（等同 RCE，且可读写 `%APPDATA%\Gitool\gitool.sqlite3`）。
- **修复建议**
  1. 校验远端提供的摘要（GitHub Release API 现返回 `digest`，形如 `sha256:<hex>`）：

```ts
// services/updater.ts
import { createHash } from "node:crypto";
import { createReadStream, rm } from "node:fs";
import { pipeline } from "node:stream/promises";

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return `sha256:${hash.digest("hex")}`;
}

// checkForUpdates(): assets?: Array<{ name?: string; browser_download_url?: string; digest?: string }>
// 缓存 expectedDigest 与 downloadUrl 一起保存（cachedDownloadUrl 旁新增 cachedDigest）
// downloadUpdate() 末尾：
if (!expectedDigest || (await sha256File(filePath)) !== expectedDigest) {
  rm(filePath, { force: true });
  throw new Error("更新包校验失败，已丢弃，请稍后重试");
}
```

  2. 执行前再做一次 Authenticode 校验（防"摘要取自同一被控源"）：

```ts
// 仅在 win32；PowerShell 校验签名与主体名
const ps = `$s = Get-AuthenticodeSignature -FilePath '${installerPath.replace(/'/g, "''")}';
if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notlike '*Gitool*') { exit 1 }`;
await execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
```

  3. 配置签名（`electron-builder.yml`）：

```yaml
forceCodeSigning: true
win:
  certificateFile: ${env:WINDOWS_CERT_PFX}
  certificatePassword: ${env:WINDOWS_CERT_PASSWORD}
  signingHashAlgorithms: ["sha256"]
  rfc3161TimeStampServer: "http://timestamp.digicert.com"
```

  4. 治理侧：更新源改为组织账号（或自建静态分发 + 双签名），并在 CI 中签名后归档产物。
- **修复成本**：M（签名证书获取与 CI 接入为主要工作量；摘要校验本身 1 小时）。

#### SEC-02（P1）`updater:install` 命令拼接（cmd 元字符注入）

- **证据**
  ```ts
  // updater.ts:140-150
  export function installUpdate(installerPath: string): void {
    if (!isTrustedInstallerPath(installerPath)) throw new Error("安装包路径不受信任，已拒绝执行");
    spawn("cmd", ["/c", "start", "", "/wait", installerPath], { detached: true, stdio: "ignore", shell: false });
    app.quit();
  }
  ```
  `installerPath` 源头是渲染层（`ipc.ts:407-408` → `useUpdater.ts:77` 的 `downloadedPath`），`isTrustedInstallerPath`（`:30-35`）只做"前缀 + `.exe` 后缀"，**不校验文件是否存在**、**不排除 `& | ^ < > ( )`**。
- **攻击面与利用条件**
  - 渲染层一旦能执行任意 JS（DevTools 手工调用、未来某处 DOM XSS、被注入的第三方脚本），即可：
    `window.gitool.installUpdate("C:\\Users\\u\\AppData\\Local\\Temp\\gitool-updates\\x&calc.exe")` → 通过前缀与后缀校验（`resolved` 无空格，Node 不会加引号）→ 实际由 cmd 解析为两条命令：`start "" /wait C:\...\x` 与 `calc.exe`。
  - 依赖条件：`%TEMP%` 路径中不含空格（绝大多数用户名满足），且目标第二段命令可执行。**注意**：此处不要求被指向的 `.exe` 真实存在，第二条命令即为攻击者要执行的内容。
  - 结论：这是"渲染层 → 宿主任意命令执行"的**最短路径**（比 SEC-07 更短，因为任务功能必须由用户先跑一次任务）。
- **修复建议**：完全移除 `cmd`，直接执行安装包（NSIS 支持 `/S` 静默）：

```ts
import { existsSync } from "node:fs";

export function installUpdate(installerPath: string): void {
  if (!isTrustedInstallerPath(installerPath) || !existsSync(installerPath)) {
    throw new Error("安装包路径不受信任，已拒绝执行");
  }
  // Windows 允许直接 CreateProcess 该 exe，无需 cmd 解释；同时杜绝元字符注入
  const child = spawn(installerPath, ["/S"], { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => { /* 记录日志，不静默 */ });
  child.unref();
  app.quit();
}
```

  并把 `isTrustedInstallerPath` 收紧为"正则白名单文件名"：`/^gitool-setup-\d+\.exe$/`（当前 `resolveFileName` 生成的就是 `${productName}-${version}-setup.exe`，见 `updater.ts:129-138`，可改为带时间戳的固定格式）。
- **修复成本**：S。

#### SEC-03（P1）任意路径 / UNC 路径直通主进程

- **证据**
  - `ipc.ts:155-161` `shell:openPath`：`requireString` → `shell.openPath(path)`，无根目录约束；
  - `ipc.ts:167-169` `shell:openTerminal`：`requireString` → `spawnDetached(..., cwd=path)`（`openers.ts:21-29`）；
  - `ipc.ts:171-194`：`projects:inspect / snapshot / analyze / detectCommands / diskSize / readme / scanDirectory` 全部 `requireString`；
  - `git.ts:133-161` `scanDirectoryForRepositories` 与 `git.ts:865-884` `readProjectReadme` 会对传入路径直接 `readdirSync/readFileSync`；
  - `serviceUtils.ts:20-30` `assertDirectory` 只判断"存在且是目录"，**不要求绝对路径、不排除 UNC**。
- **攻击面与利用条件**
  - **UNC 出站认证（NTLM 泄露）**：任意接受路径的通道传入 `\\attacker\share\x`（`assertDirectory` 的 `statSync`、`shell.openPath`、`readFileSync` 都会触发 SMB 连接），Windows 会向该服务器发送当前用户 NTLM 认证凭据（Net-NTLMv2 哈希），攻击者可离线破解或用于中继。该机制在 Windows 上稳定成立；**最终是否发出凭据需运行期验证**（取决于系统策略 `RestrictSendingNTLMTraffic` 等）。
  - **任意位置探测/读取**：`projects:readme` 可读取任意目录下的 `README*`（≤512KB，`git.ts:856-884`）；`projects:scanDirectory` 可枚举任意目录一层子目录名并返回给渲染层（信息收集）。
  - **`operations:export`**（`ipc.ts:356-358`）可把操作日志 CSV 写到任意可写目录（覆盖同名文件的理论风险）。
  - 前置条件：渲染层可执行任意 JS（同 SEC-02），或诱导用户把项目路径选择到 UNC 共享（`system:selectDirectory` 返回的路径未做校验，`ipc.ts:134-146`）。
- **修复建议**

```ts
// services/serviceUtils.ts（新增）
const UNC_PREFIX = /^\\\\/;
export function assertLocalAbsolutePath(target: string, label = "路径"): string {
  if (UNC_PREFIX.test(target)) throw new Error(`${label}不支持网络共享路径`);
  if (!isAbsolute(target)) throw new Error(`${label}必须是绝对路径`);
  return target;
}

// electron/main/services/pathPolicy.ts（新增）：允许根 = 用户主目录 + 已登记项目路径 + 已选备份目录
export function assertPathAllowed(target: string, roots: string[]): void {
  assertLocalAbsolutePath(target, "路径");
  const resolved = resolve(target).toLowerCase();
  const ok = roots.some((root) => {
    const base = resolve(root).toLowerCase().replace(/[\\/]+$/, "");
    return resolved === base || resolved.startsWith(base + sep);
  });
  if (!ok) throw new Error("路径不在允许的应用范围内");
}
```

  在 `shell:openPath`、`shell:openTerminal`、`projects:*`、`git:*` 的 handler 内统一接入（根列表取 `loadWorkspaces/loadProjects` 的 `path` 与 `app.getPath("home")`），并对 `system:selectDirectory` 返回的路径立即做同一校验。
- **修复成本**：M（需把"允许根"概念接入 12+ 个 handler，且要考虑"未登记项目"的导入流程）。

#### SEC-04（P1）IPC 校验覆盖不足 + 安全承诺失真

- **证据**：见 §3.1/§3.2 数量对比与通道清单；`ipc.ts:479-484` 的 `requireString` 无长度上限；`schemas.ts` 中 30 个 schema 彼此独立、`aiSecretSchema`（`:168-171`）是**唯一**带长度上限的字符串 schema（其中 `requiredString` 仅判非空，`:45-46`）。README:124「主进程校验所有 IPC 入参」与实现不符。
- **攻击面与利用条件**
  - 直接的远程利用不成立（需渲染层被攻破）；但两点是实质风险：
    1. **无上限字符串**经 `operations:export(directory)`、`projects:load(workspaceId)` 等直达文件系统与 SQL：`directory` 传超长串会触发 `ENAMETOOLONG` 并原样回显（配合 SEC-14 形成信息泄露），也可能造成主进程异常路径；
    2. **校验语义双轨**：zod（`.catch()` 静默兜底，`schemas.ts:38-42` 注释）与手工 `requireString` 并存，后续维护者极易在新增通道上漏校验，形成"安全债务加速"。
- **修复建议**
  1. 补齐 30 个通道的 schema（可用统一基元，避免逐个手写）：

```ts
// electron/main/ipc/schemas.ts
const MAX_IPC_STRING = 4096;
export const requiredString = (label: string) =>
  z.string()
    .refine((v) => v.trim().length > 0, { message: `${label}不能为空` })
    .refine((v) => v.length <= MAX_IPC_STRING, { message: `${label}过长（最多 ${MAX_IPC_STRING} 字符）` });

const localPath = requiredString("路径").refine((v) => isAbsolute(v) && !/^\\\\/.test(v), {
  message: "路径必须是本地绝对路径",
});

export const pathOnlySchema = localPath;
export const pathAndNameSchema = z.object({ path: localPath, name: requiredString("名称") });
export const idSchema = requiredString("ID");
export const exportDirectorySchema = localPath;
```

  2. handler 统一收敛（改造后 `parseOrThrow` 覆盖率应达 78/78 或显式 `noInputChannels` 白名单）：

```ts
ipcMain.handle("shell:openPath", (_e, input: unknown) =>
  shell.openPath(parseOrThrow(pathOnlySchema, input, "项目路径")));
```

  3. 增加**结构门禁**（CI 可判定，防回退）：新增 `electron/main/ipc/coverage.test.ts`，扫描 `ipc.ts` 源码断言"每个 `ipcMain.handle("x")` 的函数体内出现 `parseOrThrow(`"，或维护 `VALIDATED_CHANNELS` 常量数组与注册表比对。
  4. 同步修正 README:124 的表述（改为"敏感域入参全部 schema 校验，路径类入参受根目录白名单约束"）。
- **修复成本**：M。

#### SEC-05（P1）凭据经 URL / 操作日志 / CSV 持久化泄露

- **证据**
  - `git.ts:185-198` `setRemoteUrl` 的正则放行 `https://user:token@host/repo.git`，随后 `remote set-url` / `remote add` 把它写进 `.git/config`；
  - `git.ts:715` `assertCloneUrl` 同样放行内嵌凭据的 URL（`git.ts:643` 会把它作为 `--` 后的参数交给 git）；
  - `git.ts:672-688` 克隆进度把 git stderr 尾部 400 字节推给渲染层；`git.ts:708` 失败时整段 `accumulated` 作为 `output` 返回（内含 `Cloning into 'https://user:token@...'`）；
  - `ipc.ts:442-463` `recordOperation` 把 `detail` 截 500 字写入 `operation_records`；`operationCsv.ts:17-36` 导出时只做 CSV 公式注入防护，**无脱敏**。
- **攻击面与利用条件**
  - 前置条件：用户按平台提示直接粘贴了带令牌的克隆地址（常见于"复制带令牌的 HTTPS 链接"），或渲染层被攻破后主动调用 `setRemoteUrl` 写入内嵌凭据的地址。
  - 后果链：令牌存在于 ①`.git/config`（可被随项目备份/移动扩散，`backups.ts` 刻意不排除 `.git`，见 `backups.ts:41-42` 注释）②`gitool.sqlite3`（明文）③导出的 CSV（常被用户发到 IM/工单）。与 README:121 承诺相反。
  - 是否真的落库取决于 git 版本在错误信息中是否回显完整 URL —— **需运行期验证**（建议加一条 e2e：用内嵌错误令牌的 URL 克隆失败后，检查 `operation_records.detail`）。
- **修复建议**

```ts
// services/serviceUtils.ts
const USERINFO_IN_URL = /\/\/[^/@\s]+:[^/@\s]+@/;
const REDACT = /(\/\/)[^/@\s]+:[^/@\s]+@/g;

export function assertNoCredentialInUrl(url: string): void {
  if (USERINFO_IN_URL.test(url)) {
    throw new Error("地址中不能包含用户名或令牌，请通过「账号与令牌」保存凭据");
  }
}
export function redactSecrets(text: string): string {
  return text
    .replace(REDACT, "$1***@")
    .replace(/\b(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,})\b/g, "***")
    .replace(/\b(glpat-[A-Za-z0-9_-]{16,})\b/g, "***");
}
```

  应用点：`assertCloneUrl` / `setRemoteUrl` 入口加 `assertNoCredentialInUrl`；`recordOperation(... detail)` 前 `redactSecrets(detail)`；`emitProgress` 的 `output` 与 `CloneRepositoryResult.output` 同样过一遍 `redactSecrets`；`buildOperationRecordsCsv` 对 `detail` 再兜一次（防历史脏数据）。同时把 `backups.ts` 的默认排除规则加入 `.git/config`（或在备份实现中显式覆盖 `--exclude=.git/config`）。
- **修复成本**：S。

#### SEC-06（P1）克隆时把可执行 credential helper 写进目标仓库 `.git/config`

- **证据**
  ```ts
  // git.ts:634-643
  if (input.accountId) {
    const account = getAccount(input.accountId);
    token = readCredential(account.credentialRef);
    args.push("--config",
      'credential.helper=!f() { echo username=x-access-token; echo password="$GITOOL_ASKPASS_TOKEN"; }; f');
  }
  args.push("--", url, targetPath);
  ```
- **攻击面与利用条件**
  - `git clone -c <key>=<value>` 的语义是"在**新建仓库**中设置配置变量"（git-clone 文档），因此这段 `!f(){...}` shell 片段会被持久化到 `<target>/.git/config`（**需运行期验证**：克隆后 `git -C <target> config --get credential.helper`）。
  - 后果：① 该仓库此后任何需要凭据的操作都会执行这段 shell（无 `GITOOL_ASKPASS_TOKEN` 时返回空密码，导致别的 Git 客户端在该仓库上认证异常）；② 仓库若被打包/分享，等于把"可执行配置 + 特定用户名"扩散给第三方；③ 与本项目"凭据只走 keyring"的设计目标不一致（把凭据来源外部化成一个环境变量约定）。
  - 令牌本身不在 config 中（只引用环境变量），因此**不构成直接令牌泄露**——这一点必须如实说明，不应夸大为 P0。
- **修复建议**：改用**不落盘**的配置注入方式（`GIT_CONFIG_*` 环境变量对子进程有效且不写仓库配置）：

```ts
const child = spawn(getActiveGitBinary(), args, {
  cwd: dirname(targetPath),
  windowsHide: true,
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    ...(token
      ? {
          GITOOL_ASKPASS_TOKEN: token,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "credential.helper",
          GIT_CONFIG_VALUE_0:
            '!f() { echo username=x-access-token; echo password="$GITOOL_ASKPASS_TOKEN"; }; f',
        }
      : {}),
  },
});
```

  并删除 `args.push("--config", ...)`。若必须用 `-c`，则克隆成功后追加

```ts
await runGitProcess(dirname(targetPath), ["-C", targetPath, "config", "--unset-all", "credential.helper"])
  .catch(() => {});
```

- **修复成本**：S。

#### SEC-07（P1）任务执行：`shell:true` + 未转义的 `profile.command`

- **证据**
  ```ts
  // tasks.ts:32-43
  const parsedArgs = splitCommandLine(profile.args);
  const args = process.platform === "win32" ? parsedArgs.map(quoteWindowsArg) : parsedArgs;
  const child = spawn(profile.command, args, {
    cwd: profile.workingDirectory, windowsHide: true, shell: process.platform === "win32",
  });
  ```
  `profile.command` 来自 `tasks:saveProfile`（`ipc.ts:323-324`），schema 仅 `requiredString("命令")`（`schemas.ts:121`），无白名单、无元字符拒绝；`quoteWindowsArg`（`commandLine.ts:58-83`）只作用在 `args` 上。任务工作目录只判"存在且为目录"（`tasks.ts:146-149`）。
- **攻击面与利用条件**
  - 这是**产品设计内的能力**（任务运行器），因此对"用户自己输入的命令"不算漏洞；风险在于：渲染层被攻破后可借 `saveProfile + run` **持久化**一条恶意命令到 DB（`task_profiles.command`），即使本次会话结束、重启后仍可被再次触发；且 `shell:true` 使 `& | > ^` 等元字符不限于"命令 + 参数"，`profile.command` 可写 `npm run build & powershell -enc <base64>`。
  - 前置条件：渲染层代码执行，或用户被诱导粘贴一条"看起来像构建命令"的恶意命令（社会工程，成本更低）。
- **修复建议**

```ts
// services/tasks.ts
const ALLOWED_TASK_COMMANDS = new Set([
  "npm", "pnpm", "yarn", "cargo", "go", "mvn", "gradle", "dotnet", "docker", "python", "node", "py",
]);
const META = /[&|<>^()`]/;

export async function runTask(profileId: string): Promise<TaskRun> {
  const profile = getTaskProfile(profileId);
  if (!profile) throw new Error("任务配置不存在");
  if (!ALLOWED_TASK_COMMANDS.has(profile.command)) {
    throw new Error(`不允许执行该命令：${profile.command}`);
  }
  if (META.test(profile.command) || META.test(profile.args)) {
    throw new Error("命令中包含不允许的字符，请使用「添加参数」的方式传参");
  }
  ...
}
```

  进一步：Windows 上把 `npm` 解析为绝对路径的 `npm.cmd` 并以 `shell:false` 执行；对 `shell:true` 保留的场景，仅允许 `^[A-Za-z0-9._-]+$` 的 command。同时在 UI 增加"首次执行外部命令"的确认弹窗（记录到操作审计）。
- **修复成本**：M（命令白名单会与"自动检测出的命令"（`commandDetection.ts`）耦合，需要保证检测产物全部落在白名单内）。

#### SEC-08（P2）`settings.gitPath` 由渲染层写入并被当作可执行文件

- **证据**：`ipc.ts:364-366`（`settings:save` 接受任意 `gitPath`）→ `settings.ts:40`（落库）→ `git.ts:76-83` `getActiveGitBinary()` 原样返回 → `environment.ts:62`、`git.ts:742/751/657` 用它作为 `execFile/spawn` 的程序名。
- **攻击面**：渲染层被攻破 → 设置 `gitPath` 为任意 exe（如 `C:\Windows\System32\calc.exe`）→ 下次任意 Git 操作触发执行（参数固定，但足以启动任意程序 / 通过 `-C <path>` 影响目标行为）。该路径也构成"持久化"（写 DB，重启仍生效）。
- **修复建议**：`gitPath` 只接受 `system:installGit` 写入或用户通过 `dialog.showOpenDialog` 选择的路径（新增专用通道 `system:selectGitBinary`），并在 `saveSettings` 前做 `existsSync + basename 匹配 /^git(\.exe)?$/i`；`getActiveGitBinary` 对非绝对路径或非 `git*.exe` 的名称回退到 `"git"`。
- **修复成本**：S。

#### SEC-09（P2）`aiBaseUrl` 无白名单 → Key 外传 + 主进程 SSRF

- **证据**：`ai.ts:10` `const baseUrl = (settings.aiBaseUrl || "https://api.openai.com/v1").trim()`；`:35` `fetch(`${baseUrl}/chat/completions`, { headers: { Authorization: `Bearer ${apiKey}` } })`；`ipc.ts:364-366` 允许渲染层写入任意 `aiBaseUrl`（`schemas.ts:65` 为 `looseString()`）。
- **攻击面**：渲染层被攻破 → `saveSettings({...current, aiBaseUrl: "https://attacker.example"})` → 调用 `ai:generateSummary` → AI Key 以 Authorization 头发往攻击者（**前提：用户已配置 AI Key**）；同时主进程 `fetch` 可指向内网/元数据地址（`http://169.254.169.254/...`）形成 SSRF，响应错误码会回显（`ai.ts:72`）。
- **修复建议**

```ts
// services/ai.ts
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?)/i;
function validateBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("AI 接口地址必须使用 HTTPS");
  if (PRIVATE_HOST.test(url.hostname)) throw new Error("AI 接口地址不能指向内网或本机");
  return url.origin + url.pathname.replace(/\/+$/, "");
}
```

  并在 `appSettingsSchema` 中加 `.superRefine` 对该字段校验，使非法值在保存阶段即被拒绝。
- **修复成本**：S。

#### SEC-10（P2）分页 `Link` 头未固定同源，Token 可能被发往任意主机

- **证据**：`providers.ts:212-215` `const next = link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1]; return next;` → `:169-177` 用该 URL 发起请求并附 `[endpoint.header]: prefix + token`。
- **攻击面**：需"上游响应可被伪造"（服务端被控 / 中间人 / 未来把 api 域名做成可配置）。一旦成立，Token 被发送到攻击者域名。当前三平台均固定 HTTPS（`:23-45`），风险等级 P2。
- **修复建议**

```ts
const origin = new URL(endpoint.url).origin;
const next = link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
if (next && new URL(next).origin === origin) return next;   // 跨源一律忽略
return null;
```

  同理 `:220-224` 的 Gitee 手工翻页已基于 `response.url`（同源），可保持不变。
- **修复成本**：S。

#### SEC-11（P2）权限策略与 `webviewTag` 依赖默认值

- **证据**：`index.ts:83-100` 的 `webPreferences` 未包含 `webviewTag`；全仓库无 `setPermissionRequestHandler` / `setPermissionCheckHandler` / `session.defaultSession` 配置（grep 为空）。
- **攻击面**：默认情况下权限请求（通知、麦克风、地理位置、剪贴板读取等）走 Electron 默认策略；若某页面（含 README 渲染出的 `<iframe>`——当前 CSP 未显式禁止 frame，`img-src` 之外的 `frame-src` 落到 `default-src 'self'` 实际被禁）被注入脚本，则可能触发权限弹窗并得到授权。**具体默认行为需运行期验证**（不同 Electron 大版本默认策略有变化，本项目为 `electron ^44.4.3`）。
- **修复建议**

```ts
// electron/main/index.ts，app.whenReady() 内
session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
// webPreferences 内显式声明
webviewTag: false,
```

  `vite.config.ts:23-34` 的 CSP 增加 `frame-src 'none'; frame-ancestors 'none'; worker-src 'self'`。
- **修复成本**：S。

#### SEC-12（P2）`backups:restore` 用 tar 解包任意归档（无穿越校验）

- **证据**：`backups.ts:67-86` `execFileAsync("tar", ["-xf", input.archivePath, "-C", input.targetDirectory])`；`ipc.ts:350-352` 入参来自 `backupRestoreInputSchema`（`schemas.ts:150-153`，仅 `requiredString`）。`isArchiveReadable` 只判"是文件"（`backups.ts:125-131`），目标目录只判"为空目录"（`:74-76`）。
- **攻击面**：恢复一个**非本应用生成**的 tar（渲染层被攻破后指定任意路径，或用户手选了下载来的归档）。GNU tar 会剥离前导 `/`，但对 `../` 条目的处理依赖实现；Windows bsdtar 与 GNU tar 行为不同 → 存在写到目标目录之外的可能（**需运行期验证**：构造含 `../evil.txt` 的 tar 实测）。同类风险：符号链接条目。
- **修复建议**

```ts
// 1) 归档必须位于备份目录内（与 SEC-03 的 pathPolicy 共用）
assertPathAllowed(input.archivePath, [loadSettings().defaultBackupDirectory]);
// 2) 解包加固：不做属主恢复、拒绝绝对路径与上级引用
await execFileAsync("tar", ["-x", "-f", input.archivePath, "-C", input.targetDirectory,
  "--no-same-owner", "--no-same-permissions"], { windowsHide: true, maxBuffer: MAX_BUFFER });
// 3) 解包后校验：遍历 targetDirectory，若出现符号链接或以 .. 逃出根 → 回滚删除
```

- **修复成本**：S。

#### SEC-13（P2）一键安装 Git：`%TEMP%` 可预测文件名 + UAC 提权执行，无哈希校验

- **证据**：`setup.ts:64-110`：下载到 `join(app.getPath("temp"), `gitool-git-setup-${Date.now()}.exe`)`；`:116-137`：`spawn("powershell", ["-Command", "Start-Process -FilePath '<path>' ... -Verb RunAs -Wait"])`（单引号已 `''` 转义，`:120`，拼接本身无可注入点）。
- **攻击面**：`%TEMP%` 是**当前用户可写**目录；任何同用户进程（含低权限恶意软件）可在下载完成与 `Start-Process` 之间的窗口期把该 exe 替换为任意程序，随后经 UAC 提升执行 → **本地权限提升**。同时未使用 GitHub Release 的 `digest`/`asset.size` 做完整性校验（`asset.size` 仅用于进度分母，`:89`）。
- **修复建议**：① 下载完成后校验 `sha256` 与 Release `digest`（同 SEC-01 代码）；② 落盘到 `app.getPath("userData")/tmp` 并创建受 ACL 限制的子目录；③ 执行前 `Get-AuthenticodeSignature` 校验发行者为 "Open Source Developer, Johannes Schindelin" / "Git for Windows"；④ 文件名改用 `crypto.randomUUID()`。
- **修复成本**：M。

#### SEC-14（P2）错误信息透传（路径/底层错误）

- **证据**：`ipc.ts:159` ``throw new Error(`无法在资源管理器中打开：${errorMessage}`)``；`ipc.ts:481` 中文标签 + 原值；`database.ts:106` `` `本地数据存储失败：${errorMessage(error)}` ``（SQLite 原始错误含表名/约束名）；`providers.ts:61/96` `` `连接远程平台失败：${errorMessage(error)}` ``（含 `fetch failed` 及底层网络细节）；`preload/index.ts:41-52` 只剥 `Error invoking remote method '...'` 前缀。
- **攻击面**：信息收集（绝对路径、用户名、DB 结构）为后续攻击提供素材；对 UNC/恶意归档场景还能把攻击者控制的文件名回显到 UI（可配合社工）。**无 stack 泄露**（Electron `invoke` 只回传 message）——这点必须明确，避免夸大。
- **修复建议**：引入 `AppError { code, userMessage, detail }`，handler 层 `try/catch` 统一包装：

```ts
// electron/main/ipc/errors.ts
type ErrCode = "E_PATH_NOT_ALLOWED" | "E_DB" | "E_NETWORK" | "E_INVALID_INPUT" | "E_UNKNOWN";
export class AppError extends Error {
  constructor(readonly code: ErrCode, message: string, readonly detail?: string) { super(message); }
}
export function toIpcError(error: unknown): Error {
  if (error instanceof AppError) return new Error(error.message);          // 只回传面向用户的文案
  logToFile(error);                                                       // 细节只进本地滚动日志
  return new Error("操作失败，请稍后重试");
}
```

  并对 `ipcMain.handle` 做一次统一注册包装（`handle(channel, fn)` → `ipcMain.handle(channel, async (...a) => { try { return await fn(...a); } catch (e) { throw toIpcError(e); } })`）。
- **修复成本**：S（骨架）+ 逐通道替换（可分批）。

#### SEC-15（P2）tsconfig 严格性缺口

- **证据**：`tsconfig.app.json:5-20`、`tsconfig.electron.json:4-12` 均 `strict: true`、`skipLibCheck: true`，但**无** `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。
- **影响**：IPC 契约里的可选字段（如 `TaskRun.exitCode?: number`）在"显式 `undefined` vs 缺省"上不受约束；`database.ts` 大量 `String(row.xxx)`、`parseStatusPorcelainZ`（`gitParsing.ts:165-189`）等索引访问处，编译器认为取到的永远是 `T`，越界只能靠运行时兜底（当前实现已有 `?? ""`/`if (!path) continue` 兜底，但机制上无护栏）。这属于**类型安全纵深**问题，不是现成漏洞。
- **修复建议**：分步开启（避免一次改动过大）：

```jsonc
// tsconfig.electron.json（先主进程，风险面最高）
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true
```

  评估结论：`database.ts` 与 `gitParsing.ts` 预计产生 10-30 处编译错误，均为"补 `?? 默认值`/改显式判断"，属安全加固而非行为变更；建议作为独立 PR 并保留完整测试基线。
- **修复成本**：M。

#### SEC-16（P2）打包与供应链配置

- **证据**：`electron-builder.yml:18-23`（`asarUnpack: **/*.node`、`npmRebuild:false`）、`:25-39`（无签名）；`ci.yml:21-33`（无漏洞扫描/无签名/无产物归档/无 Secret 扫描）；`package.json:23-45`（依赖全 `^`；`@napi-rs/keyring` 为原生模块，随 `asarUnpack` 外置）。
- **攻击面**：① 未签名的安装包与更新包（见 SEC-01）；② `**/*.node` 外置后落在 `resources/app.asar.unpacked`，任何有写权限的本地进程可替换 `.node` → 下次启动加载恶意原生库（若安装到 `%LOCALAPPDATA%` 即用户可写，风险实质存在）；③ 依赖区间 + 第三方 mirror（`ci.yml:24`）扩大供应链面；④ 无 `npm audit` 使已知 CVE 无法被流水线拦截。
- **修复建议**

```yaml
# electron-builder.yml
asarUnpack:
  - "**/@napi-rs/keyring/**"     # 只外置确需的包，避免整树 .node 暴露
```

```yaml
# ci.yml 追加
- name: 依赖漏洞扫描
  run: npm audit --audit-level=high
- name: 打包并签名（tag 触发）
  if: startsWith(github.ref, 'refs/tags/v')
  run: npm run dist
  env:
    WINDOWS_CERT_PFX: ${{ secrets.WINDOWS_CERT_PFX }}
    WINDOWS_CERT_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
- uses: actions/upload-artifact@v4
  with: { name: gitool-setup, path: release/*.exe }
```

  另建议在 `package.json` 增加 `"overrides"` 控制关键传递依赖，并对 `@napi-rs/keyring` 使用精确版本（原生模块升级必须人工过检）。
- **修复成本**：M。

#### SEC-17（P2）`openers.ts` 启动失败被静默吞掉 / `.cmd` 解析

- **证据**：`openers.ts:15-18` `const command = editor === "vscode" ? "code" : "cursor"; await assertCommandExists(...); spawnDetached(command, args);`；`:39-50` `spawnDetached` 内 `child.on("error", () => { /* 静默 */ })`。
- **攻击面/影响**：安全影响小（`shell:false` + 常量命令），但 ① 启动失败对用户不可见（"点了没反应"），② Windows 上 VS Code CLI 是 `code.cmd`，`spawn`/libuv 对 `.cmd` 的支持与 `PATHEXT` 处理不一致，可能直接失败 → 功能静默失效。**需运行期验证**（在目标机器执行一次"在编辑器中打开"）。
- **修复建议**：`spawnDetached` 的 `error` 分支改为上抛（返回 `Promise`）；Windows 下用 `execFile(process.env.ComSpec ?? "cmd.exe", ["/c", "code", "--new-window", path])` 或先 `existsSync` 解析出 `code.cmd` 绝对路径再以 `shell:true` + `quoteWindowsArg` 执行。
- **修复成本**：S。

#### SEC-18（P2）隐藏可写 IPC 通道未收口

- **证据**：`ipc.ts:341-344` `tasks:updateRun`、`ipc.ts:359-361` `operations:record` 均注册在 `ipcMain`，但 `preload/index.ts` 未暴露（`DesktopBridge` 亦无对应方法）。二者都直接写库（`updateTaskRun` / `insertOperationRecord`）。
- **攻击面**：当前渲染层不可达（无桥接方法、`invoke` 私有），**不构成现成漏洞**。风险在于"审计面可被伪造"的机制缺口：后续若为调试补进桥接层，渲染层即可写入任意 `operation_records`（伪造 `ok` 结果）与 `task_runs`，破坏审计可信度。
- **修复建议**：改为纯函数导出供主进程内部调用（删除 `ipcMain.handle`），或在这两处显式注释 `// 仅主进程内部使用，禁止暴露给 preload` 并加 `ipc-coverage.test.ts` 断言"桥接通道 ⊆ 白名单"。
- **修复成本**：S。

---

## 九、修复路线（按优先级与依赖关系）

| 阶段 | 内容 | 覆盖 ID | 可独立验证的验收信号 | 预估 |
| --- | --- | --- | --- | --- |
| **第 1 步（当周）** | 去掉 `cmd start`、收紧更新路径白名单、Git 输出脱敏、拒绝内嵌凭据 URL、克隆 `-c` 改为 `GIT_CONFIG_*` | SEC-02 / SEC-05 / SEC-06 | ① 新增单测：`installUpdate("...\\x&calc.exe")` 抛"不受信任"；② `redactSecrets` 单测覆盖 `https://u:tok@h/x` → `https://***@h/x`；③ e2e：克隆后 `git -C <target> config --get credential.helper` 为空 | 1-1.5 人日 |
| **第 2 步** | 路径根白名单 + 拒 UNC（统一 `pathPolicy`），接入 12+ handler | SEC-03 / SEC-12 | 新增 `pathPolicy.test.ts`：`\\\\evil\\share`、`C:\\Windows`、已登记项目路径 三种输入分别 rejected/allowed | 2 人日 |
| **第 3 步** | IPC schema 全覆盖 + 结构化门禁测试 | SEC-04 / SEC-18 | `parseOrThrow` 覆盖率断言 78/78；`requireString` 全局替换为带 `max(4096)` 的 schema；CI 新增一条 `ipc-coverage` 单测 | 2 人日 |
| **第 4 步** | 任务命令白名单 + 首次执行确认；`gitPath`/`aiBaseUrl` 白名单 | SEC-07 / SEC-08 / SEC-09 / SEC-10 | `tasks.test.ts`：`command="npm run build & calc"` 被拒；`saveSettings({aiBaseUrl:"http://169.254.169.254"})` 被拒 | 2-3 人日 |
| **第 5 步** | 更新链签名 + 摘要校验 + UAC 安装包校验 | SEC-01 / SEC-13 / SEC-16 | CI 产出带签名的 setup.exe；`updater.test.ts`：篡改 1 字节后 `downloadUpdate` 抛"校验失败" | 3 人日（含证书流程） |
| **第 6 步** | 权限策略、tsconfig 收紧、错误码体系、openers 错误上抛 | SEC-11 / SEC-14 / SEC-15 / SEC-17 | `session` 权限回调单测（mock）；`tsc -b` 在开启 `noUncheckedIndexedAccess` 后仍通过 | 2 人日 |

**执行纪律建议**：以上每步都应在独立 PR 中完成，并遵守本仓库既有约束——`npm run typecheck` + `npm run test:coverage` + `npm run build` 三门禁全绿方可合并；涉及"删除/覆盖文件"（如 `tar` 解包、任务执行）的改动需人工复核（对应 AGENTS.md「不可逆操作审批」原则）。

---

## 十、需运行期验证清单（静态无法定论，勿据此断言可利用性）

| # | 待验证项 | 验证方法 | 关联 ID |
| --- | --- | --- | --- |
| 1 | `installUpdate` 的 cmd 元字符注入是否真正生效 | 在测试机调用 `installUpdate("%TEMP%\\gitool-updates\\a&calc.exe")`（预期弹计算器为非期望行为，只在隔离环境做） | SEC-02 |
| 2 | `git clone -c` 是否把 helper 写入 `.git/config` | 克隆后 `git -C <target> config --list --local` | SEC-06 |
| 3 | UNC 路径是否触发 NTLM 出站认证 | 在隔离环境用 `shell.openPath("\\\\<可控SMB>\\x")` 并抓包看是否发出 `Negotiate`/NTLMSSP | SEC-03 |
| 4 | Git 失败输出是否回显内嵌令牌 URL | 用无效内嵌令牌 URL 克隆，检查 `operation_records.detail` 与 UI 日志 | SEC-05 |
| 5 | 未设权限 handler 时的实际授权行为 | 打包版内 HTML 注入 `Notification.requestPermission()`（临时测试页）观察返回值 | SEC-11 |
| 6 | `webviewTag` 默认值 | 临时页面插入 `<webview src="about:blank">` 观察是否创建 | SEC-11 |
| 7 | `tar` 对 `../` 条目的处理 | 构造 `evil.tar` 含 `../pwned.txt`，执行 `restoreBackup` 后检查目标目录外层 | SEC-12 |
| 8 | `spawn("code")` 是否能启动 VS Code | 目标机点击"在编辑器中打开"，观察进程与 UI 反馈 | SEC-17 |
| 9 | Electron 44 下 `allowRunningInsecureContent` 默认值 | DevTools `console.log(process.env)` 不可行，改用 `webContents.session` 实测混合内容页 | 基线 #5 |

---

## 十一、评审结论

1. **窗口与进程隔离层是本项目的强项**：`contextIsolation/sandbox/webSecurity` 全开、preload 零原语泄漏、`will-navigate` 与 `setWindowOpenHandler` 双收口、README 渲染链 `html:false` + 协议白名单 —— 这些是 Electron 应用最常见的失分区，本项目全部做对，**基线判定达标**。
2. **Git 域命令执行做法正确**：`execFile` + 参数数组 + `--`/`:(literal)` + ref 白名单 + 不把令牌拼进 URL。这一部分不需要返工，只需在"令牌脱敏"和"凭据注入方式"上补两处（SEC-05/SEC-06）。
3. **主要风险集中在"主进程信任渲染层"这一假设上**：33 个有入参通道未走 schema、路径类通道无根白名单、任务命令全量透传 shell、`updater:install` 用 cmd 拼接。这些组合起来意味着——**一旦渲染层被攻破，攻破面直接是"宿主用户权限"**，而不是"沙箱内权限"。修复不需要重构，只需按第九节顺序补齐"参数与路径的强校验 + 审计脱敏"。
4. **最严重的单点是更新链完整性（SEC-01）**：它是唯一"无需攻破渲染层"即可造成全量用户 RCE 的路径，且与未签名打包/无 `npm audit` 一起构成供应链短板，应作为第一优先级立项。
5. 本报告提出的 18 条问题中，**7 条 P1 里 5 条为 S 级成本**（SEC-02/05/06 与 SEC-03 部分），可在 1-2 天内显著收敛攻击面；建议以"第 1 步"为起点，先把"最短 RCE 路径 + 凭据外泄路径"掐断，再排期签名与 schema 全覆盖。