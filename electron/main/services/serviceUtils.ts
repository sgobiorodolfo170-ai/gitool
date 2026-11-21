import { statSync } from "node:fs";

/**
 * 主进程服务层公共小工具（零 electron 依赖）。
 *
 * 下沉原因：errorMessage 曾在 6 个服务文件里逐字重复；assertDirectory 在
 * 3 个文件重复且健壮性各不相同——openers 的版本没有 try/catch，目录不存在
 * 时会把原始 ENOENT 英文异常直接抛给渲染层（2026-11-07 审查 P2-12）。
 */

/** 把任意抛出的值转成可展示的字符串。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 脱敏占位符。集中定义是为了让「导出/落库的文本里出现 ***」有单一语义。 */
const REDACTED = "***";

/**
 * URL 内嵌凭据：`scheme://user:pass@host` → `scheme://***@host`。
 *
 * 只匹配「有冒号分隔的 user:pass」这一种形态：
 * - 不含冒号的 `https://git@host`、scp 形态 `git@github.com:a/b` 都是正常地址，不能误伤；
 * - user/pass 用排除式字符类而不是贪婪 `.*`，保证密码里的 `@` 之前的最后一个分隔符
 *   不会被吞掉（`https://u:p@ss@host` 这种非法但会出现在日志里的串也能截断在第一个 @）。
 */
const CREDENTIAL_URL_PATTERN = /([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]+@/gi;

/**
 * `Authorization: Bearer xxx` 头。
 * 必须带上 `Authorization:` 前缀：裸 `Bearer` 语义太宽（命令行里也可能是普通单词）。
 * 尾部排除 `,;` 是为了 CSV 导出时不吃掉分隔符。
 */
const AUTHORIZATION_BEARER_PATTERN = /(\bauthorization:\s*bearer\s+)[^\s"',;]+/gi;

/** 常见平台令牌前缀。长串下限 8 字符，避免把 `glpat-`、`[REDACTED_SLACK_TOKEN]` 这类裸前缀本身打码。 */
const TOKEN_PREFIXES = ["ghp_", "gho_", "github_pat_", "glpat-", "[REDACTED_SLACK_TOKEN]"] as const;
const MIN_TOKEN_BODY_LENGTH = 8;
const TOKEN_PATTERN = new RegExp(
  `\\b(?:${TOKEN_PREFIXES.join("|")})[A-Za-z0-9_-]{${MIN_TOKEN_BODY_LENGTH},}`,
  "g",
);

/**
 * 文本脱敏：把 URL 内嵌凭据、Bearer 令牌、平台访问令牌替换成 `***`。
 *
 * why 兜底而不拦截：真正的第一道防线在 git 侧（A-03/A-04 的入口拒绝与
 * GIT_CONFIG 注入），本函数只处理「已经产生的文本」——操作日志落库、CSV 导出、
 * 备份清单这些会被分享/上传的出口。历史数据与第三方输出无法回溯清理，
 * 逐个出口过一遍是唯一能保证不把凭据带出去的位置。
 *
 * 顺序说明：先 URL、再 Authorization、最后裸令牌。Authorization 里若带 `ghp_` 前缀，
 * 先被头部规则整段吃掉，避免出现 `Bearer ***` 之外的残缺形态。
 */
export function redactSecrets(input: string): string {
  return input
    .replace(CREDENTIAL_URL_PATTERN, (_match, scheme: string) => `${scheme}://${REDACTED}@`)
    .replace(AUTHORIZATION_BEARER_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(TOKEN_PATTERN, REDACTED);
}

/**
 * 断言目标是存在的目录，否则抛带中文文案的错误。
 * label 用于区分域：git 域传「项目路径」、备份域传「源路径」等。
 */
export function assertDirectory(target: string, label = "路径"): void {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new Error(`${label}不存在或无法访问`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label}不是目录`);
  }
}
