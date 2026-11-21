# UI/UX「Quiet Precision」编码任务规划

| 项目 | 内容 |
| --- | --- |
| 来源方案 | [`docs/ui-ux-quiet-precision-plan.md`](./ui-ux-quiet-precision-plan.md) |
| 创建日期 | 2026-11-21 |
| 基线 | `HEAD 89cee36`（v0.8.8）；工作树另有首启性能优化未提交改动，本规划未触碰 |
| 任务总数 | **62**（A 10 / B 7 / C 12 / D 12 / E 11 / F 6 / G 4） |
| 纯编码工时 | 约 89 小时（≈ 11 人日） |
| 含验收与缓冲 | 约 16 个工作日（单人串行；按并行组双人约 10–11 天） |
| 交付版本 | v0.9.0 → v0.9.1 → v0.10.0 → v0.10.1 → v0.11.0 → v0.11.1 |
| 当前状态 | **规划完成，未开始编码** |

> 本文件只做任务分解，不改变 `docs/ui-ux-quiet-precision-plan.md` 的技术决策与验收口径。任务执行中若需改变方案，先改方案文档并在执行记录里注明原因。

---

## 1. 编号、规模与状态约定

### 1.1 编号

- `A1–A10`：基础设施
- `B1–B7`：反馈系统（P0）
- `C1–C12`：排版与色彩（P0+P1）
- `D1–D12`：结构与一致性（P1）
- `E1–E11`：无障碍体系（P2）
- `F1–F6`：暗色模式（P2）
- `G1–G4`：回归与交付

### 1.2 规模

| 标记 | 含义 | 工时 | 典型特征 |
| --- | --- | --- | --- |
| **S** | 单文件、低风险 | ≤ 1h | 常量、样式小改、脚本参数 |
| **M** | 多文件或需回归 | 1–2.5h | 组件 + 样式 + 测试 |
| **L** | 跨层、需分步 | > 2.5h | 应继续拆；本规划已拆到 ≤ 2.5h |

### 1.3 状态

`待办` → `进行中` → `待验收` → `完成`；被阻塞时标 `阻塞（原因）`。

---

## 2. 依赖图（关键路径）

```
A1 ─→ A2 ─┬→ A4 ─→ B1 ─→ B2 ─┬→ B4 ─┐
           ├→ A5              ├→ B5 ─┼→ B7 → v0.9.0
           └→ A6 ─→ B3 ─→ B6 ─┘
A3 ─→ A7 ─┐
A4 ─→ A8 ─┴→ A9 ─→ A10
A3 ─→ C1 ─┬→ C2 ─→ C5 ─┬→ C8 ─┐
           ├→ C3          ├→ C9 → C10 → C11 ─┼→ C12 → v0.9.1
           └→ C4          └→ (C6/C7 独立)     ┘
C12 → D10 ─┐
A2 ─→ D1 → D2 ─┬→ D6 ─┐
A2 ─→ D3 → D4 → D5 ───┼→ D12 → v0.10.0
               D2 ─┬→ D7 ─┤
                   ├→ D8 ─┤
D9 ────────────────┴→ D9 ─┘
D10 → E1 → E5 ─┐
A6 ─→ E2 ──────┤
D9 ─→ E3 ─┬→ E7 ┼→ E9 → E10 → E11 → v0.10.1
D2 ─→ E4 ─┴→ E8 ┘
C12 → F1 → F2 ─┐
A5 ─→ F3 → F4 ─┴→ F5 → F6 → v0.11.0
F6 → G1 → G2 → G3 → G4 → v0.11.1
```

**关键路径**（决定总工期）：
`A1 → A2 → A4 → B1 → B2 → B4 → B7 → C1 → C2 → C5 → C9 → C10 → C12 → D10 → E1 → E5 → E9 → E10 → E11 → F1 → F2 → F5 → F6 → G1 → G2 → G3 → G4`

---

## 3. 热点文件与串行约束

以下文件被多个任务修改，**同一时间只允许一个任务在改**；开工前先 `git status` 确认。

