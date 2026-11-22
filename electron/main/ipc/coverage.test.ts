import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * IPC 入参校验的「接线」门禁。
 *
 * 为什么不能只做登记比对：之前本文件只把通道名与 VALIDATED_CHANNELS 对一遍，
 * 验证者在临时目录里构造过「通道登记了、handler 体内却不调用校验」的变体，测试
 * 仍然全绿——登记式校验挡不住「漏接线」。现在改为读 ipc.ts 源码，按每个
 * `ipcMain.handle("channel", ...)` 切出 handler 代码块，逐块检查是否**直接**出现
 * `parseOrThrow(`；没有的通道必须明确列入 NO_INPUT_CHANNELS，否则失败。
 *
 * why 要求直接出现而不是允许 helper 间接：A-13 复验发现共享 helper 里的
 * parseOrThrow 会让「块内含 parseOrThrow」的静态断言名存实亡（块内看不到调用）。
 * 因此路径类通道也把 parseOrThrow 显式写在 handler 里，helper 只保留 pathPolicy 语义。
 *
 * 路径通道还有第二层锚点：PATH_GUARDED_CHANNELS 里的每个通道，块内必须**直接**出现
 * `requireAllowedProjectPath(` 或 `assertPathAllowed(`。独立验证实测：只锚定
 * parseOrThrow 时，把路径语义白名单（assertPathAllowed / requireAllowedProjectPath）
 * 从 handler 里删掉，门禁仍全绿；第二层断言把「漏接白名单」变成确定性红灯。
 *
 * ⚠ 局限：源码级检查基于文本匹配，能挡住「忘了接线」和「登记造假」，但无法证明
 * 校验一定发生在业务调用之前（例如在函数末尾才 parse）。该层由 code review 与
 * 下面的行为冒烟用例兜底。
 */

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

// vi.mock 会被提升到 import 之前，收集容器必须用 vi.hoisted 一并提升，
// 否则 mock 工厂执行时变量还在 TDZ（Cannot access before initialization）。
const { handlerEntries } = vi.hoisted(() => ({
  handlerEntries: [] as Array<{ channel: string; handler: IpcHandler }>,
}));

/** 纯 Node 环境没有 electron 运行时，给 ipc.ts 需要的全部入口打桩。 */
vi.mock("electron", () => ({
  app: {
    getPath: () => process.cwd(),
    getVersion: () => "0.0.0",
    isPackaged: false,
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      // 只记录，不模拟真实 ipcMain 的重复注册抛错；唯一性由下面的用例单独断言
      handlerEntries.push({ channel, handler });
    },
  },
}));

import { registerIpcHandlers } from "../ipc";
import {
  externalUrlSchema,
  fileListSchema,
  idSchema,
  localPathSchema,
  refNameSchema,
} from "./schemas";

/** 本批次 handler 基线：任何增减都必须显式改这个数字（与 bridgeParity 保持一致）。 */
const EXPECTED_HANDLER_COUNT = 78;

/**
 * 接收入参且已接入校验的通道。
 *
 * 覆盖三类：parseOrThrow(<schema>) 的通道、路径类（parseOrThrow 显式写在 handler
 * 内、pathPolicy 语义由 helper 负责）、以及 shell:openExternal 这类已改为 schema 的通道。
 * 新增带参通道必须同时在这里登记并补 schema，否则下面的接线检查失败。
 */
