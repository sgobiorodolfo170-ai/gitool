# 阶段 F 暗色模式记录（v0.11.0）

> 方案：`docs/ui-ux-quiet-precision-plan.md` 阶段 F｜暗色模式
> 执行日期：2026-11-21
> 基线：`699fd1d`（v0.10.1）

## 1. 交付

| 项 | 内容 | 验证 |
| --- | --- | --- |
| F1 | `src/styles/dark.css`：31 个语义 token 覆盖（背景/边框/文字/状态/反馈/阴影），侧栏较内容区再深一档；显式 `color-scheme` | `node scripts/check-contrast.mjs`：两主题 15 组正文级配色全部 ≥4.5:1 |
| F2 | `useTheme(preference)`：解析 system/light/dark、监听 `prefers-color-scheme`、写 `data-theme` 与 meta theme-color | `src/hooks/useTheme.test.tsx`（3 例） |
| F3 | `AppSettings.theme` 贯通 `shared/types` → zod schema（默认 system）→ storage 读写；老库无 theme 行回退 system | `electron/main/services/storage/settings.test.ts`（7 例，含旧库回退） |
| F4 | `nativeTheme.themeSource` 启动即设置；窗口底色与 `--bg-app` 对齐；首屏 query 注入 `data-theme` 避免白闪；新增 `theme:set` IPC / preload `setTheme` / 桥接一致性计数 77 | `bridgeParity.test.ts` + 实机重启验证 |
| F5 | 设置页「外观」三态单选（跟随系统/浅色/深色），保存后立即生效 | CDP 实机切换 + 重启保持 |
| F6 | 三模式截图、暗色 axe、对比度脚本、启动持久化 | 见第 2–3 节 |

## 2. 实机验证（生产构建 + 隔离 userdata + CDP）

- 切换：设置页选「深色」并保存 → `data-theme=dark`、`body` 背景 `rgb(20,24,27)`、meta `#14181b`；
  切「浅色」→ `rgb(245,247,249)`；切「跟随系统」→ 与本机 `prefers-color-scheme` 一致。
- 重启保持：`Page.reload` 后首帧即为 `data-theme=dark`（主进程 query 注入），设置页 radio 读回 `dark`。
- 截图：`docs/screenshots/quiet-precision/f-dark-1440-*.png`（7 页）、
  `f-dark-1120-settings.png`、`f-light-1440-overview.png`、`f-system-1440-settings.png`。
- 暗色 axe（真实 Chromium，注入 axe-core；关闭无法在 DOM 层复现的 color-contrast）：
  总览 / 我的项目 / 设置 / 备份中心 serious/critical 均为 0。
  （首次运行发现「我的项目」的 Ctrl K 按钮 `aria-label` 与可见文本不一致，已改为由可见文本命名的真实按钮。）

## 3. 对比度

`npm run lint:contrast` 输出（节选）：light `text-body` 7.06、状态色 5.52–6.22、主按钮 6.31；
dark `text-body` 10.25、状态色 7.00–7.93、主按钮 9.53。全部通过 4.5:1。

## 4. 全门禁

`typecheck` / `test:coverage` / `lint:css` / `lint:ui` / `lint:contrast` / `format:check` / `build`
均为 0 退出码。

## 5. 遗留

- 读屏人工听读与 180% 字号走查在阶段 G 完成。
- 暗色下截图仅为 1440（1120 取设置页作密度抽样），三尺寸完整回归在 G1。