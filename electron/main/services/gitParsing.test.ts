import { describe, expect, it } from "vitest";
import {
  bracketValue,
  buildCommitMessageArgs,
  isValidCommitHash,
  isValidRefName,
  parseBranchLine,
  parseChangeStatus,
  parseCloneProgress,
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

describe("buildCommitMessageArgs", () => {
  it("每个非空行生成一组 -m", () => {
    expect(buildCommitMessageArgs("标题\n\n正文第一行\n正文第二行")).toEqual([
      "-m", "标题",
      "-m", "正文第一行",
      "-m", "正文第二行",
    ]);
  });

  it("保留行内的空格，只丢弃空行", () => {
    expect(buildCommitMessageArgs("  a  b  ")).toEqual(["-m", "  a  b"]);
  });

  it("空输入返回空数组", () => {
    expect(buildCommitMessageArgs("\n\n  \n")).toEqual([]);
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
