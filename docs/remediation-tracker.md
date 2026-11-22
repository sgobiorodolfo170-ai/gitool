# Gitool 整改跟踪与验收表

**创建日期**: 2026-11-22  
**项目版本**: v0.11.1  
**总问题数**: 35 条  
**总人日**: 24~32 人日

---

## 批次进度总览

| 批次 | 主题 | 问题数 | 人日 | 状态 | 完成度 |
|------|------|--------|------|------|--------|
| **第 1 批** | 止漏与立边界 | 18 | 10~14 | ✅ 已完成 | 100% |
| **第 2 批** | 架构治理 | 8 | 8~10 | ✅ 已完成 | 100% |
| **第 3 批** | 测试与工程化 | 10 | 6~8 | ✅ 已完成 | 100% |
| **合计** | — | **35** | **24~32** | — | **100%** |

---

## 第 1 批：止漏与立边界（10~14 人日）

### 1A. 更新链 RCE 修复（1.5 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-03: 更新链无哈希/签名校验 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加sha256File和digest校验 |
| P-04: updater:install 命令注入 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已去掉cmd /c start，改直接spawn |

**验收信号**:
- [x] `spawn("cmd"` 计数 = 0（`grep -c 'spawn.*cmd' electron/main/services/*.ts`）
- [x] 单测：`installUpdate("...\\x&calc.exe")` 抛"不受信任"
- [x] 单测：`sha256File` 对已知文件返回正确摘要
- [x] `electron-builder.yml` 有 `forceCodeSigning: true`

**关键文件**:
- `electron/main/services/updater.ts`
- `electron-builder.yml`

---

### 1B. 凭据外泄修复（1.5 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-05: 凭据经 URL/日志/CSV 泄露 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加assertNoCredentialInUrl和redactSecrets |
| P-06: 克隆时把可执行 shell 写进 .git/config | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已改用GIT_CONFIG_*环境变量 |

**验收信号**:
- [x] 单测：`assertNoCredentialInUrl("https://u:tok@h/x")` 抛错
- [x] 单测：`redactSecrets("https://u:tok@h/x")` → `https://***@h/x`
- [x] e2e：克隆后 `git -C <target> config --get credential.helper` 为空
- [x] 备份默认排除 `.git/config`

**关键文件**:
- `services/git/clone.ts`（已存在）
- `services/serviceUtils.ts`（redactSecrets已存在）
- `services/operationCsv.ts`（已存在）
- `services/backups.ts`（已存在）

---

### 1C. 渲染层立边界（4 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-01: 渲染层没有数据访问边界 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已创建5个hook（useTasks/useBackups/useLogs/useSettings/useGitPanel） |
| P-02: 实体构造逻辑在渲染层复制 6 处 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加shared/entities.ts工厂 |
| P-17: AI 摘要的领域逻辑在展示组件中 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已抽aiContext.ts和useAiSummary |
| P-31: 渲染层用硬编码反斜杠拼路径 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加system:resolveTargetPath |

**验收信号**:
- [x] 单测：`useTasks` 的 CRUD 操作正确调用 bridge
- [x] 单测：`useGitPanel` 的 busy 状态机正确
- [x] 单测：ESLint 规则对 `src/components/**` 生效
- [x] 投影测试：工厂产物全部通过 schema
- [x] `bridge.*` 在 `src/components` 从 53 → ≤34（`grep -c 'bridge\??\.' src/components/**/*.tsx`）
- [x] 组件层 `getDesktopBridge()` 调用归零

**关键文件**:
- `src/hooks/useTasks.ts`（新增）
- `src/hooks/useBackups.ts`（新增）
- `src/hooks/useLogs.ts`（新增）
- `src/hooks/useSettings.ts`（新增）
- `src/hooks/useGitPanel.ts`（新增）
- `src/hooks/useAiSummary.ts`（新增）
- `src/lib/aiContext.ts`（新增）
- `shared/entities.ts`（已存在）
- `electron/main/services/pathPolicy.ts`（resolveTargetPath）
- `electron/main/ipc.ts`（system:resolveTargetPath handler）

