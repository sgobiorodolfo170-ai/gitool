# UI/UX「Quiet Precision」整改实施方案

| 项目 | 内容 |
| --- | --- |
| 文档性质 | **实施方案（归档）**，本次仅落盘，不改代码、不提交 |
| 任务 | 以 Quiet Precision 为框架的 UI/UX 系统性评估与整改方案 |
| 创建日期 | 2026-11-21 |
| 编写基线 | `HEAD 89cee36`（v0.8.8，2026-11-21）；编写时工作树另有首启性能优化未提交改动，本方案未触碰 |
| 执行基线 | `HEAD f90d94c`（v0.8.9）：原生对话框实测 16 处（13 confirm + 3 alert），比编写时多 3 处 git tab |
| 覆盖范围 | **P0 + P1 + P2 全部**（反馈语义、排版色彩、结构一致性、无障碍、暗色模式） |
| 不变量 | 业务逻辑、Git 执行、IPC 参数语义、数据库表结构不变；`AppSettings` 仅新增 `theme` 字段且带默认值；现有覆盖率门槛 95/85/90/95 不降；最小窗口 1120×720 与字号 90%–180% 继续可用 |
| 预估周期 | 约 9.5 个工作日（阶段 A–G） |
| 预计版本 | v0.9.0 → v0.9.1 → v0.10.0 → v0.10.1 → v0.11.0 → v0.11.1 |
| 当前状态 | 阶段 A、B 已完成（提交 `4a976a7`、`a9bf9dc`）；C–G 待执行 |

> 行号与统计值均以基线 `89cee36` 为准。代码改动后行号会漂移，执行阶段应以文件内注释与类名定位，不要机械按行号修改。
>
> 原子任务分解、依赖图与排期见 [`docs/ui-ux-quiet-precision-tasks.md`](./ui-ux-quiet-precision-tasks.md)（62 项，含每项验收命令与并行约束）。

---

## 0. 结论摘要

### 0.1 评估结论

| 维度 | 得分（5 分制） | 主要短板 |
| --- | --- | --- |
| 视觉层次与信息架构 | 3.0 | 总览与「我的项目」信息重叠；3 处虚假可点击暗示；双套页面头 |
| 配色方案 | 3.5 | 243 个硬编码色值；`--border-strong` 比 `--border-default` 浅；环境页状态色被覆盖 |
| 字体与排版 | 1.5 | 137 处 ≤11px、75 处 ≤9px；辅助文字对比度 2.5–3.2:1；DM Mono 不存在；中文负字距 |
| 留白与间距 | 2.5 | 圆角 11 档（2–12px）；间距大量非 4 倍数 |
| 交互反馈与动效 | 2.0 | 失败也显示绿色对勾；16 处原生 confirm/alert；无加载态 |
| 组件一致性 | 2.5 | `.secure-label`/`.setting-value` 语义借用；图标尺寸 12–25px 混用 |
| 可用性与可访问性 | 2.0 | 无 `:focus-visible`；`role=button` 嵌套交互；键盘无法打开工作区菜单 |
| **综合** | **2.4 / 5（约 62/100）** | 骨架合格，**精度与反馈诚实度**不达标 |

### 0.2 量化基线（可在基线复现）

| 指标 | 基线值 | 目标值 |
| --- | --- | --- |
| `styles.css` 唯一硬编码色值 / 出现次数 | 243 / 311 | < 40 / 全部走 token |
| `font-size` 声明数 | 175 | 保持或减少 |
| ≤11px 声明占比 | 78%（137/175） | 0（最小 10px 且仅限元信息） |
| ≤9px 声明数 | 75 | 0 |
| 唯一字号档位 | 16 | 8 |
| `font-family` 声明 | 31 | ≤ 4 组语义栈 |
| `"DM Mono"` 引用 | 17 | 0 |
| `!important` | 8 | 0 |
| 唯一圆角 | 11（2–12px） | ≤ 4（4/8/12/pill） |
| `onNotice` 调用点 | 77 | 不增；失败语义全部走 `showError` |
| `window.confirm` + `window.alert` | 16（13+3） | 0 |
| `:focus-visible` 规则 | 0 | 全局覆盖 |
| `prefers-reduced-motion` | 无 | 有 |
| `font-variant-numeric: tabular-nums` | 无 | 数字/时间/哈希覆盖 |
| 暗色模式 | 无 | `system/light/dark` 三态 |
| 组件文件 | 37 个 `.tsx` | 不增业务页；新增 8 个 UI 组件（6 基础 + 2 反馈） |

