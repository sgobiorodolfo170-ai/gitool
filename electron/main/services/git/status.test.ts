/**
 * git 变更清单（listChangedFiles）集成测试：真实临时仓库 + 真实 git 子进程。
 *
 * why 不 mock git：本组用例锁定的正是「git 输出里的前导空格是不是数据」这类
 * 进程层事实。`git status --porcelain=v1 -z` 未暂存条目的 XY 状态位是 `" M"`，
 * 首字符就是空格；mock 一份被 trim 过的字符串只能复述测试作者的想法，证明不了
 * 真实 git 的输出形态（2026-11-21 冒烟 P1-1：runGit 的 trim 把 `" M"`
 * 削成 `"M "`，parseStatusPorcelainZ 判非法并整条丢弃，单文件未暂存时列表为空）。
 *
 * 环境约定：
 * - 无 git 时整组 skip（describe.skipIf），「本机没装 git」不算失败；
 * - 每个用例独立 mkdtemp 仓库，结束时清理（Windows 下 .git 目录偶有短暂占用，
 *   用重试参数兜底）；
 * - settings 桩只提供 gitPath 空串，让 getActiveGitBinary 回退到 PATH 上的 git。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listChangedFiles } from "./status";

vi.mock("../storage/settings", () => ({
  loadSettings: () => ({ gitPath: "" }),
}));

/** 探测 PATH 中是否有可用的 git（与 git.test.ts 同一策略）。 */
function gitIsAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitIsAvailable();

/** 当前用例的临时仓库；afterEach 统一清理，避免用例间状态串味。 */
let repoPath: string | null = null;

/** 在仓库内执行 git 并吞掉输出（测试只关心退出码，失败即抛给 vitest）。 */
function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * 造一个可提交的空仓库。
 * why 显式写 user.name/user.email：CI/容器里常没有全局身份，`git commit` 会直接失败；
 * why 关掉 commit.gpgsign：本机若配了签名，测试会卡在 gpg 交互上。
 */
function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitool-status-"));
  git(["-c", "commit.gpgsign=false", "init", "--quiet"], dir);
  git(["config", "user.name", "gitool-test"], dir);
  git(["config", "user.email", "gitool-test@example.com"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  return dir;
}

/** 写入文件并直接提交进基线，保证后续变更只反映本用例的意图。 */
function commitFile(cwd: string, file: string, content: string): void {
  writeFileSync(join(cwd, file), content, "utf8");
  git(["add", "--", file], cwd);
  git(["commit", "--quiet", "-m", `add ${file}`], cwd);
}

afterEach(() => {
  if (repoPath !== null) {
    rmSync(repoPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    repoPath = null;
  }
});

describe.skipIf(!hasGit)("listChangedFiles（真实仓库）", () => {
  it("只有未暂存修改时仍能返回该条目（status 保留前导空格）", async () => {
    repoPath = createRepo();
    commitFile(repoPath, "README.md", "hello\n");
    writeFileSync(join(repoPath, "README.md"), "hello world\n", "utf8");

    const files = await listChangedFiles(repoPath);

    expect(files).toHaveLength(1);
    // P-35：noUncheckedIndexedAccess 下 files[0] 需非空断言（toHaveLength 已保证存在）
    expect(files[0]!.path).toBe("README.md");
    // 关键回归点：`" M"`（工作区已改、索引未变）；若被 trim 成 `"M "` 语义就反了
    expect(files[0]!.status).toBe("modified");
    expect(files[0]!.staged).toBe(false);
  });

  it("已暂存修改返回 staged=true", async () => {
    repoPath = createRepo();
    commitFile(repoPath, "README.md", "hello\n");
    writeFileSync(join(repoPath, "README.md"), "staged\n", "utf8");
    git(["add", "--", "README.md"], repoPath);

    const files = await listChangedFiles(repoPath);

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("README.md");
    expect(files[0]!.staged).toBe(true);
  });

  it("rename 成对解析：1 条记录、路径取新名", async () => {
    repoPath = createRepo();
    commitFile(repoPath, "old.txt", "content\n");
    git(["mv", "old.txt", "new.txt"], repoPath);

    const files = await listChangedFiles(repoPath);

    // `-z` 下 rename 是 `R  new.txt\0old.txt\0`；若不对称消费第二个段会多出一条幻影
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("new.txt");
    expect(files[0]!.status).toBe("renamed");
  });

  it("混合变更（未暂存 + 已暂存 + 未跟踪）条数与状态都正确", async () => {
    repoPath = createRepo();
    commitFile(repoPath, "unstaged.txt", "a\n");
    commitFile(repoPath, "staged.txt", "b\n");
    writeFileSync(join(repoPath, "unstaged.txt"), "a changed\n", "utf8");
    writeFileSync(join(repoPath, "staged.txt"), "b changed\n", "utf8");
    git(["add", "--", "staged.txt"], repoPath);
    writeFileSync(join(repoPath, "untracked.txt"), "new\n", "utf8");

    const files = await listChangedFiles(repoPath);

    expect(files).toHaveLength(3);
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get("unstaged.txt")).toMatchObject({
      status: "modified",
      staged: false,
    });
    expect(byPath.get("staged.txt")).toMatchObject({
      status: "modified",
      staged: true,
    });
    expect(byPath.get("untracked.txt")).toMatchObject({
      status: "untracked",
      staged: false,
    });
  });
});
