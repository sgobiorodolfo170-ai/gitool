# Gitool 代码评估报告

- 评估日期：2026-10-26
- 评估范围：`electron/`（主进程 17 文件）、`src/`（渲染层 9 文件）、`shared/types.ts`、构建与打包配置
- 代码规模：9114 行（TS/TSX）+ 205 行 CSS（压缩为单行规则，48KB）
- 版本：v0.2.0
- 评估方式：全量静态阅读 + `tsc -b` / `tsc -p tsconfig.electron.json` 类型检查 + 关键路径手工推演

---

## 一、总体结论

**综合评分：6.0 / 10（B-）**

> **处置状态（2026-10-26 晚）**：本报告的第一批、第二批缺陷已全部修复，并补齐了纯函数测试与 CI。
> 版本号升至 v0.2.1，`npm run typecheck` / `npm test` / `npm run build` 三门禁均通过（61 个用例）。
> 已修复项在正文标题后标注 ✅；未处理项保留原样，供后续排期。
>
> 已完成：P0-1 ~ P0-4、P1-1 ~ P1-4、P1-6 ~ P1-10、P2-6、P2-10、P2-12（账号缓存与操作记录上限），
> 以及新增 `gitParsing` / `commandLine` / `version` / `operationCsv` / `concurrency` / `markdown`
> 六个纯函数模块与对应测试。
>
> 未处理：P2-1（App.tsx 整体拆分，需单独一次重构）、P2-2（格式化，建议一次性 prettier 提交）、
> P2-3（zod 收敛校验）、P2-5（CSS token 化）、P2-9（代码签名，需证书）、
> P1-5 的完整性校验部分（需发布流程配合产出 checksums）。


这是一个**功能完成度明显高于工程完成度**的项目。产品侧的野心很大——多工作区、三平台远程管理、任务中心、备份中心、AI 摘要、一键装 Git、自动更新，几乎覆盖了一个 Git 客户端桌面工具的全部主干功能，且 UI 与交互文案打磨得相当细致。安全基线（进程隔离、IPC 白名单、凭据管理器、SQL 参数化）也做在了正确的位置。

但工程质量与之不匹配：**0 个测试、0 个 lint 规则、0 条 CI**，核心渲染层是 3253 行的单文件；同时存在若干**端到端断裂的功能缺陷**（部署类任务存不进去）和**命令注入点**（在终端打开项目）。

一句话判断：**可以自己用、可以发预览版，但离"敢让陌生人装、敢让别人改"还有一段距离。**

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| 架构设计 | 8.0 | 主进程服务化拆分清晰，IPC 分层规范，安全基线正确 |
| 功能完整度 | 8.0 | 覆盖面广，边界场景（冲突、分叉、空目录、非 Git 仓库）都有处理 |
| 代码质量 | 5.0 | 巨石组件、430 行手写校验样板、格式失控（最长单行 2962 字符） |
| 安全性 | 6.0 | 基线扎实，但存在 1 处命令注入、更新链零校验 |
| 可维护性 | 4.0 | 无测试无 lint，两套存储实现并存，重复代码多 |
| 工程规范符合度 | 2.0 | 与本项目 `AGENTS.md` 的要求严重脱节（见第六节） |

---

## 二、做得好的地方

这些不是客套，是确实做对了、且很多同类项目会做错的地方：

1. **进程隔离配置完全正确**（`electron/main/index.ts:60-66`）
   `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` + `webSecurity: true`，preload 只通过 `contextBridge` 暴露 80 个显式方法，没有 `ipcRenderer` 泄漏。

2. **Git 调用不经过 shell**（`git.ts:699-723`）
   全部走 `execFile(binary, ["-C", cwd, ...args])`，参数以数组传递。这是 Git 客户端最容易出问题的地方，这里做对了。

3. **SQL 全参数化，无一处字符串拼接**（`storage.ts` 全文）
   连 `IN` 查询都避免了。`saveProjects` 还用了显式事务 + ROLLBACK。