| 热点文件 | 相关任务 | 约束 |
| --- | --- | --- |
| `src/styles.css` | A3、C2–C10、D10、E1、E6（样式部分） | C 阶段必须串行；D10/E1 在 C12 之后 |
| `src/App.tsx` | B2、B6、D2、D7、D8、E5 | 按 B → D → E 顺序 |
| `src/components/common.tsx` | D6、D9、E3、E8 | D6/D9 可同批；E3 之后 E8 |
| `src/hooks/useAsyncData.ts` | D4 | 独占 |
| `shared/types.ts`、`electron/main/ipc/schemas.ts` | F3、F4 | 同一人连续完成 |
| `src/hooks/useNotice.ts` | B2 | 独占；B4/B5 只改调用方 |

**并行组**（不同文件，可同时进行）：
- A4 / A5 / A6
- B4 / B5（B6 可独立）
- D1 / D3；D6 / D7 / D8 / D9
- E2 / E3 / E4；E7 / E8（均依赖 E3）
- F2 / F3

---

## 4. 任务总表

### 阶段 A｜基础设施（10 项，约 10h）

| ID | 任务 | 规模 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- | --- |
| A1 | 安装 6 个 devDeps 并锁定 | S | — | `package.json`、`package-lock.json` | `npm ls jsdom @testing-library/react axe-core stylelint` 无 missing |
| A2 | vitest 双环境 + setup + a11y helper | M | A1 | `vitest.config.ts`、`src/test/setup.ts`、`src/test/a11y.ts` | 新增一个空 jsdom 测试可运行；现有 node 套件不变 |
| A3 | `tokens.css` 初版 + 聚合入口 | M | — | `src/styles/tokens.css`、`src/styles.css` | `npm run build` 通过；无视觉变化 |
| A4 | notice 纯函数 + 单测 | M | A2 | `src/lib/notice.ts`、`notice.test.ts` | 队列/去重/超时用例全绿 |
| A5 | theme 纯函数 + 单测 | S | A2 | `src/lib/theme.ts`、`theme.test.ts` | system/非法值/持久化用例全绿 |
| A6 | focusTrap 纯函数 + 单测 | M | A2 | `src/lib/a11y/focusTrap.ts`、测试 | Tab 环绕用例全绿 |
| A7 | stylelint 配置 + 存量 allowlist | M | A3 | `.stylelintrc.json`、`.stylelintignore` | `npm run lint:css` 通过且只报预期 0 错误 |
| A8 | ui-guard 脚本 | M | A4 | `scripts/ui-guard.mjs` | 对现有代码报告 0 违规 |
| A9 | npm scripts + CI 接入 | S | A7、A8 | `package.json`、`.github/workflows/ci.yml` | 本地三条新命令可跑；CI 配置语法正确 |
| A10 | 阶段 A 验收 | S | A1–A9 | — | `typecheck` + `test` + `lint:css` + `lint:ui` + `format:check` 全绿 |

**A3 注意**：本任务只新增 token 定义与 `@import`，不得顺手替换任何现有字号/色值；视觉零变化是硬要求。

**A4 注意**：reducer 必须是纯函数（无 `setTimeout`），超时策略以 `ttlMs(kind)` 返回；队列删除由调用方 dispatch 完成。

---

### 阶段 B｜反馈系统（7 项，约 12h，交付 v0.9.0）

| ID | 任务 | 规模 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- | --- |
| B1 | `NoticeViewport` + 测试 | M | A4 | `src/components/NoticeViewport.tsx`、测试 | 4 种 kind 图标/role 正确；最多 3 条；可关闭 |
| B2 | `useNotice` 队列改造 + App 接入 | M | B1 | `useNotice.ts`、`App.tsx` | 无旧单一 toast；失败可读可关闭；连续两条不互相顶掉 |
| B3 | `ConfirmProvider` + `useConfirm` + 测试 | M | A6、B1 | `ConfirmProvider.tsx`、测试 | Promise 返回布尔；ESC 取消；焦点归还 |
| B4 | 失败语义替换（hooks） | M | B2 | `useGitOperations`、`useImportFlow`、`useProjects`、`useRemotes`、`useWorkspaces`、`useAccounts` | 失败/警告全部走 `showError/showWarning` |
| B5 | 失败语义替换（页面） | M | B2 | `TasksWorkspace`、`SettingsWorkspace`、`BackupsWorkspace`、`LogsWorkspace` | 同上 |
| B6 | 原生对话框 13 处替换 | M | B3 | 8 个文件（10 confirm + 3 alert） | `lint:ui` 对 confirm/alert 报告 0 |
| B7 | 阶段 B 验收 + v0.9.0 | S | B4、B5、B6 | — | 失败路径手工触发 3 例，全部红色 + aria-live |

