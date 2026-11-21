# Gitool 架构评审总报告（2026-11-21）

- 评审对象：`D:\github\gitool`（Electron + Vite + React + TypeScript 桌面 Git 工作台，v0.8.0，单人项目）
- 报告定位：**汇总裁决件**。合并三份独立报告，去重、冲突裁决、统一编号、排优先级，并给出可机器验收的落地清单
- 输入（只读，未修改）：`docs/architecture-review-structure.md`（事实基线）、`docs/architecture-review-layering.md`（分层与耦合）、`docs/architecture-review-security.md`（安全与工程配置）
- 评审方式：**纯静态只读**。全量枚举 + import 图解析 + 通道逐条比对 + 定向 grep 复核；**未启动应用、未运行测试**
- 本报告未修改任何业务代码，唯一产物为本文件

---

## 1. 摘要

**总体判定（三句话）**

| 维度 | 判定 | 依据 |
| --- | --- | --- |
| 分层 | **不成立（约定俗成的目录分层，不是可执行的分层架构）**：主进程 `services → storage` 二分基本成立且是唯一 SQL 入口、120 个文件 275 条 import 边 **0 模块环**；但渲染层没有数据访问边界（14 文件 53 处桥直调，其中 10 个组件自己 `getDesktopBridge()`），`ipc.ts` 承载领域编排与跨表反查，`storage` 有 2 处跨表写入，且仓库内**没有任何机制**（lint / dependency-cruiser）阻止越界 | L-01、L-03、L-15、structure §4.4 |
| 安全 | **基线扎实、链路失守**：窗口与进程隔离全项达标（`contextIsolation/sandbox/webSecurity` 全开、preload 零 Node 原语、无 `ipcRenderer` 直通），Git 域命令执行做法正确（`execFile` + 数组 + `--` + `:(literal)`）；失分集中在**更新链完整性**（无摘要/签名校验、分发权在第三方个人 GitHub 账号）、**IPC 入参校验覆盖**（30/78 走 zod、30 个仅判非空）、**凭据落盘**（URL/操作日志/CSV）、**3 个非 Git 命令执行面**（`cmd start`、任务 `shell:true`、UAC 安装） | SEC-01~07、SEC-11 |
| 工程化 | **门槛口径与风险区错位**：21 个测试文件中 15 个集中在纯函数与 storage，`services` 4,946 行与 `src/components` 5,758 行几乎零覆盖，覆盖率门槛只对 19 个白名单文件生效（"达标"是子集达标）；CI 无依赖漏洞扫描、产物无签名；typecheck 缺 `noUncheckedIndexedAccess` 等开关 | L-12、SEC-15、SEC-16 |

**问题数量**

| 等级 | 数量 | 说明 |
| --- | --- | --- |
| **P0** | **2** | 均为分层/数据正确性：渲染层无数据访问边界、实体构造漂移被 `.catch()` 静默吸收 |
| **P1** | **16** | 安全止血 7 条（含唯一不经渲染层攻破即可全量 RCE 的更新链）+ 分层/耦合/测试 9 条 |
| **P2** | **17** | 纵深防御、一致性、工程化与供应链 |
| 合计 | **35** | layering 22 + security 18 = 40，经 5 组去重合并后 35（对账见 §5.1） |

**最该先做的 3 件事**

1. **掐断更新链最短 RCE 路径**：`updater:install` 去掉 `cmd /c start` 拼接改为直接 `spawn(exe)`（S，可当天完成），随后补 GitHub `digest` 摘要校验 + 代码签名（M，含证书流程）。这是唯一"不需要攻破渲染层"就能造成全量用户 RCE 的路径。
2. **凭据落盘止血**：入口拒绝 `https://user:token@host` 形式 URL、`redactSecrets` 覆盖 git 输出/操作日志/CSV（S），并把 `git clone -c credential.helper='!f(){...}'` 改为 `GIT_CONFIG_*` 环境变量注入（S）。当前令牌会进 `.git/config`、`gitool.sqlite3` 与导出的 CSV。
3. **渲染层立边界第一刀 + 实体单点**：先做 `shared/` 实体工厂（M，纯函数+测试，风险低），再按 Git 域切片把 4 个 tab + `GitActionsPanel` 的 19 处桥直调收进 `useGitPanel`，配 ESLint `no-restricted-imports` 禁入规则（L）。其余 3 个"先做"候选（`ipc.ts` 编排下沉、`git.ts` 拆分、测试补齐）都排在第 2 批——它们成本更高且依赖边界先立。

> 排序原则：**先做"不触碰模块边界、成本 S、独立可验证"的止漏项，再做需要设计决策的边界项，最后拆巨块。** 若只能投入一天，做第 1 件的前半（去掉 `cmd`）+ 第 2 件。

---

## 2. 评审范围与方法

### 2.1 三份输入报告的来源与方法

| 报告 | 任务 | 方法 | 覆盖范围 | 产物 |
| --- | --- | --- | --- | --- |
| `architecture-review-structure.md` | id=1 `arch_structure` | 全量枚举 + 静态 import 图解析（275 条边 + DFS 找环）+ 82 条通道逐行比对 | `electron/main/`、`electron/preload/`、`src/`、`shared/` | 事实基线（不含建议） |
| `architecture-review-layering.md` | id=2 `arch_layering` | 逐文件阅读 + 全仓符号/调用点检索（IPC 调用点、SQL 语句、函数跨度、测试清单均脚本核对） | `src/`、`electron/main/`、`shared/types.ts`、测试目录对应 | 22 条问题（P0×2 / P1×10 / P2×10） |
| `architecture-review-security.md` | id=3 `arch_security` | 纯静态逐行核对 + 通道计数脚本 + Electron Security Checklist 18 项 | Electron 安全边界、IPC 攻击面、命令执行、凭据、CSP、构建与供应链 | 18 条问题（P0×0 / P1×7 / P2×11）+ 9 项待运行期验证 |

三份报告独立产出、互不引用结论，因此数字出现少量口径差异——本报告统一裁决（见 §5.2），不做简单拼接。

### 2.2 核对数字（引用 structure 的核对摘要表）

| 核对项 | 数字 | 核对方式（structure §0） |
| --- | --- | --- |
| `ipcMain.handle` 注册数 | **78** | `electron/main/ipc.ts` 全文正则计数，通道名去重后仍 78 |
| preload 桥成员数 | **80**（76 个 `invoke` + 4 个事件订阅） | 解析 `electron/preload/index.ts:54-176` 对象键 |
| 主进程 → 渲染层事件通道 | **4** | `notifyRenderer` / `webContents.send` 全量检索 |
| 无 preload 暴露的 handler | **2**（`tasks:updateRun`、`operations:record`） | 78 − 76 = 2 |
| 源码 ts/tsx 文件总数 | **120**（非测试 99 + 测试 21） | 递归枚举，排除 `node_modules`/`dist`/`dist-electron`/`coverage` |
| 相对 import 边（运行时非 type） | **275** | 逐文件解析相对路径 import，排除 `import type` |
| 模块级循环依赖 | **0** | 275 条边 DFS 回溯，去重后 0 环 |
| `shared/types.ts` | 546 行 / 66 个 `export type` 或 `interface` / 0 个 import | 全文正则统计 |
| 直接依赖 `shared/types.ts` 的非测试文件 | **41**（主进程 24 + 渲染层 17） | 逐文件匹配 import 路径 |
| 经 `src/types.ts` 桶间接依赖 | **29** | 同上 |
| 渲染层直接 import `electron` / `node:*` | **0** | `src/` 全文检索，零命中 |
| 目录级双向边 | **1 对**：`services ⇄ storage`（9 / 6 条） | structure §4.4 逐条明细 |

### 2.3 本报告新增的独立复核（3 项）

| 复核项 | 结论 | 命令 |
| --- | --- | --- |
| `ipcMain.handle` 数量 | **78**（与 structure/security 一致，layering 的 77 为口径偏差） | `grep -c 'ipcMain\.handle\(' electron/main/ipc.ts`（命中行 126~407） |
| 自行取桥的组件文件数 | **10**（`BackupsWorkspace` / `GitActionsPanel` / `LogsWorkspace` / `RemoteRepositoriesWorkspace` / `RemoteRepositorySearch` / `SettingsWorkspace` / `TasksWorkspace` / `detail/OverviewPanel` / `detail/UnclonedProjectPanel` / `settings/AppSettingsTab`） | `grep 'getDesktopBridge\|requireDesktopBridge' src/components` |
| `bridge.*` 调用行数 | **53 行 / 14 文件**（与 layering 完全一致）；差异原因已查明：4 个 `git/*Tab` 的 `bridge` 由 `GitActionsPanel` 以 props 传入（`GitActionsPanel.tsx:188,206`），故它们不 `getDesktopBridge()` 但仍直调桥 | `grep 'bridge\??\.[A-Za-z]' src/components` |

### 2.4 局限（必须先读）

| 局限 | 影响 |
| --- | --- |
| **纯静态**：未启动应用、未运行测试、未做动态分析 | 窗口数量、托盘、更新流程、权限默认值等运行时行为均为静态推断 |
| **9 项待运行期验证未闭环**（安全报告 §10） | `cmd` 元字符注入、`clone -c` 是否落盘、UNC 是否发 NTLM、git 失败输出是否回显令牌、权限默认行为、`webviewTag` 默认值、tar `../` 处理、`spawn("code")`、`allowRunningInsecureContent` 默认值——这些**不据以断言可利用性**，只作为风险方向 |
| **行号时效** | 全部行号基于本次读取版本，任何改动都会漂移；落地前需按符号名重定位 |
| **配置结论归属** | 构建/打包/CI 配置结论来自 security 报告，本报告只引用、不重复推导 |
| **未覆盖** | CSS/样式分层（单文件 3,319 行未评审组织方式）、实际测试用例内容（仅统计数量与分布）、运行时性能与内存 |
| **单人项目语境** | 不存在"多团队并行改同一模块"的冲突成本；因此本报告的"成本"按**单人返工风险**估算，而非协调成本 |

---

## 3. 现状架构图

只画真实存在的边（实线 = 运行时 import，虚线 = 字符串约定 / 无 import）。三处边界破防点用红色标注。

```mermaid
flowchart TD
  subgraph R["渲染进程 src/ （70 文件 / 无 Node 原语）"]
    APP["App.tsx<br/>634 行 / 13 项职责"]
    COMP["components 37 文件 / 5758 行"]
    HOOKS["hooks 12 文件 / 1872 行"]
    LIB["lib 11 文件 / 565 行<br/>bridge.ts 唯一桥入口"]
    APP --> COMP
    APP --> HOOKS
    APP --> LIB
    COMP -->|"7 运行时边"| HOOKS
    COMP --> LIB
    HOOKS --> LIB
  end

  PRE["electron/preload/index.ts<br/>178 行 / 80 桥成员<br/>contextBridge 唯一出口"]
  BRIDGE(("window.gitool"))

  subgraph M["主进程 electron/main/ （32 文件 / 5940 行）"]
    IPC["ipc.ts<br/>499 行 / 78 handler<br/>+ zod 校验 30 个"]
    SCHEMAS["ipc/schemas.ts<br/>303 行"]
    SVC["services 20 文件 / 3877 行"]
    STO["services/storage 9 文件 / 1069 行<br/>唯一 SQL 入口"]
    IPC --> SCHEMAS
    IPC -->|"11 条"| SVC
    IPC -->|"8 条 import + CRUD 直转"| STO
    SVC -->|"9 条"| STO
    STO -->|"6 条：credentials / serviceUtils / operationCsv"| SVC
  end

  DB[("gitool.sqlite3<br/>9 表 / node:sqlite")]
  GIT["git CLI<br/>execFile + 数组参数"]
  HTTP["HTTP<br/>GitHub / Gitee / GitLab / OpenAI"]

  LIB --> BRIDGE
  BRIDGE -->|"80 个显式方法"| PRE
  PRE -. "82 个 channel 字符串<br/>（78 invoke + 4 event，三处硬编码）" .-> IPC
  STO --> DB
  SVC --> GIT
  SVC --> HTTP

  COMP -. "① 组件直连桥<br/>14 文件 53 处" .-> BRIDGE
  COMP -. "① 4 个 git tab 经 props 拿 bridge" .-> PRE
  IPC -. "② 领域编排 / 反查 projectId / 写操作日志" .-> STO
  STO -. "③ 跨表：accounts→remote_repository_cache<br/>workspaces→projects" .-> DB

  classDef breach fill:#ffe8e8,stroke:#c62828,stroke-width:2px,color:#8e0000
  class COMP,IPC,STO breach
  classDef leaf fill:#eef4ff,stroke:#3f51b5,color:#1a237e
  class DB,GIT,HTTP leaf
```

### 3.1 三处边界破防点（本报告的核心判断依据）

| # | 破防点 | 事实 | 证据 |
| --- | --- | --- | --- |
| ① | **组件直连 bridge，绕过 hooks** | 14 个组件文件 53 处 `bridge.*`；其中 10 个自行 `getDesktopBridge()`，4 个 `git/*Tab` 通过 `GitActionsPanel` 的 props 拿到桥。同域两套通路：`useGitOperations` 只包 3 个动作，其余 14 个 Git 动作写在 tab 组件内 | `TasksWorkspace.tsx:36,55-56,79,109,173,191,204,212`；`git/ChangesTab.tsx:63,77,110,112,126,149`；`GitActionsPanel.tsx:35,62,93,188,206`；`detail/OverviewPanel.tsx:45,54,67,85,100-103,139` |
| ② | **`ipc.ts` 承载领域编排与持久化** | 每次 Git 操作成功后为反查 `projectId` 遍历全部工作区并逐区 `loadProjects`（N+1 次全表读）；操作日志与任务运行记录也在 handler 内写库，失败被静默吞掉 | `ipc.ts:417-426,428-433,435-440,442-463,465-477`、`ipc.ts:329-333`、`ipc.ts:448-462` |
| ③ | **storage 跨表访问（表所有权破防）** | accounts 域直接 `DELETE FROM remote_repository_cache`；workspaces 域直接 `SELECT COUNT(*) FROM projects`。「storage 是唯一 SQL 入口」成立，但「一张表只有一个 owner」不成立 | `storage/accounts.ts:156`、`storage/workspaces.ts:76-84` |

补充结构事实（用于理解为何"0 环"仍不是健康分层）：

- **通道契约三处硬编码**：注册（`ipc.ts:126-407`）、白名单（`preload/index.ts:55-176`）、类型（`shared/types.ts:458-546`）；`preload` 与 `main` 之间**零 import**，仅靠 82 个字符串隐式耦合，且已出现 2 个死通道。
- **两条持久化路径**：桌面走 SQLite，浏览器预览走 localStorage，由 `isDesktopRuntime()` 在每个调用点二选一（13 处分叉），规则各写一份。
- **共享层干净但膨胀**：`shared/types.ts` 546 行 / 66 类型 / 0 import，是纯类型叶子，无双向污染；但 `DesktopBridge` 88 个方法混在一处，通道名无单一常量来源。

---

## 4. 分层与安全基线判定表

图例：✅ 成立 / ⚠ 部分成立（有边界但无机制或有例外）/ ❌ 不成立（已击穿）。

