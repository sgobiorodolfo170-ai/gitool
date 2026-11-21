/**
 * git 命令参数拼装单测（A-23 前置护栏）。
 *
 * why 需要这层护栏：Git 对参数的**顺序**与**分隔符**极敏感——`--` 必须位于 pathspec
 * 之前、`:(literal)` 必须紧贴路径、`--numstat` 不能少、分批边界不能改。这些约束一旦
 * 在后续按子域拆分 git.ts 时被无意改动，人工 review 很难发现：参数只差一个元素时
 * 命令往往「还能跑」，只是语义悄悄变了（glob 打开、选项被当成路径、统计口径改变）。
 * 因此这里对**整个参数数组**做逐元素断言（toEqual），而不是只断言 toContain 片段。
 *
 * 被测对象都是纯函数：只吃输入、返回 string[]、不启动进程，所以本文件不依赖真实
 * git 与仓库状态；只 mock 掉 git.ts 在 import 期会拉起的 electron / 凭据 / 数据库依赖
 * （与 git.test.ts 的桩保持一致，避免为纯函数测试引入真实窗口与 Windows 凭据管理器）。
 */
import { describe, expect, it, vi } from "vitest";
import type { GitOperation } from "../../../shared/types";
import {
  GIT_ARG_CHUNK,
  buildBranchListArgs,
  buildCloneArgs,
  buildCommitArgs,
  buildCommitHistoryArgs,
  buildCreateBranchArgs,
  buildCreateTagArgs,
  buildCurrentBranchArgs,
  buildDeleteBranchArgs,
  buildDeleteTagArgs,
  buildDiffNumstatArgs,
  buildDiffStatArgs,
  buildFetchArgs,
  buildFileDiffArgs,
  buildGitCwdArgs,
  buildInitArgs,
  buildLastCommitDateArgs,
  buildListTagsArgs,
  buildOperationCommands,
  buildPullArgs,
  buildPushArgs,
  buildRemoteAddArgs,
  buildRemoteListArgs,
  buildRemoteSetUrlArgs,
  buildRevertArgs,
  buildShortHeadArgs,
  buildStageArgs,
  buildStatusBranchArgs,
  buildStatusPorcelainZArgs,
  buildSwitchBranchArgs,
  buildUnstageArgs,
  buildUntrackedFilesArgs,
  chunkFilesForGitArgs,
} from "./git";

// git.ts 的 import 链会碰 electron 窗口、设置库（进而初始化 SQLite）与凭据存储。
// 纯函数测试只需模块可加载，故用最小桩替换（vi.mock 会被提升到 import 之前执行）。
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("./storage/settings", () => ({
  loadSettings: () => ({ gitPath: "" }),
}));
vi.mock("./credentials", () => ({
  readCredential: () => "",
}));
vi.mock("./storage/accounts", () => ({
  getAccount: () => undefined,
}));

/**
 * 路径样本：空格、中文、glob 元字符（`[ ] * ?`）与「形似选项」的 `-` 前缀。
 * why 这些必须覆盖：任何一层转义/引号处理都会让 `:(literal)` 前缀失效或让路径失真，
 * 而 git 收到的 argv 本来就该是原始字节，不需要也不允许再加 shell 转义。
 */
const TRICKY_PATHS = [
  "带 空格 的文件.txt",
  "中文目录/子 目录/文件.md",
  "data[1].txt",
  "glob[0-9]*?.md",
  "-dash 开头.txt",
];

const ALL_LITERAL_PATHSPECS = [
  ":(literal)带 空格 的文件.txt",
  ":(literal)中文目录/子 目录/文件.md",
  ":(literal)data[1].txt",
  ":(literal)glob[0-9]*?.md",
  ":(literal)-dash 开头.txt",
];

/** 生成 n 个互不相同的路径，用于分批边界断言。 */
function makeFiles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `src/f${String(index).padStart(3, "0")}.ts`);
}

