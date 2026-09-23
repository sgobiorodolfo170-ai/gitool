import { BrowserWindow, app, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "Gitool",
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f5f7f9",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const isDevServerNavigation = devServerUrl !== undefined && url.startsWith(devServerUrl);
    if (!isDevServerNavigation) {
      event.preventDefault();
    }
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(currentDirectory, "../dist/index.html"));
  }

  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId("com.gitool.desktop");
    registerIpcHandlers();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
