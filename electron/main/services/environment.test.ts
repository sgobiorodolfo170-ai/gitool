import { rmSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEnvironmentStatus,
  probeNetwork,
  probeReachability,
  type FetchLike,
} from "./environment";

/**
 * environment 服务层单测。
 *
 * why 需要这组测试：首启体检曾把 UI 阻塞到 6s+，根因是网络探测等满超时；
 * 修法依赖两个可验证的行为——「三路探测并行」（总耗时取 max 而非 sum）与
 * 「超时判不可达而不抛」（体检整体不因网络异常失败）。这两点无法靠真实网络
 * 稳定复现（本机 github/gitee/gitlab 可达性随时变化），因此用可注入的 fetch 桩
 * 精确控制时序；同时锁定 EnvironmentStatus 字段集合，防止优化时悄悄改契约。
 *
 * 桩的边界：
 * - electron 只用到 app.getPath（角色：隔离真实 %APPDATA%，避免写用户数据目录）；
 * - node:child_process 只 mock execFile（角色：不依赖本机是否装 Git、可控延迟）；
 * - ./credentials / ./git 用最小桩（角色：keyring 探测会写 Windows 凭据管理器，
 *   单测不允许产生真机副作用；git 二进制解析走设置库，与探测时序无关）。
 */

const harness = vi.hoisted(() => {
  const separator = process.platform === "win32" ? "\\" : "/";
  const base = process.env.TEMP || process.env.TMPDIR || ".";
  return {
    /** 假 git 进程的响应延迟，用于验证「git 与网络并发」。 */
    gitDelayMs: 0,
    /** false 时回调错误，模拟未安装 Git。 */
    gitSucceeds: true,
    /** 隔离的数据目录（app.getPath("userData") 的返回值）。 */
    dataDir: `${base}${separator}gitool-env-test-${process.pid}-${Date.now()}`,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: () => harness.dataDir,
  },
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: readonly string[],
    optionsOrCallback: unknown,
    maybeCallback?: unknown,
  ) => {
    // promisify(execFile) 会把回调追加为最后一个参数；
    // 兼容 (file, args, callback) 与 (file, args, options, callback) 两种调用形态。
    const callback = (
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
    ) as ((error: Error | null, result?: { stdout: string; stderr: string }) => void) | undefined;
    setTimeout(() => {
      if (harness.gitSucceeds) {
        callback?.(null, { stdout: "git version 9.9.9\n", stderr: "" });
      } else {
        callback?.(new Error("git not found"));
      }
    }, harness.gitDelayMs);
  },
}));

vi.mock("./credentials", () => ({ probeKeyring: () => true }));
vi.mock("./git", () => ({ getActiveGitBinary: () => "git" }));

/** 立即成功的 fetch 桩：用于只关心字段/时序、不关心网络的分支。 */
const instantFetch: FetchLike = () => Promise.resolve({ ok: true, status: 200 });

/**
 * 造一个「按时序返回」的 fetch 桩：不同 host 不同延迟，并记录启动顺序。
 * 延迟 300ms 的目标决定并联总耗时；三者之和 450ms 是串行基线。
 */
function createStaggeredFetch(events: string[]): FetchLike {
  return (url, init) => {
    const host = new URL(url).hostname;
    events.push(`start:${host}`);
    const delayMs = host.includes("github") ? 50 : host.includes("gitee") ? 100 : 300;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        events.push(`end:${host}`);
        resolve({ ok: true, status: 200 });
      }, delayMs);
      // 真实 fetch 在 abort 时会以 AbortError 拒绝；桩保持同样语义，
      // 否则超时分支会「等桩自己结束」，测不到 AbortController 的实际作用。
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });
  };
}

/** 永不返回、只在 abort 时拒绝的 fetch 桩：模拟被墙/黑洞网络。 */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe never settled")), 10_000);
    init.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });

afterAll(() => {
  rmSync(harness.dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  harness.gitDelayMs = 0;
  harness.gitSucceeds = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeReachability", () => {
  it("超时后返回 unreachable 而不抛异常", async () => {
    let aborted = false;
    const stub: FetchLike = (url, init) =>
      hangingFetch(url, init).catch((error: unknown) => {
        aborted = init.signal?.aborted === true;
        throw error;
      });

    const startedAt = Date.now();
    const state = await probeReachability("https://example.invalid", 40, stub);
    const elapsed = Date.now() - startedAt;

    expect(state).toBe("unreachable");
    expect(elapsed).toBeLessThan(1000);
    expect(aborted).toBe(true);
  });

  it("fetch 立即拒绝（DNS 失败/连接拒绝）→ reachable=false 且不抛", async () => {
    const stub: FetchLike = () => Promise.reject(new TypeError("fetch failed"));

    // 不 catch 调用方：若实现把异常透传，这里会直接让用例失败。
    const state = await probeReachability("https://api.github.com", 2500, stub);

    expect(state).toBe("unreachable");
  });

  it("任意 HTTP 状态码都算可达（只关心链路是否通）", async () => {
    const state = await probeReachability("https://example.invalid", 100, () =>
      Promise.resolve({ ok: false, status: 503 }),
    );
    expect(state).toBe("reachable");
  });
});

describe("probeNetwork", () => {
  it("三平台并行探测：总耗时接近最慢一项而非三者之和", async () => {
    const events: string[] = [];
    const startedAt = Date.now();
    const network = await probeNetwork(createStaggeredFetch(events), 5000);
    const elapsed = Date.now() - startedAt;

    expect(network).toEqual({ github: "reachable", gitee: "reachable", gitlab: "reachable" });
    // 前三个事件必须都是 start：串行实现会是 start/end/start/end/start/end。
    expect(events.slice(0, 3).every((event) => event.startsWith("start:"))).toBe(true);
    expect(events.filter((event) => event.startsWith("start:"))).toHaveLength(3);
    // 串行下限 450ms；并行上限约 300ms，留 80ms 余量吸收 CI 抖动。
    expect(elapsed).toBeLessThan(380);
  });

  it("超时目标判不可达，另外两路仍各自给出结论", async () => {
    const stub: FetchLike = (url, init) =>
      url.includes("github") ? hangingFetch(url, init) : instantFetch(url, init);

    const network = await probeNetwork(stub, 50);

    expect(network.github).toBe("unreachable");
    expect(network.gitee).toBe("reachable");
    expect(network.gitlab).toBe("reachable");
  });
});

describe("getEnvironmentStatus", () => {
  it("返回字段与 EnvironmentStatus 契约完全一致", async () => {
    vi.stubGlobal("fetch", instantFetch);

    const status = await getEnvironmentStatus();

    expect(Object.keys(status).sort()).toEqual(
      [
        "git_available",
        "git_version",
        "platform",
        "data_directory",
        "data_directory_writable",
        "network",
        "keyring_available",
      ].sort(),
    );
    expect(Object.keys(status.network).sort()).toEqual(["gitee", "github", "gitlab"]);
    expect(status.git_available).toBe(true);
    expect(status.git_version).toBe("git version 9.9.9");
    expect(status.platform).toBe(process.platform);
    expect(status.data_directory).toBe(harness.dataDir);
    expect(status.data_directory_writable).toBe(true);
    expect(status.keyring_available).toBe(true);
  });

  it("Git 探测失败时 available=false、version=null（不抛）", async () => {
    vi.stubGlobal("fetch", instantFetch);
    harness.gitSucceeds = false;

    const status = await getEnvironmentStatus();

    expect(status.git_available).toBe(false);
    expect(status.git_version).toBeNull();
    expect(status.network).toEqual({
      github: "reachable",
      gitee: "reachable",
      gitlab: "reachable",
    });
  });

  it("git 探测与网络探测并发执行：总耗时取最慢一项", async () => {
    // 假 git 200ms + 假网络最慢 300ms：串行下限 500ms，并行上限约 300ms。
    harness.gitDelayMs = 200;
    const events: string[] = [];
    vi.stubGlobal("fetch", createStaggeredFetch(events));

    const startedAt = Date.now();
    const status = await getEnvironmentStatus();
    const elapsed = Date.now() - startedAt;

    expect(status.git_available).toBe(true);
    expect(elapsed).toBeLessThan(380);
    // git 的定时器与三路网络探测都在等待，说明二者没有前后串行等待。
    expect(events.filter((event) => event.startsWith("start:"))).toHaveLength(3);
  });
});