describe("clone 参数", () => {
  const cloneCases = [
    {
      name: "HTTPS 地址 + Windows 绝对目标路径",
      url: "https://github.com/a/b.git",
      targetPath: "D:\\work\\b",
    },
    {
      name: "形似 git 选项的 URL（由 -- 兜住）",
      url: "https://git.test/--upload-pack=evil.git",
      targetPath: "C:\\tmp\\target",
    },
    {
      name: "含空格与中文的目标路径",
      url: "git@github.com:a/b.git",
      targetPath: "D:\\我的 项目\\克隆 目标",
    },
  ];

  it.each(cloneCases)("$name", ({ url, targetPath }) => {
    expect(buildCloneArgs(url, targetPath)).toEqual(["clone", "--progress", "--", url, targetPath]);
  });

  it("--progress 在 -- 之前，URL 与目标路径是仅有的位置参数", () => {
    const args = buildCloneArgs("https://github.com/a/b.git", "D:\\work\\b");
    // `--` 恰好出现一次且紧跟 --progress：它只隔离选项，不参与位置参数
    expect(args.indexOf("--")).toBe(2);
    expect(args.filter((item) => item === "--")).toHaveLength(1);
    // -- 之后必须正好两个位置参数（URL、目标目录），多一个都会被 git 当成多余参数
    expect(args.slice(3)).toEqual(["https://github.com/a/b.git", "D:\\work\\b"]);
    // token 不允许出现在参数里（只走环境变量通道）
    expect(args.join(" ")).not.toContain("credential");
  });
});

describe("commit 参数", () => {
  it("单条 -m 原样传递单行信息", () => {
    expect(buildCommitArgs("fix: 修正分页 off-by-one")).toEqual([
      "commit",
      "-m",
      "fix: 修正分页 off-by-one",
    ]);
  });

  it("多行信息整体作为一条 -m 的值，不被拆成多个 -m", () => {
    // why：多个 -m 会被 git 以空行连接成段落，列表/代码块的换行结构会被打散（P1-2）
    const message = [
      "feat(ui): 支持多行提交信息",
      "",
      "- 第一项",
      "- 第二项",
      "",
      "```ts",
      "const a = 1;",
      "```",
    ].join("\n");
    const args = buildCommitArgs(message);
    expect(args).toEqual(["commit", "-m", message]);
    expect(args.filter((item) => item === "-m")).toHaveLength(1);
    expect(args[2]).toContain("\n\n");
  });

  it("只裁剪首尾空白，保留内部换行", () => {
    expect(buildCommitArgs("  \nfix: 前后空白\n \n")).toEqual(["commit", "-m", "fix: 前后空白"]);
  });

  it("空信息不产生 -m（由 commitChanges 的白名单在更早处拦截）", () => {
    // 锁定现状：buildCommitMessageArgs 对空串返回 []，此处不得悄悄改成 -m ""
    expect(buildCommitArgs("   ")).toEqual(["commit"]);
  });
});

describe("stage / unstage 参数与分批", () => {
  it("stage 对每个路径加 :(literal) 前缀，-- 位于全部 pathspec 之前", () => {
    expect(buildStageArgs(TRICKY_PATHS)).toEqual(["add", "--", ...ALL_LITERAL_PATHSPECS]);
  });

  it("unstage 用 --staged 且 -- 位于全部 pathspec 之前", () => {
    expect(buildUnstageArgs(TRICKY_PATHS)).toEqual([
      "restore",
      "--staged",
      "--",
      ...ALL_LITERAL_PATHSPECS,
    ]);
  });

  it("空格 / 中文 / glob 元字符都不被转义破坏", () => {
    const args = buildStageArgs(TRICKY_PATHS);
    // 不得出现反斜杠或引号转义：git 收到的是 argv 原值，转义会把文件名改坏
    expect(args.slice(2).some((item) => item.includes("\\") || item.includes('"'))).toBe(false);
    // 每个 pathspec 恰好一个元素，且以字面量 magic 开头
    expect(args.slice(2)).toHaveLength(TRICKY_PATHS.length);
    expect(args.slice(2).every((item) => item.startsWith(":(literal)"))).toBe(true);
    // 单元素内保留原样的空格与方括号（逐字符比较，排除「只是前缀存在」的假绿）
    expect(args[2]).toBe(":(literal)带 空格 的文件.txt");
    expect(args[4]).toBe(":(literal)data[1].txt");
  });

  const chunkCases = [
    { count: 199, expected: [199] },
    { count: 200, expected: [200] },
    { count: 201, expected: [200, 1] },
    { count: 401, expected: [200, 200, 1] },
  ];

  it.each(chunkCases)("$count 个文件按 $expected 分批", ({ count, expected }) => {
    const files = makeFiles(count);
    expect(chunkFilesForGitArgs(files).map((chunk) => chunk.length)).toEqual(expected);
  });

  it("分批大小就是 GIT_ARG_CHUNK（Windows 命令行上限对应的常量）", () => {
    expect(GIT_ARG_CHUNK).toBe(200);
    const chunks = chunkFilesForGitArgs(makeFiles(201));
    expect(chunks[0]).toHaveLength(GIT_ARG_CHUNK);
    expect(chunks[1]).toHaveLength(1);
  });

  it("分批不丢失、不改序，且每批参数独立", () => {
    const files = makeFiles(201);
    const chunks = chunkFilesForGitArgs(files);
    // 展平后与原始列表完全一致：分批只切分，不做过滤/排序/去重
    expect(chunks.flat()).toEqual(files);
    expect(buildStageArgs(chunks[0]).slice(2)).toEqual(
      files.slice(0, 200).map((p) => `:(literal)${p}`),
    );
    expect(buildStageArgs(chunks[1])).toEqual(["add", "--", ":(literal)src/f200.ts"]);
  });
});

