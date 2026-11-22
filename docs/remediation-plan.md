# Gitool 整改总体规划

**创建日期**: 2026-11-22  
**项目版本**: v0.11.1  
**目标**: 在 24~32 人日内完成 35 条问题整改，建立可执行的分层架构与质量护栏

---

## 一、整改目标与原则

### 1.1 总体目标

| 维度 | 当前状态 | 目标状态 | 关键指标 |
|------|----------|----------|----------|
| **架构分层** | 约定俗成，无机制 | 可执行的分层架构 | 组件层 `bridge.*` 调用 53 → ≤10；ESLint 禁入规则生效 |
| **安全性** | 基线扎实、链路失守 | 全链路安全 | 更新链有签名校验；凭据不外泄；IPC 100% schema 校验 |
| **工程化** | 门槛与风险区错位 | 测试与风险区对齐 | 服务层 0% → ≥60%；组件层 0% → ≥30% |
| **可维护性** | 3 个超 500 行单文件 | 单文件 ≤250 行 | `git.ts` 991 行拆为 7 个子模块 |

### 1.2 整改原则

1. **先止漏、后治理、再优化** —— 先做"不触碰模块边界、成本 S、独立可验证"的止漏项
2. **每批次有可机器判定的收敛信号** —— 不依赖人工判断，用测试/lint/统计数字验证
3. **不推翻上一批的改动** —— 批次间依赖关系明确，后续批次在前者基础上迭代
4. **单人项目语境** —— 成本按"单人返工风险"估算，不按协调成本

---

## 二、批次划分（24~32 人日）

### 2.1 批次总览

| 批次 | 主题 | 覆盖问题 | 人日 | 收敛信号（批次级） |
|------|------|----------|------|-------------------|
| **第 1 批** | 止漏与立边界 | P-01~P-09, P-17, P-19~P-23, P-25, P-27, P-31 | 10~14 | ① `spawn("cmd"` 计数 = 0；② `redactSecrets` 单测绿；③ `bridge.*` 在 `src/components` 53 → ≤34 |
| **第 2 批** | 架构治理 | P-10, P-11, P-13~P-16, P-28, P-34 | 8~10 | ① `git.ts` 无单文件 >250 行；② `ipc.ts` 行数 <200；③ 新增 `useSettings`/`useGitPanel` 单一 store |
| **第 3 批** | 测试与工程化 | P-12, P-18, P-20, P-24, P-26, P-29, P-30, P-32, P-33, P-35 | 6~8 | ① 服务层进入覆盖率白名单；② CI 加 `npm audit`/签名；③ 组件层引入 `@testing-library/react` |

### 2.2 批次依赖关系

```
第 1 批（止漏）
  ├── 1A: 更新链 RCE 修复（P-03, P-04）
  ├── 1B: 凭据外泄修复（P-05, P-06）
  ├── 1C: 渲染层立边界（P-01, P-02, P-17, P-31）
  └── 1D: 其他安全修复（P-07, P-08, P-09, P-19~P-23, P-25, P-27）
       ↓
第 2 批（架构治理）
  ├── 2A: 传输层抽象（P-10）
  ├── 2B: IPC 编排下沉（P-11）
  ├── 2C: git.ts 拆分（P-13）
  └── 2D: 类型与契约治理（P-14, P-15, P-16, P-28, P-34）
       ↓
第 3 批（测试与工程化）
  ├── 3A: 测试补齐（P-12, P-18）
  ├── 3B: 工程化配置（P-20, P-24, P-26, P-33）
  └── 3C: 类型安全收口（P-29, P-30, P-32, P-35）
```

---

## 三、第 1 批详细规划：止漏与立边界（10~14 人日）

### 3.1 批次目标

- 消除**唯一"无需攻破渲染层"即可 RCE 的路径**（更新链）
- 止血**凭据外泄通道**（URL/日志/CSV）
- 建立**渲染层数据访问边界**的雏形（实体工厂 + Git 域 hook）
- 修复**其他 P1 级安全问题**（IPC 校验、路径白名单、任务执行）

### 3.2 子批次划分

| 子批次 | 人日 | 覆盖问题 | 依赖 | 风险 |
|--------|------|----------|------|------|
| **1A** | 1.5 | P-03, P-04 | 无 | 中（证书流程需外部） |
| **1B** | 1.5 | P-05, P-06 | 无 | 低（纯函数 + 单测） |
| **1C** | 4 | P-01, P-02, P-17, P-31 | 1B 完成 | 中（迁移期需核对） |
| **1D** | 3~7 | P-07, P-08, P-09, P-19~P-23, P-25, P-27 | 1A, 1B | 中（12+ handler 接入） |

### 3.3 1A: 更新链 RCE 修复（1.5 人日）

#### 3.3.1 问题 P-03: 更新链无哈希/签名校验

**当前状态**:
- `updater.ts:11-13` 分发权在第三方个人 GitHub 账号 `sgobiorodolfo170-ai`
- `updater.ts:56-62` 丢弃 GitHub 返回的 `digest` 字段
- `electron-builder.yml` 无 `certificateFile`/`forceCodeSigning`

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `sha256File` 工具函数 | `services/updater.ts` | 新增 | 单测通过 |
| 2 | 在 `checkForUpdates` 中保存 `expectedDigest` | `services/updater.ts` | ~56-62 | 缓存 digest 与下载 URL |
| 3 | 在 `downloadUpdate` 末尾校验文件摘要 | `services/updater.ts` | ~100-120 | 不符即删包抛错 |
| 4 | 执行前 Authenticode 校验 | `services/updater.ts` | ~140-150 | PowerShell 校验签名主体 |
| 5 | 配置 `electron-builder.yml` 签名 | `electron-builder.yml` | 25-39 | 加 `forceCodeSigning` 等 |
| 6 | 更新源迁到组织账号（需决策） | `updater.ts:11` | 11-13 | 或确认当前账号安全 |

**关键代码**:

```ts
// services/updater.ts 新增
import { createHash } from "node:crypto";
import { createReadStream, rm } from "node:fs";

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return `sha256:${hash.digest("hex")}`;
}

// downloadUpdate() 末尾
if (!expectedDigest || (await sha256File(filePath)) !== expectedDigest) {
  rm(filePath, { force: true });
  throw new Error("更新包校验失败，已丢弃，请稍后重试");
}
```

