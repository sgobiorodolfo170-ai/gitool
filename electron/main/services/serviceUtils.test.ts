import { describe, expect, it } from "vitest";
import { redactSecrets } from "./serviceUtils";

/**
 * redactSecrets 是「最后一道兜底」：入口拦截（拒绝内嵌凭据的 URL）由 git 侧负责，
 * 这里覆盖历史日志、git 输出、CSV 导出这些已经落盘/即将外发的文本。
 * 因此测试重点是「该脱的必须脱干净」+「正常内容一个字符都不能动」。
 */
describe("redactSecrets", () => {
  it("脱敏 URL 内嵌凭据，保留 scheme 与 host", () => {
    expect(redactSecrets("https://user:s3cret@github.com/a/b")).toBe("https://***@github.com/a/b");
    // scheme 大小写必须原样保留：日志里出现 HTTPs:// 也不该被改写
    expect(redactSecrets("HTTPS://alice:p%40ss@git.example.com/x.git")).toBe(
      "HTTPS://***@git.example.com/x.git",
    );
  });

  it("脱敏 Authorization: Bearer 头", () => {
    expect(redactSecrets("Authorization: Bearer abc123XYZ")).toBe("Authorization: Bearer ***");
    // 头名大小写不敏感（git/http 日志里两种都见过）
    expect(redactSecrets("authorization: bearer opaque-token-1")).toBe("authorization: bearer ***");
  });

  it("脱敏常见平台令牌前缀的长串", () => {
    const tokens = [
      "ghp_1234567890abcdefghijklmnopqrstuvwx",
      "gho_1234567890abcdefghijklmnopqrstuvwx",
      "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
      "glpat-AbCdEf123456789xyz",
      "[REDACTED_SLACK_TOKEN]",
    ];
    for (const token of tokens) {
      expect(redactSecrets(`token=${token} end`)).toBe("token=*** end");
    }
  });

  it("正常 URL 与普通文本不受影响", () => {
    // 关键回归：脱敏不能把正常仓库地址打码，否则日志失去可读性
    expect(redactSecrets("https://github.com/a/b")).toBe("https://github.com/a/b");
    // scp 形态（user@host:path）不是内嵌凭据，不能误伤
    expect(redactSecrets("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
    expect(redactSecrets("Already up to date.")).toBe("Already up to date.");
    expect(redactSecrets("~/.gitconfig 与 settings.json")).toBe("~/.gitconfig 与 settings.json");
  });

  it("一段文本里的多种形态全部脱敏", () => {
    const input = [
      "remote: https://bob:topsecret@gitlab.com/team/repo.git",
      "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwx",
      "glpat-AbCdEf123456789xyz",
    ].join("\n");
    expect(redactSecrets(input)).toBe(
      ["remote: https://***@gitlab.com/team/repo.git", "Authorization: Bearer ***", "***"].join(
        "\n",
      ),
    );
  });

  it("幂等：已脱敏文本再脱一次不变", () => {
    const once = redactSecrets("https://u:p@host ghp_1234567890abcdefghijklmnopqrstuvwx");
    expect(redactSecrets(once)).toBe(once);
  });
});
