import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: "gitool-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const isDev = context.server !== undefined;
        const scriptSource = isDev ? "'self' 'unsafe-inline'" : "'self'";
        const connectSource = isDev ? "'self' ws://localhost:1420 http://localhost:1420" : "'self'";
        const policy = [
          "default-src 'self'",
          `script-src ${scriptSource}`,
          // 不再放行 Google Fonts：字体已改为系统栈，CSP 保持最小面。
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "img-src 'self' data:",
          `connect-src ${connectSource}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join("; ");

        return html.replace(
          "<!--CSP-->",
          `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const isWebPreview = mode === "web";

  return {
    plugins: [
      contentSecurityPolicyPlugin(),
      react(),
      ...(isWebPreview
        ? []
        : [
            electron({
              main: {
                entry: "electron/main/index.ts",
                vite: {
                  build: {
                    // 必须显式声明 CJS：vite-plugin-electron 会根据 package.json 的
                    // "type": "module" 自动选 ESM，而 Electron 的 electron 模块在 ESM 下
                    // 不支持具名导入，运行时抛 "does not provide an export named 'app'"。
                    lib: {
                      entry: "electron/main/index.ts",
                      formats: ["cjs"],
                      fileName: () => "main.cjs",
                    },
                    rolldownOptions: {
                      external: ["electron", "@napi-rs/keyring", /^@napi-rs\/keyring-/],
                      output: {
                        format: "cjs",
                        entryFileNames: "main.cjs",
                      },
                    },
                  },
                },
              },
              preload: {
                input: "electron/preload/index.ts",
                vite: {
                  build: {
                    rolldownOptions: {
                      output: {
                        format: "cjs",
                        entryFileNames: "preload.cjs",
                      },
                    },
                  },
                },
              },
            }),
          ]),
    ],
    clearScreen: false,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
      port: 1420,
      strictPort: true,
      // 显式绑 IPv4：Windows 上 localhost 默认解析到 ::1，
      // 只监听 IPv6 会让 127.0.0.1 的访问（含部分调试工具）连不上。
      host: "127.0.0.1",
    },
  };
});