---

### 1D. 其他安全修复（3~7 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-07: IPC 入参校验覆盖不足 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已补齐schema，ipc.ts 100% parseOrThrow |
| P-08: 路径类通道无根目录白名单、不拒 UNC | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加assertLocalAbsolutePath和assertPathAllowed |
| P-09: 任务执行 shell:true 且未转义 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加白名单和元字符拒绝 |
| P-19: 2 个死通道 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已删除 |
| P-20: 设置项被主进程当"可信目标" | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加校验 |
| P-21: backups:restore 用 tar -xf 无路径穿越校验 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加路径校验 |
| P-22: 分页 Link 头未固定同源 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加同源校验 |
| P-23: 权限策略与 webviewTag 依赖默认值 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加setPermissionRequestHandler |
| P-25: 底层错误 message 直接透传到 UI | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加toIpcError |
| P-27: openers.ts 启动失败被静默吞掉 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已添加错误上抛 |

**验收信号**:
- [x] 单测：`parseOrThrow` 对超长字符串抛错
- [x] 单测：`ipc-coverage.test.ts` 断言每条 `ipcMain.handle` 函数体内出现 `parseOrThrow`
- [x] 单测：`assertLocalAbsolutePath("\\\\evil\\share")` 抛错
- [x] 单测：`runTask` 对 `"calc"` 抛"不允许"
- [x] 78/78 handler 有 schema 或白名单
- [x] `requireString` 在 `ipc.ts` 归零

**关键文件**:
- `electron/main/ipc/schemas.ts`（已存在）
- `electron/main/ipc/coverage.test.ts`（已存在）
- `electron/main/services/pathPolicy.ts`（已存在）
- `electron/main/services/tasks.ts`（已更新）
- `electron/main/services/backups.ts`（已存在）
- `electron/main/services/providers.ts`（已存在）
- `electron/main/index.ts`（已更新）
- `vite.config.ts`（已更新）

---

## 第 2 批：架构治理（8~10 人日）

### 2A. 传输层抽象（2 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-10: 传输层未抽象 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已建 Repository/Gateway 接口 + desktop/web 双实现 + workspaceRules 纯函数 |

**验收信号**:
- [x] Repository 接口已定义（`shared/repository.ts`）
- [x] `DesktopProjectRepository` 正确调用 bridge（`src/lib/repositories/desktop.ts`）
- [x] `WebProjectRepository` 正确使用 localStorage（`src/lib/repositories/web.ts`）
- [x] 工作区规则统一到 `shared/workspaceRules.ts`（纯函数双端共用）
- [x] `window.prompt` 分支已从 Repository 层移除（web 实现的 selectDirectory 返回 null）
- [ ] hook 迁移到 Repository 注入（2A 第二步：useProjects/useWorkspaces 改造，随下批迭代）

**关键文件**:
- `shared/repository.ts`（新增：ProjectRepository/WorkspaceRepository/ShellGateway 接口）
- `shared/workspaceRules.ts`（新增：assertCanDeleteWorkspace/assertWorkspaceName/assertWorkspaceEmpty/resolveActiveWorkspace）
- `shared/workspaceRulesConstants.ts`（新增：DEFAULT_WORKSPACE_ID）
- `src/lib/repositories/index.ts`（新增：createRepositories 组合根）
- `src/lib/repositories/desktop.ts`（新增：桌面实现，全部转发 bridge）
- `src/lib/repositories/web.ts`（新增：web 实现，localStorage 适配）

---

### 2B. IPC 编排下沉（1 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-11: IPC 适配层承载领域编排 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 此前已修复：services/operations.ts 已下沉编排，反查改 findByPath 单条索引查询 |

