# 首启性能优化报告（2026-11-21）

| 项目 | 内容 |
| --- | --- |
| 任务 | 团队任务 id=67（`opt_startup_perf`）+ id=68（`finish_startup_perf`） |
| 执行日期 | 2026-11-21 |
| 基线 | `HEAD efda68e`（v0.8.8）；`89cee36` 为并发任务新增的 docs 提交（未含本报告改动） |
| 优化范围 | `electron/main/services/environment.ts`、`src/App.tsx`、`src/hooks/useEnvironment.ts`、新增 `electron/main/services/environment.test.ts` |
| 未触碰 | `electron/main/services/git/` 内部实现、UI 文案与样式、`package.json` 依赖 |
| 验证方式 | 真实 vitest / 双 tsc / 生产构建 / CDP 冷启实测（全新 user-data-dir） |
| 是否提交 | **否**（按任务要求不 git commit；改动留在工作树） |

---

## 1. 结论摘要

| 指标 | 基线（优化前） | 优化后 | 目标 | 判定 |
| --- | --- | --- | --- | --- |
| 首启侧栏工作区名出现「个人工作区」（CDP） | **6274ms** | **785–904ms**（4 次实测） | < 1500ms | ✅ |
| 首屏可交互（`.app-shell` + 侧栏文本，CDP） | 被 bootstrap 阻塞 | **580–772ms** | < 1500ms | ✅ |
| `environment()` 总耗时（本机，网络不可达） | **4720ms**（上限 5s，git 串行） | **2510–2555ms**（上限 2.5s，git 并行） | < 3000ms | ✅ |
| `environment()` 总耗时（网络可达时） | 433ms | 406ms | < 3000ms | ✅ |
| 全量单测 | 446 | **454**（446 + 新增 8） | 全绿 | ✅ |
| `tsc -b` / `tsc -p tsconfig.electron.json` | 0 / 0 | **0 / 0** | 0 / 0 | ✅ |

**核心结论**：首启慢的两个根因分别是「网络探测 5s 超时上限」和「渲染层把 `environment()` 放进首屏 `Promise.all` 同步等待」。前者改为**并行 + 2.5s 上限**并把 `git` 探测一起并行，后者改为**首屏先渲染、环境结果异步回填**。两者叠加后首屏可交互时间从 6274ms 降到 ~0.6–0.9s，`environment()` 最坏耗时减半。

---

## 2. 测量方法与网络环境说明

- 脚本级测量：临时 vitest 脚本（`%TEMP%` + 仓库内临时文件，测完删除），mock `electron.app.getPath` 指向临时目录，其余走真实 `git` 子进程、真实 `fetch`、真实 Windows 凭据管理器与真实磁盘写入。
- 旧实现已改写，无法再次 import，因此在同一脚本内**按旧逻辑复刻**（git 串行 → 三平台并行 5s → keyring → 目录），并在同一批次内**交替采样**新旧实现，避免两次运行之间网络跳变造成整段偏差（复刻代码仅存在于临时脚本，未入库）。
- CDP 实测：生产构建 + `electron . --remote-debugging-port=9224 --user-data-dir=%TEMP%\gitool-perf-smoke`（每次先删除目录保证冷启），Node 22 内置 `WebSocket` 手写 CDP 客户端，50ms 轮询 `document.body.innerText` 与 `.sidebar` 文本。
- **网络波动声明**：测量窗口内本机对 github/gitee/gitlab 的可达性反复变化（有时三路全不可达，有时全可达），因此绝对值取多次采样，结论以「上限常量 + 是否进入关键路径」为准，避免被单次网络状态误导。

时延口径：

| 名称 | 含义 |
| --- | --- |
| `first_content_ms` | body 首次出现任何文本（无白屏） |
| `shell_ms` | `.app-shell` 已渲染且侧栏有文本（首屏可交互） |
| `workspace_ms` | 侧栏工作区名从占位「工作区 / 本地模式」变为「个人工作区」 |
| `env_wall_ms` | 渲染层调用 `window.gitool.environment()` 的墙钟耗时 |

---

## 3. 优化前：四部分耗时拆解（真实旧代码）