const VALIDATED_CHANNELS: ReadonlySet<string> = new Set([
  // P-31：路径拼接收归主进程，入参经 resolveTargetPathInputSchema + pathPolicy 校验
  "system:resolveTargetPath",
  "shell:openExternal",
  "shell:openPath",
  "shell:openEditor",
  "shell:openTerminal",
  "projects:inspect",
  "projects:snapshot",
  "projects:analyze",
  "projects:detectCommands",
  "projects:diskSize",
  "projects:readme",
  "projects:init",
  "projects:scanDirectory",
  "projects:fileDiff",
  "projects:setRemoteUrl",
  "git:tags",
  "git:createTag",
  "git:deleteTag",
  "git:listVersions",
  "git:compareVersions",
  "projects:gitOperation",
  "projects:clone",
  "git:changedFiles",
  "git:stageFiles",
  "git:unstageFiles",
  "git:commit",
  "git:branches",
  "git:createBranch",
  "git:switchBranch",
  "git:deleteBranch",
  "git:history",
  "git:revert",
  "projects:load",
  "projects:save",
  "workspaces:create",
  "workspaces:rename",
  "workspaces:delete",
  "accounts:create",
  "accounts:test",
  "accounts:delete",
  "remoteRepositories:load",
  "remoteRepositories:loadCached",
  "remoteRepositories:cacheMeta",
  "remoteRepositories:create",
  "remoteRepositories:update",
  "remoteRepositories:delete",
  "remoteRepositories:search",
  "remoteRepositories:interact",
  "tasks:saveProfile",
  "tasks:deleteProfile",
  "tasks:run",
  "tasks:stop",
  "tasks:getRunningOutput",
  "backups:create",
  "backups:restore",
  "operations:export",
  "settings:save",
  "theme:set",
  "projects:move",
  "ai:generateSummary",
  "ai:saveKey",
  "updater:install",
]);

/**
 * 不接收业务入参的通道：读取类、无参动作，以及 system:selectDirectory。
 *
 * why system:selectDirectory 在这里：它的 defaultPath 只是对话框初始位置提示，
 * 非法值由 safeDialogDefaultPath 丢弃（内部复用 localPathSchema.safeParse +
 * pathPolicy）；通道真正的安全边界是返回值 selected，由 assertLocalAbsolutePath
 * 校验后才登记为会话允许根，因此没有「必须校验的业务入参」。
 *
 * why 单独登记而不是从断言里排除：新增一个无入参通道同样是一次契约变更，
 * 必须有人显式判断它「确实不需要校验」，而不是靠差集自动放行。
 */
const NO_INPUT_CHANNELS: ReadonlySet<string> = new Set([
  "system:environment",
  "system:refreshEnvironment",
  "system:installGit",
  "system:selectDirectory",
  "workspaces:list",
  "accounts:load",
  "tasks:listProfiles",
  "tasks:listRuns",
  "backups:list",
  "operations:list",
  "operations:clear",
  "settings:load",
  "ai:deleteKey",
  "ai:hasKey",
  "updater:check",
  "updater:download",
]);

/**
 * 接收路径、且必须做**路径语义准入**（白名单）的通道基线。
 *
 * why 单列这份清单：文件头的「块内有 parseOrThrow」只锚定了类型/长度校验。
 * 独立验证实测：把 `requireAllowedProjectPath(...)` / `assertPathAllowed(...)`
 * 从任意路径 handler 里删掉，门禁依旧全绿——路径语义接线当时没有任何测试锚点。
 * 这里把路径通道单列成硬编码基线，让「漏接白名单」直接变成确定性红灯。
 *
 * 登记口径：handler 块内出现 `requireAllowedProjectPath(` 或 `assertPathAllowed(`
 * 即视为路径通道（数量以 ipc.ts 实际调用点为准）。
 *
 * 不在本清单的相邻通道，理由必须写明，避免「差集自动放行」：
 * - projects:save 走 assertRegistrableProjectPath 做「新增根登记」，不是对既有根准入；
 * - updater:install 的路径约束在 isTrustedInstallerPath（下载目录 + 文件名白名单），
 *   属于服务层业务白名单而非项目根准入；
 * - system:selectDirectory 的 defaultPath 只是对话框提示，返回值才用
 *   assertLocalAbsolutePath 校验（见 NO_INPUT_CHANNELS 注释）。
 */