**单测要求**:
- `updater.test.ts` 新增：`installUpdate("...\\x&calc.exe")` 抛"不受信任"
- 单测：`sha256File` 对已知文件返回正确摘要
- 单测：摘要不符时删包抛错

**成本**: S（摘要校验）+ M（证书流程）  
**风险**: 中（证书获取与 CI 接入为主要工作量）

#### 3.3.2 问题 P-04: `updater:install` 命令注入

**当前状态**:
- `updater.ts:144-148` 用 `spawn("cmd", ["/c","start",...])` 拼接路径
- `isTrustedInstallerPath` 只判前缀 + `.exe`，不校验存在、不排除元字符

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 移除 `cmd /c start`，改直接 `spawn(exe, ["/S"])` | `services/updater.ts` | 144-148 | 无 `cmd` 字符串 |
| 2 | 加 `existsSync` 校验文件存在 | `services/updater.ts` | 144-148 | 不存在即抛错 |
| 3 | 文件名正则白名单 `/^gitool-setup-[\\d.]+\\.exe$/` | `services/updater.ts` | ~30-35 | 不匹配即拒 |
| 4 | `error` 事件不静默 | `services/updater.ts` | 144-148 | 日志记录 |

**关键代码**:

```ts
export function installUpdate(installerPath: string): void {
  if (!isTrustedInstallerPath(installerPath) || !existsSync(installerPath)) {
    throw new Error("安装包路径不受信任，已拒绝执行");
  }
  const child = spawn(installerPath, ["/S"], { detached: true, stdio: "ignore", shell: false });
  child.on("error", (err) => { logError("update", err); });
  child.unref();
  app.quit();
}
```

**单测要求**:
- 单测：`installUpdate("...\\x&calc.exe")` 抛"不受信任"
- 单测：`installUpdate("...不存在.exe")` 抛"不存在"
- 单测：`installUpdate("...合法路径.exe")` 成功 spawn

**成本**: S  
**风险**: 低（无行为变更，仅收紧校验）

---

### 3.4 1B: 凭据外泄修复（1.5 人日）

#### 3.4.1 问题 P-05: 凭据经 URL/日志/CSV 泄露

**当前状态**:
- `git.ts:185-198` `setRemoteUrl` 放行 `https://user:token@host`
- `git.ts:672-688` 克隆进度回显完整 URL
- `ipc.ts:442-463` 操作日志未脱敏落库
- `operationCsv.ts:17-36` 导出未脱敏

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `assertNoCredentialInUrl` 工具 | `services/serviceUtils.ts` | 新增 | 单测通过 |
| 2 | 新增 `redactSecrets` 工具 | `services/serviceUtils.ts` | 新增 | 单测通过 |
| 3 | `setRemoteUrl` 入口加 `assertNoCredentialInUrl` | `services/git.ts` | 185-198 | 内嵌凭据 URL 被拒 |
| 4 | `assertCloneUrl` 入口加 `assertNoCredentialInUrl` | `services/git.ts` | 715 | 同上 |
| 5 | `recordOperation` 前 `redactSecrets(detail)` | `electron/main/ipc.ts` | 442-463 | 落库已脱敏 |
| 6 | `emitProgress` 的 output 过 `redactSecrets` | `services/git.ts` | 672-688 | 输出已脱敏 |
| 7 | `buildOperationRecordsCsv` 对 detail 再兜底 | `services/operationCsv.ts` | 17-36 | 导出已脱敏 |
| 8 | 备份默认排除 `.git/config` | `services/backups.ts` | 41-42 | 加 `--exclude=.git/config` |

**关键代码**:

```ts
// services/serviceUtils.ts 新增
const USERINFO_IN_URL = /\/\/[^/@\s]+:[^/@\s]+@/;
const REDACT = /(\/\/)[^/@\s]+:[^/@\s]+@/g;

export function assertNoCredentialInUrl(url: string): void {
  if (USERINFO_IN_URL.test(url)) {
    throw new Error("地址中不能包含用户名或令牌，请通过「账号与令牌」保存凭据");
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(REDACT, "$1***@")
    .replace(/\b(ghp_[A-Za-z0-9]{20,})/g, "***")
    .replace(/\b(glpat-[A-Za-z0-9_-]{16,})/g, "***");
}
```

**单测要求**:
- 单测：`assertNoCredentialInUrl("https://u:tok@h/x")` 抛错
- 单测：`redactSecrets("https://u:tok@h/x")` → `https://***@h/x`
- 单测：`redactSecrets("ghp_abc123...")` → `***`
- e2e：用内嵌错误令牌的 URL 克隆失败后，检查 `operation_records.detail` 无明文

**成本**: S  
**风险**: 低（纯函数 + 单测保护）

#### 3.4.2 问题 P-06: 克隆时把可执行 shell 写进 `.git/config`

**当前状态**:
- `git.ts:634-643` 用 `git clone -c credential.helper='!f(){...}'` 把 shell 片段写进目标仓库

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 删除 `args.push("--config", ...)` | `services/git.ts` | 634-643 | 无 `--config` 参数 |
| 2 | 用 `GIT_CONFIG_COUNT/KEY_0/VALUE_0` 环境变量注入 | `services/git.ts` | 634-643 | 子进程 env 含配置 |
| 3 | 克隆后 `config --unset-all` 兜底（可选） | `services/git.ts` | 新增 | 双保险 |

**关键代码**:

```ts
// git.ts:634-643 改写
const child = spawn(getActiveGitBinary(), args, {
  cwd: dirname(targetPath),
  windowsHide: true,
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    ...(token ? {
      GITOOL_ASKPASS_TOKEN: token,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: '!f() { echo username=x-access-token; echo password="$GITOOL_ASKPASS_TOKEN"; }; f',
    } : {}),
  },
});
```

**单测要求**:
- e2e：克隆后 `git -C <target> config --get credential.helper` 为空
- 单测：`GIT_CONFIG_COUNT` 环境变量正确设置

**成本**: S  
**风险**: 低（不落盘，更安全）

