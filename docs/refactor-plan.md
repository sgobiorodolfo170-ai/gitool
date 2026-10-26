# Gitool 剩余技术债修复规划

- 编写日期：2026-10-26
- 基线：v0.2.1（commit `550b0e2`）
- 来源：`docs/code-review-2026-10-26.md` 中标注为"未处理"的条目
- 规模标记：**S**（单文件、低风险）/ **M**（多文件、需回归）/ **L**（架构级、需分阶段）

---

## 执行进度（2026-10-26 晚，v0.2.2）

| 编号 | 事项 | 状态 | 结果 |
| --- | --- | --- | --- |
| P2-1 A | 抽纯函数与常量 | ✅ 完成 | `src/lib/{format,navigation,projectMatch,storageKeys}.ts`，+28 用例 |
| P2-1 B | 抽展示组件 | ✅ 完成 | 14 个组件 + `src/lib/meta.ts`，App 3114 → 1278 |
| P2-1 C | 抽领域 hooks | 🚧 部分 | C-1 完成（useNotice/useEnvironment/useUpdater），App 1278 → 1228；**C-2 未做** |
| P2-1 D | App 收敛编排层 | ⬜ 未开始 | 依赖 C-2 |
| P2-2 | prettier | ✅ 完成 | 3 次提交，最长行 2962 → 144 |
| P2-3 | zod 收敛 IPC | ⬜ 未开始 | 需引入 zod + 重写 26 个 validator |
| P2-5 | CSS token | ✅ 完成 | 26 个 token，硬编码 482 → 287 |
| P2-9 | 代码签名 | ⏸ 暂缓 | 用户明确暂不碰 |
| P1-5b | 更新包 SHA256 | ⏸ 暂缓 | 用户明确暂不碰 |

**下一步唯一优先级：P2-1 阶段 C-2**（useProjects / useImportFlow / useRemotes / useGitOperations）。
App 目前仍有约 900 行事件处理器，不抽完这 4 个 hook，`App.tsx` 永远降不到 300 行。

---

## 一、待办清单与依赖关系

| 编号 | 事项 | 规模 | 依赖 | 可独立发布 |
| --- | --- | --- | --- | --- |
| P2-1 | `App.tsx` 拆分（3217 行） | L | 无 | 每个阶段都可以 |
| P2-2 | prettier 统一格式化 | S | 应在 P2-1 之后 | 是（单独一次提交） |
| P2-3 | zod 收敛 IPC 校验 | M | 无 | 是 |
| P2-5 | CSS 设计 token | M | 无 | 是（可分批） |
| P2-9 | 代码签名 | M | 需采购证书 | 是 |
| P1-5b | 更新包 SHA256 校验 | M | 依赖发布流程改造 | 是 |

**建议顺序**：P2-1 → P2-2 → P2-3 → P2-5 → P1-5b → P2-9

理由：
- P2-1 是所有后续改动的放大器——文件不拆，每次改 `App.tsx` 都在制造冲突
- P2-2 必须紧跟在 P2-1 之后，否则格式化会把拆分 diff 淹没
- P2-9 依赖外部采购，可与其它项并行推进，不阻塞代码

---

## 二、P2-1：`App.tsx` 拆分

### 2.1 现状量化（基于 v0.2.1 实测）

```
src/App.tsx                3217 行
├── App()                  124–1375   1252 行
│   ├── 33 个 useState + 2 个 useRef        40 行
│   ├── 核心持久化 + 4 个 useEffect        171 行
│   ├── 派生值（useMemo）                    15 行
│   ├── 30 个事件处理器                    904 行  ← 真正的病灶
│   └── 顶层 JSX（8 个工作区 + 侧栏）       245 行
└── 32 个平级函数/组件     1376–3216   1841 行
    ├── GitActionsPanel          357 行（自带 18 个 useState）
    ├── TasksWorkspace           241 行
    ├── SettingsWorkspace        155 行
    ├── WorkspaceSwitcher        150 行
    ├── RemoteRepositoriesWs     142 行
    ├── ProjectsWorkspace        130 行
    ├── ProjectDetail            128 行
    └── 其余 25 个小组件/工具函数  538 行
```

**关键判断：问题不在 JSX 太大，而在 904 行事件处理器全堆在 `App()` 一个作用域里。**