const PATH_GUARDED_CHANNELS: ReadonlySet<string> = new Set([
  // P-31：join 结果经 resolveTargetPath 内的 assertPathAllowed 做根目录准入
  "system:resolveTargetPath",
  "shell:openPath",
  "shell:openEditor",
  "shell:openTerminal",
  "projects:inspect",
  "projects:snapshot",
  "projects:analyze",
  "projects:detectCommands",
  "projects:diskSize",
  "projects:readme",
  "projects:init",
  "projects:scanDirectory",
  "projects:fileDiff",
  "projects:setRemoteUrl",
  "git:tags",
  "git:createTag",
  "git:deleteTag",
  "git:listVersions",
  "git:compareVersions",
  "projects:gitOperation",
  "projects:clone",
  "git:changedFiles",
  "git:stageFiles",
  "git:unstageFiles",
  "git:commit",
  "git:branches",
  "git:createBranch",
  "git:switchBranch",
  "git:deleteBranch",
  "git:history",
  "git:revert",
  "operations:export",
  "projects:move",
  "backups:create",
  "backups:restore",
]);

const IPC_SOURCE = readFileSync(new URL("../ipc.ts", import.meta.url), "utf8");

interface HandlerBlock {
  channel: string;
  code: string;
}

/**
 * 按 `ipcMain.handle("channel"` 把源码切成 handler 代码块（切到下一个 handle 或文件尾）。
 *
 * why 行首锚定：正则加 `^[ \t]*` 可避免把注释/字符串里出现的 `ipcMain.handle` 当成
 * 真正的注册点；真实的注册都带两个空格缩进，注释行以 `//` 开头不会被命中。
 */
function splitHandlerBlocks(source: string): HandlerBlock[] {
  const starts = [...source.matchAll(/^[ \t]*ipcMain\.handle\(\s*"([^"]+)"/gm)];
  return starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? source.length;
    // P-35：正则捕获组 [1] 在 noUncheckedIndexedAccess 下可能为 undefined；
    // 正则含字面量捕获组，match 非 null 时必有值，! 仅做类型收窄。
    return { channel: match[1]!, code: source.slice(start, end) };
  });
}

/** 该代码块是否**直接**调用了统一解析入口（不接受 helper 间接，见文件头注释）。 */
function isWired(code: string): boolean {
  return code.includes("parseOrThrow(");
}

/** 取代码块前 count 行，失败信息里带上通道名，便于直接定位漏接线的 handler。 */
function firstLines(code: string, count = 3): string {
  return code
    .split(/\r?\n/)
    .slice(0, count)
    .map((line) => line.trimEnd())
    .join("\n");
}

function describeBlock(block: HandlerBlock): string {
  return `${block.channel}\n${firstLines(block.code)}`;
}

/**
 * 登记为「已校验」却没有接线的通道 = 漏接线；返回「通道名 + 代码块前 3 行」。
 * 抽成纯函数是为了让下面的自测变体复用同一判定，而不是另写一套断言。
 */
function findRegisteredButUnwired(blocks: readonly HandlerBlock[]): string[] {
  return blocks
    .filter((block) => VALIDATED_CHANNELS.has(block.channel) && !isWired(block.code))
    .map(describeBlock);
}

/** 既没接线、也没被列入无入参白名单的通道 = 新的漏网之鱼。 */
function findUnclassified(blocks: readonly HandlerBlock[]): string[] {
  return blocks
    .filter(
      (block) => !VALIDATED_CHANNELS.has(block.channel) && !NO_INPUT_CHANNELS.has(block.channel),
    )
    .map(describeBlock);
}

/** 路径语义准入的三个入口：项目路径 helper、自定义允许根断言，以及备份专用允许根。 */
const PATH_GUARD_CALLS = [
  "requireAllowedProjectPath(",
  "assertPathAllowed(",
  "requireAllowedBackupPath(",
] as const;

/** 该代码块是否**直接**做了路径语义准入（不接受 helper 间接，理由同 isWired）。 */
function isPathGuarded(code: string): boolean {
  return PATH_GUARD_CALLS.some((call) => code.includes(call));
}

/**
 * 登记为路径通道、块内却没有语义准入调用 = 白名单漏接线。
 * 返回「通道名 + 代码块前 3 行」，与 findRegisteredButUnwired 保持同一失败格式。
 */