4. **凭据不落库**（`credentials.ts` + `README.md:112-120`）
   PAT 与 AI Key 存 Windows Credential Manager，SQLite 里只有 `credentialRef`。`probeKeyring()` 在体检时主动探测可用性，避免用户录入令牌时才失败——这是有产品思维的细节。

5. **导航与窗口安全**（`index.ts:78-90`）
   `setWindowOpenHandler` 一律 deny + `shell.openExternal`，`will-navigate` 非 devServer 一律 preventDefault。CSP 由 Vite 插件按 dev/prod 分流注入，prod 下 `script-src 'self'`，没有 `unsafe-eval`。

6. **注释写的是"为什么"，不是"是什么"**
   例如 `git.ts:42-45` 解释为何要显式存 `gitPath`（PATH 变更不传播到运行中的 Electron 进程）、`setup.ts:116-117` 解释为何用 `where.exe` 而非主进程 PATH。这符合 `AGENTS.md` 第七节的要求，也是接手成本最低的写法。

7. **边界场景处理到位**
   `getProjectSnapshot` 区分 conflicted / ahead / behind / 分叉；`listChangedFiles` 用 `-z` 分隔符处理含空格/中文的文件名；`runGitOperation` 在 pull/sync 前检查未提交变更并阻止；`assertCloneTarget` 校验目录为空。这些是踩过坑才会写的代码。

8. **缓存有意识**：磁盘占用 60s TTL、结构分析 30s TTL，避免频繁全盘扫描。

9. **类型检查干净**：`tsc -b` 与 `tsc -p tsconfig.electron.json` 均**零错误零警告**通过。

---

## 三、缺陷清单

按严重度排序。P0 = 功能断裂或安全问题，应立即修；P1 = 数据正确性 / 性能 / 健壮性；P2 = 可维护性。

### ✅ P0-1 部署类任务无法保存（端到端断裂）

| 位置 | 代码 |
| --- | --- |
| `shared/types.ts:271` | `TaskType = "build" \| "run" \| "package" \| "deploy"` |
| `commandDetection.ts:242` | 生成 `category: "deploy"` 的命令 |
| `App.tsx:2951` | 下拉框提供 `<option value="deploy">部署</option>` |
| **`ipc.ts:548`** | `if (taskType !== "build" && taskType !== "run" && taskType !== "package") throw new Error("任务类型无效")` |

**后果**：用户在任务中心选择"部署"分类，或选择任何被自动检测为 deploy 的命令（Dockerfile、`deploy` 脚本），点保存必然报"任务类型无效"。README 第 28 行宣称"分类为构建、运行、打包、部署"，实际部署分类完全不可用。

**修复**：`ipc.ts:548` 补 `&& taskType !== "deploy"`。一行。

---

### ✅ P0-2 "在终端打开"存在 PowerShell 命令注入

```ts
// electron/main/services/openers.ts:20
spawnDetached("powershell", ["-NoExit", "-Command", `Set-Location -LiteralPath '${projectPath}'`]);
```

`projectPath` 来自 IPC，`ipc.ts:154` 只做了 `requireString` 非空校验。路径中只要含单引号即可逃逸字符串字面量：

```
C:\work\it's-a-repo        → Set-Location -LiteralPath 'C:\work\it's-a-repo'   ← 语法错误
C:\work\x'; calc; '        → 执行 calc
```

`-LiteralPath` 只影响参数绑定，**不阻止 PowerShell 词法解析阶段的注入**。

**攻击链可行性**：Windows 允许目录名含 `'`。用户克隆/解压一个目录名精心构造的仓库 → 点"在终端打开" → 以当前用户权限执行任意 PowerShell。这是本地攻击面，需要一次用户交互，但完全不需要用户察觉。

**修复**（任选其一，推荐 1）：

1. 改用 `-WorkingDirectory` 参数，彻底不拼接脚本：
   ```ts
   spawnDetached("powershell", ["-NoExit", "-WorkingDirectory", projectPath]);
   ```
2. 单引号转义：`projectPath.replaceAll("'", "''")`。

---

### ✅ P0-3 自动更新与一键装 Git 均"下载即执行"，零完整性校验