---

### 3.5 1C: 渲染层立边界（4 人日）

#### 3.5.1 问题 P-01: 渲染层没有数据访问边界

**当前状态**:
- 14 个组件文件 53 处 `bridge.*` 直调
- 6 个领域无 hook（tasks/backups/logs/settings/remote-search/detail 动作）

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `useTasks` hook | `src/hooks/useTasks.ts` | 新增 | 单测通过 |
| 2 | 新增 `useBackups` hook | `src/hooks/useBackups.ts` | 新增 | 单测通过 |
| 3 | 新增 `useLogs` hook | `src/hooks/useLogs.ts` | 新增 | 单测通过 |
| 4 | 新增 `useSettings` hook | `src/hooks/useSettings.ts` | 新增 | 单测通过 |
| 5 | 新增 `useGitPanel` hook | `src/hooks/useGitPanel.ts` | 新增 | 单测通过 |
| 6 | 迁移 `TasksWorkspace` 的 8 处直调用到 `useTasks` | `src/components/TasksWorkspace.tsx` | 36,55-56,79... | 无 `getDesktopBridge()` |
| 7 | 迁移 `BackupsWorkspace` 的 6 处直调用到 `useBackups` | `src/components/BackupsWorkspace.tsx` | 17,26,37... | 无 `getDesktopBridge()` |
| 8 | 迁移 `LogsWorkspace` 的 4 处直调用到 `useLogs` | `src/components/LogsWorkspace.tsx` | 23,45,54,56 | 无 `getDesktopBridge()` |
| 9 | 迁移 `SettingsWorkspace` 的 5 处直调用到 `useSettings` | `src/components/SettingsWorkspace.tsx` | 71,85-86... | 无 `getDesktopBridge()` |
| 10 | 迁移 Git 域 19 处直调用到 `useGitPanel` | `src/components/git/*` | 多处 | 无 `getDesktopBridge()` |
| 11 | 加 ESLint `no-restricted-imports` 规则 | `.eslintrc.js` 或类似 | 新增 | 组件层 import `lib/bridge` 报错 |

**关键代码（useGitPanel 范式）**:

```ts
// src/hooks/useGitPanel.ts
import { useReducer, useCallback } from "react";
import { getDesktopBridge } from "../lib/bridge";

interface GitPanelState {
  activeTab: string;
  busy: boolean;
  output: string | null;
  count: number;
  reloadToken: number;
}

type GitPanelAction =
  | { type: "SET_TAB"; tab: string }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_OUTPUT"; output: string | null }
  | { type: "RELOAD" };

function reducer(state: GitPanelState, action: GitPanelAction): GitPanelState {
  switch (action.type) {
    case "SET_TAB": return { ...state, activeTab: action.tab };
    case "SET_BUSY": return { ...state, busy: action.busy };
    case "SET_OUTPUT": return { ...state, output: action.output };
    case "RELOAD": return { ...state, reloadToken: state.reloadToken + 1 };
    default: return state;
  }
}

export function useGitPanel(projectPath: string) {
  const [state, dispatch] = useReducer(reducer, {
    activeTab: "changes",
    busy: false,
    output: null,
    count: 0,
    reloadToken: 0,
  });

  const runOperation = useCallback(async (op: string, ...args: unknown[]) => {
    dispatch({ type: "SET_BUSY", busy: true });
    try {
      const bridge = getDesktopBridge();
      const result = await bridge.runGitOperation(projectPath, op, ...args);
      dispatch({ type: "SET_OUTPUT", output: result });
      return result;
    } finally {
      dispatch({ type: "SET_BUSY", busy: false });
    }
  }, [projectPath]);

  return { ...state, runOperation, reload: () => dispatch({ type: "RELOAD" }) };
}
```

**ESLint 规则**:

```js
// .eslintrc.js
module.exports = {
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/lib/bridge'],
        message: '组件层禁止直接引用 bridge，请通过 hook 层访问',
      }],
    }],
  },
};
```

**单测要求**:
- 单测：`useTasks` 的 CRUD 操作正确调用 bridge
- 单测：`useGitPanel` 的 busy 状态机正确
- 单测：ESLint 规则对 `src/components/**` 生效
- 集成测试：`TasksWorkspace` 无 `getDesktopBridge()` 调用

**成本**: L  
**风险**: 中（迁移期需逐一核对错误提示文案与 loading 时序）

#### 3.5.2 问题 P-02: 实体构造逻辑在渲染层复制 6 处

**当前状态**:
- `Project`（20 字段）/ `TaskProfile`（10 字段）构造在 6 处独立实现
- 字段漂移被 `.catch()` 静默改写

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `createProject` 工厂 | `shared/entities.ts` | 新增 | 单测通过 |
| 2 | 新增 `createTaskProfile` 工厂 | `shared/entities.ts` | 新增 | 单测通过 |
| 3 | 新增 `workspaceRules` 纯函数 | `shared/workspaceRules.ts` | 新增 | 单测通过 |
| 4 | 替换 `useRemotes.ts` 的 3 处字面量 | `src/hooks/useRemotes.ts` | 173-191,245-263,315-333 | 用工厂 |
| 5 | 替换 `useImportFlow.ts` 的 3 处字面量 | `src/hooks/useImportFlow.ts` | 67-84,132-149,176-193 | 用工厂 |
| 6 | 替换 `TasksWorkspace.tsx` 的字面量 | `src/components/TasksWorkspace.tsx` | 160-171 | 用工厂 |
| 7 | 收窄 `projectSchema` 的 `.catch()` 为"仅派生展示字段" | `electron/main/ipc/schemas.ts` | 185-198 | 业务字段报错 |
| 8 | 加投影测试：工厂产物必须通过 schema | `shared/entities.test.ts` | 新增 | 全部 `safeParse.success` |

**关键代码**:

