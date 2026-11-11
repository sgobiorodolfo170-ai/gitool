import { execFile, type ChildProcess } from "node:child_process";

/**
 * 子进程登记表：应用真实退出时的统一回收点。
 *
 * 背景：Node 子进程是独立 OS 进程，主进程退出后不会自动消亡——运行中的
 * 任务命令（npm run … 经 shell 派生的进程树）与 git clone 会在应用关闭后
 * 变成孤儿进程，继续占用端口、文件句柄与 CPU（用户诉求「关闭即完全退出，
 * 不残留后台进程」）。因此所有长生命周期子进程在 spawn 后登记终止函数，
 * before-quit 统一回收；最小化到托盘（仅隐藏窗口）不触发回收，任务照常运行。
 *
 * 登记的是「终止函数」而非进程对象：任务域需要在终止时同步标记 stopped
 * 状态，克隆域只需杀进程树——各域自己包好语义，本模块只管登记与遍历。
 */

const stoppers = new Set<() => void>();

/**
 * 登记一个子进程终止函数，返回注销函数。
 * 子进程自然退出（close/error）时必须注销，避免集合无限增长。
 */
export function registerProcessStopper(stop: () => void): () => void {
  stoppers.add(stop);
  return () => {
    stoppers.delete(stop);
  };
}

/** 真实退出前统一回收：逐个终止并清空登记表。 */
export function killAllProcesses(): void {
  for (const stop of [...stoppers]) {
    try {
      stop();
    } catch {
      // 进程已退出等场景的终止失败不阻断退出流程
    }
  }
  stoppers.clear();
}

/** 当前在册子进程数（观测用）。 */
export function getTrackedProcessCount(): number {
  return stoppers.size;
}

/**
 * 终止整个进程树。
 *
 * Windows 上 `child.kill()` 只结束直接子进程：`npm run build` 会派生
 * node / tsc / vite，父进程被杀后子进程继续占用端口与文件句柄。
 * 因此 Windows 走 `taskkill /T /F`（execFile 数组参数，不经 shell）。
 * platform 参数仅供测试注入，生产调用不传。
 */
export function killProcessTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  platform: string = process.platform,
): void {
  const pid = child.pid;
  if (pid === undefined) {
    try {
      child.kill();
    } catch {
      // 进程已退出
    }
    return;
  }
  if (platform === "win32") {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
      // 失败（进程已退出 / 权限不足）不阻断回收流程
    });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // 进程已退出
  }
}