```ts
// updater.ts:104-111
export function installUpdate(installerPath: string): void {
  spawn("cmd", ["/c", "start", "", "/wait", installerPath], { detached: true, ... });
  app.quit();
}
```

问题有三层：

1. **无哈希 / 无签名校验**：下载完直接执行。`updater.ts` 与 `setup.ts` 都从 GitHub Release 取 exe，HTTPS 只能保证传输链路，不能保证资产本身未被替换。
2. **`updater:install` 接受任意路径**（`ipc.ts:377-382`，只校验非空字符串）：渲染层若被 XSS 攻破，可直接 `installUpdate("C:\\Windows\\System32\\calc.exe")` 并提权执行。IPC 层"所有入参校验"的承诺在这里破防。
3. **`setup.ts:96-114` 用 UAC 提权执行未校验的 exe**：`Start-Process -Verb RunAs` 是最高权限动作，却是整条链路上校验最薄弱的一环。

另外 `REPO_OWNER = "sgobiorodolfo170-ai"`（`updater.ts:8`）——一个看起来非项目主体的账号，作为**自动更新的唯一信任根**。该账号一旦被接管，全量用户会被静默推入恶意更新。这是本报告中最需要产品层面决策的风险点。

**修复建议**：

- 短期：`installUpdate` 增加白名单校验——路径必须位于 `app.getPath("temp")/gitool-updates/` 下且扩展名为 `.exe`；下载后校验 SHA256（GitHub Release 可附 `checksums.txt` 资产）。
- 中期：接入 `electron-updater` + 代码签名，让 NSIS 安装包带 Authenticode 签名，由 Windows 自身完成验签。

---

### ✅ P0-4 `revertCommit` 返回错误的操作类型

```ts
// git.ts:536-550
export async function revertCommit(input: RevertCommitInput): Promise<GitOperationResult> {
  ...
  return { operation: "pull", success: result.success, output: result.output, snapshot };
  //                   ^^^^^^ 硬编码错误
}
```

`GitOperationResult.operation` 只允许 `fetch | pull | push | sync`，没有 `revert`，于是这里塞了 `"pull"`。后果：撤销提交后，操作记录与 UI 状态会显示成"拉取更新"，用户完全无法从日志追溯真实操作。

**修复**：扩展 `GitOperation` 联合类型加入 `"revert"`（`shared/types.ts:12`），同步补 `OPERATION_COMMANDS` 的映射豁免或单独类型，然后返回 `operation: "revert"`。

---

### ✅ P1-1 `moveProject` 名为移动、实为复制，且从不删除源目录

```ts
// git.ts:841-849
cpSync(sourcePath, targetPath, { recursive: true });
const sourceCount = countFiles(sourcePath);
const targetCount = countFiles(targetPath);
if (sourceCount !== targetCount) { rmSync(targetPath, ...); throw ... }
return { success: true, targetPath, output: `项目已移动到 ${targetPath}` };
```

而前端拿到结果后直接把记录指针改到新路径：

```ts
// App.tsx:955
updateProjects(prev => prev.map(p => p.id === sourceProject.id ? { ...p, path: result.targetPath } : p));
setNotice("项目已移动，记录已更新");
```

**后果**：磁盘上现在有两份完整副本（含 `node_modules`、`.git`），应用只认新的那份，旧的永久残留。用户以为"移动"了，实际是"复制后改指针"。带 `node_modules` 的前端项目动辄几百 MB，一个 10 项目的用户点几次移动就是几个 GB 的隐形垃圾。

复制后做文件数校验是对的，但方向错了——**移动应该先 `cpSync` 校验，再 `rmSync(sourcePath)`**，或在同盘时直接用 `renameSync`。

---

### ✅ P1-2 `compareVersions` 存在 Git 参数注入

```ts
// git.ts:229-232
const [statResult, numStatResult] = await Promise.all([
  runGitProcess(input.path, ["diff", "--stat", `${base}..${head}`]),
  runGitProcess(input.path, ["diff", "--numstat", `${base}..${head}`]),
]);
```