```ts
// shared/entities.ts
import { projectSchema, taskProfileSchema } from "../electron/main/ipc/schemas";

export function createProject(partial: Partial<Project> = {}): Project {
  const project: Project = {
    id: partial.id ?? `${partial.name ?? "project"}-${Date.now()}`,
    name: partial.name ?? "未命名项目",
    path: partial.path ?? "",
    provider: partial.provider ?? "local",
    remoteId: partial.remoteId ?? null,
    remoteUrl: partial.remoteUrl ?? null,
    defaultBranch: partial.defaultBranch ?? "main",
    lastActiveAt: partial.lastActiveAt ?? null,
    status: partial.status ?? "clean",
    color: partial.color ?? "#8b97a8",
    isFavorite: partial.isFavorite ?? false,
    isCloned: partial.isCloned ?? true,
    // ... 其他字段
  };
  const result = projectSchema.safeParse(project);
  if (!result.success) {
    throw new Error(`Project 构造失败: ${result.error.issues.map(i => i.message).join(", ")}`);
  }
  return result.data;
}
```

**单测要求**:
- 单测：`createProject` 对各种 partial 输入返回合法 Project
- 单测：`createTaskProfile` 对各种 partial 输入返回合法 TaskProfile
- 投影测试：工厂产物全部通过 schema（当前会因漏字段失败，正好捕获 6 处漂移）
- 单测：`workspaceRules.assertCanDelete` 正确判断

**成本**: M  
**风险**: 低（纯函数 + 单测保护）

#### 3.5.3 问题 P-17: AI 摘要的领域逻辑在展示组件中

**当前状态**:
- `OverviewPanel.tsx:92-168` 包含 4 路并发取数、prompt 拼装、AI 调用、降级策略
- magic number `slice(0,400)` 等硬编码

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 抽 `src/lib/aiContext.ts` 纯函数 | `src/lib/aiContext.ts` | 新增 | 单测通过 |
| 2 | 抽 `src/hooks/useAiSummary.ts` | `src/hooks/useAiSummary.ts` | 新增 | 单测通过 |
| 3 | 组件只留 `actionMessage` 展示与按钮 | `src/components/detail/OverviewPanel.tsx` | 92-168 | 无业务逻辑 |

**关键代码**:

```ts
// src/lib/aiContext.ts
export function buildSummaryContext(
  project: Project,
  readme: string | null,
  history: CommitHistory | null,
  analysis: Analysis | null,
  disk: DiskSize | null,
): string {
  const lines: string[] = [];
  lines.push(`项目: ${project.name}`);
  if (readme) lines.push(`README: ${readme.slice(0, 400)}`);
  if (history) lines.push(`最近提交: ${history.commits.slice(0, 5).map(c => c.message).join(", ")}`);
  if (analysis) lines.push(`语言分布: ${JSON.stringify(analysis.languages)}`);
  if (disk) lines.push(`大小: ${formatBytes(disk.total)}`);
  return lines.join("\n");
}
```

**单测要求**:
- 单测：`buildSummaryContext` 对各种输入返回正确上下文
- 单测：`useAiSummary` 的 AI→本地 降级编排正确

**成本**: S  
**风险**: 低（纯函数 + 单测）

#### 3.5.4 问题 P-31: 渲染层用硬编码反斜杠拼路径

**当前状态**:
- `useRemotes.ts:297` `` `${parentDirectory}\\${repository.name}` ``
- `useImportFlow.ts:115` `` `${directory}\\${projectName}` ``

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 让 `initRepository`/`cloneRepository` 接受 `parentDirectory` + `name` | `services/git.ts` | 163-170, 624-643 | 主进程 `join` |
| 2 | 渲染层只传语义入参，不构造路径 | `src/hooks/useRemotes.ts` | 297 | 无 `\` 拼接 |
| 3 | 主进程做合法性校验 | `services/git.ts` | 726-739 | 复用 `assertCloneTarget` |

**成本**: S  
**风险**: 低（复用 P-08 的 `pathPolicy`）

---

### 3.6 1D: 其他安全修复（3~7 人日）

#### 3.6.1 问题 P-07: IPC 入参校验覆盖不足

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 定义 `MAX_IPC_STRING = 4096` 基元 | `electron/main/ipc/schemas.ts` | 新增 | — |
| 2 | 定义 `localPath` schema | `electron/main/ipc/schemas.ts` | 新增 | 单测通过 |
| 3 | 补齐 30 个通道的 schema | `electron/main/ipc/schemas.ts` | 多处 | 30 个新 schema |
| 4 | handler 统一收敛用 `parseOrThrow` | `electron/main/ipc.ts` | 126-407 | 78/78 或白名单 |
| 5 | 加 `ipc-coverage.test.ts` 结构门禁 | `electron/main/ipc/coverage.test.ts` | 新增 | 单测通过 |
| 6 | 修正 README:124 的表述 | `README.md` | 124 | 与实际一致 |

**关键代码**:

```ts
// electron/main/ipc/schemas.ts
const MAX_IPC_STRING = 4096;

export const requiredString = (label: string) =>
  z.string()
    .refine((v) => v.trim().length > 0, { message: `${label}不能为空` })
    .refine((v) => v.length <= MAX_IPC_STRING, { message: `${label}过长` });

export const localPath = requiredString("路径").refine(
  (v) => isAbsolute(v) && !/^\\\\/.test(v),
  { message: "路径必须是本地绝对路径" }
);
```

**单测要求**:
- 单测：`parseOrThrow` 对超长字符串抛错
- 单测：`ipc-coverage.test.ts` 断言每条 `ipcMain.handle` 函数体内出现 `parseOrThrow`

**成本**: M  
**风险**: 中（12+ handler 接入）

#### 3.6.2 问题 P-08: 路径类通道无根目录白名单、不拒 UNC

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `assertLocalAbsolutePath` 工具 | `services/serviceUtils.ts` | 新增 | 单测通过 |
| 2 | 新增 `assertPathAllowed` 工具 | `services/pathPolicy.ts` | 新增 | 单测通过 |
| 3 | 接入 12+ handler | `electron/main/ipc.ts` | 155-194 等 | 全部用 `pathPolicy` |
| 4 | `system:selectDirectory` 返回值立即校验 | `electron/main/ipc.ts` | 134-146 | 不合法即拒 |

**关键代码**:

```ts
// services/pathPolicy.ts
const UNC_PREFIX = /^\\\\/;