因此拆分策略必须是"**先抽 hook，再拆组件**"，而不是常见的"先拆 JSX 组件"。如果先拆 JSX，那 904 行 handlers 还是得原样往下传，props 反而更厚。

### 2.2 阶段 A：抽纯函数与常量（S，零逻辑改动）

**目标**：把无 React 依赖的逻辑移出，为后续测试铺路。

| 移出内容 | 当前位置 | 目标文件 |
| --- | --- | --- |
| `remoteProjectMatch` | 91–97 | `src/lib/projectMatch.ts` |
| `projectFromSnapshot` | 1376–1387 | 同上 |
| `workspaceLabel` / `buildNavGroups` / `NavItem` | 48、98–123、1388–1400 | `src/lib/navigation.ts` |
| `isDormant` / `formatBytes` | 2077–2096 | `src/lib/format.ts` |
| `formatCommitDate` / `formatDayGroup` | 2499–2521 | 同上 |
| `LAST_IMPORT_DIRECTORY_KEY` 等 3 个常量 | 120–122 | `src/lib/storageKeys.ts` |

**验收**：
```powershell
npm run typecheck          # 零错误
npm test                   # 61 passed
git diff --stat            # 只有 import 增删 + 代码平移，无逻辑变更
```

同时给 `src/lib/format.ts` 和 `navigation.ts` 补单测（`isDormant` 的月份边界、`formatBytes` 的进位、`buildNavGroups` 的计数）。

---

### 2.3 阶段 B：抽展示组件（M，props 原样搬运）

**原则**：只移动文件，不改 props 签名。每个文件搬完立刻 `typecheck`。

| 目标文件 | 内容 | 行数 |
| --- | --- | --- |
| `src/components/GitActionsPanel.tsx` | GitActionsPanel（最大，18 个 useState，独立性强） | 357 |
| `src/components/TasksWorkspace.tsx` | TasksWorkspace + 其内部子组件 | 241 |
| `src/components/SettingsWorkspace.tsx` | SettingsWorkspace | 155 |
| `src/components/WorkspaceSwitcher.tsx` | WorkspaceSwitcher | 150 |
| `src/components/remotes/RemoteRepositoriesWorkspace.tsx` | 同上 | 142 |
| `src/components/projects/ProjectsWorkspace.tsx` | ProjectsWorkspace + `ProjectsWorkspaceProps` | 130 |
| `src/components/projects/ProjectDetail.tsx` | ProjectDetail + AliasEditor + TagEditor + ReadmeSection + ProjectAnalysisPanel + DetailStat | 190 |
| `src/components/overview/OverviewWorkspace.tsx` | OverviewWorkspace + `OverviewWorkspaceProps` + MetricCard + AttentionPanel | 90 |
| `src/components/overview/RemoteRepositorySearch.tsx` | 同上 | 103 |
| `src/components/common/` | FilterButton、ProjectRow、EmptyProjects、GitOperationButton、AnalysisMetric | 50 |
| `src/components/LogsWorkspace.tsx` / `BackupsWorkspace.tsx` | 各一个 | 121 |
| `src/components/timeline.tsx` | renderTimeline | 30 |

**顺序**：先搬零依赖的小组件（common → overview → projects → remotes → tasks → settings → GitActionsPanel），最后搬 `GitActionsPanel`（它引用最多内部工具）。

**验收**：每个文件搬完跑 `npm run typecheck && npm run build`；全部搬完后 `App.tsx` 应从 3217 行降到约 **1350 行**。

---

### 2.4 阶段 C：抽领域 hooks（L，核心工作）

**目标**：把 904 行 handlers 按领域收进自定义 hook，`App()` 只做编排。

依赖方向必须单向，避免循环：

```
useProjects ──┬─→ useWorkspaces
              ├─→ useRemotes
              ├─→ useGitOperations
              └─→ useImportFlow
useAccounts ──┴─→ useRemotes（取 token 所属账号）
useEnvironment / useUpdater / useAppSettings（独立）
```

#### Hook 清单与职责边界