`base` / `head` 来自 IPC（`ipc.ts:508-518`），只校验非空字符串。项目里其他所有版本标识（分支名 `git.ts:476`、标签名 `189`、提交哈希 `539`）都有正则白名单，**唯独这里没有**。

由于参数以数组传给 `execFile`，不是 shell 注入；但 `git diff` 会把以 `--` 开头的参数当选项。传 `base = "--output=C:\\Users\\x\\evil.txt"` 即可让 git 向任意路径写文件。

**修复**：复用已有白名单 `/^[A-Za-z0-9._\/-]+$/` 校验 `base` / `head`，并拒绝以 `-` 开头的值。

---

### ✅ P1-3 远程仓库超过 100 个时，编辑/删除必然失败

```ts
// providers.ts:473-500
async function findRepository(account, token, repositoryId) {
  const endpoint = REPOSITORY_ENDPOINTS[account.provider];  // 固定 per_page=100，只请求一次
  ...
  return payload.map(...).find(r => r.id === repositoryId) ?? null;
}
```

`findRepository` 只拉第一页（100 条），而 `updateRemoteRepository` / `deleteRemoteRepository` 都依赖它定位仓库。账号下仓库超过 100 个时，第 101 个之后的仓库会报"远程仓库不存在或已不可见"——用户会以为是权限问题。

对比：`fetchRemoteRepositories`（`providers.ts:155-196`）是正确分页的，`findRepository` 没有复用。**修复**：改为分页遍历，或在缓存里查。

---

### ✅ P1-4 任务停止 / 超时不杀进程树

```ts
// tasks.ts:51-61
const timer = profile.timeoutSeconds > 0 ? setTimeout(() => {
  try { child.kill(); } catch { }
  ...
}, profile.timeoutSeconds * 1000) : undefined;

// tasks.ts:95-106
export function stopTask(runId: string): void {
  running.process.kill();
}
```

Windows 上 `child.kill()` 只终止直接子进程。`npm run build` 会派生 `node` / `tsc` / `vite` 子进程，父进程被杀后子进程继续持有端口和文件句柄。用户点"停止"后日志停了、进程还在跑——这是 Electron 里非常典型的坑。

**修复**：Windows 下用 `taskkill /PID <pid> /T /F`（`execFile` 调用，不经 shell）。

另外：`stopTask` 只 kill，不写状态。`close` 事件里 `run.status === "running"` 才改成 `failed`，所以**用户主动停止的任务被记为"失败"**。`TaskRun.status` 里的 `"stopped"` 枚举值（`shared/types.ts:294`）从未被写入过。

---

### ⚠️ P1-5 更新包下载：全量进内存 + 未等待写完

```ts
// updater.ts:85-99
const chunks: Buffer[] = [];
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (value) { chunks.push(Buffer.from(value)); downloaded += value.byteLength; ... }
}
writer.write(Buffer.concat(chunks));
writer.close();
```

两个问题：

1. **注释与实际相反**：`setup.ts:62` 的注释写着"流式下载，避免一次性读入内存"，而 `updater.ts` 正是把 100MB 安装包全量堆在内存里再 `Buffer.concat`，峰值翻倍。两个下载器用了两套实现，其中一套是反面教材。
2. **`writer.write()` 后立即 `close()`，没有等待 `finish` / 监听 `error`**：大文件可能尚未刷盘就返回路径，后续执行到截断的 exe。

**修复**：直接用 `Readable.fromWeb(response.body).pipe(writer)`，并 `await once(writer, "finish")`。

---

### ✅ P1-6 备份：同日重复备份互相覆盖

```ts
// backups.ts:13
const archiveName = `${sanitizeFileName(input.projectName)}-${now.replace(/[:.]/g, "-").slice(0, 10)}.zip`;
```

`slice(0, 10)` 把 ISO 时间戳截成 `YYYY-MM-DD`。同一天对同一项目备份两次，第二个 zip **静默覆盖**第一个，但 `backup_records` 表会插入两条指向同一文件的记录。用户看到两条"备份成功"，实际只有一份文件。

