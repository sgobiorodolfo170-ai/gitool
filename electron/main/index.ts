import { BrowserWindow, Menu, Tray, app, nativeImage, shell } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc.js";
import { checkForUpdates, CHECK_INTERVAL_MS } from "./services/updater.js";
import { killAllProcesses } from "./services/processCleanup.js";
import { loadSettings } from "./services/storage/settings.js";

function notifyUpdateIfAvailable(window: BrowserWindow): void {
  void checkForUpdates()
    .then((result) => {
      if (result.hasUpdate) {
        window.webContents.send("updater:available", { version: result.version });
      }
    })
    .catch(() => {});
}

// 主进程以 CJS 构建，直接用 __dirname（ESM 的 import.meta 在 CJS 下不可用）。
const currentDirectory = __dirname;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let tray: Tray | null = null;
let isQuitting = false;
let updateTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 真实退出前的统一资源回收。
 *
 * 「关闭窗口」与「最小化到托盘」是两种行为：托盘模式只隐藏窗口、进程与
 * 子任务保持运行；而任何真实退出路径（托盘菜单退出、X 关闭、安装更新重启）
 * 都会汇聚到 before-quit，在这里杀掉全部在册子进程（运行中的任务、git clone）
 * 并销毁托盘图标，确保完全退出、不残留后台进程。
 */
function runShutdownCleanup(): void {
  isQuitting = true;
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  killAllProcesses();
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function quitApp(): void {
  isQuitting = true;
  app.quit();
}

function createTray(window: BrowserWindow): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Gitool");
  const contextMenu = Menu.buildFromTemplate([
    { label: "打开 Gitool", click: () => showMainWindow(window) },
    // 显式进入托盘模式的入口：仅隐藏界面，进程保持后台运行
    { label: "隐藏到托盘", click: () => window.hide() },
    { type: "separator" },
    { label: "退出", click: quitApp },
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

  // 页面加载失败时窗口会一直隐藏（show: false + ready-to-show 不触发），
  // 用户只看到「应用没反应」。这里把失败原因打到主进程日志，便于定位白屏。
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error("[gitool] 页面加载失败", { code, description, url });
  });

  window.on("close", (event) => {
    // 真实退出进行中（托盘退出 / 安装更新重启）：放行关闭，由 before-quit 统一回收。
    if (isQuitting) {
      return;
    }
    // 关闭行为实时读库：设置改动无需重启即生效。
    // 读取失败按默认行为处理（彻底退出），不让设置层故障阻断关闭。
    let closeToTray = false;
    try {
      closeToTray = loadSettings().closeToTray;
    } catch {
      // 保持默认
    }
    if (closeToTray) {
      // 托盘模式：仅隐藏主窗口，进程与后台任务保持运行
      event.preventDefault();
      window.hide();
      return;
    }
    // 默认行为：放行关闭 → window-all-closed → app.quit() → 统一回收
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

  // 回收挂在 before-quit：所有真实退出路径（含 updater 的 app.quit()）都经过这里
  app.on("before-quit", runShutdownCleanup);

  void app.whenReady().then(() => {
    app.setAppUserModelId("com.gitool.desktop");
    registerIpcHandlers();
    const window = createMainWindow();
    createTray(window);
    notifyUpdateIfAvailable(window);
    updateTimer = setInterval(() => notifyUpdateIfAvailable(window), CHECK_INTERVAL_MS);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    // closeToTray=false 时 X 关闭走到这里 → 退出 → before-quit 统一回收；
    // 托盘模式下窗口只是隐藏，不会触发本事件。
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
