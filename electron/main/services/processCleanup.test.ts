import { describe, expect, it } from "vitest";
import {
  killProcessTree,
  killAllProcesses,
  registerProcessStopper,
  getTrackedProcessCount,
} from "./processCleanup";

type FakeChild = {
  pid?: number;
  killed: string[];
  kill(signal?: number | NodeJS.Signals | undefined): boolean;
};

function fakeChild(pid?: number): FakeChild {
  return {
    pid,
    killed: [],
    kill(signal?: number | NodeJS.Signals | undefined) {
      this.killed.push(String(signal ?? "<default>"));
      return true;
    },
  };
}

describe("进程登记表（退出时统一回收）", () => {
  it("登记后 killAllProcesses 调用终止函数，集合清空", () => {
    let stopped = 0;
    registerProcessStopper(() => {
      stopped += 1;
    });
    expect(getTrackedProcessCount()).toBe(1);
    killAllProcesses();
    expect(stopped).toBe(1);
    expect(getTrackedProcessCount()).toBe(0);
  });

  it("注销后 killAllProcesses 不再调用该终止函数", () => {
    let stopped = 0;
    const unregister = registerProcessStopper(() => {
      stopped += 1;
    });
    unregister();
    killAllProcesses();
    expect(stopped).toBe(0);
  });

  it("注销可重复调用（子进程 close/error 双路径注销）", () => {
    const unregister = registerProcessStopper(() => {});
    expect(() => {
      unregister();
      unregister();
    }).not.toThrow();
    expect(getTrackedProcessCount()).toBe(0);
  });

  it("单个终止函数抛错不影响其余进程回收（异常隔离）", () => {
    let secondStopped = 0;
    registerProcessStopper(() => {
      throw new Error("进程已退出");
    });
    registerProcessStopper(() => {
      secondStopped += 1;
    });
    expect(() => killAllProcesses()).not.toThrow();
    expect(secondStopped).toBe(1);
    expect(getTrackedProcessCount()).toBe(0);
  });

  it("空登记表直接 killAllProcesses 不抛错", () => {
    expect(() => killAllProcesses()).not.toThrow();
    expect(getTrackedProcessCount()).toBe(0);
  });

  it("两次 killAllProcesses 只回收一次（第二次为空表 no-op）", () => {
    let stopped = 0;
    registerProcessStopper(() => {
      stopped += 1;
    });
    killAllProcesses();
    killAllProcesses();
    expect(stopped).toBe(1);
  });
});

describe("killProcessTree（进程树终止）", () => {
  it("pid 未知时退化为直接 kill（回退分支）", () => {
    const child = fakeChild(undefined);
    killProcessTree(child, "win32");
    expect(child.killed).toEqual(["<default>"]);
  });

  it("回退 kill 抛错时吞掉异常（进程已退出场景）", () => {
    const child = fakeChild(undefined);
    child.kill = () => {
      throw new Error("ESRCH");
    };
    expect(() => killProcessTree(child, "linux")).not.toThrow();
  });

  it("Windows 上有 pid 时走 taskkill 进程树终止，不向 child.kill 降级", () => {
    const child = fakeChild(999999999);
    // 真实调用 taskkill /PID 999999999 /T /F：目标不存在，静默失败，无副作用
    expect(() => killProcessTree(child, "win32")).not.toThrow();
    expect(child.killed).toEqual([]);
  });

  it("非 Windows 平台向进程发送 SIGTERM", () => {
    const child = fakeChild(1234);
    killProcessTree(child, "linux");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("非 Windows 平台 kill 抛错时吞掉异常", () => {
    const child = fakeChild(1234);
    child.kill = () => {
      throw new Error("ESRCH");
    };
    expect(() => killProcessTree(child, "linux")).not.toThrow();
  });
});
