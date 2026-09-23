# Gitool

Gitool 是一个 Windows Git 仓库管理桌面工具，统一管理本地仓库以及 GitHub、Gitee、GitLab 远程仓库。

当前版本是首个可运行里程碑，已包含：

- Electron + React + TypeScript 桌面工程骨架。
- 本地项目导入、收藏、搜索和状态筛选。
- 真实 Git 分支、提交、文件数量和工作区状态读取。
- 受控的 `fetch`、`pull`、`push`、`sync` 操作。
- 项目目录、语言、大小、类型和关键文件分析。
- SQLite（`node:sqlite`）项目及账号元数据持久化。
- GitHub、Gitee、GitLab PAT 账号管理和连接测试。
- Windows Credential Manager 令牌安全存储。
- GitHub、Gitee、GitLab 远程仓库查询和搜索。

完整产品需求见 [docs/requirements.md](docs/requirements.md)。

## 架构

| 层 | 实现 |
| --- | --- |
| 桌面壳 | Electron 44（内置 Node.js 24） |
| 渲染层 | React 19 + TypeScript + Vite 8 |
| 主进程 | Node.js + TypeScript，构建产物 `dist-electron/` |
| IPC | `contextBridge` + `ipcRenderer.invoke` / `ipcMain.handle` |
| 数据库 | `node:sqlite`（内置，无原生编译） |
| 凭据 | `@napi-rs/keyring`（Windows Credential Manager） |
| Git | `node:child_process` 调用系统 Git CLI |
| 打包 | electron-builder（NSIS x64 安装包） |

## 开发环境

- Windows 10 22H2 或 Windows 11 x64
- Node.js 24+
- npm 11+
- Git 2.x

无需安装 Rust、Visual Studio Build Tools 或 WebView2。

如果所在网络无法直连 GitHub，可在安装 Electron 二进制时使用镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

## 常用命令

```powershell
npm install          # 安装依赖
npm run dev          # 启动 Electron 桌面应用（含主进程热重启与渲染层 HMR）
npm run dev:web      # 仅浏览器预览，使用演示数据
npm run typecheck    # 渲染层与主进程类型检查
npm run build        # 构建 dist/ 与 dist-electron/
npm run dist         # 构建并生成 NSIS 安装包到 release/
```

浏览器预览不会访问系统 Git、SQLite、Windows Credential Manager 或远程平台 API。

打包时如需镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

## 数据与安全

- 项目和账号元数据保存到 Electron `userData` 目录中的 `gitool.sqlite3`。
- PAT 和后续 AI API Key 使用 Windows Credential Manager 保存，不写入 SQLite。
- Token 不写入远程 URL、操作日志或界面状态。
- Git 操作通过参数数组直接调用系统 Git，不经过 shell。
- 渲染层启用 `contextIsolation`、`sandbox`，禁用 `nodeIntegration`，仅暴露白名单桥接方法。
- 生产环境启用严格 CSP；主进程校验所有 IPC 入参。
- 结构分析默认忽略 `.git`、`node_modules`、`target`、`dist` 等目录。

## 当前限制

- OAuth、远程仓库创建/修改/删除尚未接入。
- 远程仓库克隆按钮当前只展示入口，目录选择和私有仓库凭据注入尚未完成。
- 构建、运行、打包任务以及 ZIP 备份仍是后续里程碑。
- 应用图标暂用 electron-builder 默认图标，后续补充 `build/icon.ico`。
