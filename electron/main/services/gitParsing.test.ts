import { describe, expect, it } from "vitest";
import {
  bracketValue,
  buildCommitMessageArgs,
  isValidCommitHash,
  isValidRefName,
  parseBranchLine,
  parseChangeStatus,
  parseCloneProgress,
  parseCommitHistory,
  parseNumstatPaths,
  parseStatusPorcelainZ,
  toLiteralPathspec,
} from "./gitParsing";

describe("isValidRefName", () => {
  it("放行常规分支与标签名", () => {
    for (const name of ["main", "feature/login", "v1.0.0", "release-2026_10", "a.b/c-d_e"]) {
      expect(isValidRefName(name), name).toBe(true);
    }
  });

  it("拒绝以 - 开头的值，防止被 git 当作选项", () => {
    // 关键回归用例：compareVersions 曾未校验，`--output=<path>` 可让 git 写任意文件
    expect(isValidRefName("--output=C:/evil.txt")).toBe(false);
    expect(isValidRefName("-D")).toBe(false);
  });

  it("拒绝空格、引号、反斜杠与 shell 元字符", () => {
    for (const name of ["a b", "a'b", 'a"b', "a;rm -rf", "a|b", "a\\b", "a$b"]) {
      expect(isValidRefName(name), name).toBe(false);
    }
  });

  it("拒绝空串与超长值", () => {
    expect(isValidRefName("")).toBe(false);
    expect(isValidRefName("   ")).toBe(false);
    expect(isValidRefName("a".repeat(256))).toBe(false);
  });
});

describe("isValidCommitHash", () => {
  it("接受 7-40 位十六进制", () => {
    expect(isValidCommitHash("abc1234")).toBe(true);
    expect(isValidCommitHash("a".repeat(40))).toBe(true);
  });

  it("接受 ^ 与 ~N 后缀", () => {
    expect(isValidCommitHash("abc1234^")).toBe(true);
    expect(isValidCommitHash("abc1234~2")).toBe(true);
  });

  it("拒绝过短、非十六进制与注入尝试", () => {
    expect(isValidCommitHash("abc12")).toBe(false);
    expect(isValidCommitHash("zzzzzzz")).toBe(false);
    expect(isValidCommitHash("abc1234; rm -rf")).toBe(false);
    expect(isValidCommitHash("--output=x")).toBe(false);
  });
});

describe("parseChangeStatus", () => {
  it("识别冲突", () => {
    expect(parseChangeStatus("UU")).toBe("conflicted");
    expect(parseChangeStatus("AA")).toBe("conflicted");
    expect(parseChangeStatus("DD")).toBe("conflicted");
  });

  it("识别未跟踪", () => {
    expect(parseChangeStatus("??")).toBe("untracked");
  });

  it("识别重命名、删除、新增", () => {
    expect(parseChangeStatus("R ")).toBe("renamed");
    expect(parseChangeStatus(" D")).toBe("deleted");
    expect(parseChangeStatus("A ")).toBe("added");
  });

  it("默认归类为修改", () => {
    expect(parseChangeStatus(" M")).toBe("modified");
  });
});

describe("bracketValue", () => {
  it("从分支行提取 ahead / behind 数值", () => {
    const line = "## main...origin/main [ahead 2, behind 1]";
    expect(bracketValue(line, "ahead")).toBe("2");
    expect(bracketValue(line, "behind")).toBe("1");
  });

  it("只有 ahead 时 behind 返回 null", () => {
    const line = "## main...origin/main [ahead 3]";
    expect(bracketValue(line, "ahead")).toBe("3");
    expect(bracketValue(line, "behind")).toBeNull();
  });

  it("无跟踪信息时返回 null", () => {
    expect(bracketValue("## main", "ahead")).toBeNull();
  });
});

describe("parseCloneProgress", () => {
  it("取最后一次出现的百分比作为当前进度", () => {
    const output = "Receiving objects: 45% (45/100)\nResolving deltas: 80% (8/10)";
    expect(parseCloneProgress(output)).toBe(80);
  });

  it("无百分比时返回 0", () => {
    expect(parseCloneProgress("Cloning into 'repo'...")).toBe(0);
  });

  it("钳制到 0-100 区间", () => {
    expect(parseCloneProgress("done 250%")).toBe(100);
  });
});