describe("tag 参数", () => {
  it("带说明创建附注标签：-a 在前、-m 紧跟名字", () => {
    const message = "发布说明 第一行\n第二行";
    expect(buildCreateTagArgs("v1.0.0", message)).toEqual(["tag", "-a", "v1.0.0", "-m", message]);
  });

  it("无说明创建轻量标签：不带 -a / -m", () => {
    expect(buildCreateTagArgs("v1.0.0", "")).toEqual(["tag", "v1.0.0"]);
  });

  it("删除标签：-d 在标签名之前", () => {
    expect(buildDeleteTagArgs("v1.0.0")).toEqual(["tag", "-d", "v1.0.0"]);
  });

  it("标签列表格式串固定 4 行、降序排序", () => {
    const args = buildListTagsArgs();
    expect(args).toEqual([
      "for-each-ref",
      "refs/tags",
      "--sort=-creatordate",
      "--format=%(refname:short)\n%(objectname:short)\n%(creatordate:iso8601-strict)\n%(contents:subject)",
    ]);
    // 解析端按 4 行一组消费，字段数量不能被悄悄改动
    expect(args[3].split("\n")).toHaveLength(4);
    expect(args[2].startsWith("--sort=-")).toBe(true);
  });
});

describe("branch 参数", () => {
  it("创建分支：checkout -b <name>", () => {
    expect(buildCreateBranchArgs("feature/中文-分支")).toEqual([
      "checkout",
      "-b",
      "feature/中文-分支",
    ]);
  });

  it("切换分支：checkout <name>（不带 -b）", () => {
    expect(buildSwitchBranchArgs("main")).toEqual(["checkout", "main"]);
  });

  it("删除分支：-D 强制删除，名字在选项之后", () => {
    expect(buildDeleteBranchArgs("topic/x")).toEqual(["branch", "-D", "topic/x"]);
  });

  it("当前分支与分支列表的参数", () => {
    expect(buildCurrentBranchArgs()).toEqual(["branch", "--show-current"]);
    // -vv 才带上游与 [ahead/behind] 段，parseBranchLine 依赖它
    expect(buildBranchListArgs()).toEqual(["branch", "-vv"]);
  });
});

describe("diff / numstat 参数", () => {
  it("--stat 用于人读展示，范围是两点语法", () => {
    expect(buildDiffStatArgs("v1.0.0", "v1.1.0")).toEqual(["diff", "--stat", "v1.0.0..v1.1.0"]);
  });

  it("--numstat 用于机器解析（供 parseNumstatPaths 与增删行累加）", () => {
    const args = buildDiffNumstatArgs("main", "feature/x");
    expect(args).toEqual(["diff", "--numstat", "main..feature/x"]);
    // 必须是两点范围：三点会改成「相对 merge-base」的统计口径
    expect(args[2]).not.toContain("...");
  });

  it("单文件差异：-- 在 :(literal) pathspec 之前", () => {
    expect(buildFileDiffArgs("data[1].txt")).toEqual(["diff", "--", ":(literal)data[1].txt"]);
    expect(buildFileDiffArgs("目 录/data[1].txt")).toEqual([
      "diff",
      "--",
      ":(literal)目 录/data[1].txt",
    ]);
  });
});