| # | 边界 | 判定 | 证据 |
| --- | --- | --- | --- |
| B-01 | 窗口与进程隔离（Electron 安全基线） | ✅ | `contextIsolation:true` / `nodeIntegration:false` / `sandbox:true` / `webSecurity:true` — `index.ts:93-99` |
| B-02 | preload 暴露面（不泄漏 Node 原语） | ✅ | 80 个业务语义方法，`invoke` 为模块内私有函数，无 `ipcRenderer`/`fs`/`shell` 直通 — `preload/index.ts:41-52,178` |
| B-03 | 渲染层不直连 `electron` / `node:*` | ✅ | `src/` 全量检索零命中（structure §4.1） |
| B-04 | 导航与窗口打开收口 | ✅ | `setWindowOpenHandler` 一律 deny，http(s) 转系统浏览器；`will-navigate` 仅放行 dev server — `index.ts:132-144` |
| B-05 | README / 不可信内容渲染 | ✅ | `markdown-it` `html:false` + 协议白名单 + `rel="noreferrer noopener"`；全仓 2 处 `dangerouslySetInnerHTML` 均经 `renderMarkdownSafe` — `markdown.ts:28-48,35,56-79` |
| B-06 | 凭据存储 | ✅ | PAT / AI Key 走 Windows Credential Manager，SQLite 只存 `credentialRef` — `credentials.ts:6-13`、`database.ts:76-88` |
| B-07 | **Renderer → hook → bridge 单一通路** | ❌ | 14 文件 53 处直调；6 个领域无 hook（tasks/backups/logs/settings/remote-search/detail 动作）— §3.1 ① |
| B-08 | **渲染层不含业务规则** | ❌ | 实体字面量 6 处 + 工作区规则双份 + AI prompt 在展示组件 — `useRemotes.ts:173-191`、`lib/workspaces.ts:59,71`、`OverviewPanel.tsx:105-134` |
| B-09 | **IPC 适配层只做"校验 → 调服务 → 返回"** | ❌ | 领域编排、跨表反查、写操作日志、写任务运行记录都在 handler 内 — `ipc.ts:417-477,329-333` |
| B-10 | IPC 入参校验 | ⚠ | 78 个 handler 中 30 个走 zod；48 个未走（15 无入参、3 内联检查、**30 仅 `requireString` 无长度上限**）→ 33 个有入参通道未经 schema |
| B-11 | 通道契约单一来源 + 编译期一致性 | ❌ | 三处硬编码、无 `CHANNEL` 常量、无联合类型；已存在 2 个死通道 — `ipc.ts:341,359`、`preload/index.ts:54-176` |
| B-12 | `services → storage` 单向依赖 + 唯一 SQL 入口 | ✅ | SQL 仅出现在 `storage/*`；`storage → services` 6 条边均为基础设施（credentials / serviceUtils / operationCsv），不构成反向领域依赖（structure §4.4） |
| B-13 | **storage 表级所有权（一张表一个 owner）** | ❌ | 2 处跨表：`accounts.ts:156`、`workspaces.ts:76-84`；两表均无 FK 声明 |
| B-14 | 模块级无循环依赖 | ✅ | 120 文件 / 275 边 / 0 环（structure §4.4） |
| B-15 | **分层可执行性（有机制阻止越界）** | ❌ | 仓库内无 `dependency-cruiser`、无 ESLint 分层规则；仅有 CI 三门禁 + 覆盖率门禁 |
| B-16 | 命令执行隔离 | ⚠ | Git 域全 `execFile` + 数组 + `--`/`:(literal)` ✅；但 `updater:install` 走 `cmd /c start`、任务执行 `shell:true` 且 `profile.command` 未转义、`setup` UAC 提权无哈希 — `updater.ts:144-148`、`tasks.ts:32-43`、`setup.ts:116-137` |
| B-17 | **凭据外泄通道（URL / 日志 / CSV / .git/config）** | ❌ | `git.ts:185-198,715` 放行内嵌凭据 URL；`ipc.ts:442-463` 落库未脱敏；`operationCsv.ts:17-36` 导出未脱敏；`git.ts:634-643` 把可执行 helper 写进 `.git/config` |
| B-18 | 更新链完整性 | ❌ | 无摘要/签名校验，仅"路径在 `%TMP%\gitool-updates` + `.exe`"；分发权在第三方个人账号；产物未签名 — `updater.ts:11-13,30-35,56-62`、`electron-builder.yml:25-39` |
| B-19 | CSP 与权限策略 | ⚠ | 生产 CSP 最小化良好（`script-src 'self'`），但缺 `frame-ancestors`/`worker-src`；无 `setPermissionRequestHandler`、未显式 `webviewTag:false` — `vite.config.ts:21-34`、`index.ts:83-100` |
| B-20 | 测试分层与风险区对齐 | ❌ | 21 个测试中 15 个在纯函数 + storage；services 13 个文件无测试、components 5,758 行零测试；门槛仅覆盖 19 个白名单文件 — `vitest.config.ts:22-43,47-52` |
| B-21 | 类型安全收口（跨进程 + DB 行） | ⚠ | 入参有 zod，**出参零校验**（`preload/index.ts:41-43` 直接 `as T`）；DB 行 17 处 `as unknown as SqlRow`；未开 `noUncheckedIndexedAccess` |
| B-22 | 工程与供应链 | ❌ | 无签名、`asarUnpack: **/*.node` 整树外置、CI 无 `npm audit`/SARIF/secret 扫描、依赖全 `^` + 第三方 mirror — `electron-builder.yml:18-23`、`ci.yml:21-33` |

**判定汇总**：✅ 8 项（B-01~06、B-12、B-14）、⚠ 4 项（B-10、B-16、B-19、B-21）、❌ 10 项。**安全基线与依赖无环是强项；失分几乎全部落在"渲染层信任边界"与"契约/校验机制缺失"这两条主线上**——这也是第 1 批整改的靶心。

---

## 5. 统一问题清单

### 5.1 合并对账：40 条 → 35 条

`layering` 22 条（P0×2 / P1×10 / P2×10）+ `security` 18 条（P0×0 / P1×7 / P2×11）= **40 条**，经 5 组"同一问题、同一根因、同一修复动作"的去重合并后为 **35 条**。

**被合并的 5 组（每组合并后保留双方证据）**

| 合并后编号 | 被合并条目 | 合并理由 | 等级裁决 |
| --- | --- | --- | --- |
| P-16 | **L-11 + L-13** | 同一根因：Git 面板没有单一状态源。L-11 是"11 个 props + 4 个 setter + ref 登记式联动"，L-13 是"busy 存在 3 个状态源"，二者修复动作同为"建 `useGitPanel(projectPath)` 单一 store" | 取高 → **P1**（L-13 原为 P2，因它是同一缺陷的并发安全面而升级） |
| P-10 | **L-07 + L-08** | 同一根因：传输层与业务规则未抽象，渲染层保留了一整套影子实现。L-07 是"规则双份"，L-08 是"13 处 `isDesktopRuntime()` 分叉"，修复动作同为"`shared/workspaceRules` + Repository 接口" | 均 P1 → **P1** |
| P-19 | **L-14 + SEC-18** | **同一问题的两种视角**：layering 从契约一致性称"2 个死通道"，security 从攻击面称"2 个隐藏可写通道"，证据完全相同（`ipc.ts:341-344`、`ipc.ts:359-361`） | 均 P2 → **P2**（但保留 security 的"审计可伪造"机制风险描述） |
| P-35 | **L-22 + SEC-15** | 同一根因：类型安全缺少运行时收口。L-22 是"17 处 `as unknown as`+ 出参 `as T`"，SEC-15 是"tsconfig 缺 `noUncheckedIndexedAccess` 等开关"，二者共同决定"DB 列名写错 → 字符串 `\"undefined\"`"这条失效链 | 均 P2 → **P2** |
| P-20 | **SEC-08 + SEC-09** | 同一模式：`settings:save` 接受渲染层任意值，主进程把该值当"可信目标"使用（一个当可执行文件、一个当 HTTP 目标）。修复动作同为"字段级策略 + schema `superRefine`" | 均 P2 → **P2** |

### 5.2 冲突裁决与存疑

**数字/结论冲突（必须裁决，不能两说并存）**

| # | 冲突 | 裁决 | 理由 |
| --- | --- | --- | --- |
| C-1 | handler 数量：layering 多处写 **77**（L-14、§一、§4.5 复核方法），structure 与 security 均为 **78** | 采信 **78**；L-14 的"77 vs 76"应为"78 vs 76"，**差集仍为 2，结论不变** | 本报告 grep 复核命中 126~407 共 78 行；structure §3.2 逐行列出 78 条；security §3.1 脚本核对 78。三者中两者一致且我独立复核通过 |
| C-2 | `services/storage` 行数：layering §一 写 **998**，structure §1.2 写 **1069** | 采信 **1069**（非测试口径） | structure 逐文件列出 9 个文件的行数；layering §六 自己注明 `Measure-Object -Line` 会少算并已改用 `Get-Content .Count`，998 疑为该旧口径残留 |
| C-3 | 组件直调桥的文件数：structure **10**，layering **14** | **两者都成立，口径不同**：10 = 自己调用 `getDesktopBridge()` 的文件；14 = 文件中出现 `bridge.*` 调用（含 `GitActionsPanel.tsx:188,206` 以 props 下发给 4 个 `git/*Tab` 的桥） | 本报告 grep 复核：10 个文件命中 `getDesktopBridge`，53 行命中 `bridge.*` 分布在 14 个文件，与 layering 完全一致 |
| C-4 | 反向依赖：layering §一 称"依赖方向单向（storage 不反向引 service）"，structure §4.4 列出 **6 条** `storage → services` 边 | 采信 structure 的 6 条边**事实**，但支持 layering 的**性质判断**：6 条均为 `credentials` / `serviceUtils` / `operationCsv` 基础设施依赖，不构成领域反向依赖。报告统一表述为"无领域反向依赖，存在 6 条基础设施反向边" | structure 逐文件逐行列出，可复核；layering 的括注已承认 `credentials` 例外，只是漏了 `operationCsv` |
| C-5 | SEC-04 摘要"33 个有入参通道未走 schema"vs §3.1"48 个未走 zod" | **二者不冲突**，本报告统一表述为：78 个 handler → 30 走 zod → 48 未走（其中 15 无入参、3 内联检查、**30 仅 `requireString`**）→ 即 **33 个"有入参但未经 schema"** | 48 = 15 + 3 + 30；33 = 3 + 30。摘要口径是"有入参"，正文口径是"未走 zod"，分母不同 |

**存疑（对前序报告的具体结论有疑问，需按此降级理解）**

| # | 原文结论 | 存疑理由 | 本报告处理 |
| --- | --- | --- | --- |
| Q-1 | L-06："若将来给任务加人工修改状态，UI 可绕过 service 直接改库" | `tasks:updateRun` **当前没有任何桥接方法**（同一报告 L-14 已确认渲染层不可达），因此"UI 可绕过"目前只是机制缺口，不是现存路径 | P-12 的影响描述改为"路径当前不可达；风险在于一旦补进 preload 即成为审计/状态篡改入口"，不据以提升等级 |
| Q-2 | L-05："`git.ts` 加载会连带整个服务图" | "连带"程度未量化（`environment.ts:8` 只依赖一个符号，若打包器 tree-shaking 生效则未必连带）；静态无法判定构建产物粒度 | 保留问题本体（991 行 / 8 子域），删除"连带加载"作为影响论据，改写为"单文件修改爆炸半径 = 991 行 + 测试无法按子域纳入白名单" |
| Q-3 | L-12 的成本标注 **L**，但同一节的整改建议是"先补零依赖模块" | 分层报告把"给 services 补测"整体估为 L 是合理的，但其中 `src/lib/{projects,workspaces,uiPrefs,bridge}` 四项成本为 S，混在一条里会掩盖"低成本可先做"的部分 | P-18 拆为"先做 S 级四项（`src/lib` 补测）→ 再随 P-13 拆分推进 services 覆盖"，路线图中显式分段 |

**保留独立、但共用修复动作的相邻对（不合并，避免掩盖不同问题本体）**

| 对子 | 关系 | 处理 |
| --- | --- | --- |
| L-09 ↔ L-14/SEC-18（P-14 ↔ P-19） | 根因 ↔ 症状：无通道常量源 → 出现死通道 | 分开保留；先做 P-19（S，清理），再做 P-14（M，建 `shared/channels.ts` + 双向差集测试）可一次性堵住复发 |
| L-02 ↔ SEC-04（P-02 ↔ P-07） | 共用 `.catch()` 静默兜底议题，但主体不同：P-02 缺"唯一构造点"，P-07 缺"校验覆盖 + 门禁" | 分开保留；P-02 收窄 `.catch()` 的语义（业务字段报错）、P-07 扩 schema 覆盖，二者在 `schemas.ts` 上串行实施 |
| L-03 ↔ L-21（P-11 ↔ P-34） | 共用"`ipc.ts` 按域拆分"这一动作，但问题是编排越界 vs 单文件多职责 | 分开保留；实施时**先 P-34 建目录，再 P-11 下沉编排**，避免两次改同一文件 |
| L-18 ↔ SEC-03（P-31 ↔ P-08） | 共用"主进程统一路径策略"这一底座（正确性 vs 安全） | 分开保留；P-08 先建 `pathPolicy`，P-31 复用同一模块做 `join` |
| SEC-05 ↔ SEC-06（P-05 ↔ P-06） | 同为凭据落盘，机制不同（令牌进 URL/日志 vs 可执行 shell 片段进 `.git/config`），验收信号不同 | 分开保留；同属第 1 批，可同一 PR 提交但需两条独立用例 |
| L-12 ↔ SEC-16（P-18 ↔ P-26） | 都提到 CI，但一个是测试门禁口径，一个是漏洞扫描/签名 | 分开保留 |

### 5.3 P0 问题（2 条）

