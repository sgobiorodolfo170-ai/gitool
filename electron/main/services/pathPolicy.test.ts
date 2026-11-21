import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { win32 } from "node:path";
import {
  assertLocalAbsolutePath,
  assertPathAllowed,
  assertRegistrableProjectPath,
  backupPathRoots,
  collectAllowedRoots,
  pathsNeedingValidation,
  PathPolicyError,
  requireAllowedBackupPath,
} from "./pathPolicy";

/**
 * 路径策略的边界覆盖。
 *
 * 这些用例是「渲染层被攻破」威胁模型的回归靶子：
 * UNC（SMB 认证泄露）、相对路径（依赖 cwd）、`..` 穿越、允许根前缀撞名、
 * 大小写差异、尾随分隔符、Windows 保留设备名。任何一条退化为「放行」，
 * 都意味着 12+ 个路径类 IPC 同时失守。
 */

const HOME = "C:\\Users\\tester";
const PROJECT = "C:\\Users\\tester\\workspace\\demo";

describe("assertLocalAbsolutePath", () => {
  it("拒绝反斜杠形式的 UNC 路径", () => {
    expect(() => assertLocalAbsolutePath("\\\\evil\\share\\project", "项目路径")).toThrow(
      PathPolicyError,
    );
    expect(() => assertLocalAbsolutePath("\\\\evil\\share\\project", "项目路径")).toThrow(
      /不支持网络共享路径（UNC）/,
    );
  });

  it("拒绝正斜杠形式的 UNC 路径", () => {
    expect(() => assertLocalAbsolutePath("//evil/share/project", "项目路径")).toThrow(
      PathPolicyError,
    );
  });

  it("拒绝 Win32 设备/扩展路径前缀", () => {
    expect(() => assertLocalAbsolutePath("\\\\?\\C:\\data\\project", "项目路径")).toThrow(
      /不支持网络共享路径（UNC）/,
    );
    expect(() => assertLocalAbsolutePath("\\\\.\\PhysicalDrive0", "项目路径")).toThrow(
      PathPolicyError,
    );
  });

  it("拒绝相对路径与驱动器相对路径", () => {
    expect(() => assertLocalAbsolutePath("data\\project", "项目路径")).toThrow(/必须是绝对路径/);
    expect(() => assertLocalAbsolutePath(".\\project", "项目路径")).toThrow(/必须是绝对路径/);
    expect(() => assertLocalAbsolutePath("C:project", "项目路径")).toThrow(/必须是绝对路径/);
  });

  it("拒绝缺少盘符的根相对路径", () => {
    expect(() => assertLocalAbsolutePath("\\Windows\\System32", "项目路径")).toThrow(
      /本地盘符绝对路径/,
    );
    expect(() => assertLocalAbsolutePath("/data/project", "项目路径")).toThrow(/本地盘符绝对路径/);
  });

  it("拒绝含 .. 段的穿越路径", () => {
    expect(() => assertLocalAbsolutePath("C:\\data\\..\\Windows", "项目路径")).toThrow(
      /不能包含上级目录/,
    );
    expect(() => assertLocalAbsolutePath("C:/data/../../etc", "项目路径")).toThrow(
      /不能包含上级目录/,
    );
  });

  it("不误伤以 .. 开头的合法目录名", () => {
    const resolved = assertLocalAbsolutePath("C:\\data\\..cache\\project", "项目路径");
    expect(resolved).toBe("C:\\data\\..cache\\project");
    // `...` 是合法文件名，不属于 `..` 段
    expect(() => assertLocalAbsolutePath("C:\\data\\...\\project", "项目路径")).not.toThrow();
  });

  it("拒绝空字符与控制字符", () => {
    expect(() => assertLocalAbsolutePath("C:\\data\\bad\u0000name", "项目路径")).toThrow(
      /非法控制字符/,
    );
    expect(() => assertLocalAbsolutePath("C:\\data\\bad\nname", "项目路径")).toThrow(
      /非法控制字符/,
    );
  });

  it("拒绝 Windows 保留设备名（含扩展名与尾随空格）", () => {
    expect(() => assertLocalAbsolutePath("C:\\data\\CON\\project", "项目路径")).toThrow(
      /保留设备名/,
    );
    expect(() => assertLocalAbsolutePath("C:\\data\\nul.txt", "项目路径")).toThrow(/保留设备名/);
    expect(() => assertLocalAbsolutePath("C:\\data\\com1 \\project", "项目路径")).toThrow(
      /保留设备名/,
    );
    // 普通名字含保留子串不命中
    expect(() => assertLocalAbsolutePath("C:\\data\\console\\project", "项目路径")).not.toThrow();
  });

  it("接受本机绝对路径并返回 resolve 后的规范形式", () => {
    expect(assertLocalAbsolutePath("C:/data/project/", "项目路径")).toBe("C:\\data\\project");
    expect(assertLocalAbsolutePath("D:\\work\\repo", "项目路径")).toBe("D:\\work\\repo");
  });

  it("拒绝空字符串", () => {
    expect(() => assertLocalAbsolutePath("", "项目路径")).toThrow(/不能为空/);
  });
});