---

## 1. 设计原则与可操作标准

### 1.1 Quiet Precision 的五条内核

1. **克制**：颜色、动效、装饰只用于传达信息，不用于营造气氛。
2. **精准**：字号、字重、色彩、间距的每一档都有语义，不是随手取值。
3. **低干扰**：不打断、不闪烁、不制造虚假可点击暗示。
4. **诚实**：成功是成功、失败是失败、加载是加载、空是空。
5. **一致**：同类事物使用同一套组件、命名与节奏。

### 1.2 七条硬指标（验收用）

| 编号 | 标准 | 机器可判定信号 |
| --- | --- | --- |
| Q1 | 层级与信息架构无重复、无歧义 | 同信息跨页重复数；无行为可点击元素数 = 0 |
| Q2 | 语义色板唯一、对比达标 | 裸 hex = 0；正文/辅助/状态文字对比 ≥ 4.5:1 |
| Q3 | 字号阶梯收敛、中文排版正确、字体真实可用 | 唯一字号 = 8；≤9px = 0；未分发字体引用 = 0 |
| Q4 | 间距/圆角/尺寸有刻度 | 圆角 ≤ 4 档；间距落在 4px 栅格 |
| Q5 | 反馈语义正确、动效克制 | 4 种提示类型；有 reduced-motion |
| Q6 | 同类页面/控件同一契约 | 页面头实现 = 1；基础控件统一 |
| Q7 | 键盘可达、语义正确、命中区合理 | axe serious/critical = 0；焦点可见；目标 ≥ 24×24 |

---

## 2. 技术决策

| 编号 | 决策 | 理由与边界 |
| --- | --- | --- |
| D1 | 新增 `src/styles/tokens.css`；`styles.css` 保留为聚合入口；按域渐进迁出 `base/layout/components/pages/dark` | 一次性重写 3300 行风险过高；每阶段可回滚。迁移期 token 与旧值并存 |
| D2 | `<html data-theme="light\|dark">` + `prefers-color-scheme` + `AppSettings.theme` + Electron `nativeTheme` | 避免启动白闪；跨进程一致；老库默认 `system` |
| D3 | `NoticeProvider` + 队列 + 4 种 kind；保留 `showNotice(message)` 兼容签名（默认 success） | 77 个调用点中约 34 个需要改语义，其余零改动 |
| D4 | Promise 式 `confirmDialog(options)` + `useFocusTrap` | 替换 16 处原生对话框；统一 ESC/焦点归还 |
| D5 | 8 档字号 token，最小 10px（元信息），正文 13px，辅助 11–12px | 提高默认可读性；保留 `--font-scale` 缩放机制 |
| D6 | 等宽字体统一为 `ui-monospace, "Cascadia Mono", Consolas, monospace` | DM Mono 未随包分发，17 处声明必然回退；不自托管以控制包体与许可风险 |
| D7 | 间距 4px 栅格；圆角 3 档 + pill | 建立可复用的节奏，减少“近似但不同”的取值 |
| D8 | 现有 node 测试不动；组件测试文件顶部加 `// @vitest-environment jsdom` | 零风险引入组件测试，不改变现有套件环境 |
| D9 | stylelint（error）+ `scripts/ui-guard.mjs`（error）+ CI 两个新步骤 | 防回潮；符合 AGENTS 第九节质量护栏 |

### 2.1 目标 token 体系（草案）