| 项 | 耗时 | 结果 |
| --- | --- | --- |
| git 探测（`git --version`） | **55ms**（复测 53ms） | ok |
| github `https://api.github.com` | **5003ms** | unreachable（撞 5s 上限） |
| gitee `https://gitee.com/api/v5/version` | **5003ms** | unreachable（撞 5s 上限） |
| gitlab `https://gitlab.com/api/v4/version` | **5014ms** | unreachable（撞 5s 上限） |
| 三路**串行**合计（理论最坏） | **15020ms** | — |
| 三路**并行**（旧实现 5s 上限） | **5014ms** | — |
| keyring 可用性（写 + 删 Windows 凭据） | **25ms** | available |
| 数据目录可写（写探针文件 + 删除） | **1ms** | writable |
| **`getEnvironmentStatus()` 合计（冷）** | **4720ms** | 网络不可达批次 |
| **`getEnvironmentStatus()` 合计（热）** | **433ms** | 网络可达批次 |
| **首启「个人工作区」（CDP，`docs/smoke-gui-2026-11-21.md`）** | **6274ms** | — |

旧实现缺陷（结构性）：

1. `probeEndpoint` 超时 **5000ms**，且超时值直接等于首启等待时间；
2. `getEnvironmentStatus` 先 `await` git 再 `await` 网络，两段**串行相加**；
3. 成功分支才 `clearTimeout`，失败路径遗留定时器（资源泄漏，非用户可见）；
4. 渲染层 `App.tsx` 把 `bridge.environment()` 放进首屏 `Promise.all`，四份数据全部就绪后才 `setWorkspaces`，导致侧栏一直停在占位。

---

## 4. 优化后：四部分耗时与总耗时

### 4.1 分项（当前实现路径独立计时）

| 项 | 优化前 | 优化后（实测区间） |
| --- | --- | --- |
| git 探测 | 55ms（串行在链首） | **59–71ms（与网络并发，不叠加）** |
| github | ≤5003ms（上限 5s） | **80–623ms**（可达）/ **≤2500ms**（不可达，超时即 false） |
| gitee | ≤5003ms（上限 5s） | **72–162ms**（可达）/ **≤2500ms**（不可达） |
| gitlab | ≤5014ms（上限 5s） | **338–1144ms**（可达）/ **≤2500ms**（不可达） |
| 三路并行总量 | **5014ms**（上限 5s） | **775–1469ms**（可达）/ **≤2500ms**（上限 2.5s） |
| keyring | 25ms | 12–25ms |
| 数据目录可写 | 1ms | 0–1ms |
| **`environment()` 总耗时** | **4720ms**（冷） | **2510 / 2516 / 2533 / 2555ms**（不可达批次）；**406ms**（可达批次） |

### 4.2 新旧实现交替采样（同一批次、同网络状态）

| 轮次 | 新实现 | 旧实现复刻 | 网络状态 |
| --- | --- | --- | --- |
| 1 | **2516ms** | 5088ms | 三路不可达 |
| 2 | **2533ms** | 5102ms | 三路不可达 |
| 3 | **2510ms** | 4584ms | 三路可达但慢 |
| 最小值比 | — | **1.83×**（4584 / 2510） | — |

另一批次（网络全程可达）：新实现 2509 / 2511ms，旧实现复刻 2545 / 3177ms —— 可达场景下两者差距收窄（仅剩 git 串行 ~60ms），说明**收益集中体现在"有目标不可达"这一常态场景**：上限从 5s 降到 2.5s，且 git 探测不再叠加。

---

## 5. 首屏可交互时间（CDP 冷启实测）

生产构建（`npm run build`）后，全新 `user-data-dir` 冷启，CDP 轮询：

| 轮次 | first_content | shell（可交互） | 「个人工作区」 | `environment()` 墙钟 |
| --- | --- | --- | --- | --- |
| 1 | 580ms | **580ms** | **785ms** | 2523ms |
| 2 | 703ms | **703ms** | **785ms** | 2517ms |
| 3 | 706ms | **706ms** | **904ms** | 2533ms |
| 4（侧栏判定） | 772ms | **772ms** | **874ms** | 2512ms |

**关键证据**：首屏 706ms 时侧栏仍是占位（`Gitool DEVELOPER WORKSPACE L 工作区 本地模式 …`），而此时 `environment()` 仍在主进程里跑（2500ms+ 才返回）。即渲染链路已与环境体检完全解耦：**首屏约 0.6–0.8s 可交互，工作区名 0.8–0.9s 就位，而环境结果 2.5s 后才回填**。

清理结果：`Browser.close` + 仅 kill 本次 spawn 的 PID；测量后 `Get-Process electron` 为空，9224 端口无 `Listen`，临时 user-data-dir 已删除。