**验收信号**:
- [x] `services/operations.ts` 已存在并承载 recordGitOperation/recordClone/recordCommit
- [x] `resolveProjectIdByPath` 使用 `findByPath` 单条索引查询（消除 N+1 全表读）
- [x] `insertTaskRun` 已移入 `services/tasks.ts`（A-22：先落库再 spawn）
- [x] ipc.ts 的 handler 只做「校验入参 → 调服务 → 返回」

**关键文件**:
- `services/operations.ts`（已存在）
- `electron/main/ipc.ts`
- `services/tasks.ts`

---

### 2C. git.ts 拆分（3 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-13: git.ts 991 行 / 38 个顶层函数 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 此前已修复：git.ts 已按子域拆为 13 个文件 |

**验收信号**:
- [x] `git.ts` 已拆分为 `services/git/{binary,branch,clone,compare,core,disk,history,index,operation,repo,status,tags}.ts`
- [x] `services/git/status.test.ts` 已存在
- [x] `git/index.ts` 重导出保持 `ipc.ts` import 不变

**关键文件**:
- `services/git/*.ts`（12 个子域文件 + index 重导出）
- `services/git/status.test.ts`

---

### 2D. 类型与契约治理（2~4 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-14: shared/types.ts 已成上帝类型文件 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已创建 shared/channels.ts 常量表（satisfies 编译期完整性检查） |
| P-15: App.tsx 634 行 13 项职责 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 已抽 useBootstrap 统一 desktop/web 双分支 |
| P-16: Git 面板没有单一状态源 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | useGitPanel 重写为 useReducer 单一 store + useGitPanelActions |
| P-28: 表所有权破防 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 此前已修复：accounts 经 deleteByAccount owner API |
| P-34: database.ts 混合三类职责 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 此前已修复：storage 分域拆分，域模块单向依赖 database.ts |

**验收信号**:
- [x] `shared/channels.ts` 常量表存在，`satisfies Record<keyof DesktopBridge, string>` 编译期完整性检查通过
- [x] `useBootstrap` 已抽出（`src/hooks/useBootstrap.ts`），统一双分支 + resolveActiveWorkspace 单点规则
- [x] `useGitPanel` 单一 store（activeTab/busy/output/snapshot/reloadToken 全部收敛）
- [x] `useGitPanelActions` 收拢 Git 域 19 处桥直调
- [x] typecheck 通过（tsc -b + tsc -p tsconfig.electron.json）
- [x] 全部 525 个测试通过（54 文件）
- [ ] hooks 迁移到 Repository 注入 + channels 常量表接入 preload/ipc（随第 3 批迭代推进）

**关键文件**:
- `shared/channels.ts`（新增：INVOKE_CHANNELS/EVENT_CHANNELS/ALL_CHANNELS 常量表）
- `src/hooks/useBootstrap.ts`（新增：loadDesktopBootstrap/loadWebBootstrap/useBootstrap）
- `src/hooks/useGitPanel.ts`（重写：useReducer 单一 store + useGitPanelActions）
- `electron/main/ipc/coverage.test.ts`（更新：handler 基线 77→78，登记 system:resolveTargetPath）
- `electron/main/ipc/bridgeParity.test.ts`（更新：handler 基线 77→78）

**验收信号**:
- [ ] `shared/types.ts` 已拆为 7 个子文件
- [ ] `shared/channels.ts` 常量表存在
- [ ] 单测：`Object.keys(bridge)` 与 `ipcMain` 注册表双向差集为空
- [ ] `App.tsx` 行数 <400
- [ ] 单测：`useBootstrap` 正确工作
- [ ] 单测：`useSettings` 单一 store 正确工作

**关键文件**:
- `shared/types/*.ts`（新增）
- `shared/channels.ts`（新增）
- `src/hooks/useBootstrap.ts`（新增）
- `src/components/setup/*`（新增）
- `services/storage/remoteRepositoryCache.ts`
- `services/storage/projects.ts`
- `services/storage/database/*`（新增）
- `electron/main/ipc/*`（新增）

---

## 第 3 批：测试与工程化（6~8 人日）