| 编号 | 等级 | 类别 | 标题 | 证据（文件:行号） | 影响 | 修复方向 | 成本 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P-01** | P0 | 分层 | 渲染层没有数据访问边界：组件与 hook 平权直连 preload bridge | 53 处直调，例：`src/components/TasksWorkspace.tsx:36,55-56,79,109,173,191,204,212`；`src/components/git/ChangesTab.tsx:63,77,110,112,126,149`；`src/components/GitActionsPanel.tsx:35,62,93`；`src/components/detail/OverviewPanel.tsx:45,54,67,85,100-103,139`；`src/components/BackupsWorkspace.tsx:17,26,37,42,66`；`src/hooks/useGitOperations.ts:44`（仅包 3 个 Git 动作） | 分层第一约束"UI 依赖抽象、不依赖传输"被绕过；同一 bridge 方法在不同组件各自处理错误（`TasksWorkspace.tsx:82-85`、`HistoryTab.tsx:95-99` 吞错 vs `BackupsWorkspace.tsx:52-54` 提示），错误语义无法统一；bridge 签名变更无集中适配点，只能逐组件改；6 个领域（tasks/backups/logs/settings/remote-search/detail 动作）完全没有 hook 层 | ① 新增 `useTasks` / `useBackups` / `useLogs` / `useSettings` / `useGitPanel` 五个域 hook（照 `useProjects`/`useAsyncData` 范式）；② 加 ESLint `no-restricted-imports`：`src/components/**` 禁止 import `lib/bridge`（仅 `src/hooks/**` 与 `lib/bridge.ts` 自身豁免）；③ 先做 Git 域（19/53 处集中在 4 个 tab + `GitActionsPanel`） | **L** | L-01 |
| **P-02** | P0 | 类型安全 | 实体构造逻辑在渲染层复制 6 处，字段漂移被 `.catch()` 静默改写 | `src/hooks/useRemotes.ts:173-191,245-263,315-333`；`src/hooks/useImportFlow.ts:67-84,132-149,176-193`；`src/components/TasksWorkspace.tsx:160-171`；`electron/main/ipc/schemas.ts:185-198`（`.catch()` 兜底）、`:124`（`timeoutSeconds: z.number().catch(0)`） | `Project`（20 字段）/`TaskProfile`（10 字段）的构造被复制 6 次，同一实体校验在 `shared/types.ts`、`projectSchema`、`projectFromSnapshot` 三处独立维护。字段漏写或类型错**不报错而静默改写**：`schemas.ts:185` 非法状态回退 `clean`、`:193` 语言色回退默认、`:196` 磁盘大小回退 0 —— 落库的是"看似成功"的错误数据，无告警；新增字段要同步改 6 处 | ① `shared/` 增实体工厂 `createProject(partial)` / `createTaskProfile(draft)` 作为唯一构造点；② `projectSchema` 的 `.catch()` 收窄为"仅派生展示字段兜底，业务字段报错"；③ 6 处字面量替换为工厂 + 投影测试（工厂产物必须 `safeParse.success`） | **M** | L-02 |

### 5.4 P1 问题（16 条）

| 编号 | 等级 | 类别 | 标题 | 证据（文件:行号） | 影响 | 修复方向 | 成本 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P-03** | P1 | 安全 | 更新链无哈希/签名校验，分发权在第三方个人 GitHub 账号，产物亦未签名 | `electron/main/services/updater.ts:11-13`（`REPO_OWNER = "sgobiorodolfo170-ai"`）、`:56-62`（丢弃 `digest`）、`:83-123`（`fetch`→`pipeline` 直接写盘）、`:30-35`（唯一信任判定是路径前缀 + `.exe`）、`:140-150`；`electron-builder.yml:25-39`（无 `certificateFile`/`forceCodeSigning`）；轮询 `electron/main/index.ts:176` | **唯一"无需攻破渲染层"即可造成全量用户 RCE 的路径**：账号被接管 / 资产被替换 → 用户点安装即执行；应用自身未签名，用户无法用"签名者不同"察觉；NSIS 静默安装落到 `%LOCALAPPDATA%` 即完整用户权限（可读写 `%APPDATA%\Gitool\gitool.sqlite3`） | ① 校验 GitHub Release 的 `sha256:` digest，不符即删包报错；② 执行前 `Get-AuthenticodeSignature` 校验签名与主体；③ `electron-builder.yml` 开 `forceCodeSigning` + 证书 + 时间戳；④ 更新源迁到组织账号或自建分发 | **M**（+证书流程） | SEC-01 |
| **P-04** | P1 | 安全 | `updater:install` 把渲染层路径拼进 `cmd /c start`，cmd 元字符可注入 | `services/updater.ts:144-148`（`spawn("cmd", ["/c","start","","/wait", installerPath])`）、`:30-35`（只判前缀 + `.exe`，不校验存在、不排除 `& \| ^ < > ( )`）；入参来源 `ipc.ts:407-413`、`src/hooks/useUpdater.ts:77` | 渲染层一旦可执行任意 JS，`installUpdate("...\\x&calc.exe")` 可通过校验并由 cmd 解析为两条命令 → **渲染层到宿主任意命令的最短路径**；且不要求目标 `.exe` 存在 | 移除 `cmd`：`spawn(installerPath, ["/S"])` + `existsSync` + 文件名正则白名单（如 `/^gitool-setup-[0-9.]+\.exe$/`）；`error` 事件不静默 | **S** | SEC-02 |
| **P-05** | P1 | 安全 | 允许 URL 内嵌凭据，Git 输出未脱敏即落库与导出 CSV | `services/git.ts:185-198`（`setRemoteUrl` 正则放行 `https://user:token@host`）、`:715`（`assertCloneUrl` 同样放行）、`:672-688`（stderr 尾部 400B 推给渲染层）、`:708`（失败时整段 `accumulated` 作为 output）；`ipc.ts:442-463`（`detail.slice(0,500)` 落库）；`operationCsv.ts:17-36`（只防 CSV 公式注入，无脱敏）；`backups.ts:41-42`（备份未排除 `.git`） | 令牌扩散到 ①`.git/config`（随后续备份/移动扩散）②`gitool.sqlite3`（明文）③导出 CSV（常被发到 IM/工单）；与 README:121「Token 不写入远程 URL、操作日志或界面状态」直接矛盾。是否真落库取决于 git 是否回显完整 URL（**待运行期验证**） | `assertNoCredentialInUrl` 拦截入口 + `redactSecrets` 覆盖 `emitProgress` / `CloneRepositoryResult.output` / `recordOperation(detail)` / CSV 导出兜底；备份默认排除 `.git/config` | **S** | SEC-05 |
| **P-06** | P1 | 安全 | `git clone -c credential.helper='!f(){...}'` 把可执行 shell 片段持久化进目标仓库 `.git/config` | `services/git.ts:634-643`（`args.push("--config", 'credential.helper=!f() {...}')`） | `git clone -c` 的语义是在**新建仓库**设置配置变量 → 片段写入 `<target>/.git/config`；该仓库后续任何需要凭据的操作都会执行这段 shell（无环境变量时返回空密码，破坏其他 Git 客户端）；仓库被分享即扩散"可执行配置"。**令牌本身不在 config 中**（只引用环境变量），不构成直接令牌泄露 | 改用不落盘的 `GIT_CONFIG_COUNT/KEY_0/VALUE_0` + `GITOOL_ASKPASS_TOKEN` 环境变量注入，删除 `--config` 参数；或克隆后 `config --unset-all credential.helper` 兜底 | **S** | SEC-06 |
| **P-07** | P1 | 安全 | IPC 入参校验覆盖不足（33 个有入参通道未经 schema）+ 安全承诺失真 | `electron/main/ipc.ts:126-407`（78 handler）、`:479-484`（`requireString` 只判非空，**无长度上限**）；30 个通道清单见 security §3.2（如 `ipc.ts:155-161,167-169,171-194,356-358`）；`ipc/schemas.ts:45-46`（`requiredString` 仅非空）、`:168-171`（唯一带长度上限的 schema）；`README.md:124` 声称"主进程校验所有 IPC 入参" | 无上限字符串经 `operations:export(directory)` / `projects:load(workspaceId)` 直达文件系统与 SQL（`ENAMETOOLONG` 原样回显，配合 P-25 放大信息泄露）；zod `.catch()` 静默兜底与手工 `requireString` 双轨并存，新增通道极易漏校验，形成"安全债加速" | 统一 schema 基元（`MAX_IPC_STRING = 4096` + `localPath`）+ 覆盖清单 + `electron/main/ipc/coverage.test.ts`（断言每条 `ipcMain.handle` 函数体内出现 `parseOrThrow`，或维护 `VALIDATED_CHANNELS` 与注册表比对）+ 修正 README:124 | **M** | SEC-04 |
| **P-08** | P1 | 安全 | 路径类通道无根目录白名单、不拒 UNC | `ipc.ts:155-161`（`shell:openPath` 任意路径）、`:167-169`（`openTerminal` 当 `cwd`）、`:171-194`（`projects:inspect/snapshot/analyze/detectCommands/diskSize/readme/scanDirectory`）、`:356-358`（`operations:export` 任意目录）、`:134-146`（`selectDirectory` 返回值未校验）；`services/git.ts:133-161,865-884` 直接 `readdirSync/readFileSync`；`serviceUtils.ts:20-30`（只判"存在且是目录"） | UNC 路径（`\\\\attacker\\share\\x`）会触发 SMB 出站认证，Windows 可能发送 NTLM（Net-NTLMv2）→ 离线破解/中继（**是否发出凭据待运行期验证**）；`projects:readme` 可读任意目录 README（≤512KB）、`scanDirectory` 可枚举任意目录、`operations:export` 可写任意可写目录。属纵深防御缺口，需渲染层被攻破或用户被诱导选到 UNC | 新增 `pathPolicy`：`assertLocalAbsolutePath`（拒 UNC + 要求绝对路径）+ `assertPathAllowed(target, roots)`（允许根 = 用户主目录 + 已登记项目路径 + 已选备份目录）；接入 12+ handler，并对 `selectDirectory` 返回值立即校验 | **M** | SEC-03 |
| **P-09** | P1 | 安全 | 任务执行 `shell:true` 且 `profile.command` 未转义、未白名单 | `services/tasks.ts:32-43`（`spawn(profile.command, args, { shell: process.platform === "win32" })`）、`:146-149`（工作目录只判存在）；`ipc.ts:323-324`（`tasks:saveProfile` 可写任意命令）；`ipc/schemas.ts:121`（`requiredString("命令")`）；`commandLine.ts:58-83`（`quoteWindowsArg` 只作用于 args） | 对用户自己输入的命令不算漏洞，但：①`command` 可写 `npm run build & powershell -enc <base64>`，元字符不限于"命令 + 参数"；②渲染层被攻破后可 `saveProfile + run` 把恶意命令**持久化**进 DB，重启仍生效；③社会工程"看起来像构建命令"成本更低 | 命令白名单（npm/pnpm/yarn/cargo/go/mvn/gradle/dotnet/docker/python/node/py）+ 元字符拒绝 + Windows 解析 `npm.cmd` 绝对路径并 `shell:false` + 首次执行外部命令确认弹窗（写审计） | **M** | SEC-07 |
| **P-10** | P1 | 分层 | 传输层未抽象：工作区规则双份 + 13 处 `isDesktopRuntime()` 在 hook 内分叉 | 规则双份：`src/lib/workspaces.ts:59`（至少保留一个）↔ `storage/workspaces.ts:67`；`src/lib/workspaces.ts:71`（还有 N 个项目）↔ `storage/workspaces.ts:82`；`src/lib/workspaces.ts:25,42`（名称非空）↔ `ipc/schemas.ts:204,209`；`src/lib/projects.ts:14`（`as Project[]` 直信 localStorage）↔ `schemas.ts:178-199`。分叉点：`useProjects.ts:74-77,144-147,170-173`、`useWorkspaces.ts:54-56,71-73,88-92,109-113`、`useRemotes.ts:68,107-110,197,288-291,372-375`、`useImportFlow.ts:38-42`（`window.prompt` 代目录选择）、`:63-65,101-104`、`App.tsx:228-282` | 业务 hook 同时承担"业务编排 + 环境判断 + 传输实现"；两份实现无共享代码/测试，已可指认差异：主进程用 SQL 计数、渲染版用 `JSON.parse` + 数组长度且对损坏数据静默放行（`lib/workspaces.ts:66-81`）；渲染版 `loadProjects` 对非数组直接 `[]`，主进程版按 schema 校验。桌面与浏览器预览行为不一致，规则变更必须双份同步 | ① `shared/workspaceRules.ts`（纯函数 `assertCanDelete` / `assertName`）两端共用；② 定义 `ProjectRepository`/`WorkspaceRepository`/`ShellGateway` 接口 + `desktop`/`web` 两实现，在启动时注入；③ 删除 hook 内 `isDesktopRuntime()` 分叉与 `window.prompt` 分支 | **M** | L-07 + L-08 |
| **P-11** | P1 | 分层 | IPC 适配层承载领域编排与持久化 | `ipc.ts:417-426`（`recordGitOperation`）、`:428-433`（`recordClone`）、`:435-440`（`recordCommit`）、`:442-463`（`recordOperation`）、`:465-477`（`resolveProjectIdByPath` 遍历全部工作区逐区 `loadProjects`）、`:329-333`（`tasks:run` 内 `insertTaskRun`）、`:448-462`（日志写入失败静默）；`ipc.ts:58,59-64`（直连 `storage/workspaces` / `storage/projects`） | 每次 git pull/fetch/commit/clone 后主进程做 `1 + N_workspaces` 次全量项目读；`ipc.ts` 直接耦合两张表；任何非 IPC 触发路径（托盘、启动时自动更新、未来定时任务）无法复用编排，只能复制粘贴；审计日志与业务动作无事务性 | ① 新增 `services/operations.ts`，`recordOperation` / `resolveProjectIdByPath` 下沉，`ipc.ts` 只留一行转发；② 反查改 `storage/projects.findByPath(path)` 单条索引查询；③ `insertTaskRun` 移入 `services/tasks.ts`，与 `updateTaskRun` 同层 | **M** | L-03 |
| **P-12** | P1 | 耦合 | 一次任务运行的持久化被切在三处，失败静默 | `services/tasks.ts:116-122`（`persistRun`→`updateTaskRun`）、`:119-121`（`catch {}` 全吞）；`ipc.ts:331`（首次 `insertTaskRun`）、`:341-344`（`tasks:updateRun` handler）；`src/components/TasksWorkspace.tsx:191-192`（结果直接 `setRuns`） | "谁负责一次运行的完整生命周期"无唯一答案；`persistRun` 失败被完全吞掉 → 运行记录可能永久停在 `running` 且用户无感知；DB 与内存双源，任务中心显示的历史可能与真实执行不一致；（注：`tasks:updateRun` 当前不可达，见 Q-1） | ① `runTask` 内部在 `runningTasks.set` 之前完成 insert，IPC 只返回；② 删除 `tasks:updateRun` 与 `taskRunSchema` 写路径用法；③ `persistRun` 失败改写入一条 `failed` 记录或上抛 | **S** | L-06 |
| **P-13** | P1 | 耦合 | `services/git.ts` 991 行 / 38 个顶层函数，单文件覆盖 8 个不相关子域 | `services/git.ts:76-100`（二进制探测）、`:102-161`（仓库检查/init/扫描）、`:163-321`（diff/tags/versions/compare）、`:323-443`（snapshot/operation）、`:445-557`（暂存/提交/分支）、`:559-619`（历史/revert）、`:624-739`（clone + 校验）、`:741-783`（进程封装 + 磁盘缓存）、`:785-885`（磁盘统计/README）、`:886-990`（移动/文件计数） | 任何一处修改的爆炸半径 = 991 行；无法按子域测试或替换；磁盘统计（与 git 无关）与 git 命令共享同一模块级缓存（`git.ts:767-768`）；`git.ts` 是最重的"服务层无测试"（P-18）里最难解的一块 | 按子域拆 `services/git/{binary,repo,status,history,branch,clone,disk}.ts` + `git/index.ts` 重导出保持 `ipc.ts` import 不变；拆分前先补命令拼装测试 | **L** | L-05 |
| **P-14** | P1 | 类型安全 | `shared/types.ts` 已成上帝类型文件，通道名无单一常量源 | `shared/types.ts:1-546`（66 类型）、`:458-546`（`DesktopBridge` 88 方法）；三处硬编码：`electron/preload/index.ts:55-176`、`ipc.ts:126-407`、`shared/types.ts:458-546`；双 import 别名：`src/types.ts:1`（`export * from "../shared/types"`）与直接引用 `useRemotes.ts:2`；通道名错误仅运行时暴露（`ipc.ts:150` 手动 `throw`） | 领域实体、IPC 方法面、事件 payload、UI 视图枚举（`AppView`）、后端环境结构混在一处；88 方法无分组；前缀不一致（`projects:clone` vs `git:cloneProgress`）无编译期保护；两套别名让"契约来源"看起来像两个模块 | ① 按域拆 `shared/types/{project,git,account,task,backup,settings,ipc}.ts` + `index.ts` 重导出；② 新增 `shared/channels.ts` 常量表，双侧引用并可 `satisfies Record<keyof DesktopBridge,string>` 做完整性检查；③ 统一 import 入口 | **M** | L-09 |
| **P-15** | P1 | 分层 | `App.tsx` 634 行承担 13 项职责（上帝组件），首启逻辑双份且规则相反 | `src/App.tsx:35-39`（4 个顶层 state）、`:43-205`（8 个 hook 编排）、`:225-287`（首启 bootstrap）、`:264-282`（浏览器分支重复实现）、`:137-143`（`resetView` 强制回总览）、`:248`（首启默认选中首项）、`:545-629`（100+ 行内联安装模态）；规则冲突对照 `useProjects.ts:97-99`（明确写"不做 projects[0] 兜底"） | 双份 bootstrap 已漂移（浏览器分支不设 `selectedId`，desktop 分支设），同一领域规则两处相反实现；`resetView` 把"切工作区"与"强制离开当前页"硬绑定，需求无法拆开；新增页面必须改 if-else 路由链（`:430-502`）；内联模态无法单测 | ① 抽 `useBootstrap()` 统一两分支（浏览器态作为其内部一条分支）；② `SetupModal`/`SetupProgressFloat` 抽到 `src/components/setup/*`；③ 路由改 `Record<AppView, ReactNode>` 映射表；④ 首启是否选中首项交 `useProjects` 决策 | **M** | L-04 |
| **P-16** | P1 | 耦合 | Git 面板没有单一状态源：11 props + 4 setter + ref 登记式联动 + busy 三源 | `src/components/git/HistoryTab.tsx:17-47`（11 props，`:39-44` 四个 setter）；`src/components/git/ChangesTab.tsx:13`（同类骨架）；`src/components/GitActionsPanel.tsx:35,52-54,58-69,197-199`（`historyReloadRef` 登记）；`src/components/detail/GitTabPanel.tsx:36,41-42`（`activeOperation !== null` 判禁用）；`src/hooks/useGitOperations.ts:44`（模块级 `gitBusyRef`）；9 处 `eslint-disable react-hooks/exhaustive-deps`（`BranchesTab:67,73`、`ChangesTab:96,102`、`HistoryTab:107,117,125`、`TagsTab:71,77`） | 面板要"刷新历史"必须先问 ref 里登记过谁，未挂载还要兜底拉取；新增一个上报字段要改 5 个文件；正确性依赖 `externalBusy` 四层 props 透传（`ProjectsWorkspace.tsx:298`→`ProjectDetail.tsx:60`→`GitTabPanel.tsx:26`→`GitActionsPanel.tsx:52`），任一环断裂即重现"批量操作中仍可提交/切分支"的历史缺陷；并发 git 争用 `index.lock` 靠约定而非机制 | ① 建 `useGitPanel(projectPath)` 收敛"当前 tab / shared output / busy / 计数 / reload 触发器"到单一 store（`useReducer`）；② tab 只接 `projectPath` + 2-3 个回调；③ 用显式 `reloadToken` 或 key 替代 ref 登记；④ 可选：主进程对项目路径加进程内串行队列，状态不依赖渲染层 | **M** | L-11 + L-13 |
| **P-17** | P1 | 分层 | AI 摘要的领域逻辑（取数/截断/拼 prompt/降级策略）写在展示组件里 | `src/components/detail/OverviewPanel.tsx:92-168`：`:99-104`（4 路并发取数）、`:105-134`（prompt 拼装）、`:136-146`（AI 调用 + 回退决策）、`:148-159`（本地摘要模板）；magic number `:106,117,153`（`slice(0,400)` 等） | 提示词工程 + 降级策略被绑在 React 生命周期与 bridge 直调上：无法单测、无法复用于"批量生成摘要"、调模型参数必须改 UI；违反 AGENTS.md 第七节「禁止 magic number」 | ① 抽 `src/lib/aiContext.ts` 纯函数 `buildSummaryContext(project, readme, history, analysis, disk)` + 单测；② `useAiSummary` 承载"AI→本地"降级编排；③ 组件只留 `actionMessage` 展示与按钮 | **S** | L-10 |
| **P-18** | P1 | 测试 | 测试分层与实现分层错位：覆盖率门槛只对 19 个白名单文件生效 | `vitest.config.ts:22-43`（include 仅 19 个文件）、`:47-52`（门槛 95/85/90/95）、`:35-37`（注释自认"git.ts 等其余服务层（下一里程碑）"）；无测试：`services/{git,providers,tasks,backups,analysis,commandDetection,environment,setup,ai,updater,credentials,openers,events}.ts`（`git.ts` 991 / `providers.ts` 753）；`src/components` 5,758 行 0 测试；`src/hooks` 仅 `useAsyncData.test.ts` | 门槛对**白名单子集**生效，给出"达标"的假信号；风险最高的 git 命令拼装/解析、provider HTTP、任务进程生命周期、备份 tar 全部无回归保护（AGENTS.md 第八节要求核心业务模块 ≥90%，当前 Git 域为 0）；`gitParsing.test.ts` 只覆盖纯函数，`getProjectSnapshot:323-383`、`cloneRepository:624-712` 等编排未被测试 | 分段推进：① 先补零依赖四项 `src/lib/{projects,workspaces,uiPrefs}.ts` + `bridge.ts`（S）；② 随 P-13 拆分把 `services/git/*` 纳入白名单；③ 组件层引入 `@testing-library/react`，从 `common.tsx`、`TaskProfilesList` 等纯展示件起步 | **L**（分段：S → M → L） | L-12 |