describe("assertPathAllowed", () => {
  it("放行位于允许根之下的路径", () => {
    expect(assertPathAllowed("C:\\data\\project\\src", ["C:\\data"], "项目路径")).toBe(
      "C:\\data\\project\\src",
    );
  });

  it("放行允许根本身（含尾随分隔符差异）", () => {
    expect(assertPathAllowed("C:\\data", ["C:\\data\\"], "项目路径")).toBe("C:\\data");
    expect(assertPathAllowed("C:\\data\\", ["C:\\data"], "项目路径")).toBe("C:\\data");
  });

  it("拒绝前缀撞名的兄弟目录（关键：不能用 startsWith）", () => {
    expect(() => assertPathAllowed("C:\\data-evil\\project", ["C:\\data"], "项目路径")).toThrow(
      /路径不在允许范围内/,
    );
    expect(() => assertPathAllowed("C:\\data2\\project", ["C:\\data"], "项目路径")).toThrow(
      PathPolicyError,
    );
  });

  it("大小写不敏感比较", () => {
    expect(assertPathAllowed("C:\\DATA\\Proj", ["c:\\data"], "项目路径")).toBe("C:\\DATA\\Proj");
  });

  it("拒绝允许根之外的路径", () => {
    expect(() =>
      assertPathAllowed("C:\\Windows\\System32", ["C:\\Users\\tester"], "项目路径"),
    ).toThrow(/路径不在允许范围内/);
  });

  it("拒绝未在根内的用户主目录近似路径", () => {
    expect(() => assertPathAllowed("C:\\Users\\tester-evil\\data", [HOME], "项目路径")).toThrow(
      /路径不在允许范围内/,
    );
  });

  it("多根场景：已登记项目路径可放行", () => {
    const roots = collectAllowedRoots({
      homeDirectory: HOME,
      registeredProjectPaths: ["D:\\work\\repo"],
    });
    expect(assertPathAllowed("d:\\WORK\\repo\\src", roots, "项目路径")).toBe("d:\\WORK\\repo\\src");
  });

  it("主目录下的路径可放行", () => {
    const roots = collectAllowedRoots({ homeDirectory: HOME });
    expect(assertPathAllowed("C:\\Users\\tester\\workspace\\demo", roots, "项目路径")).toBe(
      PROJECT,
    );
  });

  it("以 .. 开头的目录名不会被误判为越界", () => {
    expect(assertPathAllowed("C:\\data\\..cache\\project", ["C:\\data"], "项目路径")).toBe(
      "C:\\data\\..cache\\project",
    );
  });

  it("根内路径尝试用 .. 逃逸时被拒绝", () => {
    expect(() =>
      assertPathAllowed("C:\\data\\..\\Windows\\System32", ["C:\\data"], "项目路径"),
    ).toThrow(/不能包含上级目录/);
  });

  it("UNC 目标在允许根检查之前就被拒绝", () => {
    expect(() => assertPathAllowed("\\\\evil\\share", ["C:\\data"], "项目路径")).toThrow(
      /不支持网络共享路径（UNC）/,
    );
  });

  it("非法根（UNC/相对/穿越）被丢弃，不会扩大放行面", () => {
    const roots = collectAllowedRoots({
      homeDirectory: HOME,
      registeredProjectPaths: ["\\\\evil\\share", "relative\\path", "C:\\data\\..\\evil"],
    });
    expect(() => assertPathAllowed("\\\\evil\\share\\project", roots, "项目路径")).toThrow(
      /不支持网络共享路径（UNC）/,
    );
    expect(() => assertPathAllowed("C:\\evil\\project", roots, "项目路径")).toThrow(
      /路径不在允许范围内/,
    );
  });

  it("抛出的错误类型与统一文案便于 UI 展示", () => {
    try {
      assertPathAllowed("C:\\Windows\\System32", ["C:\\data"], "项目路径");
      throw new Error("应当抛出 PathPolicyError");
    } catch (error) {
      expect(error).toBeInstanceOf(PathPolicyError);
      expect((error as PathPolicyError).name).toBe("PathPolicyError");
      expect((error as PathPolicyError).code).toBe("PATH_NOT_ALLOWED");
      expect((error as PathPolicyError).message).toContain("路径不在允许范围内");
    }
  });
});

