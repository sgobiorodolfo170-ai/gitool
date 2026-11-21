/**
 * git 服务层凭据加固单测（A-03 入口拒绝 / 输出脱敏，A-04 克隆凭据不落盘）。
 *
 * why 用真实 git 进程而不是 mock：这些约束的关键在于「git 实际做了什么」——
 * `.git/config` 里到底写了什么、credential helper 链路究竟由谁应答。
 * mock git 只能证明代码调用了某个函数，证明不了这两件事。
 *
 * 两条独立证据链（互相不可替代）：
 * - 「不落盘」：真实克隆一个本地 bare 仓库后读回目标仓库配置；
 * - 「链路可控」（F-01）：`git credential fill` 走完整 helper 链，验证注入脚本
 *   在系统级 helper 之前生效——**这一条不能用 insteadOf → file:// 代替**，
 *   因为 file 协议根本不触发 credential helper，只会造成假绿。
 *
 * 环境约定：
 * - 无 git 时整组 skip（describe.skipIf），「本机没装 git」不算失败；
 * - electron / 凭据存储 / 本地数据库全部 mock：被测代码只需要 notifyRenderer
 *   与「某个账号的 token」，不该拉起真实窗口、Windows 凭据管理器与 SQLite；
 * - 全程离线：源仓库用 `git init --bare` 现造，再通过 url.<base>.insteadOf
 *   把 `https://gitool.test/repo.git` 重写到本地 bare 仓库，克隆路径仍是
 *   真实的 cloneRepository + 真实 git 子进程。
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertNoCredentialInUrl,
  buildCredentialEnv,
  cloneRepository,
  redactCloneOutput,
} from "./git";

const execFileAsync = promisify(execFile);

/** 测试用假令牌：形态命中 redactSecrets 的 ghp_ 规则，但不是任何真实凭据。 */
const fixtures = vi.hoisted(() => ({
  token: "ghp_testsOnlyToken1234567890",
}));

// 依赖桩（vi.mock 会被提升到 import 之前执行）：只提供被测路径需要的最小行为。
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("./storage/settings", () => ({
  loadSettings: () => ({ gitPath: "" }),
}));
vi.mock("./credentials", () => ({
  readCredential: () => fixtures.token,
}));
vi.mock("./storage/accounts", () => ({
  getAccount: () => ({ id: "account-test", credentialRef: "account-test" }),
}));

/** 假远程地址：只作为 cloneRepository 的入参，实际由 insteadOf 重写到本地 bare 仓库。 */
const REMOTE_URL = "https://gitool.test/repo.git";
const CREDENTIAL_HELPER_KEY = "credential.helper";

/** 探测 PATH 中是否有可用的 git。 */
async function gitIsAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const hasGit = await gitIsAvailable();

type GitConfigLookup = { exitCode: number; value: string };

/**
 * 读取仓库级（`--local`）配置项：键不存在时 git 以非 0 退出（code 1），
 * 这正是「配置没有被写入目标仓库」的确定性信号。
 *
 * why 必须带 `--local`：Windows 版 Git 的系统配置默认带
 * `credential.helper=manager`，裸 `--get` 会合并系统/全局层，永远读到一个值，
 * 无法区分「本次克隆写进仓库」与「机器默认配置」。
 */
async function readGitConfig(repoPath: string, key: string): Promise<GitConfigLookup> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      repoPath,
      "config",
      "--local",
      "--get",
      key,
    ]);
    return { exitCode: 0, value: stdout.trim() };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string };
    const exitCode = typeof failure.code === "number" ? failure.code : 1;
    return { exitCode, value: (failure.stdout ?? "").trim() };
  }
}

/**
 * `git credential fill` 的查询串：故意用一个本机从未访问过、也不存在的主机，
 * 保证只有被注入的 helper 可能应答（GCM 若在链首会去查它的凭据库或挂起）。
 * 空行是 git 协议的输入结束标记。
 */
const CREDENTIAL_QUERY = "protocol=https\nhost=example.com\n\n";

/**
 * 链路验证的超时上限：Windows 系统级 `credential.helper=manager` 在链首时
 * （F-01 回归态）实测会挂起 45s+，10s 足以把「挂起」和「即时应答」区分开。
 */
const CREDENTIAL_FILL_TIMEOUT_MS = 10_000;

type CredentialFillOutcome = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  elapsedMs: number;
};

/**
 * 跑一次真实的 `git credential fill`，stdin 写入查询串。
 *
 * why 手动 spawn 而不是 execFile：execFile 无法写 stdin，而 credential 协议的
 * 查询串必须从 stdin 输入；同时需要自己的 10s 看门狗，避免回归时测试进程被挂死。
 */
function credentialFill(env: NodeJS.ProcessEnv): Promise<CredentialFillOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("git", ["credential", "fill"], {
      windowsHide: true,
      // 叠加在被测环境之上，保留 system/global 配置：这正是要验证的「链首被重置」
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (outcome: Pick<CredentialFillOutcome, "code" | "timedOut">) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ...outcome,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        elapsedMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      // 杀整棵进程树：F-01 回归态下 git 会拉起 GCM 子进程（git-credential-manager），
      // 只 kill git 主进程会把孙进程留在后台继续等 45s（实测红跑后残留 3 个进程）。
      if (process.platform === "win32" && child.pid !== undefined) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          // 进程可能已自行退出
        }
      } else {
        child.kill("SIGKILL");
      }
      finish({ code: null, timedOut: true });
    }, CREDENTIAL_FILL_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => finish({ code: -1, timedOut: false }));
    child.on("close", (code) => finish({ code, timedOut: false }));
    // 子进程提前退出时 stdin 可能 EPIPE，不影响结论（结论由 close/看门狗给出）
    child.stdin.on("error", () => undefined);
    child.stdin.end(CREDENTIAL_QUERY);
  });
}