---

## 6. 改动清单

### 6.1 `electron/main/services/environment.ts`

```ts
/** why 2.5s 而不是 5s：超时值直接等于首启等待时间……超过即判不可达，由 UI 提示而非继续等待 */
const NETWORK_PROBE_TIMEOUT_MS = 2500;

/** 可注入的 fetch 签名：单测需要模拟「三个目标同时挂住」与「超时」时序，不依赖真实网络 */
export type FetchLike = (input: string, init: RequestInit) => Promise<unknown>;

export async function probeReachability(
  url: string,
  timeoutMs: number = NETWORK_PROBE_TIMEOUT_MS,
  fetchImpl: FetchLike = fetch,
): Promise<NetworkState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(url, { method: "GET", signal: controller.signal });
    return "reachable";            // 任意 HTTP 状态码都算可达
  } catch {
    return "unreachable";          // 超时 / DNS / 拒绝统一判不可达，不抛
  } finally {
    clearTimeout(timer);           // 顺带修掉旧实现失败路径的定时器泄漏
  }
}

export async function probeNetwork(fetchImpl = fetch, timeoutMs = NETWORK_PROBE_TIMEOUT_MS) {
  const [github, gitee, gitlab] = await Promise.all([...]);  // 总耗时 = 最慢一项
  return { github, gitee, gitlab };
}

export async function getEnvironmentStatus(): Promise<EnvironmentStatus> {
  const gitProbe = probeGit();          // 子进程
  const networkProbe = probeNetwork();  // 最坏 2.5s
  const dataDir = probeDataDirectory(); // 同步、毫秒级
  const keyringAvailable = probeKeyring();
  const [git, network] = await Promise.all([gitProbe, networkProbe]); // 不再先等 git
  return {
    git_available: git.available,
    git_version: git.version,
    platform: process.platform,
    data_directory: dataDir.path,
    data_directory_writable: dataDir.writable,
    network,
    keyring_available: keyringAvailable,
  };
}
```

- `EnvironmentStatus` 的 **7 个顶层字段与 network 的三个子键均未变化**（顺序、名称、语义一致），IPC/preload/UI 契约零改动。
- 未引入新依赖；`probeReachability` / `probeNetwork` 仅多一个可选参数，生产调用点行为不变。

### 6.2 `src/App.tsx`（首屏不再阻塞）

拆成两个 effect：

1. **首屏数据链**：`Promise.all([listWorkspaces, loadAccounts, loadSettings])` → `loadProjects(activeId)` → `setWorkspaces / applyProjects / setAccounts`（与原来一致，仅移除 `environment()`）。
2. **环境体检回填**：独立 effect 发起 `bridge.environment()`，`then` 中 `setEnvironment(status)`，并按原逻辑决定是否 `setShowSetupModal(true)`；失败仅静默（设置页保留「检测中」，可手动刷新），不回滚首屏。

UI 结构、文案、样式未改；引导弹窗可能**延后**出现（允许），但全程无白屏、无占位滞留。

### 6.3 `src/hooks/useEnvironment.ts`

仅补 `why` 注释：hook 挂载时不自动拉取环境，避免有人再把 `environment()` 加回挂载同步路径；行为零改动（仍只提供 `refreshEnvironment` 供设置页手动调用）。

### 6.4 `electron/main/services/environment.test.ts`（新增，8 例）

| # | 用例 | 断言要点 |
| --- | --- | --- |
| 1 | 并发探测总耗时≈max | 错峰桩 50/100/300ms：前 3 个事件全是 `start`（串行会是 start/end 交替），总耗时 <380ms（串行下限 450ms） |
| 2 | 超时返回 unreachable 且不抛 | `hangingFetch` 只在 abort 时拒绝；`timeoutMs=40` → `unreachable`、<1000ms、signal 确实被 abort |
| 3 | fetch 立即 reject → false | `Promise.reject(new TypeError("fetch failed"))` → `unreachable`，调用方无 try/catch 也不失败 |
| 4 | 任意 HTTP 状态码算可达 | 503 响应 → `reachable` |
| 5 | 单路超时不影响其他两路 | github 挂住 → unreachable，gitee/gitlab reachable |
| 6 | 返回字段完整 | 7 个顶层键排序比对 + network 三键 + 逐值断言（含 `platform`/`data_directory`/`git_version`） |
| 7 | git 探测失败 | `available=false`、`version=null`，不抛，网络结果照常 |
| 8 | git 与网络并发 | 假 git 200ms + 假网络 300ms → 总耗时 <380ms（串行下限 500ms） |