**修复**：文件名带完整时间戳（`YYYYMMDD-HHmmss`），或在插入前检查 `archivePath` 是否已存在。

---

### ✅ P1-7 备份排除 `.git/*`，与 README 承诺矛盾

```ts
// backups.ts:37
const args = ["-a", "-c", "-f", archivePath, "-C", parentDirectory, "--exclude", ".git/*"];
```

而 `README.md:35` 写的是"将项目（含 .git 历史）打包为 ZIP 归档"。用户按文档预期做备份，恢复后发现提交历史全丢——**这是会造成实际数据损失级别的文档/实现不一致**。

顺带：`tar` 打 zip 依赖 Windows 10 1803+ 自带的 bsdtar，没有 fallback 也没有前置检查，在精简版系统上会以 `ENOENT` 形式报"备份失败：spawn tar ENOENT"，用户看不懂。

---

### ✅ P1-8 结构分析无并发、无上限、无容错

```ts
// analysis.ts:82-124
async function walk(current: string): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });   // ← 无 try/catch
  for (const entry of entries) {
    ...
    const fileStats = await stat(entryPath).catch(() => null);       // ← 串行 await
    ...
    await walk(entryPath);                                           // ← 深度递归，无上限
  }
}
```

三个问题：

- **串行 `stat`**：每个文件一次 await 往返，10 万文件的项目要跑很久。
- **`readdir` 无容错**：遇到一个无权限目录（如 `System Volume Information`、被占用的构建目录）整个分析直接抛错，前端只看到失败。
- **无深度/文件数上限**：项目里若有软链接形成的环（`entry.isDirectory()` 对 symlink 返回 false，此处侥幸不会无限递归），但目录层级极深时仍有栈风险。

**修复**：`readdir` 包 try/catch 跳过；文件大小用 `readdir({ withFileTypes: true })` + `stat` 批量并发（`p-limit` 或手写信号量，并发 32）；加 `maxFiles` 上限。

---

### ✅ P1-9 数据库迁移会丢失索引

```ts
// storage.ts:440-474
connection.exec(`
  CREATE TABLE projects_migration (...);
  INSERT INTO projects_migration (...) SELECT ... FROM projects;
  DROP TABLE projects;              -- ← 索引随表一起被删除
  ALTER TABLE projects_migration RENAME TO projects;
`);
```

`migrationEnsureWorkspaceColumns`（`storage.ts:404-412`）在前面创建了 `idx_projects_workspace`，然后 `DROP TABLE projects` 把索引一起删掉，**之后没有任何重建**。迁移过的用户数据库里 `workspaceId` 查询永久走全表扫描。

另外整个迁移不在事务里，中途失败会留下半成品表。

**修复**：迁移后补 `CREATE INDEX IF NOT EXISTS`，并把整段包进 `BEGIN/COMMIT`。

---

### ✅ P1-10 项目数据保存存在并发乱序

```ts
// App.tsx:306-319
const updateProjects = (updater) => {
  setProjects((prev) => {
    const next = updater(prev);
    if (isDesktopRuntime()) {
      void requireDesktopBridge().saveProjects(activeWorkspaceId, next).catch(...);  // fire-and-forget
    }
    ...
    return next;
  });
};
```

三个叠加问题：

1. **副作用写在 `setState` 的 updater 里**——React 严格模式下 updater 可能被调用两次，等于重复落库。
2. **fire-and-forget，无顺序保证**：连续两次快速操作（如连续收藏两个项目），两次 `saveProjects` 并发，后发起的可能先返回，**旧快照覆盖新快照**。
3. **每次任何字段变更都全量 UPSERT 整个项目列表 + 扫描删除孤儿**（`storage.ts:88-147`）。20 个项目时每次操作是 20 次 UPSERT + 1 次全表查 + 逐条比对。

**修复**：把保存移出 updater；用一个串行队列（或 debounce 300ms + 版本号）保证顺序；长期看应改为增量 API（`updateProject(id, patch)`）。

---