describe("collectAllowedRoots", () => {
  it("组合主目录、已登记项目、备份目录与显式追加目录", () => {
    const roots = collectAllowedRoots({
      homeDirectory: HOME,
      registeredProjectPaths: ["D:\\work\\repo"],
      backupDirectory: "E:\\backups",
      extraRoots: ["F:\\selected"],
    });
    expect(roots).toEqual([HOME, "D:\\work\\repo", "E:\\backups", "F:\\selected"]);
  });

  it("大小写不敏感去重", () => {
    const roots = collectAllowedRoots({
      homeDirectory: "C:\\Users\\Tester",
      registeredProjectPaths: ["c:\\users\\tester", "C:\\Users\\Tester\\workspace"],
      extraRoots: ["C:\\USERS\\TESTER\\WORKSPACE"],
    });
    expect(roots).toEqual(["C:\\Users\\Tester", "C:\\Users\\Tester\\workspace"]);
  });

  it("忽略空值、空字符串与非法根", () => {
    const roots = collectAllowedRoots({
      homeDirectory: HOME,
      registeredProjectPaths: ["", "relative\\path"],
      backupDirectory: null,
      extraRoots: ["\\\\evil\\share"],
    });
    expect(roots).toEqual([HOME]);
  });

  it.runIf(process.platform === "win32")("默认包含用户主目录", () => {
    const roots = collectAllowedRoots();
    expect(roots).toContain(win32.resolve(homedir()));
  });
});

/**
 * 备份允许根：备份产物 / 归档 / 恢复目标必须落在用户可控目录内。
 *
 * why 这些用例是 P1-2 的回归靶子：修复前 backups:create / backups:restore 只做 schema
 * 校验，系统目录可以当源目录或恢复目标。这里的断言覆盖「设置被污染」这一最坏情况——
 * 即使默认备份目录被改成 C:\Windows\System32，也必须被系统关键目录拒绝。
 */
describe("backupPathRoots", () => {
  it("组合主目录、默认备份目录与会话选择目录（不含已登记项目）", () => {
    expect(
      backupPathRoots({
        homeDirectory: HOME,
        backupDirectory: "D:\\gitool-backups",
        extraRoots: ["E:\\picked-in-dialog"],
      }),
    ).toEqual([HOME, "D:\\gitool-backups", "E:\\picked-in-dialog"]);
  });

  it("丢弃非法根并大小写不敏感去重", () => {
    expect(
      backupPathRoots({
        homeDirectory: HOME,
        backupDirectory: HOME.toLowerCase(),
        extraRoots: ["\\\\evil\\share", "relative\\dir", "D:\\backups"],
      }),
    ).toEqual([HOME, "D:\\backups"]);
  });
});

describe("requireAllowedBackupPath", () => {
  const options = { homeDirectory: HOME, backupDirectory: "D:\\gitool-backups" };

  it("放行主目录、默认备份目录与会话选择目录下的路径", () => {
    expect(requireAllowedBackupPath(`${HOME}\\backups`, options, "备份目录")).toBe(
      `${HOME}\\backups`,
    );
    expect(requireAllowedBackupPath("D:\\gitool-backups\\demo-2026.zip", options, "备份文件")).toBe(
      "D:\\gitool-backups\\demo-2026.zip",
    );
    expect(
      requireAllowedBackupPath(
        "E:\\picked\\demo",
        { ...options, extraRoots: ["E:\\picked"] },
        "恢复目录",
      ),
    ).toBe("E:\\picked\\demo");
  });

  it("拒绝允许根之外的普通目录", () => {
    expect(() => requireAllowedBackupPath("C:\\srv\\backups", options, "备份目录")).toThrow(
      /不在允许范围内/,
    );
  });

  it("拒绝盘符根目录", () => {
    expect(() => requireAllowedBackupPath("D:\\", options, "备份目录")).toThrow(/磁盘根目录/);
    expect(() => requireAllowedBackupPath("D:/", options, "备份目录")).toThrow(/磁盘根目录/);
  });

  it("拒绝 UNC、相对路径与 .. 穿越（复用本机绝对路径断言）", () => {
    expect(() => requireAllowedBackupPath("\\\\evil\\share\\backups", options)).toThrow(/UNC/);
    expect(() => requireAllowedBackupPath("backups\\demo", options)).toThrow(/绝对路径/);
    expect(() => requireAllowedBackupPath(`${HOME}\\backups\\..\\..\\Windows`, options)).toThrow(
      /上级目录/,
    );
  });

  it("拒绝被配置成允许根的系统关键目录（settings 被污染）", () => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const system32 = win32.join(systemRoot, "System32");
    expect(() =>
      requireAllowedBackupPath(
        system32,
        { homeDirectory: HOME, backupDirectory: system32 },
        "恢复目录",
      ),
    ).toThrow(/系统关键目录/);
  });
});