```css
:root {
  /* 字号（均乘 --font-scale） */
  --fs-2xs: 10px;  /* 状态、元信息 */
  --fs-xs: 11px;   /* 辅助说明 */
  --fs-sm: 12px;   /* 次正文 */
  --fs-base: 13px; /* 正文 */
  --fs-md: 15px;   /* 面板标题 */
  --fs-lg: 19px;   /* 详情标题 */
  --fs-xl: 24px;   /* 页面标题 */
  --fs-display: 29px;

  /* 间距（4px 栅格） */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 40px; --space-8: 48px;

  /* 圆角 */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-pill: 999px;

  /* 文本（对比度按 WCAG AA 校准） */
  --text-body: #4b5b63;        /* 7.0:1 */
  --text-secondary: #5a6c72;   /* 5.5:1 */
  --text-muted: #5f6d74;       /* 5.5:1 */
  --text-subtle: #727f85;      /* 4.5:1 */
  --text-tertiary: #6b787e;    /* 4.7:1 */

  /* 状态（前景对各自底色 ≥4.5:1） */
  --status-clean-fg: #256b59;  --status-clean-bg: #e6f5ee;
  --status-ahead-fg: #3d5f7d;  --status-ahead-bg: #e7f0f7;
  --status-behind-fg: #7a5a1e; --status-behind-bg: #faf1d7;
  --status-dirty-fg: #8f4a38;  --status-dirty-bg: #fae8e1;
  --status-conflict-fg: #8a3547; --status-conflict-bg: #f8dfe4;

  /* 动效 */
  --dur-fast: 120ms; --dur-base: 180ms; --ease-standard: cubic-bezier(.2,0,0,1);
}
```

> 具体色值在阶段 C 用对比度脚本校准后落定；上表是目标方向，不是最终值。

---

## 3. 依赖变更（全部 devDependencies）

```
jsdom
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
axe-core
stylelint
```

**不引入**：vitest-axe（对 vitest 5 兼容性不稳定，改用 axe-core + 自定义断言）、Tailwind、CSS-in-JS、组件库、Playwright、字体自托管。

---

## 4. 分阶段实施计划

### 阶段 A｜基础设施（约 0.5 天）

**目标**：先把“约束”建起来，再改界面；本阶段不改变任何可见样式。

**新增**
- `src/styles/tokens.css`（草案见 2.1）。
- `src/lib/notice.ts` + `notice.test.ts`：`NoticeKind`、队列 reducer（上限 3、同文去重、按 kind 定超时：success 3s / info 4s / warning 6s / error 8s）。
- `src/lib/theme.ts` + `theme.test.ts`：`resolveTheme(preference, systemDark)`、`parseTheme`、持久化键。
- `src/lib/a11y/focusTrap.ts` + 测试：可聚焦元素收集与 Tab 环绕的纯函数。
- `src/test/setup.ts`、`src/test/a11y.ts`（`expectNoA11yViolations(container)`）。
- `scripts/ui-guard.mjs`：扫描 `window.confirm|window.alert`、`"DM Mono"`、`calc(8px|9px`、`showNotice("…失败")`、`App.tsx` 中无条件 `<Check` toast。
- `.stylelintrc.json`、`.stylelintignore`。

**修改**
- `package.json`：新增 `lint:css`、`lint:ui`、`test:ui`，并在 `test` 前串联 guard。
- `vitest.config.ts`：白名单追加 `src/lib/notice.ts`、`src/lib/theme.ts`、`src/lib/a11y/focusTrap.ts`；`setupFiles` 按 `typeof window !== "undefined"` 条件加载 jest-dom。
- `src/styles.css`：顶部 `@import "./styles/tokens.css";`。
- `.github/workflows/ci.yml`：新增「UI 约束（stylelint + guard）」「格式检查」两步。

**验收**
```bash
npm run lint:css
npm run lint:ui
npm run format:check
npm test
npm run typecheck
```
首版 stylelint 仅启用 3 条规则（禁 8/9px、hex 仅 tokens、禁新增 `!important`），存量 8 处进 allowlist，阶段 C 清零后转 error。

**回滚点**：删除新增文件与 scripts 即可，无运行时影响。

---

### 阶段 B｜反馈系统（P0，约 1 天）

**目标**：让成功与失败在视觉和语义上分开；去掉阻塞式原生弹窗。

**新增**
- `src/components/NoticeViewport.tsx`：4 种图标/色板；`error` 用 `role="alert"`，其余 `role="status"`；单条关闭；最多堆叠 3 条；不遮挡 bulk-action-bar。
- `src/components/ConfirmProvider.tsx` + `useConfirm`：`confirmDialog({ title, description, confirmLabel, danger }) → Promise<boolean>`；ESC 取消、焦点陷阱、确认后归还焦点。

