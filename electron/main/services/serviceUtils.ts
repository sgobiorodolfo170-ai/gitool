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

/** 常见平台令牌前缀。长串下限 8 字符，避免把 `glpat-`、`xoxb-` 这类裸前缀本身打码。 */
const TOKEN_PREFIXES = ["ghp_", "gho_", "github_pat_", "glpat-", "xoxb-"] as const;
const MIN_TOKEN_BODY_LENGTH = 8;
const TOKEN_PATTERN = new RegExp(
  `\\b(?:${TOKEN_PREFIXES.join("|")})[A-Za-z0-9_-]{${MIN_TOKEN_BODY_LENGTH},}`,
  "g",
);

/**
 * query / form 形态的敏感键值对：`?access_token=xxx`、`token=xxx`、`password=...`。
 *
 * why 按「键名 + 等号」匹配而不是猜值形态：git 远程错误、OAuth 回调、Webhook 日志里
 * 凭据最常见的落点就是 query 参数与 form 字段，值本身没有可识别前缀（不像 ghp_）。
 *
 * 误伤防护：
 * - 键名前用 `\b`，`mytoken=`、`token_type=`、`tokens=` 这类含敏感子串的普通键不命中
 *   （`token` 前后必须是非单词字符）；
 * - 值用单层排除式字符类 `[^\s&"',;]+`（线性匹配、无嵌套量词，不会回溯爆炸），
 *   遇到空白/`&`/引号/CSV 分隔符即截断，不会把后面的正常字段一起吃掉；
 * - 至少一个字符：空值 `token=` 不携带秘密，保持原样。
 * 幂等性：已脱敏的 `token=***` 再次匹配仍替换为 `token=***`。
 */
const SENSITIVE_PARAM_PATTERN =
  /\b(access_token|refresh_token|private_token|auth_token|client_secret|token|password)=([^\s&"',;]+)/gi;

/**
 * 文本脱敏：把 URL 内嵌凭据、Bearer 令牌、敏感 query/form 参数、平台访问令牌替换成 `***`。
 *
 * why 兜底而不拦截：真正的第一道防线在 git 侧（A-03/A-04 的入口拒绝与
 * GIT_CONFIG 注入），本函数只处理「已经产生的文本」——操作日志落库、CSV 导出、
 * 备份清单、pull/push 的 git 错误输出这些会被展示/分享的出口。历史数据与第三方
 * 输出无法回溯清理，逐个出口过一遍是唯一能保证不把凭据带出去的位置。
 *
 * 顺序说明（从「最具体」到「最宽泛」）：
 * 1. URL 内嵌凭据：`scheme://u:p@host` → `scheme://***@host`；
 * 2. Authorization 头：整段吃掉，避免出现 `Bearer ***` 之外的残缺形态；
 * 3. 敏感键值对：先于裸令牌，`?access_token=ghp_xxx` 会被整值替换成 `access_token=***`；
 * 4. 裸平台令牌：兜住没有键名的独立长串。
 */
export function redactSecrets(input: string): string {
  return input
    .replace(CREDENTIAL_URL_PATTERN, (_match, scheme: string) => `${scheme}://${REDACTED}@`)
    .replace(AUTHORIZATION_BEARER_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(SENSITIVE_PARAM_PATTERN, (_match, key: string) => `${key}=${REDACTED}`)
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
