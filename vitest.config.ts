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
  },
});