function findMissingPathGuard(blocks: readonly HandlerBlock[]): string[] {
  return blocks
    .filter((block) => PATH_GUARDED_CHANNELS.has(block.channel) && !isPathGuarded(block.code))
    .map(describeBlock);
}

/**
 * 反向：块内出现路径语义准入、通道却不在 PATH_GUARDED_CHANNELS = 新增路径通道漏分类。
 *
 * why 双向都要查：只查「登记了却没接线」会放过「接了线却没登记」——后者意味着有人
 * 新增了一条路径通道却没经过分类决策，下次改动时这条通道就处在无锚点状态。
 */
function findUnregisteredPathGuard(blocks: readonly HandlerBlock[]): string[] {
  return blocks
    .filter((block) => !PATH_GUARDED_CHANNELS.has(block.channel) && isPathGuarded(block.code))
    .map(describeBlock);
}

const handlerBlocks = splitHandlerBlocks(IPC_SOURCE);

/** 源码里真正调用了 parseOrThrow 的通道集合。 */
const wiredChannels: ReadonlySet<string> = new Set(
  handlerBlocks.filter((block) => isWired(block.code)).map((block) => block.channel),
);

/** 源码里真正做了路径语义准入的通道集合。 */
const pathGuardedChannels: ReadonlySet<string> = new Set(
  handlerBlocks.filter((block) => isPathGuarded(block.code)).map((block) => block.channel),
);

beforeAll(() => {
  registerIpcHandlers();
});

function registeredChannels(): Set<string> {
  return new Set(handlerEntries.map((entry) => entry.channel));
}

function handlerFor(channel: string): IpcHandler {
  const entry = handlerEntries.find((candidate) => candidate.channel === channel);
  if (!entry) {
    throw new Error(`通道未注册：${channel}`);
  }
  return entry.handler;
}