| Hook | 收拢的 state / handler | 对外返回（节选） |
| --- | --- | --- |
| `useProjects` | projects、projectsRef、saveQueueRef、applyProjects、persistProjects、updateProjects、selectedId、filter、search、tagFilter、selectedProject、filteredProjects、allTags、toggleFavorite、deleteProjectFromList、refreshProjects、moveProject | `{ projects, selectedProject, filteredProjects, allTags, updateProject, toggleFavorite, refreshProjects, moveProject, ... }` |
| `useImportFlow` | isImporting、importProject、initNewRepository、scanDirectoryForImport、importScannedRepositories | `{ isImporting, importProject, initNewRepository, scanDirectory, importScanned }` |
| `useWorkspaces` | workspaces、activeWorkspaceId、switchWorkspace、createWorkspace、renameWorkspace、deleteWorkspace | `{ workspaces, activeWorkspaceId, switchWorkspace, ... }` |
| `useAccounts` | accounts、accountBusyId、addAccount、testAccount、deleteAccount | `{ accounts, accountBusyId, addAccount, testAccount, deleteAccount }` |
| `useRemotes` | remoteRepositories、remoteSyncTime、selectedAccountId、remoteSearch、isLoadingRemotes、cloningRepositoryId、cloneProgress、loadRemoteRepositories、cloneRemoteRepository、mutateRemoteRepository、toggleRemoteFavorite、toggleRemoteWatch | `{ repositories, load, clone, mutate, toggleFavorite, toggleWatch, ... }` |
| `useGitOperations` | activeOperation、operationOutput、analysis、isAnalyzing、runGitOperation、runBulkGitOperation、analyzeProject | `{ activeOperation, output, analysis, run, runBulk, analyze }` |
| `useEnvironment` | environment、installProgress、showSetupModal、installingGit、refreshEnvironment、installGit | `{ environment, installProgress, installingGit, refreshEnvironment, installGit }` |
| `useUpdater` | updateAvailable、updateProgress、downloadedPath、isDownloading、handleUpdate、handleInstallUpdate | `{ available, progress, isDownloading, download, install }` |
| `useAppSettings` | appSettings、saveSettings | `{ settings, save }` |

#### 关键设计约束

1. **跨 hook 调用通过参数注入，不让 hook 互相 import**。
   ```ts
   // 正确：useRemotes 需要"收藏远程项目时同步写入项目列表"
   const remotes = useRemotes({
     accounts: accounts.accounts,
     upsertProject: projects.upsertFromRemote,
     removeProjectByWebUrl: projects.removeByWebUrl,
     onNotice: showNotice,
   });

   // 错误：useRemotes 内部 import useProjects
   ```

2. **`notice` 统一成一个 `useNotice` hook**，返回 `showNotice(message, duration)`。当前有 41 处 `setNotice(...) + setTimeout` 的重复模式，收敛后能少 80 行。

3. **`bridge` 只取一次**：`App()` 顶部 `const bridge = requireDesktopBridge()`，通过参数传给各 hook，避免每个 hook 重复判断 `isDesktopRuntime()`。

4. **每个 hook 单独一个文件**，放 `src/hooks/`，配套 `*.test.ts` 覆盖纯逻辑分支（如 `filteredProjects` 的筛选组合、`toggleFavorite` 的乐观更新）。

#### 阶段 C 的执行粒度

**一次只抽一个 hook，抽完立刻跑门禁并提交**。推荐顺序：

```
useNotice (最小，被其他 hook 依赖)
  → useAppSettings
  → useUpdater
  → useEnvironment
  → useProjects
  → useImportFlow
  → useWorkspaces
  → useAccounts
  → useRemotes
  → useGitOperations
```

`useProjects` 是最难的一个（含保存队列、乐观更新、与 remote 的双向同步），单独一次提交，不要和别的混。

**验收**：`App.tsx` 应从约 1350 行降到 **300 行以内**（只剩 hook 调用 + 顶层 JSX）。

---

### 2.5 阶段 D：App 收敛为编排层（S）

完成后 `App()` 的结构应该是：

```tsx
function App() {
  const notice = useNotice();
  const settings = useAppSettings();
  const projects = useProjects({ activeWorkspaceId, onNotice: notice.show });
  const workspaces = useWorkspaces({ onProjectsReload: projects.reload });
  const accounts = useAccounts({ onNotice: notice.show });
  const remotes = useRemotes({ accounts: accounts.accounts, upsertProject: projects.upsertFromRemote, ... });
  const git = useGitOperations({ selectedProject: projects.selectedProject });
  const env = useEnvironment();
  const updater = useUpdater();

  return (
    <div className="app-shell">
      <Sidebar ... />
      {view === "overview" && <OverviewWorkspace ... />}
      {/* 8 个工作区，每个 5–8 个 props */}
    </div>
  );
}
```