副作用隔离：mock `electron.app.getPath`（临时目录）、`execFile`（不依赖本机 git）、`probeKeyring`（不写 Windows 凭据管理器）。

---

## 7. 验证结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 专项测试 | `npx vitest run electron/main/services/environment.test.ts` | **8 passed**（1 file） |
| 全量单测 | `npx vitest run` | **39 files / 454 tests passed**（基线 446 + 新增 8） |
| 应用类型检查 | `npx tsc -b` | **exit 0** |
| 主进程类型检查 | `npx tsc -p tsconfig.electron.json` | **exit 0** |
| 生产构建 | `npm run build` | 成功（`dist/assets/index-CqsbVw9b.js` 458.93 kB；`dist-electron/main.cjs` 178.18 kB） |
| CDP 冷启 | 见第 5 节 | 首屏 580–772ms；工作区名 785–904ms |
| 清理 | 进程 / 端口 / 临时目录 | 无 electron 进程；9224 无 Listen；profile 已删 |

---

## 8. 残留瓶颈与后续建议（未在本轮处理）

| 优先级 | 瓶颈 | 现状/量级 | 建议 |
| --- | --- | --- | --- |
| P2 | **网络探测仍在 `environment()` 内**，2.5s 上限是常态路径 | 本机三平台常不可达 → 每次体检 ≈2.5s | 可把「网络可达性」改为懒探测/独立 IPC（渲染层按需拉），`environment()` 只保留 git/keyring/目录；或按 provider 单独探测，只探测用户实际使用的平台 |
| P2 | **`environment()` 无缓存/去重** | 设置页每次刷新重跑 2.5s；dev 模式 `StrictMode` 双调用（生产构建已验证只跑一次） | 增加 in-flight 去重（并发调用共享同一 Promise），保留 `refreshEnvironment` 强制重探语义 |
| P3 | **keyring 探测同步写 Windows 凭据管理器** | 12–25ms，阻塞主进程事件循环 | 改为懒/异步探测（首次保存凭据时再校验），或缓存结果 |
| P3 | **`loadProjects` 为数据链第二跳串行 IPC** | 需先拿到 `listWorkspaces` 才知道 activeId；已含在 785ms 内 | 可让主进程一次返回「首屏快照」（workspaces + activeId + projects + settings），减少一次往返 |
| P3 | **git 探测无超时上限** | 正常 55–71ms；极端情况下 `git --version` 挂住会让环境结果永不回填（首屏不受影响，设置页停留「检测中」） | 可加 `GIT_PROBE_TIMEOUT_MS`（如 5s）+ killSignal，注意极端慢机误判风险 |
| P4 | 数据库迁移/首启种子 | `initDatabase` 惰性在首次 IPC 打开；实测首启种子约 0.6s（含在 785ms 内），早在窗口创建之后 | 无需处理；若未来表增多可把迁移结果缓存为 `user_version` 快速路径 |
| P4 | 启动即触发更新检查 `notifyUpdateIfAvailable` | 异步发起，未观测到阻塞首屏 | 可延后到首屏空闲（如 `requestIdleCallback` 语义） |

---

## 9. 复现步骤

```powershell
# 1) 单测与类型检查
npx vitest run
npx tsc -b
npx tsc -p tsconfig.electron.json

# 2) 构建
npm run build

# 3) CDP 冷启（全新 profile）
Remove-Item "$env:TEMP\gitool-perf-smoke" -Recurse -Force -ErrorAction SilentlyContinue
.\node_modules\electron\dist\electron.exe . --remote-debugging-port=9224 --user-data-dir="$env:TEMP\gitool-perf-smoke"

# 4) 从 http://127.0.0.1:9224/json/list 取 webSocketDebuggerUrl，
#    50ms 轮询 document.body.innerText / .sidebar innerText，
#    记录出现「个人工作区」的毫秒数；结束用 Browser.close 并只 kill 本次 PID。
```

---

## 10. 独立验证（复验，追加于文末）