describe("IPC 通道校验覆盖（源码级接线）", () => {
  it(`handler 数量为 ${EXPECTED_HANDLER_COUNT}（注册表与源码两侧一致）`, () => {
    expect(handlerEntries).toHaveLength(EXPECTED_HANDLER_COUNT);
    expect(handlerBlocks).toHaveLength(EXPECTED_HANDLER_COUNT);
  });

  it("handler 通道不重复注册（真实 ipcMain.handle 会直接抛错）", () => {
    const channels = handlerEntries.map((entry) => entry.channel);
    expect(channels).toHaveLength(new Set(channels).size);
  });

  it("源码切出的通道集合与运行时注册表完全一致", () => {
    expect(new Set(handlerBlocks.map((block) => block.channel))).toEqual(registeredChannels());
  });

  it("每个 handler 块必须直接调用 parseOrThrow（核心源码级断言）", () => {
    // 漏接线 = 块内既没有 parseOrThrow(，也没有列入 NO_INPUT_CHANNELS。
    // 失败信息由 findRegisteredButUnwired 输出「通道名 + 代码块前 3 行」，便于定位。
    expect(findRegisteredButUnwired(handlerBlocks)).toEqual([]);
  });

  it("接线集合与 VALIDATED_CHANNELS 双向差集为空", () => {
    // 反向：块内有 parseOrThrow 却没登记 → 有人绕过清单直接接线
    expect([...wiredChannels].filter((channel) => !VALIDATED_CHANNELS.has(channel))).toEqual([]);
    // 正向：登记为已校验却没接线 → 漏接线
    expect([...VALIDATED_CHANNELS].filter((channel) => !wiredChannels.has(channel))).toEqual([]);
  });

  it("清单大小固定：62 已校验 + 16 无入参 = 78", () => {
    expect(VALIDATED_CHANNELS.size).toBe(62);
    expect(NO_INPUT_CHANNELS.size).toBe(16);
  });

  it("注册表 → 清单：没有未分类通道（新增通道必须登记）", () => {
    expect(findUnclassified(handlerBlocks)).toEqual([]);
    expect(
      [...registeredChannels()].filter(
        (channel) => !VALIDATED_CHANNELS.has(channel) && !NO_INPUT_CHANNELS.has(channel),
      ),
    ).toEqual([]);
  });

  it("清单 → 注册表：没有已登记但未注册的通道（双向差集另一侧）", () => {
    const registry = registeredChannels();
    const missing = [...VALIDATED_CHANNELS, ...NO_INPUT_CHANNELS].filter(
      (channel) => !registry.has(channel),
    );
    expect(missing).toEqual([]);
    expect(VALIDATED_CHANNELS.size + NO_INPUT_CHANNELS.size).toBe(EXPECTED_HANDLER_COUNT);
  });

  it("两份清单互不相交，且无入参通道块内不应出现校验调用", () => {
    for (const channel of VALIDATED_CHANNELS) {
      expect(NO_INPUT_CHANNELS.has(channel)).toBe(false);
    }
    const wiredNoInput = handlerBlocks
      .filter((block) => NO_INPUT_CHANNELS.has(block.channel) && isWired(block.code))
      .map((block) => block.channel);
    expect(wiredNoInput).toEqual([]);
  });

  it("路径通道基线数量为 34，且必须全部属于已校验通道", () => {
    // 硬编码基线：ipc.ts 中接收路径的 handler 共 34 个（以实际
    // requireAllowedProjectPath / assertPathAllowed / requireAllowedBackupPath 调用点为准）。
    // 数量变化意味着有通道新增或移除了路径语义，必须显式确认后同步改这里。
    expect(PATH_GUARDED_CHANNELS.size).toBe(35);
    // 路径通道必然要先过 schema：凡是路径通道都必须已在 VALIDATED_CHANNELS 登记。
    expect(
      [...PATH_GUARDED_CHANNELS].filter((channel) => !VALIDATED_CHANNELS.has(channel)),
    ).toEqual([]);
    // 无入参通道不允许出现在路径清单里（两套清单语义互斥）。
    expect([...PATH_GUARDED_CHANNELS].filter((channel) => NO_INPUT_CHANNELS.has(channel))).toEqual(
      [],
    );
  });

  it("每个路径通道的 handler 块必须直接做路径语义准入（核心源码级断言）", () => {
    // 失败信息由 findMissingPathGuard 输出「通道名 + 代码块前 3 行」。
    // 之前只锚定 parseOrThrow，删掉白名单调用门禁仍全绿；这条断言补上那个缺口。
    expect(findMissingPathGuard(handlerBlocks)).toEqual([]);
  });

  it("路径语义接线与 PATH_GUARDED_CHANNELS 双向差集为空", () => {
    // 反向：块内有 requireAllowedProjectPath/assertPathAllowed 却没登记 → 新路径通道漏分类
    expect(
      [...pathGuardedChannels].filter((channel) => !PATH_GUARDED_CHANNELS.has(channel)),
    ).toEqual([]);
    // 正向：登记为路径通道却没接线 → 白名单被删
    expect(
      [...PATH_GUARDED_CHANNELS].filter((channel) => !pathGuardedChannels.has(channel)),
    ).toEqual([]);
  });

  it("自测：路径通道删掉语义准入时判定必须变红，补回后转绿", () => {
    // 内联变体复现「把 requireAllowedProjectPath 换成裸 parseOrThrow」的变异，
    // 与 %TEMP% 副本里的真实变异同构，确保这条门禁不是永远为绿。
    const guarded = [
      '  ipcMain.handle("projects:readme", (_event, p: unknown) =>',
      '    readProjectReadme(requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"))),',
      "  );",
    ].join("\n");
    const unguarded = [
      '  ipcMain.handle("projects:readme", (_event, p: unknown) =>',
      '    readProjectReadme(parseOrThrow(localPathSchema, p, "项目路径")),',
      "  );",
    ].join("\n");

    // 正例先过：有准入时判定为绿，排除「永远报错」的假门禁
    expect(findMissingPathGuard(splitHandlerBlocks(guarded))).toEqual([]);

    const report = findMissingPathGuard(splitHandlerBlocks(unguarded));
    expect(report).toHaveLength(1);
    expect(report[0]).toContain("projects:readme");
    expect(report[0]).toContain('readProjectReadme(parseOrThrow(localPathSchema, p, "项目路径")),');

    // 反向自测：接了线但没登记的新通道同样必须被拦下
    const unregistered = [
      '  ipcMain.handle("projects:archive", (_event, p: unknown) => {',
      '    const target = requireAllowedProjectPath(parseOrThrow(localPathSchema, p, "项目路径"));',
      "    return archiveProject(target);",
      "  });",
    ].join("\n");
    const unregisteredReport = findUnregisteredPathGuard(splitHandlerBlocks(unregistered));
    expect(unregisteredReport).toHaveLength(1);
    expect(unregisteredReport[0]).toContain("projects:archive");
  });

  it("自测：通道登记为已校验但 handler 未接线时，判定必须变红", () => {
    // 内联变体模拟验证者在 %TEMP% 构造的「登记但不接线」场景；
    // 复用同一套切分/判定函数，确保门禁不是永远为绿。
    const unwired = [
      'ipcMain.handle("workspaces:delete", (_event, id: unknown) => {',
      "  return deleteWorkspace(id);",
      "});",
    ].join("\n");
    const unwiredBlocks = splitHandlerBlocks(unwired);
    expect(unwiredBlocks.map((block) => block.channel)).toEqual(["workspaces:delete"]);
    const report = findRegisteredButUnwired(unwiredBlocks);
    expect(report).toHaveLength(1);
    // 失败信息必须带通道名和代码块内容（前 3 行），否则定位成本太高
    expect(report[0]).toContain("workspaces:delete");
    expect(report[0]).toContain("return deleteWorkspace(id);");

    // 正例：同一变体补上 parseOrThrow 后不再被判为漏接线，排除「永远报错」的假门禁
    const wired = unwired.replace(
      "deleteWorkspace(id)",
      'deleteWorkspace(parseOrThrow(idSchema, id, "工作区 ID"))',
    );
    expect(findRegisteredButUnwired(splitHandlerBlocks(wired))).toEqual([]);
  });
});

