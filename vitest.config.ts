import { defineConfig } from "vitest/config";

/**
 * 单测配置独立于 vite.config.ts：后者会加载 electron 插件，
 * 在纯 Node 测试环境里没必要也不稳定。
 *
 * 当前只覆盖零 IO 依赖的纯函数（解析 / 校验 / 格式化）。
 * 主进程服务层的测试需要 mock electron 的 app 模块，后续按需引入。
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
      // 模板默认「整体 ≥80%」。当前项目阶段测试集中在零 IO 纯函数层，
      // 服务层（git.ts/storage.ts 等，依赖 electron 模块）尚无测试——
      // 把门槛锁定在纯函数层并保持高水位（95/85/90/95），防止既有
      // 用例随重构悄然劣化；服务层纳入门槛是下一里程碑（过渡计划）。
      // 基线：v0.6.0 时纯函数层 stmts 97.9% / branch 89.0% / funcs 92.7% / lines 97.8%。
      include: [
        "electron/main/ipc/schemas.ts",
        "electron/main/services/commandLine.ts",
        "electron/main/services/concurrency.ts",
        "electron/main/services/gitParsing.ts",
        "electron/main/services/operationCsv.ts",
        "electron/main/services/version.ts",
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