describe("revert / init / remote 参数", () => {
  it("-C 前置，revert 带 --no-edit 与原始哈希", () => {
    expect(buildRevertArgs("D:\\repo 1", "abc1234")).toEqual([
      "-C",
      "D:\\repo 1",
      "revert",
      "--no-edit",
      "abc1234",
    ]);
  });

  it("-C 前缀由统一函数拼装（全局选项必须在子命令之前）", () => {
    expect(buildGitCwdArgs("D:\\repo", ["status"])).toEqual(["-C", "D:\\repo", "status"]);
    // 与 revert 的参数在前缀部分保持一致
    expect(buildRevertArgs("D:\\repo", "abc1234").slice(0, 2)).toEqual(["-C", "D:\\repo"]);
  });

  it("init 带 -b 与默认分支名", () => {
    expect(buildInitArgs("main")).toEqual(["init", "-b", "main"]);
  });

  it("remote 列表 / add / set-url 的位置参数顺序", () => {
    expect(buildRemoteListArgs()).toEqual(["remote"]);
    expect(buildRemoteAddArgs("origin", "git@github.com:a/b.git")).toEqual([
      "remote",
      "add",
      "origin",
      "git@github.com:a/b.git",
    ]);
    expect(buildRemoteSetUrlArgs("origin", "https://github.com/a/b.git")).toEqual([
      "remote",
      "set-url",
      "origin",
      "https://github.com/a/b.git",
    ]);
  });
});

describe("快照 / 历史 / 无副作用的查询参数", () => {
  it("快照与查询命令逐元素锁定", () => {
    expect(buildStatusBranchArgs()).toEqual(["status", "--porcelain=v1", "--branch"]);
    expect(buildStatusPorcelainZArgs()).toEqual(["status", "--porcelain=v1", "-z"]);
    expect(buildShortHeadArgs()).toEqual(["rev-parse", "--short", "HEAD"]);
    expect(buildUntrackedFilesArgs()).toEqual(["ls-files", "-co", "--exclude-standard"]);
    expect(buildLastCommitDateArgs()).toEqual(["log", "-1", "--format=%cs"]);
  });

  it("log 格式串：字段顺序固定、记录分隔符在末尾", () => {
    const args = buildCommitHistoryArgs(50);
    expect(args).toEqual(["log", "-n 50", "--format=%H\x1f%an\x1f%ae\x1f%aI\x1f%s\x1f%b\x1e"]);
    const format = args[2];
    // 6 个字段 = 5 个字段分隔符 \x1f；少一个解析端就会少解一列
    expect(format.split("\x1f")).toHaveLength(6);
    // 记录尾分隔符 \x1e 必须在格式串末尾（放中间会让下一条 hash 粘上上一条 body）
    expect(format.endsWith("\x1e")).toBe(true);
    expect(format.indexOf("%b")).toBeLessThan(format.indexOf("\x1e"));
  });
});

describe("批量操作的命令序列", () => {
  const operationCases: Array<{ operation: GitOperation; expected: string[][] | undefined }> = [
    { operation: "fetch", expected: [["fetch", "--prune"]] },
    { operation: "pull", expected: [["pull", "--no-rebase"]] },
    { operation: "push", expected: [["push"]] },
    {
      operation: "sync",
      expected: [
        ["fetch", "--prune"],
        ["pull", "--no-rebase"],
      ],
    },
    { operation: "revert", expected: undefined },
  ];

  it.each(operationCases)("$operation 的命令序列", ({ operation, expected }) => {
    expect(buildOperationCommands(operation)).toEqual(expected);
  });

  it("单项参数构建与 dispatcher 保持一致", () => {
    expect(buildFetchArgs()).toEqual(["fetch", "--prune"]);
    expect(buildPullArgs()).toEqual(["pull", "--no-rebase"]);
    expect(buildPushArgs()).toEqual(["push"]);
    // sync 的顺序是 fetch → pull：先刷新远端引用再合并，顺序颠倒会合并到旧提交
    expect(buildOperationCommands("sync")).toEqual([buildFetchArgs(), buildPullArgs()]);
  });
});

describe("纯函数契约", () => {
  it("每次调用返回新数组，调用方追加/修改不会污染其他调用", () => {
    const first = buildStageArgs(["a.txt"]);
    first.push(":(literal)b.txt");
    expect(buildStageArgs(["a.txt"])).toEqual(["add", "--", ":(literal)a.txt"]);
  });

  it("不读取环境、不做 IO：相同输入两次调用结果相等", () => {
    expect(buildCloneArgs("https://x.test/r.git", "D:\\t")).toEqual(
      buildCloneArgs("https://x.test/r.git", "D:\\t"),
    );
    expect(buildOperationCommands("fetch")).toEqual(buildOperationCommands("fetch"));
  });
});
