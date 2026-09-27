# Gitool 整体回归验证报告

> 验证日期：2026-09-27
> 覆盖：构建、启动、IPC 一致性、数据库迁移、Git 服务解析、前端功能缺口

## 1. 验证范围与结果

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| TypeScript 类型检查 | `npm run typecheck` | ✅ 通过 |
| 生产构建 | `npm run build` | ✅ 通过（dist + dist-electron 产物完整） |
| 应用启动 | `npm run dev` + 进程/端口探测 | ✅ Electron 主进程 + 渲染层正常，`/` 返回 200，日志无 error |
| IPC 通道一致性 | 对比 `ipcMain.handle` 与 preload `invoke` | ✅ 61 vs 59，差额为主进程内部通道（`operations:record`、`tasks:updateRun`） |
| Bridge 类型一致性 | `DesktopBridge` 类型成员 vs preload 实现 | ✅ 60/60 全对齐，无缺失/多余 |
| 数据库迁移 | SQLite PRAGMA 检查 | ✅ 7 张表齐全；`projects` 含 `diskSizeBytes`、`alias` 等全列 |
| Git 输出解析 | 真实临时仓库冒烟 | ✅ status/log/diff/numstat 解析正确 |
| 标签解析 | `git tag`/`for-each-ref` 冒烟 | ⚠️ 发现并修复（见下） |
| 前端未消费能力 | 扫描 `bridge.xxx` 使用 | ⚠️ `openExternal`、`listVersions` 未被渲染层使用（部分已修复） |

## 2. 回归发现的问题与修复

### 2.1 标签解析 Bug（已修复）
- **现象**：`git tag -l --format=...%x1e...` 与 `git for-each-ref` **不展开** `%x1e` 十六进制转义（`%x1e` 仅在 `git log --pretty` 中生效），导致 `listTags` 把整行当作标签名。
- **修复**（commit `ab288ce`）：改用 `for-each-ref` + 换行分隔字段（每 4 行解析一个标签），日期用 `%(creatordate:iso8601-strict)` 保证可 `new Date()` 解析。已用真实仓库验证解析正确。

### 2.2 版本对比仅支持提交（已补齐）
- **现象**：`git:listVersions`（聚合提交/分支/标签）已实现但渲染层未使用，版本对比只能选提交，不满足 FR-806「提交、分支或标签」。
- **修复**（commit `78d92e3`）：对比下拉按「分支 / 标签 / 提交」分组展示。

## 3. 未完成的已知项（非回归）

- AI API Key 存于 SQLite 设置表（功能可用）；按 FR-705 应迁移到 Windows Credential Manager。
- `openExternal` 桥接方法当前无前端消费点（预留，用于打开远程仓库页面等场景）。
- 克隆、任务执行等为真实子进程；任务输出 1s 轮询刷新，非 SSE 推送（可接受）。

## 4. 结论

当前版本可正常构建、启动、读写数据库，Git 核心操作解析正确，IPC/Bridge 契约完整。回归中发现并修复 2 项问题（标签解析、版本对比范围），无阻塞性缺陷。