**B2 验收细节**：
1. 保存设置失败 → 红色 `role="alert"`，8s 后消失。
2. 连续两次失败 → 两条同时可见（≤3 条堆叠），均可单独关闭。
3. 成功提示仍为绿色，不遮挡右下角批量操作条。

---

### 阶段 C｜排版与色彩（12 项，约 18h，交付 v0.9.1）

| ID | 任务 | 规模 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- | --- |
| C1 | 生成字号替换清单与映射脚本 | S | A3 | 临时脚本（不入库）+ `docs` 附录 | 175 处全部有归属，无遗漏 |
| C2 | 字号替换：侧栏/顶栏/页面头 | M | C1 | `styles.css` | 该区块无 ≤9px；1120 宽不溢出 |
| C3 | 字号替换：列表/详情/状态 | M | C1 | `styles.css` | 项目行、详情统计、时间线可读 |
| C4 | 字号替换：表单/弹窗/README/Git | M | C1 | `styles.css` | 表单标签 ≥11px；README 内文 13px |
| C5 | 对比度校准：文本 + 状态 | M | C2 | `tokens.css`、`styles.css` | 脚本对全部语义色 ≥4.5:1 |
| C6 | 字体栈统一 + `tabular-nums` | S | C1 | `styles.css` | `"DM Mono"` = 0；数字不抖动 |
| C7 | 中文排版字距 | S | C2 | `styles.css` | 中文标题 `letter-spacing: 0` |
| C8 | 环境页状态色 + `count-badge` | S | C5 | `EnvironmentTab.tsx`、`AttentionPanel.tsx`、`styles.css` | 环境页 5 个胶囊恢复语义色 |
| C9 | hex 收敛：基础/布局 | M | C5 | `styles.css` | 该域无裸 hex |
| C10 | hex 收敛：组件/页面 | M | C9 | `styles.css`、`tokens.css` | 全文件裸 hex < 40 |
| C11 | `!important` 清理 | S | C9 | `styles.css` | `!important` = 0 |
| C12 | 阶段 C 验收 + v0.9.1 | M | C6–C11 | — | 全门禁 + 1120/1440 截图核对 |

**C 阶段执行规则**：C2–C4 虽然按区块拆分，但同属 `styles.css`，**必须串行提交**；每完成一个区块立即截图存档，便于回归定位。

**C8 关键断言**：`EnvironmentTab` 的状态胶囊 class 中不再出现 `setting-value`，或 `.setting-value` 规则加 `:not(.status-pill)`；截图取色确认底/字均有语义色。

---

### 阶段 D｜结构与一致性（12 项，约 18.5h，交付 v0.10.0）

| ID | 任务 | 规模 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- | --- |
| D1 | `PageHeader` + 测试 | M | A2 | `PageHeader.tsx`、测试 | h1 唯一；actions 顺序稳定 |
| D2 | 7 页接入 `PageHeader` | M | D1 | 7 个 Workspace | 页面头实现唯一；中文 eyebrow |
| D3 | `EmptyState` + `Skeleton` + 测试 | M | A2 | 两个组件 + 测试 | 三态 variant 正确；骨架尺寸稳定 |
| D4 | `useAsyncData` status + `isLoading` | M | D3 | `useAsyncData.ts`、`useProjects.ts`、测试 | loading/ready/error 转换正确 |
| D5 | 7 页三态接入 | M | D2、D4 | 7 个 Workspace | 首屏不闪「没有匹配」 |
| D6 | `MetricCard` 可点击 + 总览导航 | S | D2 | `common.tsx`、`OverviewWorkspace.tsx`、`App.tsx` | 四卡分别到达正确筛选页 |
| D7 | `Ctrl K` 改按钮 + 聚焦事件 | S | D2 | `App.tsx`、`ProjectsWorkspace.tsx` | 点击/快捷键均聚焦搜索 |
| D8 | 移除头像「L」/工作区首字母 | S | D2 | `App.tsx`、`WorkspaceSwitcher.tsx` | 无硬编码身份占位 |
| D9 | 删除按钮 hover/focus 显示 | S | D2 | `common.tsx`、`styles.css` | 静止态不可见；键盘 focus 可见 |
| D10 | 间距/圆角 token 替换 | M | C12 | `styles.css` | 圆角 ≤ 4 档；间距落 4px 栅格 |
| D11 | inline style 色值迁类 | S | C10 | `TaskForm.tsx` 等 5 处 | 组件内无裸色值 |
| D12 | 阶段 D 验收 + v0.10.0 | M | D5–D11 | — | 三尺寸截图 + 全门禁 |

