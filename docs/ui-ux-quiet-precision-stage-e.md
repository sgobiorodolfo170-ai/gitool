# 阶段 E 无障碍整改记录（v0.10.1）

> 配套方案：`docs/ui-ux-quiet-precision-plan.md` 阶段 E｜无障碍体系
> 执行日期：2026-11-21
> 基线：`658b059`（v0.10.0）

## 1. 交付范围

| 项 | 改动 | 验证 |
| --- | --- | --- |
| E1 | 全局 `:focus-visible`（2px accent + 2px offset），移除输入框基础规则的 `outline: none`；`prefers-reduced-motion` 关闭 spin/过渡/平滑滚动 | CDP 键盘走查 26 个焦点目标全部 `solid 2px`；模拟 reduced-motion 后按钮 `transition-duration: 0s` |
| E2 | `WorkspaceSwitcher` 改为 `aria-haspopup="menu"` 按钮 + `role="menu"/menuitem`；↑↓/Home/End/Escape，打开落焦首项 | `WorkspaceSwitcher.test.tsx`（5 例） |
| E3 | `ProjectRow` 外层改 `li`，主信息区独立按钮，复选框/收藏/删除同级；项目列表 `ul/li` | `ProjectRow.test.tsx`（3 例）+ axe list 规则通过 |
| E4 | 详情 `tablist/tab/tabpanel` + `aria-selected/controls`，左右箭头循环、Home/End | `DetailTabs.test.tsx`（2 例） |
| E5 | 首启 Git 弹窗、远程仓库表单、README 阅读层、确认框统一接入 `useFocusTrap`；关闭归还焦点 | 代码走查 + `ConfirmProvider.test.tsx` |
| E6 | 分隔条 `tabIndex=0`，Arrow ±2%（Shift ±10%）、Home/End，补 `aria-valuemin/max/now/text` | 代码走查（`useSplitWidth` 纯逻辑） |
| E7 | `.icon-button/.bare-button` ≥28×28，`.tag-remove` ≥24×24；刷新/保存等图标按钮补 `aria-label` | axe `button-name`/`target-size` 无 serious |
| E8 | `remote-list`、日志、分支、标签改 `ul/li`（保留类名），补列表重置样式 | axe `list`/`listitem` 通过 |
| E9 | 总览/项目/设置/备份 4 页 axe smoke | `src/components/__a11y__/pages.test.tsx`：serious/critical = 0 |
| E10 | 键盘走查 | 见第 2 节 |
| E11 | 全门禁 + v0.10.1 | 见第 3 节 |

## 2. 键盘走查（CDP：生产构建 + 隔离 userdata）

- 方法：`electron . --remote-debugging-port` + Node 内置 WebSocket 手写 CDP，`Input.dispatchKeyEvent` 连按 Tab 26 次；每步读取 `document.activeElement` 与 `getComputedStyle`。
- 结果：26 个焦点目标（工作区切换器、7 个导航项、页面头按钮、搜索框、卡片等）全部命中 `outline-style: solid / width: 2px / offset: 2px`；无焦点不可见项。
- 侧栏截图：`docs/screenshots/quiet-precision/e-walkthrough-1440.png`（焦点轮廓在深色侧栏上清晰可见；工作区切换器改为按钮结构后视觉不变）。
- reduced-motion：`Emulation.setEmulatedMedia({prefers-reduced-motion: reduce})` 后 `.button` 计算样式 `transition-duration: 0s`。

## 3. 门禁

```bash
npm run typecheck      # 0
npm run test:coverage  # 全部通过，覆盖率门槛满足
npm run lint:css       # 0
npm run lint:ui        # 0 / 0 基线
npm run format:check   # 0
npm run build          # 0
```

## 4. 未纳入本阶段

- 读屏人工听读（NVDA）与 180% 字号走查安排到阶段 G 的交付回归。
- 暗色模式下的 focus/axe 复验在阶段 F 完成后执行。