**修改**
- `src/hooks/useNotice.ts`：由 `string` 改为队列 + 类型，返回 `{ notices, showNotice, showError, showWarning, showInfo, dismiss, clear }`；保留 `showNotice(message)`。
- `src/App.tsx`：挂 `NoticeProvider`；移除 506–511 的单一绿勾 toast；2 处 `window.confirm`（216、315）改用新组件。
- 失败/警告语义替换（约 34 处）：
  - hooks：`useGitOperations.ts`、`useImportFlow.ts`、`useProjects.ts`、`useRemotes.ts`、`useWorkspaces.ts`、`useAccounts.ts`
  - 页面：`TasksWorkspace.tsx`、`SettingsWorkspace.tsx`、`BackupsWorkspace.tsx`、`LogsWorkspace.tsx`
  - `RemoteRepositoriesWorkspace.tsx`：3 处 `window.alert` → `showError`
- 原生确认框替换：`BackupsWorkspace.tsx`、`LogsWorkspace.tsx`、`TasksWorkspace.tsx`、`SettingsWorkspace.tsx`、`git/BranchesTab.tsx`、`git/HistoryTab.tsx`、`git/TagsTab.tsx`、`useImportFlow.ts`、`useProjects.ts`、`useRemotes.ts`、`App.tsx`（执行基线实测 13 处 confirm + 3 处 alert）。

**验收**
- 断网克隆 / 无 Git 执行操作 / 保存失败：红色或琥珀提示 + 对应图标 + `role="alert"`。
- 连续两条失败均可读、可关闭；不会被后一条直接顶掉。
- `npm run lint:ui` 对原生对话框报告 0。

**提交**：`feat(toast): 提示按语义分流并引入确认对话框`（v0.9.0）

---

### 阶段 C｜排版与色彩（P0+P1，约 2 天）

**目标**：解决可读性与语义色问题，这是体感提升最大的一步。

**字号替换映射（175 处）**

| 原值 | 新值 | 用途 |
| --- | --- | --- |
| 8px | 10px | 元信息、哈希、路径 |
| 9px | 10–11px | 标签、辅助 |
| 10px | 11px | 辅助说明 |
| 11px | 12px | 次正文 |
| 12px | 13px | 正文 |
| 13px | 14px | README 内文 |
| 14px | 15px | 面板标题 |
| 15–16px | 16px | 模块标题 |
| 17–22px | 19–24px | 详情/指标 |
| 26–29px | 29px | 页面标题 |

**对比度修正**
- `--text-muted`、`--text-subtle`、`--text-tertiary` 按 2.1 目标值替换。
- 状态胶囊前景加深，确保 9–10px 小字也 ≥4.5:1（当前 `#31836f` on `#e6f5ee` ≈ 4.05:1）。

**字体**
- 删除 17 处 `"DM Mono"`，统一 D6 字体栈。
- `pre/code/时间/哈希/指标数值` 加 `font-variant-numeric: tabular-nums`。

**中文排版**
- `page-heading h1`、`.detail-title h2` 的 `letter-spacing: -0.04em` → `0`。
- 负字距仅保留在 `:lang(en)` 作用域。
- `.eyebrow` 的 `letter-spacing: 0.16em` → `0.08em`，且仅英文生效。

**语义色修复**
- `EnvironmentTab.tsx`：状态胶囊改用独立 `.env-status`（不再组合 `.setting-value`），或给 `.setting-value` 加 `:not(.status-pill)`。
- `AttentionPanel.tsx`：`.secure-label` → `.count-badge`（中性灰蓝）。

**硬编码收敛**
- 243 个唯一 hex 按语义归入 tokens，目标 < 40。
- `tokens.css` 之外禁止 hex（stylelint 转 error）。
- 清理 8 处 `!important`（`compact-button`、`secure-label` 等）。

**验收**
```bash
grep -rn "calc(8px\|calc(9px" src/    # 0
npm run lint:css                        # hex 仅 tokens
npm run test -- src/styles/tokens.test.ts
```
另需 1120×720 下逐页核对：无横向溢出、无文字截断、列表行高不塌陷。

**提交**：`refactor(styles): 收敛字号/色板/字体栈，修复状态色覆盖`（v0.9.1）

---

### 阶段 D｜结构与一致性（P1，约 2 天）