**D5 验收细节**：清空 localStorage 与工作区数据后冷启，前 500ms 显示骨架；加载完成后若确实无项目，才显示「还没有项目」。

---

### 阶段 E｜无障碍体系（11 项，约 17h，交付 v0.10.1）

| ID | 任务 | 规模 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- | --- |
| E1 | 全局 `:focus-visible` + reduced-motion | S | D10 | `styles.css` | 键盘遍历焦点可见；动画可关闭 |
| E2 | `WorkspaceSwitcher` 键盘菜单 | M | A6 | `WorkspaceSwitcher.tsx`、测试 | Enter/Arrow/Escape 全可用 |
| E3 | `ProjectRow` 去嵌套交互 | M | D9 | `common.tsx`、测试 | 无 button 嵌套；Enter/Space 选择 |
| E4 | 详情 tabs `tablist` 语义 | M | D2 | `ProjectDetail.tsx`、测试 | 左右箭头切换；aria-selected 同步 |
| E5 | 4 个弹窗层接入焦点陷阱 | M | B3、E1 | `App.tsx`、`RemoteRepositoriesWorkspace`、`ReadmeOverlay`、`ConfirmProvider` | Tab 不逃逸；关闭归还焦点 |
| E6 | 分隔条键盘操作 | S | D10 | `useSplitWidth.ts`、`ProjectsWorkspace.tsx` | Arrow/Home/End + aria-value |
| E7 | 命中区 ≥24/28px + aria-label | M | E3 | 图标按钮、`tag-remove` | axe 无「目标过小」；无名称缺失 |
| E8 | 列表语义化 `ul/li` | M | E3 | 项目/远程/日志/分支/标签列表 | 屏幕阅读器可辨列表项数 |
| E9 | axe 4 页 smoke | M | E2–E8 | `src/components/__a11y__/` | serious/critical = 0 |
| E10 | 键盘走查 | S | E9 | — | 第 9 节人工清单全过 |
| E11 | 阶段 E 验收 + v0.10.1 | S | E10 | — | 全门禁 + 走查记录归档 |

**E3 注意**：重构只改结构与事件绑定，不改 `ProjectRow` 的视觉与信息项；类名保持，避免 CSS 回归。

---

### 阶段 F｜暗色模式（6 项，约 10h，交付 v0.11.0）

| ID | 任务 | 规模 | 依赖 | 主要文件 | 验收 |
| --- | --- | --- | --- | --- | --- |
| F1 | `dark.css` token 覆盖 + 对比度 | M | C12 | `src/styles/dark.css` | 暗色语义色 ≥4.5:1 |
| F2 | `useTheme` + 持久化 + meta 同步 | M | F1 | `useTheme.ts`、测试 | 三态切换即时生效 |
| F3 | `AppSettings.theme` 跨层 | M | A5 | `shared/types.ts`、`schemas.ts`、`storage/settings.ts` + 测试 | 老库默认 `system`；schema 通过 |
| F4 | Electron `nativeTheme` + preload | M | F3 | `electron/main/index.ts`、`preload/index.ts`、`electron.d.ts`、`bridgeParity.test.ts` | 窗口底色同步；桥接一致性测试通过 |
| F5 | 设置页三态 UI | S | F2、F4 | `AppSettingsTab.tsx` | 保存/重启后保持 |
| F6 | 暗色验收 + v0.11.0 | M | F5 | — | 三模式截图 + axe + 对比度脚本 |

**F3/F4 顺序**：先类型与 schema（含 zod 默认值），再 storage 测试，最后 IPC/preload；`bridgeParity.test.ts` 与 `bridgeParity` 基线必须同一次提交更新。

---

### 阶段 G｜回归与交付（4 项，约 3.5h，交付 v0.11.1）

| ID | 任务 | 规模 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| G1 | 三尺寸截图基线 | M | F6 | 7 页 + 4 弹窗层，1440/1120/1920 各一组 |
| G2 | 全门禁回归 | S | G1 | 七条命令全 0 退出码 |
| G3 | CHANGELOG + 版本 | S | G2 | 六行版本记录，与提交对应 |
| G4 | 回填执行记录与偏差 | S | G3 | 方案文档第 10 节填写完成 |