**验收标准**：
- `App.tsx` ≤ 300 行
- 单文件最长 ≤ 400 行（`GitActionsPanel` 仍需二次拆分，见下）
- 顶层 JSX 中每个组件的 props ≤ 8 个
- `npm run typecheck && npm test && npm run build` 全绿
- 手工回归清单：切换工作区、导入项目、批量 fetch、克隆、任务运行、备份恢复、装 Git

**`GitActionsPanel` 的二次拆分**（阶段 D 之后可做）：357 行 + 18 个 useState，应按 tab 拆成 `ChangesTab` / `BranchesTab` / `HistoryTab` / `TagsTab`，父组件只保留 tab 切换与共享的 `busy` 状态。

---

## 三、P2-2：prettier 统一格式化

### 现状

95 行超过 200 字符，最长 **2962 字符**（`RemoteRepositoriesWorkspace` 的 props 签名）。没有 prettier 配置。

### 执行方式

1. **配置**（放在 P2-1 完成后）：
   ```json
   {
     "printWidth": 100,
     "semi": true,
     "singleQuote": false,
     "trailingComma": "all",
     "arrowParens": "always"
   }
   ```

2. **两步提交，绝不合并**：
   - 第一次：只加 `.prettierrc` + `npm run format` 脚本 + `.prettierignore`（忽略 `dist/`、`dist-electron/`、`release/`、`build/`），**不改任何源码**
   - 第二次：`npx prettier --write "src/**/*.{ts,tsx,css}" "electron/**/*.ts" "shared/**/*.ts"`，提交信息写 `style: 统一 prettier 格式化（无逻辑变更）`

3. **验证无逻辑变更**：
   ```powershell
   npx prettier --write .
   npm run typecheck; npm test; npm run build
   git diff --stat          # 预期只有空白与换行变化
   git diff --ignore-all-space --stat   # 应接近空
   ```

4. **加 husky + lint-staged**（可选，建议做）：提交时自动格式化暂存文件，避免格式回潮。

### 风险

CSS 当前是"一条规则一行"的压缩写法，prettier 会展开成多行，`styles.css` 的 diff 会非常大（48KB → 约 90KB）。**建议 CSS 单独一次提交**，与 TS 分开。

---

## 四、P2-3：zod 收敛 IPC 校验

### 现状

`ipc.ts` 856 行中约 430 行是 26 个手写 `requireXxx` 函数，结构与错误文案高度雷同：

```ts
function requireCreateBranchInput(value: unknown): CreateBranchInput {
  if (typeof value !== "object" || value === null) throw new Error("创建分支参数格式不正确");
  const candidate = value as Record<string, unknown>;
  return { path: requireString(candidate.path, "项目路径"), name: requireString(candidate.name, "分支名") };
}
```

### 目标结构

```
electron/main/ipc/
├── index.ts          # registerIpcHandlers，只做 channel → handler 映射
├── schemas.ts        # 全部 zod schema，与 shared/types 一一对应
└── validate.ts       # parseOrThrow<T>(schema, value, label)
```

### 迁移方式

1. 引入 `zod`（约 60KB，只在主进程，不进渲染包）。
2. **先写 schema，不删旧函数**，让新旧并行：

   ```ts
   // schemas.ts
   export const createBranchInputSchema = z.object({
     path: z.string().min(1, "项目路径不能为空"),
     name: z.string().min(1, "分支名不能为空").regex(REF_NAME_PATTERN, "分支名不合法"),
   }).strict();
   ```

3. 逐组替换（按业务域分 5 次提交）：workspaces → accounts → git → remotes → tasks/backups/settings。
4. 每次替换后**保留旧函数不删**，用测试对比两者对同一输入的判定是否一致；全部替换完再删除旧函数。

### 类型复用

`z.infer<typeof schema>` 应能直接替代 `shared/types.ts` 里的手写类型。**不要一次全换**——只对已有 schema 的类型做 `z.infer` 反推，其余保留手写。否则 `shared/types.ts` 会被 zod 依赖污染（渲染层也会 import 它）。

### 验收