### P2 级问题（可维护性）

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2-1 | **3253 行单文件、30+ 组件** | `src/App.tsx` | `App()` 函数体约 1225 行，108 个 `useState`，无路由、无状态管理。这是当前最大的可维护性瓶颈 |
| P2-2 | **格式失控** | `src/App.tsx` | 95 行超过 200 字符，最长 **2962 字符**（`App.tsx:2594` 的 `RemoteRepositoriesWorkspace` 签名）。`ipc.ts:114`、`ipc.ts:520` 两条语句挤在一行 |
| P2-3 | **430 行手写校验样板** | `ipc.ts:423-856` | 26 个 `requireXxx` 函数结构高度雷同。建议引入 `zod`，可压缩到约 80 行且能复用类型 |
| P2-4 | **两套存储实现并存** | `src/lib/projects.ts` vs `storage.ts` | 桌面端走 SQLite，web 预览走 localStorage。两套逻辑已经漂移（localStorage 版无校验、不清理孤儿、无事务），改一处忘一处是迟早的事 |
| P2-5 | **CSS 无设计 token** | `src/styles.css` | 48KB 样式压缩为单行规则，0 个 CSS 变量，颜色值大量硬编码重复（`#15232b` 出现 20+ 次） |
| P2-6 | **外部字体依赖** | `styles.css:1` | `@import` Google Fonts。**中国大陆网络下大概率加载失败**，静默回退到系统字体；同时是一次不必要的外部请求 |
| P2-7 | **AI 默认模型过时** | `ai.ts:11` | `gpt-3.5-turbo` 作为 2026 年的默认值已不合适，建议改为可配置为空并要求用户显式选择 |
| P2-8 | **`aiBaseUrl` 未校验协议** | `ai.ts:9` | 用户可配置 `http://`，API Key 将明文传输。应强制 `https://`（localhost 除外） |
| P2-9 | **无代码签名** | `electron-builder.yml` | 未配置 `certificateFile`，安装包触发 SmartScreen"未知发布者"警告 |
| P2-10 | **构建产物未忽略** | `.gitignore` | `build/electron-dist/` 处于 untracked 状态 |
| P2-11 | **`buildUpdateBody` 无法清空描述** | `providers.ts:585` | `if (input.description && ...)`，空字符串被跳过，用户永远清不掉仓库描述。同函数 `594` 行 `&&`/`||` 优先级混乱（行为碰巧正确） |
| P2-12 | **孤儿记录不清理** | `storage.ts` | 删除账号不删 `remote_repository_cache`；删除任务配置不删 `task_runs`；`operation_records` 无上限增长（只读 500 条但无限写入） |
| P2-13 | **`probeEndpoint` timer 泄漏** | `environment.ts:15-25` | `clearTimeout` 只在成功路径调用，catch 路径未清理（影响小，但属疏漏） |
| P2-14 | **`nextPageUrl` 无最大页数保护** | `providers.ts:198-220` | 理论上可无限翻页；Gitee 分支靠手动递增 `page`，若服务端忽略该参数将死循环 |

---

## 四、架构评估

### 分层是清晰的

```
渲染层 (React)  →  preload (contextBridge)  →  ipc.ts (校验)  →  services/* (业务)  →  SQLite / Git CLI / HTTP
```

`services/` 按领域拆成 13 个模块（git / providers / storage / tasks / backups / analysis / commandDetection / credentials / environment / openers / setup / updater / events），职责边界清楚，没有循环依赖。`shared/types.ts` 作为单一类型来源被前后端共同引用，`src/types.ts` 只是一行重导出——这个做法是对的。

### 但有三个结构性隐患

**1. `ipc.ts` 承担了两种职责**
856 行里，约 380 行是 handler 注册，430 行是入参校验。校验应该独立成 `ipc/validators.ts`，否则每加一个功能都要在同一个文件里改两处。

**2. 渲染层没有状态管理层**
108 个 `useState` 全部堆在 `App()` 里，然后通过 props 逐层往下传。`ProjectsWorkspace`、`RemoteRepositoriesWorkspace`、`TasksWorkspace` 的 props 签名都长到需要横向滚动（最长 2962 字符）。这是"能跑但改不动"的典型形态。