### 5.5 P2 问题（17 条）

| 编号 | 等级 | 类别 | 标题 | 证据（文件:行号） | 影响 | 修复方向 | 成本 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P-19** | P2 | 安全 | 2 个"有 handler、无桥接方法"的死通道（安全视角：2 个未收口的隐藏可写通道） | `ipc.ts:341-344`（`tasks:updateRun` → `updateTaskRun`）、`ipc.ts:359-361`（`operations:record` → `insertOperationRecord`）；`electron/preload/index.ts:54-176` 与 `shared/types.ts:458-546` 均无对应方法；附带死代码 `services/providers.ts:157-159`（`loadCachedRemoteRepositories` 全仓无调用），实际由 `ipc.ts:285-289` 直连 storage | 当前渲染层不可达（`invoke` 是 preload 私有函数），**不构成现成漏洞**；风险是机制缺口：一旦有人"顺手"补进 preload，渲染层即可写任意 `operation_records`（伪造 `ok` 审计）与 `task_runs`；同时扩大了 IPC 攻击面，且 `providers` 的同名函数误导读者以为缓存读取走服务层 | ① 删除两个通道及其 schema / 测试用例（若按 D-02 保留则补桥接方法）；② 加单测：`Object.keys(bridge)` 与 `ipcMain` 注册表双向差集为空；③ `ipc.ts:288` 改走 `providers.loadCachedRemoteRepositories`，不直连 storage | **S** | L-14 + SEC-18 |
| **P-20** | P2 | 安全 | 渲染层可写的设置项被主进程当"可信目标"：`gitPath` 当可执行文件、`aiBaseUrl` 当请求目标 | `ipc.ts:364-366`（`settings:save` 接受任意值）→ `storage/settings.ts:40` 落库 → `services/git.ts:76-83` `getActiveGitBinary()` 原样返回 → `environment.ts:62`、`git.ts:657,742,751` 作为 `execFile/spawn` 程序名；`services/ai.ts:10,35-40`（`fetch(\`${baseUrl}/chat/completions\`, Authorization: Bearer)`）、`:72`（错误码回显）；`ipc/schemas.ts:65`（`looseString()`） | `gitPath` 可持久化为任意 exe → 下次任意 Git 操作触发执行（固定参数足以启动任意程序）；`aiBaseUrl` 改指向即把 AI Key 以 Authorization 头发往攻击者（需用户已配置 Key），并可让主进程 `fetch` 指向内网/元数据地址形成 SSRF | `gitPath` 只接受 `system:installGit` 写入或专用 `system:selectGitBinary` 选择，保存前 `existsSync` + basename `/^git(\.exe)?$/i`，非法回退 `"git"`；`aiBaseUrl` 校验 `https:` + 私网/回环拒绝，并在 `appSettingsSchema` 加 `.superRefine` 使非法值保存即失败 | **S** | SEC-08 + SEC-09 |
| **P-21** | P2 | 安全 | `backups:restore` 用 `tar -xf` 解包渲染层指定归档，无路径穿越/来源校验 | `services/backups.ts:67-86`（`tar -xf archive -C target`）、`:125-131`（`isArchiveReadable` 只判是文件）、`:74-76`（目标只判空目录）；`ipc.ts:350-352`；`ipc/schemas.ts:150-153`（仅 `requiredString`） | 恢复一个非本应用生成的 tar（渲染层指定任意路径，或用户手选下载来的归档）→ GNU tar 会剥离前导 `/`，但对 `../` 条目与符号链接的处理依赖实现，Windows bsdtar 与 GNU tar 行为不同，存在写到目标目录之外的可能（**待运行期验证**） | ① 归档必须位于备份目录内（复用 P-08 的 `assertPathAllowed`）；② 解包加 `--no-same-owner --no-same-permissions`；③ 解包后遍历目标目录，发现符号链接或逃逸路径即回滚删除 | **S** | SEC-12 |
| **P-22** | P2 | 安全 | 分页 `Link` 头未固定同源，Token 可能被发往任意主机 | `services/providers.ts:212-215`（`link?.match(/<([^>]+)>…rel="next"/)`）、`:169-177`（用该 URL 发请求并附 `[endpoint.header]: prefix + token`）、`:204-216`；三平台端点固定在 `:23-45` | 需"上游响应可被伪造"（服务端被控 / 中间人 / 未来 api 域名可配置）才成立；一旦成立，Token 被发送到攻击者域名。当前等级 P2 | `if (next && new URL(next).origin === new URL(endpoint.url).origin) return next;` 跨源一律忽略；Gitee 手工翻页已基于 `response.url`（同源）可保持不变 | **S** | SEC-10 |
| **P-23** | P2 | 安全 | 权限策略与 `webviewTag` 依赖 Electron 默认值，CSP 缺 `frame-ancestors`/`worker-src` | `index.ts:83-100`（`webPreferences` 未含 `webviewTag`）；全仓无 `setPermissionRequestHandler` / `setPermissionCheckHandler` / `session.defaultSession` 配置（grep 为空）；`vite.config.ts:21-34`（CSP 缺 `frame-ancestors`、`worker-src`、`manifest-src`） | 通知/麦克风/地理位置/剪贴板读取等权限请求沿用默认策略；若页面被注入脚本可能触发权限弹窗并获授权；`webviewTag` 依赖默认 `false`，Electron 大版本默认值变动时无兜底（**待运行期验证**） | `session.defaultSession.setPermissionRequestHandler((_wc,_p,cb)=>cb(false))` + `setPermissionCheckHandler(()=>false)`；`webPreferences` 显式 `webviewTag: false`；CSP 补 `frame-src 'none'; frame-ancestors 'none'; worker-src 'self'` | **S** | SEC-11 |
| **P-24** | P2 | 安全 | 一键安装 Git：`%TEMP%` 可预测文件名 + UAC 提权执行，无哈希校验 | `services/setup.ts:64-110`（下载到 `join(app.getPath("temp"), \`gitool-git-setup-${Date.now()}.exe\`)`）、`:116-137`（`powershell -Command "Start-Process … -Verb RunAs -Wait"`，单引号已 `''` 转义 `:120`，拼接本身无可注入点）、`:89`（`asset.size` 只作进度分母） | `%TEMP%` 当前用户可写 → 同用户低权限进程可在"下载完成 → `Start-Process`"窗口期替换 exe，随后经 UAC 提权执行 = **本地权限提升**；未使用 Release `digest`/`asset.size` 做完整性校验 | ① 下载后校验 `sha256` 与 Release `digest`（复用 P-03 的 `sha256File`）；② 落盘到 `userData/tmp` 并建 ACL 受限子目录；③ 执行前 `Get-AuthenticodeSignature` 校验发行者；④ 文件名改 `crypto.randomUUID()` | **M** | SEC-13 |
| **P-25** | P2 | 安全 | 底层错误 message（绝对路径 / 原始 DB 错误 / 网络细节）直接透传到 UI，无错误码映射 | `ipc.ts:159`（`` `无法在资源管理器中打开：${errorMessage}` ``）、`:481`；`storage/database.ts:106`（SQLite 原始错误含表名/约束名）；`services/providers.ts:61,96`（`fetch failed` 及网络细节）；`preload/index.ts:41-52`（只剥 `Error invoking remote method` 前缀） | 信息收集（绝对路径、用户名、DB 结构）为后续攻击提供素材；UNC/恶意归档场景还能把攻击者控制的文件名回显到 UI（配合社工）。**无 stack 泄露**（Electron `invoke` 只回传 message） | 引入 `AppError { code, userMessage, detail }` + `toIpcError`（细节只进本地滚动日志，UI 只收 userMessage）+ 对 `ipcMain.handle` 做统一 try/catch 包装（可分批替换） | **S**（骨架）+ 分批替换 | SEC-14 |
| **P-26** | P2 | 工程化 | 打包与供应链：无签名、`asarUnpack: **/*.node` 整树外置、CI 无漏洞扫描、依赖全 `^` | `electron-builder.yml:18-23`（`asar: true`、`asarUnpack: **/*.node`、`npmRebuild:false`、`nodeGypRebuild:false`）、`:25-39`（NSIS x64，无签名配置）；`ci.yml:21-33`（`npm ci` + typecheck + test:coverage + build，无 `npm audit`/SARIF/secret 扫描/产物归档）、`:24`（`ELECTRON_MIRROR` 指向第三方 mirror）；`package.json:23-45`（依赖全 `^`） | ① 未签名安装包/更新包（与 P-03 叠加）；② `**/*.node` 外置后落在 `app.asar.unpacked`，任何有写权限的本地进程可替换 `.node` → 下次启动加载恶意原生库（装到 `%LOCALAPPDATA%` 时用户可写）；③ 依赖区间 + 第三方 mirror 扩大供应链面；④ 无 `npm audit` 使已知 CVE 无法被流水线拦截 | `asarUnpack` 收窄到 `**/@napi-rs/keyring/**`；CI 加 `npm audit --audit-level=high` + tag 触发签名打包 + 产物归档；`package.json` 加 `overrides`，关键原生模块用精确版本 | **M** | SEC-16 |
| **P-27** | P2 | 工程化 | `openers.ts` 启动失败被静默吞掉 / Windows `.cmd` 解析不确定 | `services/openers.ts:15-18`（`editor === "vscode" ? "code" : "cursor"` → `spawnDetached(command, args)`）、`:39-50`（`child.on("error", () => { /* 静默 */ })`） | 安全影响小（`shell:false` + 常量命令），但启动失败对用户完全不可见（"点了没反应"）；Windows 上 VS Code CLI 是 `code.cmd`，`spawn` 对 `.cmd`/`PATHEXT` 的处理可能直接失败 → 功能静默失效（**待运行期验证**） | `spawnDetached` 返回 `Promise` 并把 `error` 上抛；Windows 用 `ComSpec` 或先解析 `code.cmd` 绝对路径再执行 | **S** | SEC-17 |
| **P-28** | P2 | 分层 | 表所有权破防：accounts 写 `remote_repository_cache`，workspaces 读 `projects` | `services/storage/accounts.ts:156`（`DELETE FROM remote_repository_cache WHERE accountId = ?`）；`services/storage/workspaces.ts:76-84`（`SELECT COUNT(*) FROM projects` + `DELETE FROM workspaces`）；`database.ts:47`（`foreign_keys = ON`，但 `projects`/`remote_repository_cache` 无 FK 声明） | 「storage 是唯一 SQL 入口」成立，但「一张表只有一个 owner」不成立：列名/语义变更时会被兄弟模块悄悄破坏（如给 cache 表加分区键，accounts 的级联删除将失效）；"删除账号清缓存""删除工作区仍有项目"两条跨域不变量无单点表达 | ① 把不变量暴露为 owner 模块 API：`remoteRepositoryCache.deleteByAccount(accountId)`、`projects.countByWorkspace(workspaceId)`，由 accounts/workspaces 调用；② 或补真 FK + `ON DELETE CASCADE/RESTRICT` 让数据库承担 | **S** | L-15 |
| **P-29** | P2 | 类型安全 | 同一联合类型/对象形状在契约、校验、渲染三处各写一遍 | `shared/types.ts:64`（`RemoteProvider`）↔ `:108`（手写 `"github" \| "gitee" \| "gitlab" \| "local"`）↔ `ipc/schemas.ts:182,213,253`；visibility：`types.ts:249` ↔ `useRemotes.ts:37` ↔ `RemoteRepositoriesWorkspace.tsx:60,78`；`TaskType`：`types.ts:278` ↔ `schemas.ts:119`；`RemoteRepositoryWriteInput` 形状在 `useRemotes.ts:31-40` 与 `RemoteRepositoriesWorkspace.tsx:53-63` 各抄一份 | 增删平台（如加 `coding`）或可见性枚举时编译器只报"部分位置"，漏改处被 `.catch()` / `as` 静默吸收（与 P-02 叠加）；`Provider` 在 types 里出现 4 次，是最典型漂移入口 | ① `Project.provider` 改 `RemoteProvider \| "local"`；② `shared/constants.ts` 导出 `const REMOTE_PROVIDERS = [...] as const`，类型与 `z.enum` 均从它派生；③ 组件/hook 直接引用 `RemoteRepositoryWriteInput` / `Partial<…>` | **M** | L-16 |
| **P-30** | P2 | 耦合 | "冲突"判定在两处独立实现 | `services/gitParsing.ts:36-53`（`parseChangeStatus`：`U`/`AA`/`DD` → conflicted）↔ `services/git.ts:323-339`（`getProjectSnapshot` 内联 `line[0]==="U" \|\| line[1]==="U" \|\| startsWith("AA ") \|\| startsWith("DD ")`） | 两处对"冲突"的定义必须永远一致，否则出现"详情页显示 conflicted、项目卡片显示 dirty"；当前实现细节已不同（一个看两字符位，一个额外用带空格 `startsWith`），靠注释维持 | `gitParsing.ts` 增 `parseStatusEntryLine(line)` / `isConflictStatus(status)`，`git.ts:335-339` 改为调用；共用 `"AA"/"DD"/"U"` 常量 | **S** | L-17 |
| **P-31** | P2 | 分层 | 渲染层用硬编码反斜杠拼路径（平台语义泄漏到 UI） | `src/hooks/useRemotes.ts:297`（`` `${parentDirectory}\\${repository.name}` ``）、`src/hooks/useImportFlow.ts:115`（`` `${directory}\\${projectName}` ``）；正确做法对照 `services/git.ts:14`（`import { basename, dirname, isAbsolute, join } from "node:path"`）、`:726-739`（`assertCloneTarget`） | 渲染层与主进程路径规则分叉；名称含尾随空格/保留字（`CON`、`aux.`）时结果不同；浏览器预览下 `\\` 也是错的 | 让 `initRepository`/`cloneRepository` 接受 `parentDirectory` + `name`，由主进程 `join` 并做合法性校验；渲染层只传语义入参（复用 P-08 的 `pathPolicy`） | **S** | L-18 |
| **P-32** | P2 | 耦合 | 应用设置有两份运行时状态，字段形状在三处维护 | `src/App.tsx:38`（`appSettings` state）、`:239`（首启写入）；`src/components/SettingsWorkspace.tsx:72`（第二份 `settings` state）、`:81-94`（自己再 `loadSettings`）、`:105-109`（保存后单向回写 App）、`:19-29`（`INITIAL_SETTINGS` 第三份形状）；`schemas.ts:57-67` | 任一入口改设置后 App 侧不自动刷新；`BackupsWorkspace.tsx:37` 与 `OverviewPanel.tsx:103` 也各自读设置；加字段要改三处；App 顶栏/总览依赖的 `defaultSearchAccountId` 可能与设置页显示不一致（直到重进设置页） | ① 设置纳入 `useSettings()` 单一 store（可复用 P-16 的 store 方案）；② `INITIAL_SETTINGS` 从 `shared` 导出默认值常量，与 schema `.catch()` 兜底共用一份 | **S** | L-19 |
| **P-33** | P2 | 工程化 | 主→渲染推送有三条实现路径 + 7 处模块级可变单例 | 推送：`main/index.ts:12`（`window.webContents.send("updater:available")`）、`ipc.ts:400`（`win?.webContents.send("updater:progress")`）、`services/events.ts:3-8`（`notifyRenderer`，被 `git.ts:50`、`setup.ts:8` 使用）；单例：`src/lib/bridge.ts:7`（`window.gitool`）、`useGitOperations.ts:44`（`gitBusyRef`）、`ipc.ts:121-124`（`cachedDownloadUrl`/`updateDownloadInFlight`）、`tasks.ts:8,11`（`runningTasks`/`stopRequested`）、`git.ts:767-768`（`diskSizeCache`）、`storage/database.ts:35`（连接） | 三路径中只有 `notifyRenderer` 广播全部窗口，`index.ts:12`/`ipc.ts:400` 只发单窗口 → 多窗口/托盘场景事件会丢；模块级状态无统一重置入口（`cachedDownloadUrl` 跨"检查→下载"两次 IPC 保持），主进程逻辑难以单测（需 `vi.resetModules`） | ① 事件统一走 `services/events.ts`（新增 `sendToWindow` 供定向场景）；② `cachedDownloadUrl`/`updateDownloadInFlight` 收进 `updater.ts` 的"一次更新会话"对象，IPC 只持 id；③ 为模块级状态补 `reset*ForTest()` 或依赖注入 | **M** | L-20 |
| **P-34** | P2 | 耦合 | `database.ts` 混合连接/DDL迁移/行映射三类职责；`ipc.ts` 一个 291 行函数注册 78 个 handler | `services/storage/database.ts:39-163`（连接生命周期 + 9 张表内联 DDL）、`:194-284`（`ensureIndexes` + 3 迁移 + 种子）、`:285-406`（7 个 `rowToX`）；`ipc.ts:125-415`（`registerIpcHandlers` 291 行，仅用空行视觉分组） | 改 schema 需动 406 行文件的 DDL 区与迁移区；行映射与 DDL 靠手工一致，列名改动无编译期检查（靠 `as unknown as SqlRow` 遮盖，见 P-35）；无法定位"我改的通道在哪一段"，也无法按域拆分测试；每次新增实体继续膨胀 | `database.ts` → `database/{connection,schema,migrations/*,rows/*}`；`ipc.ts` → `ipc/{system,projects,git,accounts,remotes,tasks,backups,settings,updater}.ts` 各导出 `register(ipcMain)`，`ipc.ts` 只做聚合（同时为 P-19 的双向差集校验提供入口） | **M** | L-21 |
| **P-35** | P2 | 类型安全 | 类型安全两个收口点都靠断言：DB 行 `as unknown as`、IPC 出参 `as T`；且 tsconfig 缺关键严格开关 | 17 处 `as unknown as SqlRow`：`storage/accounts.ts:21,34,120`、`storage/backups.ts:16`、`storage/database.ts:203,225,242`、`storage/operations.ts:22`、`storage/projects.ts:23,76`、`storage/remoteRepositoryCache.ts:32,48`、`storage/settings.ts:14`、`storage/tasks.ts:18,26,86`、`storage/workspaces.ts:22`；另有 `src/lib/projects.ts:14`（`parsed as Project[]`）、`preload/index.ts:41-43`（`invoke<T>` 内 `as T`）与事件 payload 断言（`:58-61,81-84,158-161,167-170`）；`tsconfig.app.json:5-20`、`tsconfig.electron.json:4-12`（`strict:true` + `skipLibCheck:true`，缺 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`/`noImplicitOverride`/`noFallthroughCasesInSwitch`） | ① `node:sqlite` 返回 `unknown`，`as unknown as` 把"列名写错/类型不符"变成运行时 `undefined`，再被 `String(undefined)` 变成字符串 `"undefined"` 落库或展示；② preload 的 `as T` 意味着主进程返回结构任何变化在渲染层都不报错，只让 UI 读到 `undefined`；③ 索引访问按 `T` 处理，越界只能靠运行时兜底。**入参有 zod、出参零校验** | ① 为 `rowToX` 加运行时断言/轻量 zod（失败抛带表名列名的错误），`storage` 内 `as unknown as SqlRow` 计数归零；② 高频返回值（`Project[]`/`GitSnapshot`/`EnvironmentStatus`）在 preload 加轻量校验（schema 需移到 `shared/` 以避开 electron 依赖）；③ `lib/projects.ts:14` 用 schema 校验；④ tsconfig 分步开严格开关（先 electron 后 app） | **M** | L-22 + SEC-15 |

### 5.6 严重度与类别分布

| 等级 | 数量 | 条目 |
| --- | --- | --- |
| **P0** | **2** | P-01、P-02 |
| **P1** | **16** | P-03~P-18 |
| **P2** | **17** | P-19~P-35 |
| 合计 | **35** | layering 22 + security 18 = 40 → 合并 5 组 → 35 |

| 类别 | 数量 | 条目 |
| --- | --- | --- |
| 安全 | 14 | P-03~P-09、P-19~P-25 |
| 分层 | 7 | P-01、P-10、P-11、P-15、P-17、P-28、P-31 |
| 耦合 | 6 | P-12、P-13、P-16、P-30、P-32、P-34 |
| 类型安全 | 4 | P-02、P-14、P-29、P-35 |
| 测试 | 1 | P-18 |
| 工程化 | 3 | P-26、P-27、P-33 |

> 注：合计 35 = 安全 14 + 分层 7 + 耦合 6 + 类型安全 4 + 测试 1 + 工程化 3。P-27（`openers`）的"启动失败静默"本身不是安全漏洞，但同一条目包含 `.cmd` 解析风险，仍归工程化主责。若按"是否含安全语义"统计，安全相关条目为 17 条（P-03~09 共 7 条、P-19~27 共 9 条、P-35 共 1 条）。

---

## 6. 优先级路线图

三批划分不是按"问题等级"切，而是按**依赖关系与可验证性**切：每一批结束时都应有一条可机器判定的收敛信号，且下一批不会推翻上一批的改动。

### 6.1 批次总览

| 批次 | 主题 | 覆盖问题 | 收敛信号（批次级） | 预估 | 阻塞前提 |
| --- | --- | --- | --- | --- | --- |
| **第 1 批** | 止漏与立边界 | P-03~P-09、P-19~P-23、P-25、P-27、P-01、P-02、P-17、P-31（18 条） | ① `spawn("cmd"` 计数 = 0；② `redactSecrets` 单测绿 + 仓库内无"内嵌凭据 URL 可写入"路径；③ `requireString` 调用在 `ipc.ts` 归零；④ `bridge.*` 在 `src/components` 的计数从 53 降到 ≤34（Git 域清零）；⑤ 投影测试绿（实体工厂产物全部通过 schema） | 10~14 人日（1A 约 3 天，1B 约 5 天，1C 约 5 天） | 无（1A 全部可立即开工）；1B 的 P-03 依赖 D-06 决策；1C 的 P-01 依赖 P-02 先落地 |
| **第 2 批** | 拆巨块、补测试 | P-10~P-16、P-18、P-34（9 条；P-19 的差集门禁已归第 1 批 A-05） | ① `ipc.ts` < 120 行；② `services/git/*` 单文件 ≤250 行；③ `npm run test:coverage` 白名单包含 `services/git/*` 且达标；④ `isDesktopRuntime()` 在 hooks 内归零；⑤ `useGitPanel` props ≤4 | 18~25 人日 | 第 1 批完成（尤其 P-01 的 Git 域切片、P-02 的工厂、P-07 的 schema 基元） |
| **第 3 批** | 工程化与供应链、一致性收尾 | P-24、P-26、P-28~P-30、P-32、P-33、P-35（8 条；P-23 的 CSP 补项归第 1 批 A-08） | ① `npm audit --audit-level=high` 退出码 0；② CI 产物签名 `Status=Valid`；③ 开启 `noUncheckedIndexedAccess` 后 `tsc -b` 通过；④ `storage` 内 `as unknown as SqlRow` 归零 | 8~12 人日（含证书流程） | 第 2 批完成（拆巨块后才有稳定的静态检查基线）；P-26 依赖 P-03 的证书流程；P-24 复用 P-03 的哈希工具 |

### 6.2 第 1 批：止漏与立边界

**为什么是这个顺序**：先做"不触碰模块边界、成本 S、每项都有独立用例"的止漏动作（1A），它们彼此零依赖、可并行、当天即可验证；再做需要一条共用底座（`pathPolicy`、统一 schema 基元）的 M 项（1B）；最后才动渲染层与实体构造（1C），因为 P-01/P-02 要改 14 个组件与 6 处构造点，放在安全止血之后才不会"边改边漏"。**反过来说：先拆 `git.ts` 或先补测试都是错的——它们不改攻击面，还会把止血 PR 拖长。**

| 波次 | 建议顺序 | 问题 | 依赖 | 理由 |
| --- | --- | --- | --- | --- |
| **1A**（S，可并行） | 1 | P-04 | 无 | 30 行改动，直接删掉"渲染层 → 宿主任意命令"最短路径；当天可完成可验证 |
| | 2 | P-05 | 无 | 凭据扩散面最广（`.git/config` / SQLite / CSV 三处），且修复是"入口拦截 + 出口脱敏"的加法，风险最低 |
| | 3 | P-06 | 无 | 与 P-05 同文件（`git.ts` 克隆段），同一 PR 提交可少一次回归 |
| | 4 | P-19 | 无（D-02 决策） | 删除 2 个死通道，同时为 P-07 的门禁测试清理基线；成本 S |
| | 5 | P-20 | 无 | 两个"设置项当可信目标"的点位一次收口，复用同一 schema 校验 |
| | 6 | P-22 | 无 | 单行同源校验 |
| | 7 | P-23 | 无 | 权限 handler + `webviewTag` 显式声明，防止依赖 Electron 默认值 |
| | 8 | P-25 | 无 | 错误码骨架 + 统一包装，是 1B 各修复的"错误出口"，先建骨架后续直接复用 |
| | 9 | P-27 | 无 | 启动失败上抛，顺手修掉"点了没反应" |
| **1B**（M，需共用底座） | 10 | P-08 → P-21 | P-08 产出的 `pathPolicy` 是 P-21/P-31 的底座 | 先建"允许根 + 拒 UNC"的单一模块，再让 tar 恢复复用；否则会出现两套路径判断 |
| | 11 | P-03 | D-06（更新源与证书）、P-04 已完成 | 去掉 `cmd` 之后再补摘要校验与签名，避免"签名了一个仍可被注入的安装流程" |
| | 12 | P-07 | P-19（通道基线稳定）；若在 P-14 之前落地，需接受门禁测试随 `channels.ts` 重写一次 | schema 覆盖 + 门禁测试是"防回退"机制，必须在死通道清理后建立，否则门禁基线本身含噪声 |
| | 13 | P-09 | D-08（是否接受命令白名单收敛） | 白名单会改变产品能力边界，需先确认；技术上依赖 `commandDetection` 的产物全部落在白名单内 |
| **1C**（立边界） | 14 | P-02 | 无（但建议在 P-07 之后，共用 `schemas.ts`） | 纯函数 + 单测，风险最低，先消除"静默写坏数据"；它是 P-01 的前置（hook 迁移时要有统一构造点） |
| | 15 | P-01（Git 域切片） | P-02、P-16 的 store 草案 | 19/53 处集中在 Git 域，先做它收益最大、边界最清晰；其余 4 个域在 1C 内分批 |
| | 16 | P-17 | 无（S，可随时插入） | 抽 `aiContext` 纯函数，与 P-01 的 `OverviewPanel` 迁移同文件，可合并实施 |
| | 17 | P-31 | P-08 | 复用 `pathPolicy` 的 `join`，顺手消掉渲染层反斜杠拼接 |

### 6.3 第 2 批：拆巨块、补测试

**为什么是这个顺序**：本批动作几乎全部落在 `ipc.ts` / `git.ts` / `tasks.ts` 三个文件上，**必须串行**，否则每次合并都要解决大面积冲突。顺序设计为"先建目录骨架 → 再搬逻辑 → 再补测试 → 最后调 UI 层级"：先 P-34 把 `ipc.ts` 按域拆开、`database.ts` 拆成 connection/schema/migrations/rows，为后续所有改动提供落点；P-11 依赖这个落点把编排搬进 `services/operations.ts`；P-12 与 P-19 同一处（任务运行记录），紧接其后；P-13 是风险最高的一步（Git 命令参数顺序极敏感），必须先把 `ipc.ts` 稳定下来、并先补命令拼装测试；P-18 只能在 P-13 拆完后按新模块纳入白名单，否则覆盖率仍是对旧文件计数；P-16/P-15/P-10 是渲染层结构调整，放在主进程稳定之后；**P-14 放最后**，因为拆 `types`/`channels` 会与所有改通道的 PR 冲突。

| 建议顺序 | 问题 | 依赖 | 理由 |
| --- | --- | --- | --- |
| 1 | P-34 | 第 1 批 P-19/P-07 完成 | 先建目录骨架；`ipc.ts` 从 499 行降到"聚合 + 组合根" |
| 2 | P-11 | P-34 | 编排下沉需要按域 ipc 文件作为落点；`resolveProjectIdByPath` 改单条查询 |
| 3 | P-12 | P-11（同属任务运行记录） | 与 P-19 的 `tasks:updateRun` 删除同批完成，避免同一 model 两次改 |
| 4 | P-13 | P-18 的第一段（`git` 命令拼装测试先写） | 991 行拆分前必须先有命令拼装回归，否则拆完无法判断行为是否等价 |
| 5 | P-18 | P-13、P-34 | 覆盖率白名单按新模块重建，才能让门槛与风险区对齐 |
| 6 | P-16 | P-01 的 Git 域 hook 骨架 | store 与 hook 是同一层的两个面，必须一起设计 |
| 7 | P-15 | P-16（复用 store 手法）、P-10 的 D-01 决策 | `App.tsx` 拆分涉及 bootstrap 双分支，先定"浏览器预览"去留 |
| 8 | P-10 | D-01 | Repository 接口的形状取决于"是否保留 Web 实现" |
| 9 | P-14 | 所有通道改动冻结后 | 契约拆域是纯机械但大面积的重构，放最后 |

### 6.4 第 3 批：工程化与供应链

**为什么是这个顺序**：签名与 CI 是**发布门禁**，只有在攻击面收敛（第 1 批）、测试基线建立（第 2 批）之后才有意义——否则是在给一个仍在变的产物签名、在无测试的仓库上开严格开关，只会制造噪音与假绿。批次内顺序为"签名/扫描（P-26）→ 安装链加固（P-24）→ 类型收口（P-35）→ 一致性收尾（P-28~P-30、P-32、P-33）"：前两项对外部可见（用户侧 SmartScreen、更新可信度），后两项是内部质量，可以按"顺手修"挂到邻近 PR。

| 建议顺序 | 问题 | 依赖 | 理由 |
| --- | --- | --- | --- |
| 1 | P-26（签名 + `npm audit` + `asarUnpack` 收窄） | P-03 的证书流程 | 先让产物可验证、已知 CVE 可拦截；`asarUnpack` 收窄同时降低 P-26 自身的 .node 替换面 |
| 2 | P-24（setup 哈希 + 目录加固） | P-03 的 `sha256File` 工具 | 复用同一哈希实现，避免两套校验逻辑 |
| 3 | P-35（tsconfig 分步 + 行校验 + 出参校验） | P-34（行映射已集中） | 行映射集中在 `database/rows/*` 之后，`as unknown as` 清理范围才可控 |
| 4 | P-28、P-29、P-30、P-32、P-33 | 无（均为 S/M 局部改动） | 一致性收尾，不改变外部行为；建议按"改到哪个文件顺手修"执行，不单独排期 |

### 6.5 依赖关系图

```mermaid
flowchart LR
  subgraph B1["第 1 批"]
    P04["P-04"] --> P03["P-03"]
    P03 --> P26["P-26（批 3）"]
    P05["P-05"]
    P06["P-06"]
    P19["P-19"] --> P07["P-07"]
    P19 --> P12["P-12（批 2）"]
    P20["P-20"]
    P22["P-22"]
    P23["P-23"]
    P25["P-25"]
    P27["P-27"]
    P08["P-08"] --> P21["P-21"]
    P08 --> P31["P-31"]
    P02["P-02"] --> P01["P-01"]
    P01 --> P16["P-16（批 2）"]
  end
  subgraph B2["第 2 批"]
    P34["P-34"] --> P11["P-11"] --> P12
    P34 --> P18["P-18"]
    P13["P-13"] --> P18
    P16 --> P15["P-15"]
    P14["P-14（收尾）"]
  end
  subgraph B3["第 3 批"]
    P26 --> P24["P-24"]
    P34 --> P35["P-35"]
  end
  P07 --> P34
```

---

## 7. 落地改进清单（可勾选）

**使用方式**：每条动作独立成 PR；勾选条件 = 该行"验收信号"全部通过且 `npm run typecheck && npm run test:coverage && npm run build` 三门禁全绿。命令均在仓库根目录执行（PowerShell）。

**动作 ↔ 问题对照**（36 个动作覆盖 35 条问题，无遗漏；P-03 拆为摘要校验 A-02 + 签名 A-29，P-01 拆为 Git 域 A-16 + 其余域 A-17，P-32 由 A-17 部分覆盖、A-35 收尾）：

| 动作 | 覆盖问题 | 动作 | 覆盖问题 |
| --- | --- | --- | --- |
| A-01 | P-04 | A-19 | P-31 |
| A-02 | P-03（摘要校验） | A-20 | P-34 |
| A-03 | P-05 | A-21 | P-11 |
| A-04 | P-06 | A-22 | P-12 |
| A-05 | P-19 | A-23 | P-13 |
| A-06 | P-20 | A-24 | P-18 |
| A-07 | P-22 | A-25 | P-16 |
| A-08 | P-23 | A-26 | P-15 |
| A-09 | P-25 | A-27 | P-10 |
| A-10 | P-27 | A-28 | P-14 |
| A-11 | P-08 | A-29 | P-26 + P-03（签名） |
| A-12 | P-21 | A-30 | P-24 |
| A-13 | P-07 | A-31 | P-35 |
| A-14 | P-09 | A-32 | P-28 |
| A-15 | P-02 | A-33 | P-29 |
| A-16 | P-01（Git 域） | A-34 | P-30 |
| A-17 | P-01（其余域）+ P-32 | A-35 | P-32（收尾） |
| A-18 | P-17 | A-36 | P-33 |

### 7.1 第 1 批：止漏与立边界（19 项）

| 状态 | 编号 | 动作 | 涉及文件（精确路径） | 验收信号（可机器判定） | 预估改动量 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | A-01 | 移除 `cmd /c start`，改为直接 `spawn(installerPath, ["/S"])` + `existsSync` + 文件名白名单，`error` 不静默 | `electron/main/services/updater.ts` | `(Select-String -Path electron\main\services\updater.ts -Pattern 'spawn\("cmd"').Count` = 0；`npx vitest run electron/main/services/updater.test.ts -t "rejects untrusted installer path"` 通过 | ~30 行 | 低：安装包启动参数变化，需手测一次 NSIS 静默安装 |
| [ ] | A-02 | 校验 GitHub Release `digest`（`sha256:`），不符即删包并报错；`cachedDownloadUrl` 旁新增 `cachedDigest` | `electron/main/services/updater.ts`、`electron/main/services/updater.test.ts`（新增） | `npx vitest run electron/main/services/updater.test.ts -t "digest mismatch removes file"` 通过；`(Select-String -Path electron\main\services\updater.ts -Pattern 'digest').Count` ≥ 2 | ~60 行 + 测试 | 低：若上游 release 未提供 `digest` 需回退策略（缺失即拒装） |
| [ ] | A-03 | 入口拒绝内嵌凭据 URL；`redactSecrets` 覆盖进度输出、克隆结果、操作日志、CSV 导出；备份排除 `.git/config` | `electron/main/services/serviceUtils.ts`、`services/git.ts`、`electron/main/ipc.ts`、`services/operationCsv.ts`、`services/backups.ts`、新增 `services/serviceUtils.test.ts` | `npx vitest run electron/main/services/serviceUtils.test.ts -t "redactSecrets"` 通过；`(Select-String -Path electron\main\services\operationCsv.ts -Pattern 'redactSecrets').Count` ≥ 1 | ~80 行 + 测试 | 中低：脱敏正则可能误伤正常 URL（需用真实样例回归） |
| [ ] | A-04 | 克隆凭据改 `GIT_CONFIG_COUNT/KEY_0/VALUE_0` + `GITOOL_ASKPASS_TOKEN` 环境变量注入，删除 `--config` | `electron/main/services/git.ts`、`electron/main/services/git.test.ts`（新增，含 `skipIf(!hasGit)`） | `npx vitest run electron/main/services/git.test.ts -t "does not persist credential helper"` 通过；克隆后 `git -C <tmp> config --get credential.helper` 输出为空 | ~40 行 | 中低：git 版本对 `GIT_CONFIG_*` 支持需 ≥2.31（项目依赖的 git 版本需确认） |
| [ ] | A-05 | 删除 `tasks:updateRun`、`operations:record` 两个通道及其 schema 用例；`ipc.ts:288` 改走 `providers.loadCachedRemoteRepositories`；新增桥接/注册表差集测试 | `electron/main/ipc.ts`、`electron/main/ipc/schemas.ts`、`electron/main/ipc/schemas.test.ts`、`electron/main/services/providers.ts`、新增 `electron/main/ipc/bridgeParity.test.ts` | `[regex]::Matches((Get-Content electron\main\ipc.ts -Raw), 'ipcMain\.handle\(').Count` = 76；`npx vitest run electron/main/ipc/bridgeParity.test.ts` 通过 | ~50 行（净删除） | 低：若 D-02 选择保留则改为补桥接方法 |
| [ ] | A-06 | `gitPath` 仅接受安装/专用选择通道写入 + `existsSync` + basename `/^git(\.exe)?$/i`；`aiBaseUrl` 限 `https:` 且拒私网/回环，`appSettingsSchema` 加 `.superRefine` | `electron/main/services/settings.ts`、`services/git.ts`、`services/ai.ts`、`electron/main/ipc/schemas.ts`、`electron/main/ipc/schemas.test.ts` | `npx vitest run electron/main/ipc/schemas.test.ts -t "aiBaseUrl"` 通过（http、`169.254.169.254` 均被拒）；`-t "gitPath"` 通过（`calc.exe` 被拒） | ~70 行 | 中低：可能影响"自定义 Git 路径"的老用户（需迁移提示） |
| [ ] | A-07 | 分页 `Link` 头加同源校验，跨源一律忽略 | `electron/main/services/providers.ts`、`electron/main/services/providers.test.ts`（新增） | `npx vitest run electron/main/services/providers.test.ts -t "ignores cross-origin next link"` 通过 | ~5 行 + 测试 | 低 |
| [ ] | A-08 | `session.defaultSession` 权限回调一律拒绝；`webPreferences` 显式 `webviewTag: false`；CSP 补 `frame-src`/`frame-ancestors`/`worker-src` | `electron/main/index.ts`、`vite.config.ts` | `(Select-String -Path electron\main\index.ts -Pattern 'setPermissionRequestHandler\|webviewTag').Count` ≥ 2；打包后 DevTools 执行 `Notification.requestPermission()` 返回 `denied`（运行期验证项 #5） | ~20 行 | 低：若未来需要通知等权限需显式放行 |
| [ ] | A-09 | 新增 `ipc/errors.ts`（`AppError` + `toIpcError`）与统一 `handle()` 包装；`ipc.ts:159,481` 改用错误码 | `electron/main/ipc/errors.ts`（新增）、`electron/main/ipc.ts`、新增 `electron/main/ipc/errors.test.ts` | `npx vitest run electron/main/ipc/errors.test.ts` 通过；`(Select-String -Path electron\main\ipc.ts -Pattern 'errorMessage\(').Count` 逐批降为 0 | ~80 行 + 逐通道替换 | 中低：错误文案变化会影响用户可见提示，需对照现有文案 |
| [ ] | A-10 | `spawnDetached` 返回 `Promise` 并把 `error` 上抛；Windows 解析 `.cmd` 绝对路径或走 `ComSpec` | `electron/main/services/openers.ts`、新增 `electron/main/services/openers.test.ts` | `npx vitest run electron/main/services/openers.test.ts -t "propagates spawn error"` 通过 | ~25 行 | 低：编辑器的启动方式在 Windows 上需实机验证（运行期验证项 #8） |
| [ ] | A-11 | 新增 `services/pathPolicy.ts`（拒 UNC + 要求绝对路径 + 允许根），接入 `shell:openPath`/`openTerminal`/`projects:*`/`git:*` 共 12+ handler 与 `selectDirectory` 返回值 | `electron/main/services/pathPolicy.ts`（新增）、`services/serviceUtils.ts`、`electron/main/ipc.ts`、新增 `pathPolicy.test.ts` | `npx vitest run electron/main/services/pathPolicy.test.ts` 通过（`\\\\evil\\share`/相对路径 rejected、已登记项目路径 allowed） | ~150 行 | 中：需处理"未登记项目的导入流程"与"用户主目录"边界 |
| [ ] | A-12 | 备份恢复：归档限定备份目录（复用 `pathPolicy`）、解包加 `--no-same-owner --no-same-permissions`、解包后校验符号链接/逃逸 | `electron/main/services/backups.ts`、`electron/main/services/backups.test.ts`（新增） | `npx vitest run electron/main/services/backups.test.ts -t "rejects archive outside backup root"` 通过；构造含 `../pwned.txt` 的 tar 恢复后目标目录外无新文件（运行期验证项 #7） | ~50 行 | 中低：会禁止"从下载目录直接恢复"，需 UI 提示 |
| [ ] | A-13 | IPC schema 全覆盖：统一 `requiredString`（≤4096）+ `localPath`/`idSchema` 基元，替换 30 个 `requireString` 通道；新增 `ipc/coverage.test.ts`；修正 `README.md:124` | `electron/main/ipc/schemas.ts`、`electron/main/ipc.ts`、`README.md`、新增 `electron/main/ipc/coverage.test.ts` | `npx vitest run electron/main/ipc/coverage.test.ts` 通过；`(Select-String -Path electron\main\ipc.ts -Pattern 'requireString\(').Count` = 0 | ~250 行（多为机械替换） | 中：长度上限 4096 可能截断合规的长输入（需确认真实最大长度） |
| [ ] | A-14 | 任务命令白名单 + 元字符拒绝 + Windows 解析 `.cmd` 绝对路径并 `shell:false`；UI 首次执行确认 | `electron/main/services/tasks.ts`、`electron/main/ipc/schemas.ts`、`src/components/tasks/TaskForm.tsx`、新增 `electron/main/services/tasks.test.ts` | `npx vitest run electron/main/services/tasks.test.ts -t "rejects shell metacharacters"` 通过；`-t "rejects command outside allowlist"` 通过 | ~120 行 | 中高：会限制自定义命令（如 `make`），需 D-08 确认；`commandDetection` 产物需全部落在白名单 |
| [ ] | A-15 | `shared/` 增 `entities.ts`（`createProject`/`createTaskProfile`），6 处字面量替换；`projectSchema` 的 `.catch()` 收窄为仅展示字段；新增投影测试 | `shared/entities.ts`（新增）、`electron/main/ipc/schemas.ts`、`src/hooks/useRemotes.ts`、`src/hooks/useImportFlow.ts`、`src/components/TasksWorkspace.tsx`、新增 `shared/entities.test.ts` | `npx vitest run shared/entities.test.ts -t "factory output passes projectSchema"` 通过；`(Get-ChildItem src -Recurse -Include *.ts,*.tsx \| Select-String -Pattern 'status: "clean"').Count` = 0 | ~180 行 | 中低：`entities.ts` 引入运行时值，需与 `shared/types.ts` 的纯类型定位分开（新文件名区分） |
| [ ] | A-16 | Git 域立边界：新增 `useGitPanel(projectPath)`，4 个 tab + `GitActionsPanel` 的 19 处桥直调迁入；新增 ESLint `no-restricted-imports` | `src/hooks/useGitPanel.ts`（新增）、`src/components/git/{ChangesTab,BranchesTab,HistoryTab,TagsTab}.tsx`、`src/components/GitActionsPanel.tsx`、`eslint.config.js`（或等价配置文件） | `(Get-ChildItem src\components\git -Recurse -Include *.tsx \| Select-String -Pattern 'bridge\??\.[A-Za-z]').Count` = 0；在 `src/components/BackupsWorkspace.tsx` 临时插入 `import { getDesktopBridge } from "../lib/bridge"` 后 `npm run lint` **必须报错**（验证规则生效，验证后删除） | ~400 行 | 中：loading/计数/互斥时序需逐一对照 |
| [ ] | A-17 | 其余域立边界：新增 `useTasks`/`useBackups`/`useLogs`/`useSettings`（settings 与 P-32 合并）并迁移 5 个组件；ESLint 规则扩到全 `src/components/**` | `src/hooks/{useTasks,useBackups,useLogs,useSettings}.ts`（新增）、`src/components/{TasksWorkspace,BackupsWorkspace,LogsWorkspace,SettingsWorkspace}.tsx`、`src/components/detail/{OverviewPanel,UnclonedProjectPanel}.tsx`、`src/components/settings/AppSettingsTab.tsx`、`src/components/RemoteRepositoriesWorkspace.tsx` | `(Get-ChildItem src\components -Recurse -Include *.ts,*.tsx \| Select-String -Pattern 'bridge\??\.[A-Za-z]').Count` = 0；`(Get-ChildItem src\components -Recurse -Include *.tsx \| Select-String -Pattern 'getDesktopBridge\|requireDesktopBridge').Count` = 0 | ~600 行 | 中：错误提示文案与 loading 时序最易回归 |
| [ ] | A-18 | AI 摘要逻辑抽纯函数 `aiContext.ts` + `useAiSummary`；组件只留展示 | `src/lib/aiContext.ts`（新增）、`src/hooks/useAiSummary.ts`（新增）、`src/components/detail/OverviewPanel.tsx`、新增 `src/lib/aiContext.test.ts` | `npx vitest run src/lib/aiContext.test.ts` 通过；`(Select-String -Path src\components\detail\OverviewPanel.tsx -Pattern 'slice\(0,').Count` = 0 | ~200 行 | 低：纯函数搬迁，行为等价可用快照对比 |
| [ ] | A-19 | 渲染层不再拼路径：`initRepository`/`cloneRepository` 接受 `parentDirectory` + `name`，主进程 `join` 并校验 | `electron/main/services/git.ts`、`electron/main/ipc.ts`、`shared/types.ts`、`src/hooks/useRemotes.ts`、`src/hooks/useImportFlow.ts` | `(Select-String -Path src\hooks\*.ts -SimpleMatch '\\${').Count` = 0；`npx vitest run electron/main/services/pathPolicy.test.ts -t "joins target path"` 通过 | ~90 行 | 中低：IPC 入参形状变更，需同步 preload 与类型 |

### 7.2 第 2 批：拆巨块、补测试（9 项）

| 状态 | 编号 | 动作 | 涉及文件（精确路径） | 验收信号（可机器判定） | 预估改动量 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | A-20 | `ipc.ts` 按域拆为 `ipc/{system,projects,git,accounts,remotes,tasks,backups,settings,updater}.ts`（各导出 `register`），`ipc.ts` 只做聚合；`database.ts` 拆 `connection/schema/migrations/rows` | `electron/main/ipc/*.ts`（新增 9 个）、`electron/main/ipc.ts`、`electron/main/services/storage/database.ts` → `storage/database/{connection,schema,migrations,rows}.ts` | `(Get-Content electron\main\ipc.ts).Count` < 120；`Test-Path electron\main\services\storage\database.ts` = `False`；现有 21 个测试全绿 | ~600 行搬迁（净增少） | 中高：纯搬迁但涉及全部 78 通道，需逐通道对照 diff |
| [ ] | A-21 | `recordOperation`/`resolveProjectIdByPath` 下沉 `services/operations.ts`；反查改 `storage/projects.findByPath`；`insertTaskRun` 移入 `services/tasks.ts` | `electron/main/services/operations.ts`（新增）、`electron/main/ipc.ts`、`storage/projects.ts`、`services/tasks.ts`、新增 `services/operations.test.ts` | `(Select-String -Path electron\main\ipc.ts -Pattern 'loadProjects\(').Count` = 0；`npx vitest run electron/main/services/operations.test.ts` 通过 | ~150 行 | 中：操作日志写入时机变化可能影响审计完整性 |
| [ ] | A-22 | 任务运行生命周期单点：`runTask` 内部先 insert，再 spawn；`persistRun` 失败写 `failed` 或上抛 | `electron/main/services/tasks.ts`、`electron/main/ipc.ts`、`src/components/TasksWorkspace.tsx`、`electron/main/services/tasks.test.ts` | `npx vitest run electron/main/services/tasks.test.ts -t "inserts running record before spawn"` 与 `-t "writes failed record on persist error"` 均通过 | ~60 行 | 中低：状态机时序变化，需覆盖 stop/超时路径 |
| [ ] | A-23 | `git.ts` 拆 7 个子域 + `git/index.ts` 重导出；拆分前先补命令拼装测试 | `electron/main/services/git.ts` → `services/git/{binary,repo,status,history,branch,clone,disk}.ts`、`services/git/index.ts`、`services/git/*.test.ts`（新增） | `Get-ChildItem electron\main\services\git -Filter *.ts \| ForEach-Object { "$($_.Name): $((Get-Content $_).Count)" }` 全部 ≤250；`npx vitest run electron/main/services/gitParsing.test.ts` 全绿 | ~991 行搬迁 + 测试 | 高：Git 参数顺序极敏感，必须先有拼装测试再拆 |
| [ ] | A-24 | 测试补齐（三段）：①`src/lib/{projects,workspaces,uiPrefs}.ts` + `bridge.ts`；②`services/git/*`、`services/providers.ts`、`services/tasks.ts`；③引入 `@testing-library/react` 从纯展示件起步 | `src/lib/*.test.ts`（新增 4 个）、`services/**/*.test.ts`（新增）、`vitest.config.ts`（白名单扩项）、`package.json`（devDependency） | `npx vitest run src/lib` 全绿；`(Select-String -Path vitest.config.ts -Pattern 'services/git/').Count` ≥ 1；`npm run test:coverage` 达标 | L（分段） | 中：组件测试引入 jsdom 会增加 CI 时长 |
| [ ] | A-25 | `useGitPanel` 单一 store：收敛 tab/output/busy/计数/reloadToken，移除 ref 登记与 4 个 setter | `src/hooks/useGitPanel.ts`、`src/components/git/*.tsx`、`src/components/GitActionsPanel.tsx`、`src/hooks/useGitOperations.ts` | `(Select-String -Path src\components\GitActionsPanel.tsx -Pattern 'registerReload').Count` = 0；`(Get-ChildItem src\components\git -Filter *.tsx \| Select-String -Pattern 'eslint-disable react-hooks/exhaustive-deps').Count` = 0 | ~300 行 | 中高：互斥状态机重写，需覆盖"批量执行中切分支"场景 |
| [ ] | A-26 | `App.tsx` 拆分：`useBootstrap()` + `components/setup/*` + `Record<AppView, ReactNode>` 路由表 | `src/App.tsx`、`src/hooks/useBootstrap.ts`（新增）、`src/components/setup/{SetupModal,SetupProgressFloat}.tsx`（新增）、新增 `useBootstrap.test.ts` | `(Get-Content src\App.tsx).Count` < 300；`npx vitest run src/hooks/useBootstrap.test.ts` 通过 | ~400 行 | 中：首启时序（desktop/web 分支）必须逐条对照 |
| [ ] | A-27 | Repository 接口 + `shared/workspaceRules.ts`；删除 hook 内 `isDesktopRuntime()` 分叉与 `window.prompt` 分支 | `shared/workspaceRules.ts`（新增）、`src/lib/repositories/*.ts`（新增）、`src/hooks/{useProjects,useWorkspaces,useRemotes,useImportFlow}.ts`、`src/App.tsx`、`src/lib/{projects,workspaces}.ts` | `(Get-ChildItem src\hooks -Include *.ts \| Select-String -Pattern 'isDesktopRuntime\(').Count` = 0；`npx vitest run shared/workspaceRules.test.ts` 通过 | ~350 行 | 中高：取决于 D-01（是否保留 Web 实现） |
| [ ] | A-28 | 契约拆域 + `shared/channels.ts`（常量表 + `satisfies` 完整性检查）+ 统一 import 入口 | `shared/types.ts` → `shared/types/*.ts`、`shared/channels.ts`（新增）、`shared/types/*.test.ts`、`electron/preload/index.ts`、`electron/main/ipc/*.ts`、`src/types.ts` | `npx tsc -b` 通过；新增类型级测试断言 `satisfies Record<keyof DesktopBridge, string>`；`(Get-ChildItem electron\preload,electron\main -Recurse -Include *.ts \| Select-String -Pattern '"projects:clone"\|"git:cloneProgress"').Count` = 0 | ~500 行（机械） | 中：大面积重命名，需一次性合并，避免长分支 |

### 7.3 第 3 批：工程化与供应链（8 项）

| 状态 | 编号 | 动作 | 涉及文件（精确路径） | 验收信号（可机器判定） | 预估改动量 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | A-29 | 代码签名 + `asarUnpack` 收窄 + CI 漏洞扫描/签名产物归档 | `electron-builder.yml`、`.github/workflows/ci.yml`、`package.json` | `npm audit --audit-level=high` 退出码 0；`(Select-String -Path electron-builder.yml -Pattern 'forceCodeSigning').Count` = 1；tag 构建产物 `Get-AuthenticodeSignature` → `Status = Valid` | ~40 行配置 + 证书流程 | 中：证书获取/时间戳服务是外部依赖 |
| [ ] | A-30 | 一键装 Git 加固：哈希校验（复用 A-02）+ `userData/tmp` + Authenticode + `randomUUID` 文件名 | `electron/main/services/setup.ts`、`electron/main/services/setup.test.ts`（新增） | `npx vitest run electron/main/services/setup.test.ts -t "sha256 mismatch"` 通过；`(Select-String -Path electron\main\services\setup.ts -Pattern 'randomUUID').Count` ≥ 1 | ~70 行 | 中：UAC 路径需实机验证 |
| [ ] | A-31 | tsconfig 分步开 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`/`noImplicitOverride`；`rowToX` 加运行时校验；高频出参加轻量校验 | `tsconfig.electron.json`、`tsconfig.app.json`、`storage/**/*.ts`、`electron/preload/index.ts`、`shared/schemas/*.ts`（若需移出 electron 依赖） | `npx tsc -b` 通过（开关开启后）；`(Get-ChildItem electron\main\services\storage -Filter *.ts \| Select-String -Pattern 'as unknown as SqlRow').Count` = 0 | ~200 行（含 ?? 补默认值） | 中：编译错误集中在 `database.ts`/`gitParsing.ts`，属补默认值而非改行为 |
| [ ] | A-32 | 表所有权收口：`remoteRepositoryCache.deleteByAccount`、`projects.countByWorkspace`（或补 FK + `ON DELETE`） | `storage/accounts.ts`、`storage/workspaces.ts`、`storage/{remoteRepositoryCache,projects}.ts`、`storage/database.ts`（DDL） | `(Select-String -Path electron\main\services\storage\workspaces.ts -Pattern 'FROM projects').Count` = 0；`npx vitest run electron/main/services/storage -t "cascade"` 通过 | ~80 行 | 中低：若改 DDL 需迁移脚本 + 备份验证 |
| [ ] | A-33 | 联合类型/对象形状单源：`shared/constants.ts` 派生类型与 `z.enum`；组件引用 `RemoteRepositoryWriteInput` | `shared/constants.ts`（新增）、`shared/types.ts`、`electron/main/ipc/schemas.ts`、`src/hooks/useRemotes.ts`、`src/components/RemoteRepositoriesWorkspace.tsx` | `(Get-ChildItem shared,src,electron -Recurse -Include *.ts,*.tsx \| Select-String -Pattern '"github" \| "gitee"').Count` = 0 | ~120 行 | 低 |
| [ ] | A-34 | 冲突判定单源：`gitParsing.ts` 增 `isConflictStatus`，`git.ts` 改为调用 | `electron/main/services/gitParsing.ts`、`electron/main/services/git.ts`、`gitParsing.test.ts` | `(Select-String -Path electron\main\services\git.ts -Pattern 'startsWith\("AA "\)').Count` = 0；`npx vitest run electron/main/services/gitParsing.test.ts -t "isConflictStatus"` 通过 | ~30 行 | 低 |
| [ ] | A-35 | 设置单一来源 `useSettings()` + `shared` 默认值常量（随 A-17 实施） | `src/hooks/useSettings.ts`、`src/App.tsx`、`src/components/SettingsWorkspace.tsx`、`shared/constants.ts` | `(Get-ChildItem src\components -Recurse -Include *.tsx \| Select-String -Pattern 'loadSettings\(').Count` = 0；`npx vitest run src/hooks/useSettings.test.ts` 通过 | ~180 行 | 中低：设置写入的乐观更新/回滚语义需明确 |
| [ ] | A-36 | 事件与单例收口：`events.ts` 增 `sendToWindow`，三条推送统一；更新会话对象化；`reset*ForTest` | `electron/main/services/events.ts`、`electron/main/index.ts`、`electron/main/ipc.ts`、`services/updater.ts`、`services/tasks.ts`、相关测试 | `(Get-ChildItem electron\main -Recurse -Include *.ts \| Select-String -Pattern 'webContents\.send\(').Count` = 1（仅 `events.ts`）；`(Select-String -Path electron\main\services\events.ts -Pattern 'sendToWindow').Count` ≥ 1 | ~200 行 | 中：多窗口行为若存在需先确认 D-05 |

---

## 8. 需用户确认的决策点

以下 10 项**无法仅从代码判定**，且直接决定改动范围；未确认前，对应动作不应开工。每项给出推荐选择与"选错方向的代价"。

| 编号 | 决策点 | 来源 | 选项 | **推荐** | 选错方向的代价 |
| --- | --- | --- | --- | --- | --- |
| **D-01** | 浏览器预览（`isDesktopRuntime() === false`）是否仍是产品目标？ | layering §六-1；关联 P-10、P-15、A-27 | ① 保留完整双实现；② 保留只读演示，删除影子写入；③ 彻底删除 Web 分支 | **②**：保留只读演示（可展示 UI），删除 `src/lib/projects.ts`/`workspaces.ts` 的写入与规则副本，规则收敛到 `shared/workspaceRules.ts` | 选① = 长期维护两份实现与两套行为；选③ = 失去无需安装的预览能力，且要删 `App.tsx:264-282` 等分支，改动面更大 |
| **D-02** | `tasks:updateRun` / `operations:record` 是删除还是补进桥接层？ | layering §六-2；P-19、A-05 | ① 删除；② 补 bridge 方法暴露；③ 保留 handler 但注释"仅主进程内部" | **①删除**（`tasks:updateRun` 与 `operations:record` 均无合法调用方，实际写日志走 `ipc.ts:449` 直调） | 选② = 渲染层获得写审计表能力，审计可信度归零；选③ = 攻击面仍在，且与"桥接 ⊆ 白名单"门禁冲突 |
| **D-03** | `providers.loadCachedRemoteRepositories`（`providers.ts:157`）是废弃遗留还是计划启用？ | layering §六-3；P-19 | ① 删除；② 保留并让 `ipc.ts:288` 改走服务层 | **②保留并统一入口**（"缓存读取走服务层"是分层要求；删除会留下 `ipc.ts` 直连 storage 的先例） | 选① = 少一个服务层符号，但 `ipc.ts` 仍直连 `storage/remoteRepositoryCache`，分层裂缝保留 |
| **D-04** | IPC **出参**是否需要运行时校验？ | layering §六-4；P-35 | ① 全部校验；② 仅高频 3 个结构校验；③ 不校验并文档化豁免 | **②**：`Project[]`、`GitSnapshot`、`EnvironmentStatus` 加轻量校验，其余豁免并在 `AGENTS.md` 第九节留痕 | 选① = 每个通道加 schema，成本与收益不匹配；选③ = 主进程返回结构变更仍会静默变成 `undefined` |
| **D-05** | 是否存在多窗口场景（决定事件广播 vs 定向）？ | layering §六-5；P-33 | ① 单窗口（当前实现即单窗口）；② 未来多窗口 | **①单窗口**，但把 `sendToWindow` 预留出来，`notifyRenderer` 保持广播并接受可选 `windowId` 过滤参数 | 若实际会多窗口却按单窗口改，`git:cloneProgress` 等事件会投递到错误窗口（`events.ts:4-8` 无发起方过滤） |
| **D-06** | 更新源与代码签名治理：个人账号 → 组织账号？是否采购证书？ | security §七、SEC-01；P-03、A-29 | ① 维持个人账号 + 摘要校验；② 组织账号 + PFX 证书签名 + 时间戳；③ 自建静态分发 + 双签名 | **②**：摘要校验解决"传输完整性"，签名解决"来源可信"，二者缺一不可；组织账号消除单点接管 | 选① = 账号被接管仍可推恶意包（摘要由同一被控源提供）；选③ = 运维成本高，单人项目不划算 |
| **D-07** | 是否把"渲染层被攻破"纳入威胁模型？ | security §3.3；决定 P-08/P-09 定级 | ① 纳入（纵深防御按 P1）；② 不纳入（仅按 P2 排期） | **①纳入**：本项目 README 渲染链虽已加固，但 `webviewTag`/权限策略仍依赖默认值，且历史上有过 2 个未暴露通道，假设"渲染层不会被攻破"没有依据 | 选② = P-08/P-09 降为 P2，一旦出现 XSS 即直接是宿主用户权限（而非沙箱内权限） |
| **D-08** | 任务命令是否接受白名单收敛（会限制自定义命令）？ | security SEC-07；P-09、A-14 | ① 完全自由（现状）；② 白名单 + 元字符拒绝 + 首次确认；③ 白名单 + 高级模式开关 | **②**为核心，**③** 作为可选扩展（高级模式需显式开启并写审计） | 选① = 保留"产品设计内的宿主任意命令执行面"，渲染层被攻破即可持久化恶意命令；选③ 若不实现开关 = 白名单误伤 `make`/`just` 等用户命令 |
| **D-09** | tsconfig 严格开关的推进节奏？ | SEC-15；P-35、A-31 | ① 一次全开；② 先 electron 再 app；③ 不开 | **②**：先 `tsconfig.electron.json`（`database.ts`/`gitParsing.ts` 是主要错误源），稳定后再 `tsconfig.app.json` | 选① = 一次产生大量编译错误，容易为了"变绿"而加 `!` 或 `as`，反而降低安全性 |
| **D-10** | 备份恢复是否限制为"仅本应用备份目录内的归档"？ | P-21、A-12 | ① 限制（仅备份目录）；② 允许任意归档但不解包到目录外 | **①限制**；若产品需要"导入外部归档"，作为独立功能设计（显式提示 + 解包前清单预览） | 选② = 仍需自建穿越防护，且无法阻止"用户手选下载来的恶意 tar"，风险不可控 |

---

## 9. 附录

### 9.1 未覆盖范围

| 项 | 说明 | 归属 |
| --- | --- | --- |
| CSS / 样式分层 | `src/styles.css` 3,319 行单文件、无 CSS Module / 组件级样式；本次未评审其组织方式与命名一致性 | 未覆盖（需单独评审） |
| 运行时行为 | 未启动应用、未运行测试、未做动态分析；窗口数量、托盘、更新流程、权限默认值均为静态推断 | 未覆盖（见 9.2） |
| 测试用例内容 | 仅统计测试文件数量与分布，未逐个阅读用例断言质量 | 未覆盖 |
| 构建产物与配置结论 | `package.json`/`tsconfig*`/`vite.config.ts`/`electron-builder.yml` 的结论来自 security 报告，本报告只引用 | security 报告 |
| 完整 IPC 通道逐条清单 | 78 invoke + 4 event 的逐行清单见 structure §3.2/§3.3 | structure 报告 |
| 依赖漏洞实际清单 | 只指出"CI 无漏洞扫描"，未执行 `npm audit` 取实际 CVE 列表 | 未覆盖（可在 A-29 中首次执行） |

### 9.2 待运行期验证清单（静态无法定论，勿据此断言可利用性）

| # | 待验证项 | 验证方法 | 关联 |
| --- | --- | --- | --- |
| 1 | `installUpdate` 的 cmd 元字符注入是否真正生效 | 隔离环境调用 `installUpdate("%TEMP%\\gitool-updates\\a&calc.exe")`，观察是否启动第二条命令 | P-04 |
| 2 | `git clone -c` 是否把 helper 写入 `.git/config` | 克隆后 `git -C <target> config --list --local` | P-06 |
| 3 | UNC 路径是否触发 NTLM 出站认证 | 隔离环境 `shell.openPath("\\\\<可控SMB>\\x")` 并抓包看 `Negotiate`/`NTLMSSP` | P-08 |
| 4 | Git 失败输出是否回显内嵌令牌 URL | 用无效内嵌令牌 URL 克隆，检查 `operation_records.detail` 与 UI 日志 | P-05 |
| 5 | 未设权限 handler 时的实际授权行为 | 打包版内注入 `Notification.requestPermission()` 观察返回值 | P-23 |
| 6 | `webviewTag` 默认值 | 临时页面插入 `<webview src="about:blank">` 观察是否创建 | P-23 |
| 7 | `tar` 对 `../` 条目与符号链接的处理 | 构造 `evil.tar` 含 `../pwned.txt`，执行 `restoreBackup` 后检查目标目录外层 | P-21 |
| 8 | `spawn("code")` 是否能启动 VS Code | 目标机点击"在编辑器中打开"，观察进程与 UI 反馈 | P-27 |
| 9 | Electron 44 下 `allowRunningInsecureContent` 默认值 | 通过 `webContents.session` 实测混合内容页 | B-01 基线 #5 |

### 9.3 可复现命令

```powershell
# ── 基线数字（与 structure §0 对齐）────────────────────────────
# handler 计数（应为 78；本报告复核通过）
(Get-Content electron\main\ipc.ts -Raw | Select-String -Pattern 'ipcMain\.handle\(' -AllMatches).Matches.Count

# preload 桥成员计数（应为 80）
(Select-String -Path electron\preload\index.ts -Pattern '^\s{2}[A-Za-z0-9_]+:\s').Count

# 事件通道（应为 4 行命中）
Select-String -Path electron\main\*.ts,electron\main\services\*.ts -Pattern 'notifyRenderer\(|webContents\.send\('

# 渲染层是否引用 electron / node（应为 0）
(Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'from "(electron|node:)').Count

# ── 分层现状（本报告复核项）──────────────────────────────────
# 组件自行取桥的文件数与命中行数（10 个文件 / 20 行）
(Get-ChildItem src\components -Recurse -Include *.tsx | Select-String -Pattern 'getDesktopBridge|requireDesktopBridge').Count

# 组件内 bridge.* 调用（53 行 / 14 文件）
(Get-ChildItem src\components -Recurse -Include *.tsx | Select-String -Pattern 'bridge\??\.[A-Za-z]').Count

# hooks 内运行时分叉（13 处）
(Get-ChildItem src\hooks -Include *.ts | Select-String -Pattern 'isDesktopRuntime\(').Count

# SQL 是否只在 storage（命中文件应全部位于 services\storage）
Get-ChildItem electron\main -Recurse -Include *.ts | Select-String -Pattern 'SELECT |INSERT |UPDATE |DELETE |\.prepare\(' | Group-Object Path | Select-Object Name, Count

# ── 改进项验收命令（对应 §7）────────────────────────────────
(Select-String -Path electron\main\services\updater.ts -Pattern 'spawn\("cmd"').Count                        # A-01 → 0
(Select-String -Path electron\main\ipc.ts -Pattern 'requireString\(').Count                                 # A-13 → 0
(Get-ChildItem src\components -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'bridge\??\.[A-Za-z]').Count  # A-16/A-17 → 0
(Get-Content electron\main\ipc.ts).Count                                                                    # A-20 → < 120
Get-ChildItem electron\main\services\git -Filter *.ts | ForEach-Object { "$($_.Name): $((Get-Content $_).Count)" }  # A-23 → 全部 ≤250
(Get-ChildItem electron\main\services\storage -Filter *.ts | Select-String -Pattern 'as unknown as SqlRow').Count   # A-31 → 0
(Select-String -Path electron\main\services\storage\workspaces.ts -Pattern 'FROM projects').Count            # A-32 → 0
(Select-String -Path electron\main\services\git.ts -Pattern 'startsWith\("AA "\)').Count                     # A-34 → 0
```

> 注意：`Select-String` 的 `.Count` 是**命中行数**，同一行多次出现只计一次；如需匹配次数用 `-AllMatches` 后取 `.Matches.Count`。行号会随改动漂移，落地时按符号名检索而非按行号。

### 9.4 文档关系与状态

| 文档 | 关系 | 状态 |
| --- | --- | --- |
| `docs/architecture-review-structure.md` | 事实基线（数字与证据来源） | 只读引用，未改动 |
| `docs/architecture-review-layering.md` | 22 条分层/耦合问题 | 只读引用，未改动 |
| `docs/architecture-review-security.md` | 18 条安全问题 + 9 项待运行期验证 | 只读引用，未改动 |
| `docs/architecture-review-2026-11-21.md` | 本报告：合并、裁决、统一编号、路线图、验收清单 | 本次唯一产出 |

**本报告结论**：35 条问题（P0×2 / P1×16 / P2×17）全部有 `文件:行号` 证据或显式"待运行期验证"标注；5 组重复已合并、5 处数字冲突已裁决、3 处结论存疑已降级。**建议从 §7.1 的 A-01 开始，按批次推进；每批结束按 6.1 的批次级信号验收后再进入下一批。**