describe("parseCommitHistory", () => {
  // 关键回归（2026-11-07 审查 P0-1）：旧实现把 \x1f 放在 %s 与 %b 之间当记录分隔符，
  // 而记录之间只有换行，导致除最新一条外所有 commit 的 hash 被
  // 「上一条 body + 换行 + 真实 hash」污染，回退功能对历史提交全部失效。
  it("按记录尾分隔符切分多条记录，hash 不被上一条 body 污染", () => {
    const output =
      "a1b2c3d\x1f张三\x1fa@x.com\x1f2026-01-01T00:00:00+08:00\x1f第一条\x1fbody-A 第 1 行\nbody-A 第 2 行\x1e" +
      "\nb4c5d6e\x1f李四\x1fb@x.com\x1f2026-01-02T00:00:00+08:00\x1f第二条\x1f\x1e\n";
    expect(parseCommitHistory(output)).toEqual([
      {
        hash: "a1b2c3d",
        author: "张三",
        email: "a@x.com",
        date: "2026-01-01T00:00:00+08:00",
        subject: "第一条",
        body: "body-A 第 1 行\nbody-A 第 2 行",
      },
      {
        hash: "b4c5d6e",
        author: "李四",
        email: "b@x.com",
        date: "2026-01-02T00:00:00+08:00",
        subject: "第二条",
        body: "",
      },
    ]);
  });

  it("空输出返回空数组", () => {
    expect(parseCommitHistory("")).toEqual([]);
  });

  it("字段不足的残缺记录被跳过", () => {
    expect(parseCommitHistory("onlyhash\x1fpartial\x1e\n")).toEqual([]);
  });
});

describe("buildCommitMessageArgs", () => {
  it("整段提交信息作为单条 -m 传入，换行结构原样保留", () => {
    // 关键回归（2026-11-07 审查 P1-2）：旧实现按行拆多个 -m，
    // git 会以空行连接各段，把列表/代码块等换行结构打散。
    expect(buildCommitMessageArgs("标题\n\n正文第一行\n- 列表项")).toEqual([
      "-m",
      "标题\n\n正文第一行\n- 列表项",
    ]);
  });

  it("去除首尾空白", () => {
    expect(buildCommitMessageArgs("  标题  ")).toEqual(["-m", "标题"]);
  });

  it("空输入返回空数组", () => {
    expect(buildCommitMessageArgs("\n\n  \n")).toEqual([]);
  });
});

describe("parseStatusPorcelainZ", () => {
  it("解析普通条目", () => {
    expect(parseStatusPorcelainZ(" M a.txt\0?? new.txt\0")).toEqual([
      { status: " M", path: "a.txt", staged: false },
      { status: "??", path: "new.txt", staged: false },
    ]);
  });

  // 关键回归（2026-11-07 审查 P2-3）：-z 模式下 rename/copy 条目带第二个
  // \0 分隔的原始路径段，必须成对消费——旧实现把旧路径当独立条目解析，
  // 旧路径第 3 字符恰为空格时产生幻影 staged 记录。
  it("rename 条目成对消费原始路径，不产生幻影记录", () => {
    const output = "R  new name.md\0ab c.md\0 M other.txt\0";
    expect(parseStatusPorcelainZ(output)).toEqual([
      { status: "R ", path: "new name.md", staged: true },
      { status: " M", path: "other.txt", staged: false },
    ]);
  });

  it("copy 条目同样成对消费", () => {
    const output = "C  copied.txt\0original.txt\0";
    expect(parseStatusPorcelainZ(output)).toEqual([
      { status: "C ", path: "copied.txt", staged: true },
    ]);
  });

  it("空输出与空路径段被跳过", () => {
    expect(parseStatusPorcelainZ("")).toEqual([]);
    expect(parseStatusPorcelainZ("?? \0")).toEqual([]);
  });
});

describe("parseNumstatPaths", () => {
  it("提取每个条目的路径", () => {
    expect(parseNumstatPaths("12\t3\tsrc/a.ts\n0\t2\tdocs/b.md\n")).toEqual([
      "src/a.ts",
      "docs/b.md",
    ]);
  });

  it("重命名条目保留 old => new 形式", () => {
    expect(parseNumstatPaths("1\t1\told.txt => new.txt\n")).toEqual(["old.txt => new.txt"]);
  });

  it("二进制占位符不影响路径提取", () => {
    expect(parseNumstatPaths("-\t-\tmedia/logo.png\n")).toEqual(["media/logo.png"]);
  });

  it("空输出返回空数组", () => {
    expect(parseNumstatPaths("")).toEqual([]);
  });
});

describe("toLiteralPathspec", () => {
  it("加 :(literal) 前缀关闭 glob 语义", () => {
    // 文件名含 [ ] * ? 时，裸 pathspec 会被 git 当通配符匹配到错误文件
    expect(toLiteralPathspec("data[1].txt")).toBe(":(literal)data[1].txt");
  });
});

describe("parseBranchLine", () => {
  it("解析当前分支与跟踪信息", () => {
    expect(parseBranchLine("* main 1a2b3c4 [origin/main: ahead 2, behind 1] msg")).toEqual({
      name: "main",
      current: true,
      remote: "origin/main",
      ahead: 2,
      behind: 1,
    });
  });

  it("解析无跟踪信息的本地分支", () => {
    expect(parseBranchLine("  feature/x 1a2b3c4 msg")).toEqual({
      name: "feature/x",
      current: false,
      remote: undefined,
      ahead: 0,
      behind: 0,
    });
  });

  it("空行返回 null", () => {
    expect(parseBranchLine("   ")).toBeNull();
  });
});
