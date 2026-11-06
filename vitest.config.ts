import { defineConfig } from "vitest/config";

/**
 * 单测配置独立于 vite.config.ts：后者会加载 electron 插件，
 * 在纯 Node 测试环境里没必要也不稳定。
 *
 * 覆盖范围：零 IO 纯函数层 + storage 域服务层（经 initDatabase(dataDir)
 * 注入临时目录，在纯 Node 环境测真实 node:sqlite，不 mock electron）。
 * 纳入进度与门槛基线见下方 coverage 注释。
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "electron/**/*.test.ts", "shared/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "dist-electron/**", "release/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // 覆盖率门槛（AGENTS.md 第八节要求设定目标，此处为适配值）：
      // 模板默认「整体 ≥80%」。当前门槛锁定纯函数层与 storage 域并保持高水位
      // （95/85/90/95）。服务层纳入进度（2026-11-07 storage 分域拆分后）：
      // ✅ 已纳入——storage/database（连接注入/种子/老库迁移）+ 7 个域模块
      //    （真实 node:sqlite + mkdtemp 临时目录，不 mock electron）；
      // ⬜ 暂不纳入 storage/accounts——其核心路径 upsert/delete 写真实 Windows
      //    凭据管理器（@napi-rs/keyring），单测不允许产生真机副作用，凭据层
      //    可注入（如 saveCredential 作为参数传入）后再纳入；
      // ⬜ git.ts 等其余服务层（下一里程碑）。
      // 基线：v0.6.0 时纯函数层 stmts 97.9% / branch 89.0% / funcs 92.7% / lines 97.8%。
      include: [
        "electron/main/ipc/schemas.ts",
        "electron/main/services/commandLine.ts",
        "electron/main/services/concurrency.ts",
        "electron/main/services/gitParsing.ts",
        "electron/main/services/operationCsv.ts",
        "electron/main/services/version.ts",
        "electron/main/services/storage/backups.ts",
        "electron/main/services/storage/database.ts",
        "electron/main/services/storage/operations.ts",
        "electron/main/services/storage/projects.ts",
        "electron/main/services/storage/remoteRepositoryCache.ts",
        "electron/main/services/storage/settings.ts",
        "electron/main/services/storage/tasks.ts",
        "electron/main/services/storage/workspaces.ts",
        "src/lib/format.ts",
        "src/lib/markdown.ts",
        "src/lib/navigation.ts",
        "src/lib/projectMatch.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 90,
        lines: 95,
      },
    },
  },
});