/**
 * 行为冒烟：选取单入参、校验发生在任何 IO 之前的通道，证明「校验确实在
 * handler 体内执行」而不只是写在登记表里。覆盖不到的多参通道（如 git:stageFiles
 * 要先过路径白名单）由下面的基元用例直接验证 schema。
 */
describe("代表性通道的非法入参必须在校验层被拒", () => {
  it("id 类通道拒绝超长 / 空 / 控制字符", () => {
    expect(() => handlerFor("workspaces:delete")(undefined, "x".repeat(201))).toThrow("标识过长");
    expect(() => handlerFor("accounts:test")(undefined, "")).toThrow("标识不能为空");
    expect(() => handlerFor("tasks:run")(undefined, "abc\u0001")).toThrow("标识包含非法控制字符");
    expect(() => handlerFor("projects:load")(undefined, "x".repeat(5000))).toThrow("标识过长");
  });

  it("路径类通道拒绝空路径（语义白名单仍由 pathPolicy 负责）", () => {
    expect(() => handlerFor("operations:export")(undefined, "   ")).toThrow("路径不能为空");
  });

  it("外链通道只放行 http(s)，且保留原错误文案", async () => {
    await expect(
      handlerFor("shell:openExternal")(undefined, "file:///C:/Windows/system32/calc.exe"),
    ).rejects.toThrow("只允许打开 HTTP 或 HTTPS 链接");
    await expect(
      handlerFor("shell:openExternal")(undefined, "https://example.com"),
    ).resolves.toBeUndefined();
  });
});