**新增组件**
- `PageHeader.tsx`：eyebrow（中文）+ h1 + 描述 + actions。
- `EmptyState.tsx`：`variant: "no-data" | "no-match" | "error"` + 图标 + 主文案 + 一个动作。
- `Skeleton.tsx`：列表行 / 卡片 / 面板三种骨架。
- `ui/StatusPill.tsx`、`ui/CountBadge.tsx`、`ui/IconButton.tsx`（统一 28×28 命中区，`aria-label` 必填）。

**修改**
- 7 个页面换 `PageHeader`：`OverviewWorkspace`、`ProjectsWorkspace`、`RemoteRepositoriesWorkspace`、`TasksWorkspace`、`BackupsWorkspace`、`LogsWorkspace`、`SettingsWorkspace`；删除 `page-heading` / `module-hero` 两套实现。
- `src/lib/navigation.ts`：`logs` 标签从「设置与记录」改为「操作记录」，与侧栏一致；补充 `pageDescription`。
- `src/hooks/useAsyncData.ts`：新增可选 `onStatus`/返回 `status`（`idle/loading/ready/error`）。
- `ProjectsPage` / `useProjects`：暴露 `isLoading`（首载标记），用于骨架屏。
- `common.tsx`：
  - `MetricCard` 增加 `onClick`，四卡分别跳转 `projects`（全部/需要关注/已收藏）与 `remotes`。
  - `ProjectRow` 删除按钮改为 hover/focus-within 显示。
  - `EmptyProjects` 改用 `EmptyState`。
- `App.tsx`：`Ctrl K` 提示改为 `<button>`（`CustomEvent("gitool:focus-search")`），删除 `top-avatar "L"`；`WorkspaceSwitcher` 头像用工作区名称首字符。
- 间距/圆角批量替换为 token。
- `TaskForm.tsx` 等 5 处 inline style 色值迁到 `--warning-*` 类。

**验收**
- `grep -c "module-hero\|page-heading"` 仅出现在 `PageHeader.tsx`。
- 首屏 0–500ms 显示骨架，而非「没有匹配的项目」。
- 空态三态可区分：无数据 / 无匹配 / 加载失败。
- 所有带箭头或 `cursor: pointer` 的元素均有真实行为。
- 项目行静止态无红色删除按钮。

**提交**：`feat(ui): 统一页面头与空/加载态，移除虚假交互暗示`（v0.10.0）

---

### 阶段 E｜无障碍体系（P2，约 2 天）

**样式**
- 全局 `:focus-visible`（2px accent + offset 2px，`border-radius: inherit`）。
- `@media (prefers-reduced-motion: reduce)` 关闭 `spin`、`transition`、`scroll-behavior`。
- 输入框 `outline: none` 限定到 `:focus:not(:focus-visible)`。

**组件**
- `WorkspaceSwitcher.tsx`：触发区改 `<button aria-haspopup="menu" aria-expanded>`；`role="menu"` / `menuitem`；ArrowUp/Down/Home/End/Escape；打开后焦点落第一项。
- `common.tsx` `ProjectRow`：外层去 `role="button"`；主信息区独立 `<button>`，复选框/收藏/删除为同级按钮；列表改 `ul/li`。
- `ProjectDetail.tsx`：`role="tablist"` + `tab` + `aria-selected` / `aria-controls` + `tabpanel`，支持左右箭头。
- 焦点陷阱：`App.tsx` setup modal、`RemoteRepositoriesWorkspace` 表单、`ReadmeOverlay`、`ConfirmProvider`。
- `useSplitWidth.ts` + `ProjectsWorkspace`：ArrowLeft/Right ±2%（Shift ±10%）、Home/End，`aria-valuemin/max/now`。
- `tag-remove`（`OverviewPanel.tsx:184`）点击区 ≥24×24；所有 `icon-button` ≥28×28。
- 列表语义化：`remote-list`、日志、分支、标签改 `ul/li`（保留类名）。
- 无文字图标按钮补 `aria-label`（刷新、导出、清空、收起等）。

**验收**
- axe 对 7 页（bridge mock）0 serious/critical。
- 键盘走查：侧栏 → 工作区菜单 → 7 页 → 详情 tab → 四个弹窗层（3 个业务弹窗 + 确认框），焦点始终可见且不逃逸。

**提交**：`fix(a11y): 补齐键盘焦点、语义结构与焦点陷阱`（v0.10.1）

---

### 阶段 F｜暗色模式（P2，约 1.5 天）