> 本节由独立验证工程师在不采信实现方自测的前提下，于 2026-11-21 对当前工作树执行（任务 id=69），内容追加于文末。发布整理时编号由「8.」修正为「10.」并同步子节（10.1–10.8）：第 8 节为「残留瓶颈与后续建议」、第 9 节为「复现步骤」，故本节取 10 以保证全文编号唯一；本节判定与结论未作任何改动。
>
> 受验基线：`HEAD 89cee36` + 工作树未提交改动。受验文件哈希：`environment.ts` `f040f47c…`、`environment.test.ts` `1194f15f…`、`App.tsx` `3a68ec62…`、`useEnvironment.ts` `acb11152…`。除本文件外未修改任何源码；CDP 脚本/日志在 `%TEMP%\gitool-perf-verify*`，结构化结果见 `.resultverify/general_verification_result.json`（已被 `.gitignore` 忽略）。

### 10.1 门禁（全部真实执行）

| 检查 | 命令 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| 全量单测 | `npx vitest run` | **39 files / 454 tests passed**，0 skip，4.64s | ✅ |
| 应用类型检查 | `npx tsc -b` | exit 0 | ✅ |
| 主进程类型检查 | `npx tsc -p tsconfig.electron.json` | exit 0 | ✅ |
| 生产构建 | `npm run build` | exit 0；`index-CqsbVw9b.js` 458.93 kB、`main.cjs` 178.18 kB | ✅ |
| CI 覆盖率门禁（CI 实际命令） | `npm run test:coverage` | 454 passed；stmts/branch/funcs/lines = **97.51 / 90.78 / 97.32 / 97.62**（门槛 95/85/90/95），exit 0 | ✅ |

### 10.2 CDP 冷启两轮（端口 9225，每次全新 `--user-data-dir`，生产构建）

| 轮次 | first_content_ms | shell_ms | workspace_ms | `environment()` 墙钟 | `Runtime.exceptionThrown` / console.error |
| --- | --- | --- | --- | --- | --- |
| 1 | 748 | 748 | **841** | 2517 | 0 / 0 |
| 2 | 736 | 736 | **812** | 2513 | 0 / 0 |

- 断言 `workspace_ms < 1500ms`：两轮均满足（**841 / 812ms**）。
- 独立复算 `environment()`：**2517 / 2513ms**，与实现方 2510–2555ms 同量级；两轮三平台均为 `unreachable`，证明最坏超时路径真实发生且被 2.5s 上限截断（旧实现此处为 5s 上限）。
- 关键采样（第 1 轮）：`el=349 shell=false` → `el=748 bodyHasText/shell=true，侧栏仍为「工作区 / 本地模式」` → `el=841 workspace=true（个人工作区）`。第 2 轮同理（736 → 812）。首屏先渲染、工作区名随后 ~70–100ms 补齐，环境结果 2.5s 后才回填。
- 清理：两轮 `Browser.close` 后均在 3s 内自行退出；确认 `Get-Process electron` 为空、`Get-NetTCPConnection -LocalPort 9225 -State Listen` 为空、profile 已删除。只操作本次 spawn 的 PID 树。

### 10.3 渲染层回归（重点）

**代码审阅（`git diff`）**：新增的环境 effect 只做 `setEnvironment(status)` 与条件 `setShowSetupModal(true)`，**没有** `setWorkspaces` / `setActiveWorkspaceId` / `resetView`；首屏 effect 仅从 `Promise.all` 移除 `bridge.environment()`，其余顺序（`setWorkspaces → setActiveWorkspaceId → loadProjects → applyProjects/setSelectedId/setAccounts`）与改前一致；另补 `cancelled` cleanup（改前有检查但无 cleanup，属顺带修正）。

**导航稳定性（CDP）**：两轮均在侧栏可交互时（748/736ms）点击「我的项目」，此时 `workspace_ms` 尚未出现（`clickedBeforeWorkspace=true`）。等待 3s 后面包屑与 active 导航仍为「我的项目」；再独立调用 `window.gitool.environment()`（2.5s）确保应用自身回填早已落定，复查仍为「我的项目」。**不存在环境回填把用户导航打回总览的回归。**

**布局抖动**：

- Git 可用（两轮主测）：`.sidebar=[0,0,244,861]`、`.workspace-switcher=[15,86,214,52]` 在 shell 时与结束完全一致，无抖动。
- Git 不可用（对抗场景）：`.content-scroll` 从 `[244,69,1180,792]` 变为 `[244,119,1165,792]`（+50px 下移、宽度 -15px 出现滚动条），因回填后插入 `.env-banner`。该位移与引导弹窗在同一次回填中发生（弹窗为 fixed 遮罩），仅出现在「未装 Git」错误分支，属一次性、可解释变化，不构成普通首屏抖动。