**建议的拆分路径**（按收益排序，每步都可独立发布）：
1. 先把 `App.tsx` 里已经独立的组件抽成文件：`components/GitActionsPanel.tsx`、`components/TasksWorkspace.tsx`、`components/SettingsWorkspace.tsx`、`components/ProjectDetail.tsx`、`lib/markdown.ts`。**纯移动，零逻辑改动，风险最低。**
2. 抽出 `hooks/useProjects.ts`（项目 CRUD + 保存队列）、`hooks/useWorkspace.ts`（工作区切换）。
3. 再考虑引入 `zustand`（比 Redux 轻，适合这种桌面工具）收敛跨组件状态。

**3. 双存储通道**
web 预览模式用 localStorage 是有价值的（`npm run dev:web` 可无 Electron 调试 UI），但两套实现必须收敛到同一接口契约。当前 `src/lib/projects.ts` 只有 37 行、无任何校验，而 `storage.ts` 的 `saveProjects` 有 60 行事务逻辑——这种不对称会持续产生"桌面端正常、浏览器预览行为不同"的 bug。

---

## 五、安全性专项

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 进程隔离 | ✅ 合格 | contextIsolation + sandbox + 无 nodeIntegration |
| IPC 白名单 | ✅ 合格 | preload 只暴露显式方法，无通用 invoke 通道 |
| IPC 入参校验 | ⚠️ 基本合格 | 覆盖率约 95%，但 `updater:install` 的 `filePath`、`compareVersions` 的 `base/head` 是缺口 |
| 命令注入 | ❌ **存在** | `openers.ts:20` PowerShell 字符串拼接（P0-2） |
| Git 参数注入 | ❌ **存在** | `compareVersions` 未做白名单（P1-2） |
| SQL 注入 | ✅ 合格 | 全参数化，无拼接 |
| 凭据存储 | ✅ 合格 | Windows Credential Manager，不落库、不进日志 |
| 令牌泄漏 | ✅ 合格 | clone 用环境变量传 token 给 credential helper，不写入 URL |
| 更新链完整性 | ❌ **缺失** | 下载即执行，无哈希/签名（P0-3） |
| XSS | ✅ 基本合格 | README 渲染走自写 `escapeHtml` + `renderMarkdownSafe`，先转义再套标签，顺序正确 |
| 路径穿越 | ⚠️ 部分 | 备份恢复 `tar -xf` 未校验归档内路径（zip slip） |

**关于 `renderMarkdownSafe`**（`App.tsx:2063-2117`）：实现方式是"先 `escapeHtml` 再套 Markdown 标签"，这个顺序是正确的，`dangerouslySetInnerHTML` 在这里可接受。但 `inlineMarkdown` 的链接正则是 `\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)`，URL 部分允许 `"` 和 `'`，理论上可通过 `[x](https://a.com/" onmouseover="alert(1))` 注入属性——因为 `escapeHtml` 已经先把引号转成 `&quot;`，实际不会逃逸。**结论：安全，但依赖"先转义"这个隐含前提，建议在函数上加注释固化这个约束。**

---

## 六、与 `AGENTS.md` 规范的符合度

这是评估中最刺眼的部分。项目自带一份相当严谨的开发规范（29KB），但实际执行几乎是空的：

| 规范条款 | 要求 | 实际 | 差距 |
| --- | --- | --- | --- |
| 第八节 测试覆盖 | 整体 ≥80%，核心模块 ≥90%，TDD 流程 | **0 个测试文件**，`package.json` 无 `test` 脚本 | 完全未执行 |
| 第六节 Code Review | 三步自审（性能→架构→健壮性） | git log 里有 1 次 `d668392 refactor: 三步自审修复` | 仅 1 次留痕 |
| 第五节 提交规范 | 结构化提交 + 模型/指令/迭代轮次标注 | Conventional Commits 格式**做得很好**，但无生成模型、无指令引用、无轮次号 | 部分执行 |
| 第四节 版本记录 | 每次迭代一行摘要 | `CHANGELOG.md` 只有 2 条（v0.1.0 / v0.2.0），而 git log 有 15+ 次提交 | 摘要粒度太粗 |
| 第一节 独立验证 | 验收信号必须来自确定性检查 | 无 lint、无测试、无 CI，验收全靠人工点击 | 未执行 |
| 第七节 注释规范 | 三级注释、说明为什么、禁 magic number | **执行得相当好**，关键函数都有"为什么"注释 | 达标 |
| 第一节 上下文边界 | 不改未提及的模块 | 难以核查，但从代码一致性看基本遵守 | — |