/**
 * 项目登记门的边界。
 *
 * why 只在 Windows 跑：校验依赖 %SystemRoot% / %ProgramFiles% 等真实环境变量与
 * win32 路径语义；本产品只发布 Windows 版本，其他平台跳过不影响 CI（CI 即 Windows）。
 */
const describeOnWindows = process.platform === "win32" ? describe : describe.skip;

describeOnWindows("assertRegistrableProjectPath", () => {
  it("拒绝系统关键目录及其子目录", () => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    expect(() =>
      assertRegistrableProjectPath(win32.join(systemRoot, "System32"), "项目路径"),
    ).toThrow(/系统关键目录/);

    const programFiles = process.env.ProgramFiles;
    if (programFiles && existsSync(programFiles)) {
      expect(() => assertRegistrableProjectPath(programFiles, "项目路径")).toThrow(/系统关键目录/);
    }
  });

  it("拒绝盘符根目录", () => {
    expect(() => assertRegistrableProjectPath("C:\\", "项目路径")).toThrow(/磁盘根目录/);
    expect(() => assertRegistrableProjectPath("D:/", "项目路径")).toThrow(/磁盘根目录/);
  });

  it("拒绝不存在的目录", () => {
    const missing = win32.join(tmpdir(), `gitool-missing-${process.pid}-${Date.now()}`);
    expect(() => assertRegistrableProjectPath(missing, "项目路径")).toThrow(/不存在/);
  });

  it("拒绝普通文件", () => {
    const directory = mkdtempSync(win32.join(tmpdir(), "gitool-pathpolicy-file-"));
    try {
      const file = win32.join(directory, "readme.md");
      writeFileSync(file, "not a directory");
      expect(() => assertRegistrableProjectPath(file, "项目路径")).toThrow(/不是目录/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("放行临时普通目录并返回规范路径", () => {
    const directory = mkdtempSync(win32.join(tmpdir(), "gitool-pathpolicy-ok-"));
    try {
      expect(assertRegistrableProjectPath(directory, "项目路径")).toBe(win32.resolve(directory));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/**
 * 增量校验的核心语义：只有本次新出现/被改过的路径才需要过登记门。
 *
 * why 这些用例重要：projects:save 是整表覆盖，如果把「已登记但当前离线」的路径也
 * 逐条校验，U 盘拔出/网络盘未挂载时收藏、改别名、删除项目都会一起失败。
 */
describe("pathsNeedingValidation", () => {
  const project = (path: string): { path: string } => ({ path });

  it("新增路径需要校验", () => {
    expect(
      pathsNeedingValidation(
        [project("C:\\work\\a"), project("C:\\work\\b")],
        new Set(["C:\\work\\a"]),
      ),
    ).toEqual(["C:\\work\\b"]);
  });

  it("路径未变的既有条目不再校验（离线盘不阻断保存）", () => {
    expect(
      pathsNeedingValidation([project("Z:\\offline\\project")], new Set(["Z:\\offline\\project"])),
    ).toEqual([]);
  });

  it("项目换路径（同 id 换了新 path）需要校验", () => {
    // id 不参与判断：路径变了就表示要把新目录登记进白名单
    const incoming = [{ id: "p1", path: "D:\\new-place" }];
    expect(pathsNeedingValidation(incoming, new Set(["C:\\old-place"]))).toEqual(["D:\\new-place"]);
  });

  it("大小写、斜杠与尾随分隔符差异视为同一路径", () => {
    const existing = new Set(["C:\\Work\\Demo"]);
    expect(
      pathsNeedingValidation([project("c:/work/demo/"), project("C:\\WORK\\DEMO\\")], existing),
    ).toEqual([]);
  });

  it("空 existing 集合时全部校验，且同路径去重", () => {
    expect(
      pathsNeedingValidation(
        [project("C:\\work\\a"), project("c:/work/A/"), project("C:\\work\\b")],
        new Set(),
      ),
    ).toEqual(["C:\\work\\a", "C:\\work\\b"]);
  });

  it("盘符根与普通路径按不同键处理", () => {
    // 盘符根不会被尾随分隔符归一化误并到 C:\work
    const pending = pathsNeedingValidation([project("C:\\")], new Set(["C:\\work"]));
    expect(pending).toEqual(["C:\\"]);
  });
});