- `ipc.ts` 从 856 行降到约 380 行
- 新增 `schemas.test.ts`：每个 schema 至少 3 个用例（合法、缺字段、类型错误）
- 所有 IPC handler 的错误文案保持中文且面向用户

---

## 五、P2-5：CSS 设计 token

### 现状

482 处硬编码色值，去重后 **244 个**。前 10 个高频色占 40%：

```
#fff(20) #edf0f1(17) #4a9a83(16) #2d7664(14) #fbfcfc(11)
#f2faf7(11) #dfe6e8(11) #bcdcd3(9) #82bdad(8) #4b5b63(8)
```

### 提取方案

1. **按语义归并到约 24 个 token**（不要 1:1 映射，244 个变量等于没做）：

   ```css
   :root {
     /* 背景 */
     --bg-app: #f5f7f9;
     --bg-surface: #fff;
     --bg-subtle: #fbfcfc;
     --bg-sidebar: #15232b;
     --bg-sidebar-hover: #20343c;

     /* 边框 */
     --border-default: #dfe6e8;
     --border-subtle: #edf0f1;
     --border-strong: #c9d3d6;

     /* 文字 */
     --text-primary: #202a35;
     --text-secondary: #5a6c72;
     --text-muted: #849298;
     --text-inverse: #e8f0ef;

     /* 主色（青绿系） */
     --accent: #4a9a83;
     --accent-strong: #2d7664;
     --accent-soft: #f2faf7;
     --accent-border: #bcdcd3;

     /* 状态 */
     --danger: #a04a4a;
     --danger-soft: #f0cfcf;
     --warning: #b8860b;
     --success: #4a9a83;
   }
   ```

2. **用脚本做批量替换，不手工改**。写一个一次性 codemod：

   ```js
   // scripts/tokenize-css.mjs（一次性，跑完即删）
   const map = { "#4a9a83": "var(--accent)", "#2d7664": "var(--accent-strong)", /* ... */ };
   // 按色值长度降序替换，避免 #fff 误伤 #fff0f0 之类的长值
   ```

3. **分 3 批提交**：背景色 → 边框与文字 → 状态色。每批后手工看一遍主要页面（总览、项目详情、任务中心、设置）。

4. **暗色主题预留**：token 化之后，将来加暗色只需覆盖 `:root[data-theme="dark"]`，不必改 482 处。

### 注意

- 同一个色值在不同语境可能有不同语义（`#4a9a83` 既是主色也是"成功"），归并时要按**语义**而非**色值**分配，允许两个 token 暂时指向同一色值。
- 不要顺手改视觉，token 化的验收标准是"像素级不变"。

---

## 六、P2-9：代码签名

### 为什么必须做

未签名的 NSIS 安装包在 Windows 上会触发 SmartScreen 红色警告（"Windows 已保护你的电脑"），普通用户会直接放弃安装。这是**上架前的硬门槛**，不是可选优化。

### 方案对比

| 方案 | 年成本（参考） | SmartScreen 表现 | 申请门槛 |
| --- | --- | --- | --- |
| OV 代码签名证书 | ¥2000–4000 | 需累积下载信誉，初期仍可能警告 | 企业营业执照即可 |
| EV 代码签名证书 | ¥4000–8000 | **即时信誉**，无警告 | 需硬件 UKey，法人核验 |
| Azure Trusted Signing | 约 $10/月 | 即时信誉 | 需 3 年以上企业实体 + 财务核验 |
| 不签名 | 0 | 红框警告 | — |

**推荐**：面向国内个人用户分发优先 **OV**（成本低，信誉可累积）；如果要求"下载即无警告"，直接上 **EV**。Azure Trusted Signing 成本最低但资质门槛最高。

### 接入步骤

1. **本地签名**（先跑通，再接 CI）：

   ```yaml
   # electron-builder.yml
   win:
     certificateFile: ${env.CSC_LINK}        # .pfx 路径或 base64
     certificatePassword: ${env.CSC_KEY_PASSWORD}
     signingHashAlgorithms: [sha256]
     rfc3161TimeStampServer: http://timestamp.digicert.com
   ```

   EV 证书走硬件 UKey 时不能用 `certificateFile`，需改 `sign` 自定义钩子调用 `signtool`：

   ```yaml
   win:
     sign: scripts/sign-windows.js
   ```

