import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: "gitool-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const isDev = context.server !== undefined;
        const scriptSource = isDev ? "'self' 'unsafe-inline'" : "'self'";
        const connectSource = isDev
          ? "'self' ws://localhost:1420 http://localhost:1420"
          : "'self'";
        const policy = [
          "default-src 'self'",
          `script-src ${scriptSource}`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
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
                    rolldownOptions: {
                      external: ["electron", "@napi-rs/keyring", /^@napi-rs\/keyring-/],
                      output: {
                        format: "es",
                        entryFileNames: "main.js",
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
    server: {
      port: 1420,
      strictPort: true,
    },
  };
});
