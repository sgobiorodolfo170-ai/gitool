import { BrowserWindow, Menu, Tray, app, nativeImage, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let tray: Tray | null = null;
let isQuitting = false;

function createTray(window: BrowserWindow): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Gitool");
  const contextMenu = Menu.buildFromTemplate([
    { label: "打开 Gitool", click: () => showMainWindow(window) },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => showMainWindow(window));
  tray.on("click", () => showMainWindow(window));
}

function showMainWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function createTrayIcon(): Electron.NativeImage {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="7" fill="#1f3a33"/>',
    '<path d="M7 9c0-1.1.9-2 2-2h10l6 6v10c0 1.1-.9 2-2 2H9c-1.1 0-2-.9-2-2V9z" fill="#4a9a83"/>',
    '<path d="M12 12h8M12 16h8M12 20h5" stroke="#e8f5ef" stroke-width="2" stroke-linecap="round"/>',
    '</svg>',
  ].join("");
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

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

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

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
      showMainWindow(existingWindow);
    }
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId("com.gitool.desktop");
    registerIpcHandlers();
    const window = createMainWindow();
    createTray(window);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && isQuitting) {
      app.quit();
    }
  });
}