2. **CI 集成**：把 `.pfx` 转 base64 存进 GitHub Secret `CSC_LINK`，密码存 `CSC_KEY_PASSWORD`，构建时注入环境变量。**证书文件绝不入库**。

3. **验证**：

   ```powershell
   Get-AuthenticodeSignature .\release\Gitool-0.2.1-setup.exe | Format-List
   # Status 应为 Valid，SignerCertificate 应为主体公司
   ```

4. **签名后必须重新测安装**：签名会改变文件哈希，NSIS 的增量更新逻辑需要复核。

### 风险

- EV 证书的 UKey 通常不支持 CI 云端签名，需要一台常驻的 Windows 签名机，或用厂商的云签名服务。
- 证书有效期 1–3 年，到期前 30 天必须续期，否则新版本全部失去签名。

---

## 七、P1-5b：更新包 SHA256 校验

### 现状

`updater.ts` 已改为流式下载 + 路径白名单，但**仍无内容校验**：HTTPS 只保证传输链路，不保证 GitHub Release 资产未被替换。

### 改造分两端

#### 发布端：生成校验文件

在 `npm run dist` 之后追加一步：

```json
"scripts": {
  "dist": "npm run build && electron-builder --win --x64 && npm run checksums",
  "checksums": "node scripts/generate-checksums.mjs"
}
```

```js
// scripts/generate-checksums.mjs
// 对 release/*.exe 计算 SHA256，写入 release/checksums.txt
// 格式：<hash>  <filename>   （与 sha256sum 兼容）
```

`checksums.txt` 作为 Release 的附加资产一起上传。

#### 客户端：下载后校验

```ts
// electron/main/services/updater.ts
async function verifyChecksum(filePath: string, expected: string): Promise<boolean> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex").toLowerCase() === expected.toLowerCase();
}
```

`checkForUpdates` 需要额外拉取 `checksums.txt` 并解析出对应文件的 hash，随 `UpdateCheckResult` 一起返回；`downloadUpdate` 完成后校验，不匹配则删除文件并抛错。

### 更强的方案（可选）

用 `electron-updater` 替换手写更新器。它自带：
- `latest.yml` 清单（含 sha512）
- 差分下载
- 签名校验（配合代码签名）

代价是引入一个约 200KB 的依赖，且需要把发布流程改为 `electron-builder --publish`。如果 P2-9 已经做了代码签名，**强烈建议一并切到 `electron-updater`**——两者是配套的。

---

## 八、建议执行顺序与里程碑

| 里程碑 | 内容 | 产出信号 |
| --- | --- | --- |
| M1 | P2-1 阶段 A + B | `App.tsx` ≤ 1350 行，组件已分文件，测试仍 61+ 通过 |
| M2 | P2-1 阶段 C + D | `App.tsx` ≤ 300 行，新增 8 个 hook 及单测 |
| M3 | P2-2 格式化 | 全仓库 prettier 通过，`git diff --ignore-all-space` 接近空 |
| M4 | P2-3 zod | `ipc.ts` ≤ 380 行，新增 `schemas.test.ts` |
| M5 | P2-5 CSS token | 硬编码色值从 482 降到 < 30，视觉零变化 |
| M6 | P2-9 + P1-5b | 安装包签名有效，更新包校验通过 |

**每个里程碑的通用门禁**：

```powershell
npm run typecheck
npm test
npm run build
```

三条全绿才算完成——这正是 `AGENTS.md` 第一节要求的"可机器判定的验收信号"。

---

## 九、不建议做的事

| 想法 | 为什么不建议 |
| --- | --- |
| 引入 Redux / React Query | 这是本地桌面工具，数据源单一（IPC），`zustand` 或纯 hook 足够；引入重型状态库会让 3217 行的拆分变成 5000 行 |
| 一次性重写 `App.tsx` | 3217 行无测试覆盖的重写，回归风险远大于收益；分阶段搬迁每步都可回滚 |
| 给 CSS 引入 Tailwind | 现有 48KB 手写样式已经稳定，迁移成本高且会与 token 化冲突 |
| 先做 zod 再拆 hook | zod 只影响主进程，与渲染层拆分无依赖；但 `App.tsx` 不拆，后续每次改 IPC 都要在大文件里找位置 |
| 为了覆盖率数字补测试 | 只测纯函数与关键分支，不追求行覆盖率；`GitActionsPanel` 这类交互组件用人工回归更划算 |