**样式**
- `src/styles/dark.css`：`[data-theme="dark"]` 覆盖全部语义 token；侧栏与内容区统一深色阶；状态色在暗底重新校准到 ≥4.5:1。

**渲染层**
- `src/hooks/useTheme.ts`：`system|light|dark`；监听 `matchMedia("(prefers-color-scheme: dark)")`；写 `<html data-theme>` 与 `meta[name=theme-color]`。
- `shared/types.ts`：`AppSettings.theme: "system" | "light" | "dark"`。
- `src/components/settings/AppSettingsTab.tsx`：三态单选。

**主进程**
- `electron/main/ipc/schemas.ts`：新增可选字段 + 默认 `system`（老库兼容）。
- `electron/main/services/storage/settings.ts` + 测试：默认值与迁移。
- `electron/main/index.ts`：`nativeTheme.themeSource`、`window.setBackgroundColor()`。
- `electron/preload/index.ts`、`src/electron.d.ts`：新增方法签名。
- `electron/main/ipc/bridgeParity.test.ts`：同步更新桥接一致性用例。

**验收**
- 三模式即时切换、重启保持；老库（无 theme）读出 `system`。
- 暗色下 axe 与对比度脚本同样 0 违规。
- 启动瞬间无白闪（窗口底色与页面一致）。

**提交**：`feat(theme): 支持系统跟随的暗色模式`（v0.11.0）

---

### 阶段 G｜回归与交付（约 0.5 天）

- 1440×900、1120×720、1920×1080 三尺寸截图核对（7 页 + 3 个弹窗）。
- 键盘 / 读屏 / 字号 180% / 暗色四类人工走查。
- `CHANGELOG.md` 每个版本一行。
- 全量门禁（见第 6 节）。
- 提交：`docs(changelog): 记录 UI/UX 整改与验收结果`（v0.11.1）。

---

## 5. 测试矩阵

| 层级 | 文件 | 关键断言 |
| --- | --- | --- |
| 纯函数（node） | `src/lib/notice.test.ts` | 队列上限 3、同文去重、按 kind 定超时、错误不被成功挤掉 |
| 纯函数（node） | `src/lib/theme.test.ts` | system 解析、非法值回退、持久化 |
| 纯函数（node） | `src/lib/a11y/focusTrap.test.ts` | Tab/Shift+Tab 环绕、无可聚焦元素兜底 |
| 静态约束（node） | `src/styles/tokens.test.ts` | 无 8/9px、hex 仅 tokens、无 `"DM Mono"` |
| 组件（jsdom） | `NoticeViewport.test.tsx` | 4 种 kind 的图标/role/自动关闭/关闭按钮 |
| 组件（jsdom） | `ConfirmProvider.test.tsx` | 确认/取消/ESC/焦点归还 |
| 组件（jsdom） | `WorkspaceSwitcher.test.tsx` | 键盘打开、方向键、Escape、`aria-expanded` |
| 组件（jsdom） | `ProjectRow.test.tsx` | 无嵌套交互、Enter/Space 选择、操作按钮独立可点 |
| 组件（jsdom） | `DetailTabs.test.tsx` | 左右箭头切换、`aria-selected` 同步 |
| 组件（jsdom） | `PageHeader.test.tsx` | h1 唯一、actions 顺序 |
| axe smoke（jsdom） | `src/components/__a11y__/*.test.tsx` | 总览/项目/设置/备份 4 页 0 serious/critical |

**覆盖率策略**：组件测试不纳入 v8 白名单（避免拉低 95/85/90/95）；新增纯函数纳入白名单并保持门槛。`vitest.config.ts` 注释需同步说明这一取舍。

---

## 6. CI 与门禁

### 6.1 本地命令

```bash
npm run typecheck
npm run test
npm run test:coverage
npm run lint:css
npm run lint:ui
npm run format:check
npm run build
```

### 6.2 CI 步骤（在现有三步基础上增加）

```yaml
- name: 类型检查（渲染层 + 主进程）
  run: npm run typecheck
- name: 单元测试（含覆盖率门槛）
  run: npm run test:coverage
- name: UI 约束（stylelint + guard）
  run: npm run lint:css && npm run lint:ui
- name: 格式检查
  run: npm run format:check
- name: 构建产物
  run: npm run build
```