describe("新增 schema 基元边界", () => {
  it("localPathSchema：trim、非空、4096 上限、拒控制字符，且不做路径语义判断", () => {
    expect(localPathSchema.parse("  C:\\work\\demo  ")).toBe("C:\\work\\demo");
    expect(() => localPathSchema.parse("   ")).toThrow("路径不能为空");
    expect(() => localPathSchema.parse("a".repeat(4097))).toThrow("路径过长");
    expect(localPathSchema.parse("a".repeat(4096))).toHaveLength(4096);
    expect(() => localPathSchema.parse("C:\\work\\a\u0000b")).toThrow("路径包含非法控制字符");
    // 相对路径与 UNC 是 pathPolicy 的职责：schema 层放行，避免两处规则漂移
    expect(localPathSchema.parse("relative\\dir")).toBe("relative\\dir");
  });

  it("externalUrlSchema：仅 http(s)、2048 上限、拒控制字符", () => {
    expect(externalUrlSchema.parse("  https://example.com/a  ")).toBe("https://example.com/a");
    expect(externalUrlSchema.parse("HTTP://EXAMPLE.COM")).toBe("HTTP://EXAMPLE.COM");
    expect(() => externalUrlSchema.parse("file:///C:/Windows/system32/calc.exe")).toThrow(
      "只允许打开 HTTP 或 HTTPS 链接",
    );
    expect(() => externalUrlSchema.parse("javascript:alert(1)")).toThrow(
      "只允许打开 HTTP 或 HTTPS 链接",
    );
    expect(() => externalUrlSchema.parse("")).toThrow("链接不能为空");
    expect(() => externalUrlSchema.parse(`https://e.com/${"a".repeat(2041)}`)).toThrow("链接过长");
    expect(() => externalUrlSchema.parse("https://e.com/\u0000")).toThrow("链接包含非法控制字符");
  });

  it("idSchema：非空、200 上限、拒绝控制字符", () => {
    expect(idSchema.parse("  3f2a-11  ")).toBe("3f2a-11");
    expect(() => idSchema.parse("")).toThrow("标识不能为空");
    expect(() => idSchema.parse("   ")).toThrow("标识不能为空");
    expect(() => idSchema.parse("x".repeat(201))).toThrow("标识过长");
    expect(idSchema.parse("x".repeat(200))).toHaveLength(200);
    expect(() => idSchema.parse("abc\u0001")).toThrow("标识包含非法控制字符");
    expect(() => idSchema.parse("abc\u007f")).toThrow("标识包含非法控制字符");
  });

  it("refNameSchema：255 上限、拒绝控制字符 / `..` / 空白开头，且不 trim", () => {
    expect(refNameSchema.parse("v1.0.0")).toBe("v1.0.0");
    expect(() => refNameSchema.parse("")).toThrow("名称不能为空");
    expect(() => refNameSchema.parse("v".repeat(256))).toThrow("名称过长");
    expect(refNameSchema.parse("v".repeat(255))).toHaveLength(255);
    expect(() => refNameSchema.parse("v1\u0000")).toThrow("名称包含非法控制字符");
    expect(() => refNameSchema.parse("v1..2")).toThrow("名称不能包含「..」");
    expect(() => refNameSchema.parse(" tag")).toThrow("名称不能以空白开头");
    // 不 trim：带尾随空白的名字保持原样，交给 git 自己判定（避免删到同名近似标签）
    expect(refNameSchema.parse("v1.0.0 ")).toBe("v1.0.0 ");
  });

  it("fileListSchema：数组类型、总量 10000、单项 4096", () => {
    expect(fileListSchema.parse(["a.txt", "dir/b.ts"])).toEqual(["a.txt", "dir/b.ts"]);
    expect(fileListSchema.parse([])).toEqual([]);
    // 空字符串项沿用改造前口径：只判类型与长度，业务判定的交给 git
    expect(fileListSchema.parse([""])).toEqual([""]);
    expect(() => fileListSchema.parse("a.txt")).toThrow();
    expect(() => fileListSchema.parse(new Array(10001).fill("a.txt"))).toThrow("文件数量过多");
    expect(fileListSchema.parse(new Array(10000).fill("a.txt"))).toHaveLength(10000);
    expect(() => fileListSchema.parse(["a".repeat(4097)])).toThrow("文件路径过长");
    expect(fileListSchema.parse(["a".repeat(4096)])[0]).toHaveLength(4096);
  });
});