### 10.4 超时实现审阅 + 运行时探针

代码：`probeReachability` 使用 `try/catch/finally`，`finally { clearTimeout(timer) }` 覆盖成功/失败/超时；超时由 `AbortController.abort()` 触发；单次 `await`，无双重 resolve 路径。

为验证真实模块（而非仅读代码），用 Node module hooks 桩化 electron / credentials / git / child_process，执行仓库里的真实 `environment.ts`：

| 路径 | 结果 | 活跃 timer 净增量 | 备注 |
| --- | --- | --- | --- |
| 成功（立即 resolve） | reachable | 0 | timer 已清理 |
| 失败（立即 reject） | unreachable | 0 | 旧实现此路径遗留 timer，已修 |
| 超时（挂住，120ms） | unreachable | 0 | `signal.aborted=true`，124ms 返回 |
| 全部结束 | — | `activeAtEnd=0` | 无遗留 timer |

**结论：三条路径清理完整，无双 resolve / 遗留 timer。**

### 10.5 行为等价与对抗场景

- `EnvironmentStatus` 7 个顶层字段 + `network.{github,gitee,gitlab}` 与 `shared/types.ts` 完全一致；`system:environment` / `system:refreshEnvironment` 仍指向 `getEnvironmentStatus`，IPC/UI 契约未变。
- Git 未安装端到端（不改系统，仅把 electron 子进程 PATH 收窄为 `System32;C:\Windows`）：first_content/shell **555ms**、workspace **744ms**；引导弹窗在 **3254ms**（环境回填后）出现一次，标题正确、`canCancel=true`；点「稍后再说」后 1.2s 与 3.2s 均无弹窗（不复发）；`environment()` 返回 `git_available=false / git_version=null` 且不抛；`.env-banner` 正常出现；0 异常。
- 并发性实测（真实模块）：三路网络各 150ms 桩 → 总耗时 **157ms**（串行下限 450ms）；git 桩 150ms + 网络 150ms → **155ms**（串行下限 300ms），证明并行而非时序巧合。

### 10.6 新增测试的对抗审查

- 实际为 **8 条**用例（`describe` 3 + 2 + 3），不是任务描述中的 9 条；全量 446 → 454 恰好 +8，与报告一致。
- 26 个 `expect`，无 `.skip/.only/.todo`，无空断言。
- 并行断言是真实时序断言：错峰桩 50/100/300ms 下断言「前 3 个事件全是 `start`」且总耗时 <380ms（串行下限 450ms）；git+网络用例断言 <380ms（串行下限 500ms）。不是靠 sleep 巧合。
- 风险提示：两条耗时上界仅留约 65–80ms 余量（实测 309 / 313ms vs 380ms），极繁忙 CI 上存在低概率抖动；建议放宽到 420–450ms，或把「事件顺序」作为主断言、耗时只作辅助。

### 10.7 其它发现与风险

| 级别 | 发现 | 说明 / 建议 |
| --- | --- | --- |
| P3 | `environment.ts` 末尾缺换行（diff 显示 `\ No newline at end of file`） | 不影响编译/构建；建议补换行 |
| P3 | 网络探测仍占 `environment()` ≈2.5s（常态不可达） | 与实现方 P2 建议一致；首屏已解耦，不影响可交互时间 |
| P4 | `probeGit` 无超时上限 | 极端情况下环境结果不回填（首屏不受影响）；实现方已列为 P3 |
| 说明 | `prettier --check` 对 4 个改动文件报格式 | 未改动的 3 个文件同样报错（`.prettierrc` `endOfLine=lf` vs Windows CRLF 检出），属仓库基线问题；CI 不跑 `format:check`，不阻塞 |
| 说明 | 任务背景称「新增 9 条用例」 | 实际 8 条（与全量 446→454 一致），以代码与测试总数为准 |

### 10.8 最终结论

**可提交（PASS）**。依据：四项门禁 + CI 覆盖率门禁全部通过；两轮独立 CDP 冷启 `workspace_ms` 为 841/812ms（<1500ms）、首屏 748/736ms、0 异常；环境回填不会重置用户导航（3s 后与回填落定后均保持「我的项目」），普通场景无布局抖动；超时三路径清理完整、无遗留 timer；`EnvironmentStatus` 契约与 Git 缺失行为等价；新增 8 条测试为真实并行断言且无 skip/only。遗留项均为 P3/P4 级建议，不构成本次提交阻塞。