### 3A. 测试补齐（3 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-12: 任务运行持久化被切在三处 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 此前已修复（A-22）：insertTaskRun 移入 tasks.ts，先落库再 spawn |
| P-18: 测试分层与实现分层错位 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | src/lib 已有 10 个测试文件全绿；isConflictStatus 新增 4 条单测 |

**验收信号**:
- [x] `src/lib/{projects,workspaces,uiPrefs,bridge}.test.ts` 全部存在且通过
- [x] `services/git` 子模块测试通过（status.test.ts 等）
- [x] 新增 isConflictStatus 直接单测（4 条，覆盖裸码/整行/非冲突/空串）
- [x] 覆盖率门槛通过（整体 97.6%，gitParsing 95%+）
- [x] typecheck 通过 + 529 个测试全绿（54 文件）
- [ ] 组件层 `@testing-library/react` 扩展（下一里程碑：从纯展示件起步）

**关键文件**:
- `electron/main/services/gitParsing.test.ts`（新增 isConflictStatus describe）
- `src/lib/*.test.ts`（10 个已有测试文件）

---

### 3B. 工程化配置（2 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-20: 设置项被主进程当"可信目标" | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 1D 已做 |
| P-24: 一键安装 Git 无哈希校验 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | verifyInstallerDigest + randomUUID 文件名，fail-closed |
| P-26: 打包与供应链配置 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | asarUnpack 收窄 + CI 加 npm audit |
| P-33: 主→渲染推送有三条实现路径 | ⚠ 部分完成 | — | 2026-11-22 | — | — | 事件通道已统一走 notifyRenderer；单例 reset*ForTest 留待下批 |

**验收信号**:
- [x] `asarUnpack` 收窄到 `**/@napi-rs/keyring/**`
- [x] CI 有 `npm audit --audit-level=high`（high 以上红灯，中低危仅暴露）
- [x] `setup.ts` 下载后校验 GitHub Release `digest`（sha256 流式计算）
- [x] digest 缺失/不匹配时删包拒装（fail-closed，防 TOCTOU 本地提权）
- [x] 下载文件名改 `crypto.randomUUID()`（防可预测名抢注）
- [ ] CI tag 触发签名打包 + 产物归档（依赖代码签名证书，待外部流程）

**关键文件**:
- `electron-builder.yml`（asarUnpack 收窄）
- `.github/workflows/ci.yml`（新增依赖漏洞扫描门禁）
- `electron/main/services/setup.ts`（verifyInstallerDigest/parseSha256Digest）

---

### 3C. 类型安全收口（1~3 人日）

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-29: 联合类型三处各写一遍 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | shared/constants.ts 单一来源，types/schemas 派生 |
| P-30: "冲突"判定两处独立实现 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | 4 条 | isConflictStatus 单点 + 4 条直接单测 |
| P-32: 应用设置两份运行时状态 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | 1C 已做（useSettings 单一 store） |
| P-35: 类型安全收口点靠断言 | ✅ 已完成 | — | 2026-11-22 | 2026-11-22 | — | electron 侧开 noUncheckedIndexedAccess，39 处显式收窄 |

**验收信号**:
- [x] 单测：`isConflictStatus` 正确判断（裸码/整行/非冲突/空串 4 组）
- [x] tsconfig.electron.json 开 `noUncheckedIndexedAccess`（主进程先行）
- [x] 39 处索引访问显式收窄（判空/兜底/非空断言，均附 why 注释）
- [x] `shared/constants.ts` 单一来源：REMOTE_PROVIDERS/PROJECT_PROVIDERS/SEARCHABLE_PROVIDERS
- [x] `RemoteProvider`/`Project.provider` 类型从常量派生；schemas.ts 三处 z.enum 全部改用常量
- [ ] tsconfig.app.json（渲染层）开 noUncheckedIndexedAccess（下一里程碑）
- [ ] `rowToX` 运行时断言（17 处 `as unknown as` 归零，下一里程碑）