**这不是"文档写多了"，而是"文档与工程实践脱节"**。规范里"验收信号必须是可机器判定的 0/1"这句话，恰恰指出了当前项目最缺的东西：**没有任何一条命令能告诉你"这次改动没破坏东西"**。

最小可执行的补救（不需要一步到位）：

1. 装 `vitest`，先给**纯函数**写测试——`splitCommandLine`、`parseChangeStatus`、`bracketValue`、`compareVersions`、`csvEscape`、`escapeHtml`、`renderMarkdownSafe`、`parseCloneProgress`。这些无 IO 依赖，一个下午能到 90% 覆盖。
2. 装 `eslint` + `prettier`，加 `npm run lint`，在 CI 里跑 `lint + typecheck`。
3. 加一个 GitHub Actions workflow：`npm ci && npm run lint && npm run typecheck && npm test`。三行 YAML，收益巨大。
4. 主进程服务层的测试可以后置（需要 mock `execFile`），但 `git.ts` 里的**参数构造**逻辑应该单独抽成纯函数（`buildCommitArgs`、`buildDiffArgs`），抽出来后立刻可测。

---

## 七、修复优先级建议

### 第一批：半天内可完成，收益最高

| # | 事项 | 位置 | 工作量 |
| --- | --- | --- | --- |
| 1 | 补 `deploy` 类型校验 | `ipc.ts:548` | 1 行 |
| 2 | 修 PowerShell 注入 | `openers.ts:20` | 1 行 |
| 3 | 修 `revertCommit` 的 operation | `git.ts:549` + `types.ts:12` | 5 行 |
| 4 | `compareVersions` 加白名单校验 | `git.ts:224-228` | 5 行 |
| 5 | 备份文件名加时间 | `backups.ts:13` | 1 行 |
| 6 | 移除 `.git/*` 排除（或改 README） | `backups.ts:37` | 1 行 |
| 7 | `updater:install` 校验路径白名单 | `ipc.ts:377` | 10 行 |

### 第二批：1-2 天，消除数据风险

8. `moveProject` 改为真正的移动（复制→校验→删源，或同盘 `rename`）
9. 任务停止改 `taskkill /T /F`，并写入 `stopped` 状态
10. `downloadUpdate` 改流式写入 + 等待 `finish`
11. `findRepository` 支持分页
12. `saveProjects` 加串行队列，副作用移出 `setState` updater
13. 数据库迁移补索引重建 + 事务包裹

### 第三批：一周，还技术债

14. `App.tsx` 按组件拆分（纯移动，零逻辑改动）
15. 引入 `zod` 收敛 `ipc.ts` 校验
16. 接入 `vitest` + `eslint` + CI，纯函数先行
17. `analysis.ts` 加并发与容错
18. 移除 Google Fonts 依赖，改本地字体或系统字体栈

### 第四批：产品化前置

19. 代码签名 + 更新包 SHA256 校验（**上架前必须**）
20. 更新源仓库归属确认（`sgobiorodolfo170-ai`）
21. 双存储实现收敛

---

## 八、一句话总结

**产品的完成度值得这个评分之上的评价，工程的完成度值得这个评分之下的批评。**

最有价值的三个动作，按投入产出比排序：**修掉那 7 个一行的 P0/P1**（半天）、**给纯函数写测试**（一天）、**把 App.tsx 拆开**（两天）。做完这三件，这个项目的可维护性评分能从 4 分提到 7 分，而功能一行都不用改。