export function assertLocalAbsolutePath(target: string, label = "路径"): string {
  if (UNC_PREFIX.test(target)) throw new Error(`${label}不支持网络共享路径`);
  if (!isAbsolute(target)) throw new Error(`${label}必须是绝对路径`);
  return target;
}

export function assertPathAllowed(target: string, roots: string[]): void {
  assertLocalAbsolutePath(target, "路径");
  const resolved = resolve(target).toLowerCase();
  const ok = roots.some((root) => {
    const base = resolve(root).toLowerCase().replace(/[\\/]+$/, "");
    return resolved === base || resolved.startsWith(base + sep);
  });
  if (!ok) throw new Error("路径不在允许的应用范围内");
}
```

**单测要求**:
- 单测：`assertLocalAbsolutePath("\\\\evil\\share")` 抛错
- 单测：`assertPathAllowed("C:\\Windows", ["C:\\Users"])` 抛错
- 单测：`assertPathAllowed("C:\\Users\\u\\project", ["C:\\Users\\u"])` 通过

**成本**: M  
**风险**: 中（12+ handler 接入，需考虑"未登记项目"的导入流程）

#### 3.6.3 问题 P-09: 任务执行 `shell:true` 且 `profile.command` 未转义

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 定义命令白名单 | `services/tasks.ts` | 新增 | — |
| 2 | 定义元字符拒绝正则 | `services/tasks.ts` | 新增 | — |
| 3 | `runTask` 加白名单校验 | `services/tasks.ts` | 32-43 | 非白名单抛错 |
| 4 | 加元字符拒绝 | `services/tasks.ts` | 32-43 | 含元字符抛错 |
| 5 | Windows 上解析 `npm.cmd` 绝对路径 | `services/tasks.ts` | 32-43 | `shell:false` |
| 6 | 首次执行外部命令确认弹窗 | `src/components/TasksWorkspace.tsx` | 新增 | 写审计 |

**关键代码**:

```ts
// services/tasks.ts
const ALLOWED_TASK_COMMANDS = new Set([
  "npm", "pnpm", "yarn", "cargo", "go", "mvn", "gradle", "dotnet", "docker", "python", "node", "py",
]);
const META = /[&|<>^()`]/;

export async function runTask(profileId: string): Promise<TaskRun> {
  const profile = getTaskProfile(profileId);
  if (!profile) throw new Error("任务配置不存在");
  if (!ALLOWED_TASK_COMMANDS.has(profile.command)) {
    throw new Error(`不允许执行该命令：${profile.command}`);
  }
  if (META.test(profile.command) || META.test(profile.args)) {
    throw new Error("命令中包含不允许的字符，请使用「添加参数」的方式传参");
  }
  // ...
}
```

**单测要求**:
- 单测：`runTask` 对 `"calc"` 抛"不允许"
- 单测：`runTask` 对 `"npm & calc"` 抛"不允许的字符"
- 单测：`runTask` 对 `"npm run build"` 通过

**成本**: M  
**风险**: 中（与 `commandDetection.ts` 耦合，需保证检测产物全部在白名单内）

#### 3.6.4 问题 P-19: 2 个死通道

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 删除 `tasks:updateRun` 通道 | `electron/main/ipc.ts` | 341-344 | 无此 handler |
| 2 | 删除 `operations:record` 通道 | `electron/main/ipc.ts` | 359-361 | 无此 handler |
| 3 | 删除对应的 schema | `electron/main/ipc/schemas.ts` | 128-141, 150-153 | 无此 schema |
| 4 | 加单测：桥接通道 ⊆ 白名单 | `electron/main/ipc/coverage.test.ts` | 新增 | 单测通过 |

**成本**: S  
**风险**: 低（纯删除）

#### 3.6.5 问题 P-20: 设置项被主进程当"可信目标"

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `gitPath` 只接受 `system:installGit` 或 `system:selectGitBinary` | `electron/main/ipc.ts` | 364-366 | 新 schema |
| 2 | 保存前 `existsSync + basename` 匹配 `/^git(\.exe)?$/i` | `services/settings.ts` | 40 | 非法回退 `"git"` |
| 3 | `aiBaseUrl` 校验 `https:` + 私网拒绝 | `services/ai.ts` | 10, 35-40 | 新 `validateBaseUrl` |
| 4 | `appSettingsSchema` 加 `.superRefine` | `electron/main/ipc/schemas.ts` | 57-67 | 非法值保存即失败 |

**成本**: S  
**风险**: 低

#### 3.6.6 问题 P-21: `backups:restore` 用 `tar -xf` 无路径穿越校验

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 归档必须位于备份目录内 | `services/backups.ts` | 67-86 | 复用 P-08 的 `pathPolicy` |
| 2 | 解包加 `--no-same-owner --no-same-permissions` | `services/backups.ts` | 67-86 | — |
| 3 | 解包后遍历目标目录，发现符号链接或逃逸即回滚 | `services/backups.ts` | 67-86 | 单测通过 |

**成本**: S  
**风险**: 中（需运行期验证 `../` 处理）

#### 3.6.7 问题 P-22: 分页 `Link` 头未固定同源

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `next` URL 必须同源 | `services/providers.ts` | 212-215 | 跨源忽略 |

**成本**: S  
**风险**: 低

#### 3.6.8 问题 P-23: 权限策略与 `webviewTag` 依赖默认值

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 加 `setPermissionRequestHandler` 全部拒绝 | `electron/main/index.ts` | 83-100 | — |
| 2 | 加 `setPermissionCheckHandler` 全部拒绝 | `electron/main/index.ts` | 83-100 | — |
| 3 | `webPreferences` 显式 `webviewTag: false` | `electron/main/index.ts` | 83-100 | — |
| 4 | CSP 加 `frame-src 'none'; frame-ancestors 'none'` | `vite.config.ts` | 21-34 | — |

**成本**: S  
**风险**: 低

#### 3.6.9 问题 P-25: 底层错误 message 直接透传到 UI

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `AppError { code, userMessage, detail }` | `electron/main/ipc/errors.ts` | 新增 | — |
| 2 | 新增 `toIpcError` 工具 | `electron/main/ipc/errors.ts` | 新增 | — |
| 3 | 对 `ipcMain.handle` 做统一 try/catch 包装 | `electron/main/ipc.ts` | 126-407 | 分批替换 |
| 4 | 对 `database.ts`、`providers.ts` 等加 `toIpcError` | 多处 | — | — |

**成本**: S（骨架）+ 分批替换  
**风险**: 低

#### 3.6.10 问题 P-27: `openers.ts` 启动失败被静默吞掉

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `spawnDetached` 返回 `Promise` | `services/openers.ts` | 39-50 | — |
| 2 | `error` 事件上抛 | `services/openers.ts` | 39-50 | — |
| 3 | Windows 用 `ComSpec` 或先解析 `code.cmd` 绝对路径 | `services/openers.ts` | 15-18 | — |

**成本**: S  
**风险**: 低

---

## 四、第 2 批详细规划：架构治理（8~10 人日）

### 4.1 批次目标

- 建立**传输层抽象**（Repository 接口 + 双实现）
- 将 **IPC 编排下沉到服务层**
- 拆分 **`git.ts` 为 7 个子模块**
- 治理**类型与契约**（拆 `shared/types.ts`、建 `shared/channels.ts`）

### 4.2 子批次划分

| 子批次 | 人日 | 覆盖问题 | 依赖 | 风险 |
|--------|------|----------|------|------|
| **2A** | 2 | P-10 | 1C 完成 | 中（需设计决策） |
| **2B** | 1 | P-11 | 1C 完成 | 低 |
| **2C** | 3 | P-13 | 1C 完成 | 中高（Git 行为敏感） |
| **2D** | 2~4 | P-14, P-15, P-16, P-28, P-34 | 2A, 2B, 2C | 中 |

### 4.3 2A: 传输层抽象（2 人日）

#### 4.3.1 问题 P-10: 传输层未抽象

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 定义 `ProjectRepository` 接口 | `shared/repository.ts` | 新增 | — |
| 2 | 定义 `WorkspaceRepository` 接口 | `shared/repository.ts` | 新增 | — |
| 3 | 定义 `ShellGateway` 接口 | `shared/gateway.ts` | 新增 | — |
| 4 | 实现 `DesktopProjectRepository` | `src/lib/repositories/desktop.ts` | 新增 | 单测通过 |
| 5 | 实现 `WebProjectRepository` | `src/lib/repositories/web.ts` | 新增 | 单测通过 |
| 6 | 在 `App` 启动时注入 | `src/App.tsx` | 35-39 | — |
| 7 | 删除 hook 内 `isDesktopRuntime()` 分叉 | 多个 hook | — | 无分叉 |
| 8 | 删除 `window.prompt` 分支 | `src/hooks/useImportFlow.ts` | 38-42 | — |

**成本**: M  
**风险**: 中（需设计决策：浏览器预览是否仍是产品目标）

### 4.4 2B: IPC 编排下沉（1 人日）

#### 4.4.1 问题 P-11: IPC 适配层承载领域编排

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `services/operations.ts` | `services/operations.ts` | 新增 | 单测通过 |
| 2 | 下沉 `recordOperation` | `services/operations.ts` | 新增 | — |
| 3 | 下沉 `resolveProjectIdByPath` | `services/operations.ts` | 新增 | 单条索引查询 |
| 4 | 下沉 `insertTaskRun` | `services/tasks.ts` | 116-122 | 与 `updateTaskRun` 同层 |
| 5 | `ipc.ts` 只留一行转发 | `electron/main/ipc.ts` | 417-477 | 行数 <200 |

**成本**: M  
**风险**: 低

### 4.5 2C: git.ts 拆分（3 人日）

#### 4.5.1 问题 P-13: git.ts 991 行 / 38 个顶层函数

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 拆 `services/git/binary.ts` | `services/git/binary.ts` | 新增 | 单测通过 |
| 2 | 拆 `services/git/repo.ts` | `services/git/repo.ts` | 新增 | 单测通过 |
| 3 | 拆 `services/git/status.ts` | `services/git/status.ts` | 新增 | 单测通过 |
| 4 | 拆 `services/git/history.ts` | `services/git/history.ts` | 新增 | 单测通过 |
| 5 | 拆 `services/git/branch.ts` | `services/git/branch.ts` | 新增 | 单测通过 |
| 6 | 拆 `services/git/clone.ts` | `services/git/clone.ts` | 新增 | 单测通过 |
| 7 | 拆 `services/git/disk.ts` | `services/git/disk.ts` | 新增 | 单测通过 |
| 8 | 建 `services/git/index.ts` 重导出 | `services/git/index.ts` | 新增 | `ipc.ts` import 不变 |
| 9 | 补命令拼装测试 | `services/git/clone.test.ts` | 新增 | 单测通过 |

**成本**: L  
**风险**: 中高（Git 行为对参数顺序极敏感，`gitParsing.test.ts` 已覆盖解析层，但命令拼装层需新增测试）

### 4.6 2D: 类型与契约治理（2~4 人日）

#### 4.6.1 问题 P-14: shared/types.ts 已成上帝类型文件

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 拆 `shared/types/project.ts` | `shared/types/project.ts` | 新增 | — |
| 2 | 拆 `shared/types/git.ts` | `shared/types/git.ts` | 新增 | — |
| 3 | 拆 `shared/types/account.ts` | `shared/types/account.ts` | 新增 | — |
| 4 | 拆 `shared/types/task.ts` | `shared/types/task.ts` | 新增 | — |
| 5 | 拆 `shared/types/backup.ts` | `shared/types/backup.ts` | 新增 | — |
| 6 | 拆 `shared/types/settings.ts` | `shared/types/settings.ts` | 新增 | — |
| 7 | 拆 `shared/types/ipc.ts` | `shared/types/ipc.ts` | 新增 | — |
| 8 | 建 `shared/types/index.ts` 重导出 | `shared/types/index.ts` | 新增 | — |
| 9 | 新增 `shared/channels.ts` 常量表 | `shared/channels.ts` | 新增 | 单测通过 |
| 10 | 统一 import 入口 | 多处 | — | 无双别名 |

**成本**: M  
**风险**: 低

#### 4.6.2 问题 P-15: App.tsx 634 行 13 项职责

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 抽 `useBootstrap()` 统一两分支 | `src/hooks/useBootstrap.ts` | 新增 | 单测通过 |
| 2 | 抽 `SetupModal` 到 `src/components/setup/*` | `src/components/setup/SetupModal.tsx` | 新增 | — |
| 3 | 路由改 `Record<AppView, ReactNode>` 映射表 | `src/App.tsx` | 430-486 | — |
| 4 | 首启是否选中首项交 `useProjects` 决策 | `src/hooks/useProjects.ts` | 97-99 | — |

**成本**: M  
**风险**: 中

#### 4.6.3 问题 P-16: Git 面板没有单一状态源

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 建 `useGitPanel` 单一 store | `src/hooks/useGitPanel.ts` | 1C 已做 | — |
| 2 | tab 只接 `projectPath` + 2-3 个回调 | `src/components/git/*` | — | — |
| 3 | 用 `reloadToken` 或 key 替代 ref 登记 | `src/components/GitActionsPanel.tsx` | 35,52-54 | — |

**成本**: M  
**风险**: 中（1C 已做，此为收尾）

#### 4.6.4 问题 P-28: 表所有权破防

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 新增 `remoteRepositoryCache.deleteByAccount` | `services/storage/remoteRepositoryCache.ts` | 156 | — |
| 2 | 新增 `projects.countByWorkspace` | `services/storage/projects.ts` | 76-84 | — |
| 3 | `accounts.ts` 改用 owner API | `services/storage/accounts.ts` | 156 | — |
| 4 | `workspaces.ts` 改用 owner API | `services/storage/workspaces.ts` | 76-84 | — |

**成本**: S  
**风险**: 低

#### 4.6.5 问题 P-34: database.ts 混合三类职责

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 拆 `database/connection.ts` | `services/storage/database/connection.ts` | 新增 | — |
| 2 | 拆 `database/schema.ts` | `services/storage/database/schema.ts` | 新增 | — |
| 3 | 拆 `database/migrations/*` | `services/storage/database/migrations/` | 新增 | — |
| 4 | 拆 `database/rows/*` | `services/storage/database/rows/` | 新增 | — |
| 5 | `ipc.ts` 按域拆 | `electron/main/ipc/*` | 新增 | — |

**成本**: M  
**风险**: 低

---

## 五、第 3 批详细规划：测试与工程化（6~8 人日）

### 5.1 批次目标

- **补齐测试**：服务层 0% → ≥60%，组件层 0% → ≥30%
- **工程化配置**：CI 加 `npm audit`/签名/产物归档
- **类型安全收口**：DB 行 `as unknown as` 归零，出参加校验

### 5.2 子批次划分

| 子批次 | 人日 | 覆盖问题 | 依赖 | 风险 |
|--------|------|----------|------|------|
| **3A** | 3 | P-12, P-18 | 2C 完成 | 中 |
| **3B** | 2 | P-20, P-24, P-26, P-33 | 1A 完成 | 中 |
| **3C** | 1~3 | P-29, P-30, P-32, P-35 | 2D 完成 | 中 |

### 5.3 3A: 测试补齐（3 人日）

#### 5.3.1 问题 P-12: 任务运行持久化被切在三处

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `runTask` 内部在 `runningTasks.set` 之前完成 insert | `services/tasks.ts` | 116-122 | — |
| 2 | 删除 `tasks:updateRun` 通道 | `electron/main/ipc.ts` | 341-344 | 1D 已做 |
| 3 | `persistRun` 失败改写 `failed` 或上抛 | `services/tasks.ts` | 119-121 | — |

**成本**: S  
**风险**: 低

#### 5.3.2 问题 P-18: 测试分层与实现分层错位

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 先补 `src/lib/{projects,workspaces,uiPrefs}.ts` 测试 | `src/lib/*.test.ts` | 新增 | 单测通过 |
| 2 | 补 `src/lib/bridge.ts` 测试 | `src/lib/bridge.test.ts` | 新增 | 单测通过 |
| 3 | 随 2C 拆分把 `services/git/*` 纳入白名单 | `vitest.config.ts` | 22-43 | — |
| 4 | 组件层引入 `@testing-library/react` | `src/components/*.test.tsx` | 新增 | 单测通过 |
| 5 | 从 `common.tsx`、`TaskProfilesList` 等纯展示件起步 | — | — | — |

**成本**: L（分段：S → M → L）  
**风险**: 中

### 5.4 3B: 工程化配置（2 人日）

#### 5.4.1 问题 P-20: 设置项被主进程当"可信目标"

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `gitPath` 只接受 `system:installGit` 或 `system:selectGitBinary` | `electron/main/ipc.ts` | 364-366 | 1D 已做 |
| 2 | `aiBaseUrl` 校验 `https:` + 私网拒绝 | `services/ai.ts` | 10, 35-40 | 1D 已做 |

**成本**: S  
**风险**: 低

#### 5.4.2 问题 P-24: 一键安装 Git 无哈希校验

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 下载后校验 `sha256` 与 Release `digest` | `services/setup.ts` | 64-110 | 复用 1A 的 `sha256File` |
| 2 | 落盘到 `userData/tmp` 并建 ACL 受限子目录 | `services/setup.ts` | 64-110 | — |
| 3 | 执行前 `Get-AuthenticodeSignature` 校验发行者 | `services/setup.ts` | 116-137 | — |
| 4 | 文件名改 `crypto.randomUUID()` | `services/setup.ts` | 64-110 | — |

**成本**: M  
**风险**: 中

#### 5.4.3 问题 P-26: 打包与供应链配置

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `asarUnpack` 收窄到 `**/@napi-rs/keyring/**` | `electron-builder.yml` | 18-23 | — |
| 2 | CI 加 `npm audit --audit-level=high` | `.github/workflows/ci.yml` | 21-33 | — |
| 3 | CI 加 tag 触发签名打包 | `.github/workflows/ci.yml` | 21-33 | — |
| 4 | CI 加产物归档 | `.github/workflows/ci.yml` | 21-33 | — |
| 5 | `package.json` 加 `overrides` | `package.json` | 23-45 | — |

**成本**: M  
**风险**: 中

#### 5.4.4 问题 P-33: 主→渲染推送有三条实现路径

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 事件统一走 `services/events.ts` | `services/events.ts` | 3-8 | — |
| 2 | `cachedDownloadUrl` 收进 `updater.ts` 的"一次更新会话"对象 | `services/updater.ts` | 121-124 | — |
| 3 | 为模块级状态补 `reset*ForTest()` | 多处 | — | — |

**成本**: M  
**风险**: 低

### 5.5 3C: 类型安全收口（1~3 人日）

#### 5.5.1 问题 P-29: 同一联合类型/对象形状在契约、校验、渲染三处各写一遍

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `Project.provider` 改 `RemoteProvider \| "local"` | `shared/types.ts` | 64, 108 | — |
| 2 | 新增 `shared/constants.ts` 导出 `REMOTE_PROVIDERS` | `shared/constants.ts` | 新增 | — |
| 3 | 类型与 `z.enum` 均从常量派生 | `shared/types.ts`, `ipc/schemas.ts` | — | — |
| 4 | 组件/hook 直接引用 `RemoteRepositoryWriteInput` | 多处 | — | — |

**成本**: M  
**风险**: 低

#### 5.5.2 问题 P-30: "冲突"判定在两处独立实现

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | `gitParsing.ts` 增 `isConflictStatus(status)` | `services/gitParsing.ts` | 36-53 | — |
| 2 | `git.ts:335-339` 改为调用 | `services/git.ts` | 335-339 | — |
| 3 | 共用 `"AA"/"DD"/"U"` 常量 | `shared/constants.ts` | 新增 | — |

**成本**: S  
**风险**: 低

#### 5.5.3 问题 P-32: 应用设置有两份运行时状态

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 设置纳入 `useSettings()` 单一 store | `src/hooks/useSettings.ts` | 1C 已做 | — |
| 2 | `INITIAL_SETTINGS` 从 `shared` 导出默认值 | `shared/defaults.ts` | 新增 | — |

**成本**: S  
**风险**: 低

#### 5.5.4 问题 P-35: 类型安全两个收口点都靠断言

**整改步骤**:

| 步骤 | 具体动作 | 文件 | 行号 | 验收标准 |
|------|----------|------|------|----------|
| 1 | 为 `rowToX` 加运行时断言/轻量 zod | `services/storage/*` | 17 处 | 单测通过 |
| 2 | 高频返回值在 preload 加轻量校验 | `electron/preload/index.ts` | 41-43 | — |
| 3 | `lib/projects.ts:14` 用 schema 校验 | `src/lib/projects.ts` | 14 | — |
| 4 | tsconfig 分步开严格开关 | `tsconfig.app.json`, `tsconfig.electron.json` | 5-20, 4-12 | — |

**成本**: M  
**风险**: 中（10-30 处编译错误，补 `?? 默认值`/改显式判断）

---

## 六、整改跟踪与验收

### 6.1 整改跟踪文档

**文件**: `docs/remediation-tracker.md`

**格式**:

```markdown
# 整改跟踪表

## 第 1 批：止漏与立边界

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-03 | 待开始 | — | — | — | — | — |
| P-04 | 待开始 | — | — | — | — | — |
| ... | ... | ... | ... | ... | ... | ... |

## 第 2 批：架构治理

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-10 | 待开始 | — | — | — | — | — |
| ... | ... | ... | ... | ... | ... | ... |

## 第 3 批：测试与工程化

| 问题 | 状态 | 负责人 | 开始日期 | 完成日期 | 验收单测 | 备注 |
|------|------|--------|----------|----------|----------|------|
| P-12 | 待开始 | — | — | — | — | — |
| ... | ... | ... | ... | ... | ... | ... |
```

### 6.2 验收标准（可机器判定）

| 批次 | 验收信号 | 判定方式 |
|------|----------|----------|
| 第 1 批 | `spawn("cmd"` 计数 = 0 | `grep -c 'spawn.*cmd' electron/main/services/*.ts` |
| 第 1 批 | `redactSecrets` 单测绿 | `npm run test -- redactSecrets` |
| 第 1 批 | `bridge.*` 在 `src/components` 53 → ≤34 | `grep -c 'bridge\??\.' src/components/**/*.tsx` |
| 第 2 批 | `git.ts` 无单文件 >250 行 | `wc -l services/git/*.ts` |
| 第 2 批 | `ipc.ts` 行数 <200 | `wc -l electron/main/ipc.ts` |
| 第 2 批 | 新增 `useSettings`/`useGitPanel` | 文件存在 |
| 第 3 批 | 服务层进入覆盖率白名单 | `vitest.config.ts` include 含 `services/*` |
| 第 3 批 | CI 加 `npm audit` | `.github/workflows/ci.yml` 含 `npm audit` |
| 第 3 批 | 组件层引入 `@testing-library/react` | `package.json` 含依赖 |

### 6.3 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 证书获取流程延迟 | 1A 无法完成 | 先做摘要校验，证书后补 |
| 浏览器预览是否仍是产品目标 | 2A 设计决策 | 先确认，再做 2A |
| Git 行为对参数顺序敏感 | 2C 拆分 | 先补命令拼装测试，再拆 |
| 单人项目资源有限 | 整体进度 | 优先做 1A、1B、1C，2/3 批可延后 |

---

## 七、总结

本整改规划将 35 条问题按**依赖关系与可验证性**划分为 3 个批次，总人日 24~32 天：

- **第 1 批（10~14 人日）**: 止漏与立边界 —— 消除 RCE 路径、止血凭据外泄、建立渲染层边界
- **第 2 批（8~10 人日）**: 架构治理 —— 传输层抽象、IPC 编排下沉、git.ts 拆分
- **第 3 批（6~8 人日）**: 测试与工程化 —— 补齐测试、工程化配置、类型安全收口

**若资源只够做 1 天**: 做 1A 的前半（去 cmd）+ 1B（凭据止血）  
**若资源只够做 1 周**: 做第 1 批全部  
**若资源只够做 2 周**: 做第 1 批 + 第 2 批 2A、2B

每批次都有**可机器判定的收敛信号**，不依赖人工判断，确保整改质量可验证。