### 6.3 机器可判定指标

| 指标 | 目标 |
| --- | --- |
| `calc(8px\|9px` | 0 |
| `window.confirm\|window.alert` | 0 |
| `"DM Mono"` | 0 |
| `tokens.css` 外 hex | 0 |
| 唯一 hex | < 40 |
| 唯一字号档 | 8 |
| 唯一圆角 | ≤ 4 |
| axe serious/critical | 0 |
| 失败语义走 `showError` | 全部失败调用点 |

---

## 7. 提交与版本

| 阶段 | 版本 | 提交信息 |
| --- | --- | --- |
| A | — | `chore(ui): 建立设计 token 与 UI 约束基础设施` |
| B | v0.9.0 | `feat(toast): 提示按语义分流并引入确认对话框` |
| C | v0.9.1 | `refactor(styles): 收敛字号/色板/字体栈，修复状态色覆盖` |
| D | v0.10.0 | `feat(ui): 统一页面头与空/加载态，移除虚假交互暗示` |
| E | v0.10.1 | `fix(a11y): 补齐键盘焦点、语义结构与焦点陷阱` |
| F | v0.11.0 | `feat(theme): 支持系统跟随的暗色模式` |
| G | v0.11.1 | `docs(changelog): 记录 UI/UX 整改与验收结果` |

每条提交尾注：

```
Model: deepseek-v4.1-flash-1017
Prompt: UI/UX Quiet Precision 整改
Loop: P0/P1/P2 <阶段号>
```

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 字号上调导致 1120 宽下换行/溢出 | 中 | 每类组件改完即在最小窗口核对；关键容器补 `flex-wrap` / `min-width: 0` |
| 大范围 CSS 改动引入视觉回归 | 高 | 分 5 次提交；每阶段保留改前截图；token 与旧值并存一个阶段 |
| 77 个 `onNotice` 迁移遗漏 | 中 | TS 类型 + ui-guard 扫描「失败」文案 + 逐文件清单勾选 |
| stylelint 对存量 CSS 海量报错 | 中 | 首版仅 3 条规则 + allowlist；阶段 C 清零后转 error |
| 暗色 IPC 改动破坏 bridgeParity | 中 | 同步更新 `bridgeParity.test.ts` 与 schema 测试；补老库默认值用例 |
| 组件测试拖慢 CI | 低 | 仅 10 个测试文件；axe 只跑 4 页；jsdom 文件级切换 |
| 覆盖率被新代码拉低 | 中 | 新纯函数全部配单测并纳入白名单；组件测试不计入 |
| 与工作树未提交的 perf 改动冲突 | 中 | 开工前先确认 perf 改动已提交或单独分支；本方案不触碰 `App.tsx` 之外的 perf 逻辑 |

---

## 9. 完成定义（DoD）

**机器**
- 第 6.1 节全部命令 0 退出码。
- 第 6.3 节全部指标达标。

**人工**
1. 键盘从侧栏开始，可遍历 7 页与所有弹窗，焦点始终可见。
2. 触发一次失败（断网克隆 / 无 Git 操作），提示为红色且可读、可关闭。
3. 1120×720 下无横向滚动、无文字截断。
4. 字号调到 180% 后主要页面不破版。
5. 暗色模式下正文、辅助文字、状态胶囊均清晰可读。
6. 开启「减少动态效果」后无旋转/过渡动画。

---

## 10. 执行记录模板（执行时填写）

| 阶段 | 开始 | 完成 | 提交 | 门禁结果 | 备注 |
| --- | --- | --- | --- | --- | --- |
| A 基础设施 | 2026-11-21 | 2026-11-21 | `4a976a7` | 全绿（覆盖 97.71/91.31/97.67/97.79） | 新增 24 条单测；format 基线清理 13 个文件 |
| B 反馈系统 | 2026-11-21 | 2026-11-21 | `a9bf9dc` | 全绿（覆盖 97.71/91.31/97.67/97.79）；ui-guard 对话框 0 / 失败语义 0 | 16 处原生对话框替换；新增 8 条组件测试；v0.9.0 |
| C 排版色彩 | — | — | — | — | — |
| D 结构一致性 | — | — | — | — | — |
| E 无障碍 | — | — | — | — | — |
| F 暗色模式 | — | — | — | — | — |
| G 回归交付 | — | — | — | — | — |

