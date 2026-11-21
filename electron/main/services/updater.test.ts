/**
 * updater 服务单元测试。
 *
 * why: updater 是「渲染层可触发 → 本机执行 exe」的唯一链路，必须在纯 Node 环境
 * （无 Electron 运行时）里锁死三条安全边界，任何一条回归都等于重新打开远程代码执行面：
 *   1) 安装包路径：必须落在可信根内且文件名命中白名单；
 *   2) 完整性：落盘文件 sha256 必须与 GitHub Release 的 digest 一致，否则删包拒装；
 *   3) 启动方式：直接 spawn 安装包本身并传 /S，绝不经过 cmd（避免元字符注入面复现）。
 *
 * 因为被测模块只从 electron 取 app.getPath/getVersion/quit，测试用 vi.mock 注入最小桩；
 * node:child_process 用 vi.mock 捕获 spawn 调用，避免测试真的拉起安装进程。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const HASH_ALGORITHM = "sha256";
const SHA256_HEX_LENGTH = 64;
/**
 * 夹具用真实发布产物的命名：electron-builder.yml 的 artifactName 模板为
 * `${productName}-${version}-setup.${ext}`，同时它也必须命中 checkForUpdates 的
 * assets 筛选条件（`endsWith("-setup.exe")`），否则测试会因「选不到资产」而假通过。
 */
const INSTALLER_NAME = "Gitool-1.2.3-setup.exe";
const LEGACY_INSTALLER_NAME = "gitool-setup-1.2.3.exe";
const DOWNLOAD_URL = `https://updates.test/${INSTALLER_NAME}`;
const RELEASE_TAG = "v1.2.3";
/** 未安装版本（app.getVersion 桩返回值），保证 checkForUpdates 判定为「有更新」。 */
const CURRENT_VERSION = "0.8.0";

const electronMock = vi.hoisted(() => ({
  appMock: {
    getPath: vi.fn(),
    getVersion: vi.fn(),
    quit: vi.fn(),
  },
}));

const childProcessMock = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("electron", () => ({ app: electronMock.appMock }));
vi.mock("node:child_process", () => ({ spawn: childProcessMock.spawnMock }));

type SpawnListener = (...args: unknown[]) => void;

/**
 * 伪造 ChildProcess。
 *
 * why: 真实 spawn 会拉起安装程序；这里只模拟 Node 的两种确定性事件——
 * 成功时触发 "spawn"，失败时触发 "error"。事件用 queueMicrotask 异步派发，
 * 以便验证实现确实在 Promise 里等待了事件而不是同步吞掉错误。
 */
function createFakeChild(options: { error?: Error } = {}): {
  once: (event: string, listener: SpawnListener) => unknown;
  unref: () => void;
} {
  const child = {
    once(event: string, listener: SpawnListener) {
      if (options.error && event === "error") {
        queueMicrotask(() => listener(options.error));
      }
      if (!options.error && event === "spawn") {
        queueMicrotask(() => listener());
      }
      return child;
    },
    unref: vi.fn(),
  };
  return child;
}

function sha256Hex(payload: Buffer): string {
  return createHash(HASH_ALGORITHM).update(payload).digest("hex");
}

/** 下载桩的额外旋钮，避免为每个边界单独复制一套 fetch 桩。 */
type StubReleaseOptions = {
  /** 覆盖默认下载地址（用于验证「非法资产名 → 标准名回退」）。 */
  downloadUrl?: string;
  /** 提供则在吐出首块后让响应流报错，模拟下载中途断流。 */
  streamError?: Error;
};

/**
 * 桩掉全局 fetch：/releases/latest 返回 release 元数据，下载地址返回二进制流。
 * digest 传 undefined 表示模拟「上游未提供摘要」，用于验证缺失即拒装的安全默认。
 */