---

## 5. 排期（单人串行 16 个工作日；按并行组双人约 10–11 天）

| 工作日 | 任务 | 交付 |
| --- | --- | --- |
| D1 | A1–A4（约 4.5h） | token 与测试基座 |
| D2 | A5–A10（约 5.5h） | 基础设施就绪 |
| D3 | B1–B2（约 4h） | 提示队列可用 |
| D4 | B3–B5（约 5.5h） | 确认框 + 失败语义 |
| D5 | B6–B7（约 2.5h） | **v0.9.0** |
| D6 | C1–C3（约 6h） | 字号替换（侧栏/顶栏/列表） |
| D7 | C4–C6（约 5h） | 字号替换（表单/README）+ 字体栈 |
| D8 | C7–C10（约 5.5h） | 字距 / 状态色 / hex 收敛 |
| D9 | C11–C12（约 2h） | **v0.9.1** |
| D10 | D1–D4（约 7.5h） | 页面头 + 三态基础 |
| D11 | D5–D9（约 5.5h） | 三态接入 + 交互暗示 |
| D12 | D10–D12（约 4h） | **v0.10.0** |
| D13 | E1–E5（约 8.5h） | 焦点 + 核心组件 |
| D14 | E6–E11（约 8.5h） | **v0.10.1** |
| D15 | F1–F6（约 10h） | **v0.11.0** |
| D16 | G1–G4（约 3.5h） | **v0.11.1** |

缓冲策略：每个版本日预留 0.5 天；单人串行 16 天，若按第 3 节并行组投入两人，可压缩到 10–11 天。若某阶段超时，优先保证 B（P0）与 C（可读性），E/F 可顺延但不得跨版本混提。

---

## 6. 提交批次

| 批次 | 包含任务 | 提交信息 | 版本 |
| --- | --- | --- | --- |
| 1 | A1–A10 | `chore(ui): 建立设计 token 与 UI 约束基础设施` | — |
| 2 | B1–B7 | `feat(toast): 提示按语义分流并引入确认对话框` | v0.9.0 |
| 3 | C1–C12 | `refactor(styles): 收敛字号/色板/字体栈，修复状态色覆盖` | v0.9.1 |
| 4 | D1–D12 | `feat(ui): 统一页面头与空/加载态，移除虚假交互暗示` | v0.10.0 |
| 5 | E1–E11 | `fix(a11y): 补齐键盘焦点、语义结构与焦点陷阱` | v0.10.1 |
| 6 | F1–F6 | `feat(theme): 支持系统跟随的暗色模式` | v0.11.0 |
| 7 | G1–G4 | `docs(changelog): 记录 UI/UX 整改与验收结果` | v0.11.1 |

单批次内若需多次提交（如 C 阶段分 4 个区块），使用 `refactor(styles): <区块>（C2/12）` 形式，版本号只在批次末递增。

尾注：

```
Model: deepseek-v4.1-flash-1017
Prompt: UI/UX Quiet Precision 编码任务规划
Loop: P0/P1/P2 <任务号>
```

---

## 7. 单任务执行流程（每张任务卡照此执行）

1. **领取**：确认状态为「待办」，依赖已全部「完成」。
2. **查冲突**：`git status` 确认热点文件无未提交改动；有冲突则等待或换并行组任务。
3. **先测试**（TDD）：
   - 纯函数：先写失败用例 → 跑红 → 实现 → 跑绿。
   - 组件：先写渲染/交互断言 → 实现 → 跑绿。
   - CSS：先写静态断言（`tokens.test.ts` / stylelint）或截图基线。
4. **实现**：只改任务卡列出的文件；发现邻近问题记入「遗留清单」，不顺手修。
5. **自审**（三步，按变更规模匹配）：
   - 性能：有无新增重复渲染、无关重算、过大 DOM。
   - 逻辑/架构：状态归属是否合理，是否绕过了既有 hook/组件边界。
   - 健壮性：空值、禁用态、错误路径、键盘路径。
6. **单任务验收**：`npm run typecheck` + 相关测试 + 该任务的专项命令。
7. **标记**：状态改「待验收」→ 阶段负责人复核 → 「完成」。

