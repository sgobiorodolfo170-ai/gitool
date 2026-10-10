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
  const iconPath = join(currentDirectory, "..", "build", "icon.png");
  return nativeImage.createFromPath(iconPath);
}

function createMainWindow(): BrowserWindow {
  const iconPath = join(currentDirectory, "..", "build", "icon.png");
  const window = new BrowserWindow({
    title: "Gitool",
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f5f7f9",
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
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