describe.skipIf(!hasGit)("git credential hardening", () => {
  let workRoot = "";
  let sourceRepo = "";
  let previousGitConfigGlobal: string | undefined;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "gitool-git-test-"));
    sourceRepo = join(workRoot, "source.git");
    await execFileAsync("git", ["init", "--bare", sourceRepo]);

    // insteadOf 让「看起来是 HTTPS」的克隆真正落到本地目录：
    // 既保留了 cloneRepository 的 URL 白名单校验路径，又完全不依赖外网。
    const globalConfigPath = join(workRoot, "gitconfig");
    writeFileSync(
      globalConfigPath,
      [
        `[url "${pathToFileURL(sourceRepo).href}"]`,
        `\tinsteadOf = ${REMOTE_URL}`,
        `[protocol "file"]`,
        `\tallow = always`,
        "",
      ].join("\n"),
      "utf8",
    );
    previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfigPath;
  });

  afterAll(() => {
    if (previousGitConfigGlobal === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal;
    }
    if (workRoot.length > 0) {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("rejects credential in url", async () => {
    // 内嵌凭据：user 与 password 都非空，必须被拦在 git 之前
    expect(() =>
      assertNoCredentialInUrl("https://user:token@github.com/a/b.git", "克隆地址"),
    ).toThrow(/内嵌/);
    // 正常 HTTPS 地址不受影响
    expect(() => assertNoCredentialInUrl("https://github.com/a/b.git", "克隆地址")).not.toThrow();
    // 入口拦截：cloneRepository 必须在启动 git 进程前就失败
    await expect(
      cloneRepository({
        url: "https://user:token@github.com/a/b.git",
        targetPath: join(workRoot, "rejected-clone"),
      }),
    ).rejects.toThrow(/内嵌/);
  });

  it("redacts token in output", () => {
    const leaked = `Fetching https://user:${fixtures.token}@github.com/a/b.git ...`;
    const output = redactCloneOutput(leaked);
    expect(output).not.toContain(fixtures.token);
    expect(output).toContain("***");
    // 只有凭据被抹掉，仓库地址等可诊断信息必须保留
    expect(output).toContain("github.com/a/b.git");
  });

  it("does not persist credential helper", async () => {
    // 注意：insteadOf → file:// 只用于「离线克隆 + 读回配置」，
    // file 协议不触发 credential helper，因此本用例只能证明「不落盘」，
    // 不能证明帮助脚本在真实 HTTPS 链路里生效——后者由下一条用例覆盖。
    const targetPath = join(workRoot, "clone-target");
    const result = await cloneRepository({
      url: REMOTE_URL,
      targetPath,
      accountId: "account-test",
    });
    // 克隆失败时先给出可读原因，避免后续断言在「目录不存在」上给出误导性结论
    if (!result.success) {
      throw new Error(`本地克隆失败（insteadOf 重写可能未生效）：${result.output}`);
    }

    const helper = await readGitConfig(targetPath, CREDENTIAL_HELPER_KEY);
    expect(helper.value).toBe("");
    expect(helper.exitCode).not.toBe(0);

    // 纵深校验：目标仓库配置文件里既不该有 helper 脚本，也不该有明文 token
    const repositoryConfig = readFileSync(join(targetPath, ".git", "config"), "utf8");
    expect(repositoryConfig).not.toContain(CREDENTIAL_HELPER_KEY);
    expect(repositoryConfig).not.toContain(fixtures.token);
  });

  // why 显式把用例超时放宽到 15s（> 看门狗 10s）：F-01 回归态会挂起，
  // 必须由内部看门狗先触发并给出「helper 未被重置」的可读断言，
  // 否则会被 vitest 默认 5s 全局超时抢先掐断（实测红跑时正是 5s 超时先到）。
  it("resets system credential helper chain", async () => {
    // why 不能只靠 insteadOf → file://：file 协议根本不走 credential helper，
    // 即使系统级 `credential.helper=manager` 仍排在链首也会「克隆成功」，
    // 属于假绿（F-01 就是被这种假象盖住的）。这里让 git 对一台本机从未
    // 访问过的 HTTPS 主机执行 credential fill，唯一可能的应答者只能是注入的脚本。
    const outcome = await credentialFill(buildCredentialEnv(fixtures.token));

    if (outcome.timedOut) {
      throw new Error(
        `git credential fill 在 ${outcome.elapsedMs}ms 内未返回：系统级 helper 未被重置（F-01 回归）`,
      );
    }
    expect(outcome.code).toBe(0);
    // 注入脚本的固定用户名 + 环境变量里的 token，证明应答者是我们注入的 helper
    expect(outcome.stdout).toContain("username=x-access-token");
    expect(outcome.stdout).toContain(`password=${fixtures.token}`);
    // 10s 内返回（回归态实测挂起 45s+）
    expect(outcome.elapsedMs).toBeLessThan(CREDENTIAL_FILL_TIMEOUT_MS);
  }, 15_000);
});