**禁止**：
- 跨任务修改未列出的文件；
- 在一个提交里混入格式化全文件（会让 diff 淹没）；
- 为了让测试通过而放宽断言或跳过用例；
- 未经方案文档更新就改变技术决策（如换字体、换状态色方向）。

---

## 8. 任务卡模板

```markdown
### <ID> · <任务名>
- 规模：M（预估 2h）
- 依赖：<ID 列表>
- 并行组：<组名 / 无>
- 目标：<一句话，可验收>
- 改动文件：
  - `path/to/file.tsx`
- 实施要点：
  1. ...
- 验收：
  - [ ] `npm run typecheck`
  - [ ] `<专项命令>`
  - [ ] <手工/截图断言>
- 回滚：< revert 该提交即可 / 需同步回滚 X>
- 备注：<风险、遗留>
```

---

## 9. 人工走查清单（E10 / G2 使用）

### 9.1 键盘

- [ ] 侧栏 Tab 顺序：品牌 → 工作区 → 导航项 → 版本按钮
- [ ] 工作区菜单：Enter 打开、方向键移动、Escape 关闭、焦点归还
- [ ] 7 页可完整到达，焦点环始终可见
- [ ] 详情 tab：左右箭头切换，`aria-selected` 同步
- [ ] 项目行：Tab 到主按钮、Enter/Space 选择；收藏/删除可独立到达
- [ ] 分隔条：左右箭头调整，Home/End 到边界
- [ ] 4 个弹窗层：初始焦点、Tab 循环、ESC 关闭、焦点归还
- [ ] 字号滑块可用方向键调整

### 9.2 反馈

- [ ] 断网克隆 → 红色错误提示，8s 后消失，可手动关闭
- [ ] 保存设置成功 → 绿色提示，3s 后消失
- [ ] 连续两次失败 → 两条同时可见
- [ ] 确认框：取消不执行、确认执行、ESC 等同取消
- [ ] 破坏性操作确认文案说明后果

### 9.3 视觉与响应

- [ ] 1120×720：无横向滚动、无文字截断、按钮不换行破版
- [ ] 1440×900：主布局与截图基线一致
- [ ] 字号 180%：页面标题、列表、表单不重叠
- [ ] 暗色：正文/辅助/状态胶囊对比清晰；无白闪
- [ ] 「减少动态效果」：无旋转、无过渡

### 9.4 语义

- [ ] 页面 h1 唯一
- [ ] 图标按钮均有可读名称
- [ ] 列表在屏幕阅读器中报告项数
- [ ] 状态不只靠颜色传达（保留文字）

---

## 10. 遗留清单（执行中登记，不顺手修）

| 日期 | 任务 | 发现 | 处理建议 | 状态 |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

---

## 附录：任务 ↔ 评估问题覆盖

| 评估问题 | 任务 |
| --- | --- |
| 失败提示绿色对勾 | B2、B4、B5 |
| 提示无队列/不可回溯 | A4、B1、B2 |
| 原生 confirm/alert 13 处 | B3、B6 |
| 环境页状态色被覆盖 | C5、C8 |
| `.secure-label` 语义借用 | C8 |
| 75 处 ≤9px / 137 处 ≤11px | C1–C4 |
| 辅助文字对比度不足 | C5 |
| DM Mono 未分发（17 处） | C6 |
| 中文标题负字距 | C7 |
| 数字非等宽/指标补零 | C6、D6 |
| 243 个硬编码 hex | C9、C10 |
| `--border-strong` 命名矛盾 | C5、C9 |
| 圆角 11 档/间距非栅格 | D10 |
| 双套页面头 | D1、D2 |
| 面包屑名称不一致 | D2 |
| 指标卡箭头不可点 | D6 |
| Ctrl K 提示不可点 | D7 |
| 头像「L」硬编码 | D8 |
| 空态/加载态混淆 | D3、D4、D5 |
| 项目行常显删除按钮 | D9 |
| 无 `:focus-visible` | E1 |
| 工作区菜单不可键盘打开 | E2 |
| ProjectRow 嵌套交互 | E3、E8 |
| tab 用 `aria-pressed` | E4 |
| 模态无焦点管理 | E5 |
| 分隔条不可键盘操作 | E6 |
| 无 reduced-motion | E1 |
| 图标尺寸/命中区不统一 | E7 |
| 无暗色模式 | F1–F6 |
| 启动白闪风险 | F4 |
| 全量回归与门禁 | G1–G4 |