**关键文件**:
- `shared/constants.ts`（新增：运行时常量单一来源）
- `shared/types.ts`（RemoteProvider/Project.provider 改为派生）
- `electron/main/ipc/schemas.ts`（三处 z.enum 改用常量）
- `electron/main/services/gitParsing.ts`（isConflictStatus 单点）
- `electron/main/services/git/status.ts`（快照冲突判定改调单点）
- `tsconfig.electron.json`（开 noUncheckedIndexedAccess）
- 9 个源码/测试文件（39 处 P-35 索引访问收窄）

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 | 状态 |
|------|------|----------|------|
| 证书获取流程延迟 | 1A 无法完成 | 先做摘要校验，证书后补 | 待确认 |
| 浏览器预览是否仍是产品目标 | 2A 设计决策 | 先确认，再做 2A | 待确认 |
| Git 行为对参数顺序敏感 | 2C 拆分 | 先补命令拼装测试，再拆 | — |
| 单人项目资源有限 | 整体进度 | 优先做 1A、1B、1C | — |

---

## 变更记录

| 日期 | 变更 | 备注 |
|------|------|------|
| 2026-11-22 | 创建整改跟踪表 | 初始版本 |
| 2026-11-22 | 第 1 批完成（18 条） | 止漏与立边界：更新链 RCE、凭据外泄、渲染层 5 hook、pathPolicy |
| 2026-11-22 | 第 2 批完成（8 条） | 架构治理：Repository 抽象、channels 常量表、useBootstrap、useGitPanel |
| 2026-11-22 | 第 3 批完成（9+1 部分） | 测试与工程化：isConflictStatus、constants、setup digest、npm audit、noUncheckedIndexedAccess |
| 2026-11-22 | 三批全部收官 | typecheck 通过 + 529 测试全绿 + 覆盖率门槛 97.6% 达标 |

---

## 遗留项（下一里程碑，非阻塞）

1. **CI 签名打包 + 产物归档**——依赖代码签名证书获取（P-03/P-26 尾项，外部流程）

~~2. **tsconfig.app.json 开 noUncheckedIndexedAccess**——渲染层索引访问收窄（P-35 第二阶段）~~ ✅ 已完成（32 处修复）
~~3. **`rowToX` 运行时断言**——storage 层 `as unknown as` 归零（P-35 第三阶段）~~ ✅ 已完成（asSqlRow + assertText/IntegerColumn 列级断言，源码 20+ 处替换）
~~4. **组件层 `@testing-library/react` 测试**——从 common.tsx 等纯展示件起步（P-18 第二阶段）~~ ✅ 已完成（common.test.tsx 11 条用例）
~~5. **hooks 迁移到 Repository 注入**——useProjects/useWorkspaces 改造（P-10 第二阶段）~~ ✅ 已完成（注入 + createRepositories 单例缓存）
~~6. **channels 常量表接入 preload/ipc**——两侧字符串替换为 INVOKE_CHANNELS 引用（P-14 第二阶段）~~ ✅ 已完成（preload 78 处 + ipc 71 处替换，coverage 解析兼容常量形式）
~~7. **P-33 单例状态 `reset*ForTest()`**——模块级可变状态补测试隔离入口~~ ✅ 已完成（gitBusyRef/diskSizeCache/runningTasks/cachedDownloadUrl/sessionDirectories 共 6 个 reset 函数）

### 遗留项完成情况（2026-11-22 第二批收尾）

- typecheck 全绿（主进程 + 渲染层双 noUncheckedIndexedAccess）
- 536 个测试全绿（54 文件，含 11 条新增组件测试）
- 生产构建通过
- 唯一剩余外部依赖：代码签名证书（P-03/P-26 的 CI 签名打包）

---

## 下一步

1. **确认第 1 批 1A 的证书获取流程**（需决策：是否立即申请代码签名证书）
2. **确认浏览器预览是否仍是产品目标**（需决策：影响 2A 设计）
3. **开始第 1 批 1A 整改**（P-03, P-04）
4. **开始第 1 批 1B 整改**（P-05, P-06）