function stubReleaseFetch(
  payload: Buffer,
  digest: string | undefined,
  options: StubReleaseOptions = {},
): void {
  const downloadUrl = options.downloadUrl ?? DOWNLOAD_URL;
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/releases/latest")) {
      return new Response(
        JSON.stringify({
          tag_name: RELEASE_TAG,
          assets: [
            {
              name: INSTALLER_NAME,
              browser_download_url: downloadUrl,
              digest,
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url === downloadUrl) {
      if (options.streamError) {
        return new Response(createFailingStream(payload, options.streamError), {
          status: 200,
        });
      }
      return new Response(payload, {
        status: 200,
        headers: { "content-length": String(payload.byteLength) },
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

/**
 * 先吐一块数据再报错的 Web 流：模拟「已经写了半个包之后连接中断」，
 * 只有这样才能验证半包文件确实被清理（若首块就报错，文件可能还没创建）。
 */
function createFailingStream(chunk: Buffer, failure: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(chunk));
      controller.error(failure);
    },
  });
}

let tempRoot = "";
let userDataRoot = "";

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gitool-updater-test-"));
  userDataRoot = join(tempRoot, "user-data");
  mkdirSync(userDataRoot, { recursive: true });
  electronMock.appMock.getPath.mockImplementation((name: string) => {
    if (name === "temp") {
      return tempRoot;
    }
    if (name === "userData") {
      return userDataRoot;
    }
    throw new Error(`测试未模拟的 app.getPath: ${name}`);
  });
  electronMock.appMock.getVersion.mockReturnValue(CURRENT_VERSION);
});

beforeEach(() => {
  // 更新目录在用例间共享（app.getPath 桩返回同一 tempRoot），必须清空，
  // 否则上一个用例成功下载的安装包会让「文件应被删除/不应存在」的断言失真。
  rmSync(join(tempRoot, "gitool-updates"), { recursive: true, force: true });
  childProcessMock.spawnMock.mockReset();
  electronMock.appMock.quit.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(tempRoot, { recursive: true, force: true });
});

/**
 * 每个用例重新加载模块：updater 的 cachedDigest / cachedInstallerPath 是模块级状态，
 * 复用同一实例会让用例之间互相污染生命周期。
 */
async function loadUpdater(): Promise<typeof import("./updater")> {
  vi.resetModules();
  return import("./updater");
}

/** 完成「check → download → 摘要通过」的完整链路，返回被信任的安装包路径。 */
async function prepareVerifiedInstaller(
  updater: typeof import("./updater"),
  payload: Buffer,
): Promise<string> {
  stubReleaseFetch(payload, `${HASH_ALGORITHM}:${sha256Hex(payload)}`);
  const checkResult = await updater.checkForUpdates();
  // 夹具漂移守卫：没有选到资产时 downloadUrl 会是空串，后续「缺摘要」错误会掩盖真实原因。
  expect(checkResult.downloadUrl).toBe(DOWNLOAD_URL);
  return updater.downloadUpdate(DOWNLOAD_URL);
}

describe("updater installer hardening", () => {
  it("rejects untrusted installer path", async () => {
    const updater = await loadUpdater();
    const trustedRoot = updater.getUpdateDirectory();

    // ① 文件名不在白名单内（即使位于更新目录）→ 拒绝；
    const badFileName = join(trustedRoot, "evil.exe");
    // ② 用 `..` 逃出更新目录（resolve 后已不在可信根内）→ 拒绝；
    const traversalPath = join(trustedRoot, "..", INSTALLER_NAME);

    await expect(updater.installUpdate(badFileName)).rejects.toThrow(/不受信任/);
    await expect(updater.installUpdate(traversalPath)).rejects.toThrow(/不受信任/);
    expect(childProcessMock.spawnMock).not.toHaveBeenCalled();
    expect(electronMock.appMock.quit).not.toHaveBeenCalled();
  });

  it("accepts both published installer file names", async () => {
    const updater = await loadUpdater();
    const trustedRoot = updater.getUpdateDirectory();

    // electron-builder 产物名（Gitool-<版本>-setup.exe）与更新源/历史产物名（gitool-setup-<版本>.exe）都要放行。
    expect(updater.isTrustedInstallerPath(join(trustedRoot, INSTALLER_NAME))).toBe(true);
    expect(updater.isTrustedInstallerPath(join(trustedRoot, LEGACY_INSTALLER_NAME))).toBe(true);
    // 白名单必须挡掉目录内的其他 exe，否则更新目录会被当成任意程序的投递点。
    expect(updater.isTrustedInstallerPath(join(trustedRoot, "evil.exe"))).toBe(false);
  });

  it("digest mismatch removes file", async () => {
    const payload = Buffer.from("tampered-installer-bytes");
    const wrongDigest = `${HASH_ALGORITHM}:${"0".repeat(SHA256_HEX_LENGTH)}`;
    stubReleaseFetch(payload, wrongDigest);

    const updater = await loadUpdater();
    await updater.checkForUpdates();

    // 必须命中「摘要不一致」这条错误，而不是同样含「摘要」的「上游未提供摘要」分支。
    await expect(updater.downloadUpdate(DOWNLOAD_URL)).rejects.toThrow(/摘要校验失败/);

    const installerPath = join(updater.getUpdateDirectory(), INSTALLER_NAME);
    expect(existsSync(installerPath)).toBe(false);
    expect(childProcessMock.spawnMock).not.toHaveBeenCalled();
  });

  it("installs verified installer without cmd", async () => {
    const updater = await loadUpdater();
    const installerPath = await prepareVerifiedInstaller(
      updater,
      Buffer.from("verified-installer-bytes"),
    );

    childProcessMock.spawnMock.mockReturnValue(createFakeChild());
    await updater.installUpdate(installerPath);

    expect(childProcessMock.spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = childProcessMock.spawnMock.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    // 关键断言：命令就是安装包本身，参数只有静默安装标志，全程不出现 cmd。
    expect(command).toBe(installerPath);
    expect(args).toEqual(["/S"]);
    expect(options).toMatchObject({ shell: false, detached: true });
    expect(electronMock.appMock.quit).toHaveBeenCalledTimes(1);
  });

  it("rejects installer when release digest is missing", async () => {
    stubReleaseFetch(Buffer.from("unsigned-installer-bytes"), undefined);

    const updater = await loadUpdater();
    await updater.checkForUpdates();

    await expect(updater.downloadUpdate(DOWNLOAD_URL)).rejects.toThrow(/未提供 sha256 摘要/);
    expect(existsSync(join(updater.getUpdateDirectory(), INSTALLER_NAME))).toBe(false);
    expect(childProcessMock.spawnMock).not.toHaveBeenCalled();
  });

  it("propagates spawn error instead of swallowing it", async () => {
    const updater = await loadUpdater();
    const installerPath = await prepareVerifiedInstaller(
      updater,
      Buffer.from("verified-installer-bytes"),
    );

    // 实现里有一条「调用方未 await 时也不让主进程未处理拒绝」的兜底日志，这里顺带验证它确实记了日志。
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    childProcessMock.spawnMock.mockReturnValue(
      createFakeChild({ error: new Error("ENOENT: 安装包无法启动") }),
    );

    await expect(updater.installUpdate(installerPath)).rejects.toThrow(/启动安装程序失败/);
    expect(electronMock.appMock.quit).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("removes partial file on download failure", async () => {
    const upstreamError = new Error("连接中断");
    stubReleaseFetch(
      Buffer.from("partial-installer-bytes"),
      `${HASH_ALGORITHM}:${"a".repeat(SHA256_HEX_LENGTH)}`,
      {
        streamError: upstreamError,
      },
    );

    const updater = await loadUpdater();
    const checkResult = await updater.checkForUpdates();
    expect(checkResult.downloadUrl).toBe(DOWNLOAD_URL);

    // 原始错误必须透出（不能被清理动作掩盖），同时半包文件不能留在临时目录里。
    await expect(updater.downloadUpdate(DOWNLOAD_URL)).rejects.toThrow(/连接中断/);
    expect(existsSync(join(updater.getUpdateDirectory(), INSTALLER_NAME))).toBe(false);
    expect(childProcessMock.spawnMock).not.toHaveBeenCalled();
  });

  it("falls back to standard installer name", async () => {
    // 资产名含空格与百分号编码：清洗后形如 `Gitool_20Setup_201.2.3.exe`，不命中白名单，
    // 必须回退标准产物名，否则下载能成功但安装永远 fail-closed。
    const oddDownloadUrl = "https://updates.test/Gitool%20Setup%201.2.3.exe";
    const payload = Buffer.from("odd-name-installer-bytes");
    stubReleaseFetch(payload, `${HASH_ALGORITHM}:${sha256Hex(payload)}`, {
      downloadUrl: oddDownloadUrl,
    });

    const updater = await loadUpdater();
    const checkResult = await updater.checkForUpdates();
    expect(checkResult.downloadUrl).toBe(oddDownloadUrl);

    const installerPath = await updater.downloadUpdate(oddDownloadUrl);
    expect(basename(installerPath)).toMatch(/^gitool-setup-\d+\.exe$/);
    expect(updater.isTrustedInstallerPath(installerPath)).toBe(true);

    // 回退名同样要走完整的「白名单 + cachedInstallerPath」校验并被真实 spawn。
    childProcessMock.spawnMock.mockReturnValue(createFakeChild());
    await updater.installUpdate(installerPath);
    expect(childProcessMock.spawnMock).toHaveBeenCalledWith(
      installerPath,
      ["/S"],
      expect.objectContaining({ shell: false }),
    );
  });
});