---

## 附录 A：基线指标复现命令

```powershell
# 唯一硬编码色值 / 出现次数
$c = Get-Content src/styles.css -Raw
$hex = [regex]::Matches($c, '#[0-9a-fA-F]{3,8}\b')
($hex | ForEach-Object { $_.Value.ToLower() } | Sort-Object -Unique).Count   # 243
$hex.Count                                                                   # 311

# 字号分布
$fs = [regex]::Matches($c, 'calc\(([\d.]+)px \* var\(--font-scale\)\)')
$vals = $fs | ForEach-Object { [double]$_.Groups[1].Value }
$vals.Count                                                                  # 175
($vals | Where-Object { $_ -le 9 }).Count                                    # 75
($vals | Where-Object { $_ -le 11 }).Count                                   # 137
($vals | Sort-Object -Unique) -join ', '                                     # 16 档

# 其他
(Select-String -Path src/styles.css -Pattern '!important' -AllMatches).Count  # 8
(Select-String -Path src/lib/*.ts,src/hooks/*.ts -Pattern 'onNotice\(' -AllMatches).Count
```

---

## 附录 B：问题 → 阶段映射

| 评估问题 | 位置（基线） | 阶段 |
| --- | --- | --- |
| 失败提示显示绿色对勾 | `App.tsx:506-511` | B |
| 提示无队列、不可回溯 | `useNotice.ts:33-45` | B |
| 原生 confirm/alert 16 处 | 见 4.B | B |
| 环境页状态色被 `.setting-value` 覆盖 | `EnvironmentTab.tsx:59-136`、`styles.css:931/2289` | C |
| `.secure-label` 语义借用 | `AttentionPanel.tsx:27`、`styles.css:1398-1407` | C |
| 75 处 ≤9px / 137 处 ≤11px | `styles.css` | C |
| 辅助文字对比度 2.5–3.2:1 | `styles.css:26-33` | C |
| `"DM Mono"` 未分发（17 处） | `styles.css` 多处 | C |
| 中文标题负字距 | `styles.css:573,1039` | C |
| 数字非等宽、指标补零 | `styles.css` / `OverviewWorkspace.tsx:88` | C |
| 243 个硬编码 hex | `styles.css` | C |
| `--border-strong` 比 `--border-default` 浅 | `styles.css:18-21` | C |
| 圆角 10 档、间距非 4 栅格 | `styles.css` | C |
| 双套页面头 | `page-heading` vs `module-hero` | D |
| 面包屑「设置与记录」与侧栏不符 | `navigation.ts:61` | D |
| 指标卡箭头不可点 | `common.tsx:31` | D |
| Ctrl K 提示不可点 | `App.tsx:389-393` | D |
| 头像「L」硬编码 | `App.tsx:395`、`WorkspaceSwitcher.tsx:75` | D |
| 空态与加载态混淆 | `ProjectsWorkspace.tsx:270`、`App.tsx:36-39` | D |
| 项目行常显删除按钮 | `common.tsx:123-132` | D |
| 无 `:focus-visible` | `styles.css` | E |
| 工作区菜单不可键盘打开 | `WorkspaceSwitcher.tsx:74` | E |
| `ProjectRow` 嵌套交互 | `common.tsx:73-142` | E |
| tab 用 `aria-pressed` | `ProjectDetail.tsx:139` | E |
| 模态无焦点管理 | `App.tsx:545-629`、`ReadmeOverlay.tsx:33-61` | E |
| 分隔条不可键盘操作 | `useSplitWidth.ts:65-106` | E |
| 无 `prefers-reduced-motion` | `styles.css` | E |
| 无暗色模式 | 全站 | F |

---

## 附录 C：明确不做（防止范围蔓延）

- 不重做业务信息架构（仍为 7 个 Workspace），不合并「总览」与「我的项目」页面；只消除重复呈现与虚假入口。
- 不引入 UI 框架或设计系统库。
- 不自托管中文字体（体积与许可成本高）。
- 不做 Electron E2E / Playwright。
- 不重构 Git / IPC / 存储层（暗色仅新增 `theme` 字段）。
- 不改变现有覆盖率门槛。
- 本文档归档本身不占版本号、不改 `CHANGELOG`；执行阶段各自记录。