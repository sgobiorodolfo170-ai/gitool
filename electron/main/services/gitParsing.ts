import type { ChangeFile } from "../../../shared/types";

/**
 * Git 输出解析与标识校验。
 *
 * 这些函数刻意从 `git.ts` 抽出来：`git.ts` 依赖 `storage.ts`（进而依赖 electron 的 app 模块），
 * 纯函数留在里面就无法在 Node 测试环境里直接单测。抽离后本文件零运行时依赖，可被 vitest 直接导入。
 */

/**
 * 合法的 ref 名（分支 / 标签 / 提交范围端点）白名单。
 * 只允许字母、数字、点、下划线、斜杠、连字符——刻意排除 `-` 开头，
 * 因为 git 会把以 `-` 开头的参数当作选项（如 `--output=<path>` 可写任意文件）。
 */
const REF_NAME_PATTERN = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;

/** 提交哈希：7-40 位十六进制，可带 `^` / `~N` 后缀（如 `abc1234^`）。 */
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}([\^~][0-9]*)?$/i;

/**
 * ref 名长度上限（255）。
 * why 与字符集判断拆开：超长名的真实原因只有一个——太长，若和字符集共用一个
 * 返回值，服务层就只能抛「只能包含字母…」，用户拿 500 字符的名字去试会一头雾水
 * （2026-11-21 冒烟 P2-1：`git:createTag` 传 500 字符名时报的是字符集错误）。
 */
export const REF_NAME_MAX_LENGTH = 255;

/** ref 名字符集白名单的说明文案（供服务层拼错误信息，避免各处手抄一遍）。 */
const REF_NAME_CHARSET_HINT = "只能包含字母、数字、点、下划线、斜杠和连字符";

/**
 * 校验 ref 名并给出**可展示的失败原因**；合法时返回 null。
 *
 * 判定结果必须与 isValidRefName 完全一致（后者现在直接委托本函数），
 * 因此这里只是把「为什么失败」拆成两类：长度 / 字符集。空白裁剪规则同旧实现。
 */
export function refNameInvalidReason(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > REF_NAME_MAX_LENGTH) {
    return `过长（最多 ${REF_NAME_MAX_LENGTH} 字符）`;
  }
  if (trimmed.length === 0 || !REF_NAME_PATTERN.test(trimmed)) {
    return REF_NAME_CHARSET_HINT;
  }
  return null;
}

export function isValidRefName(value: string): boolean {
  return refNameInvalidReason(value) === null;
}

export function isValidCommitHash(value: string): boolean {
  return COMMIT_HASH_PATTERN.test(value.trim());
}

/**
 * 解析 `git status --porcelain=v1` 的两字符状态码。
 * 注意：`??` 必须判为 untracked，而 `UU` / `AA` / `DD` 是冲突。
 */
export function parseChangeStatus(status: string): ChangeFile["status"] {
  const combined = status.trim();
  if (isConflictStatus(combined)) {
    return "conflicted";
  }
  if (status[0] === "R" || status[1] === "R") {
    return "renamed";
  }
  if (status[0] === "D" || status[1] === "D") {
    return "deleted";
  }
  if (status[1] === "?" || status[1] === "!") {
    return "untracked";
  }
  if (status[1] === "A" || status[0] === "A") {
    return "added";
  }
  return "modified";
}

/**
 * 冲突状态码判定（P-30 / 架构评审 L-17 的单点实现）。
 *
 * why 抽出独立函数：「什么是冲突」原先在两处各写一遍——
 * parseChangeStatus 看 `includes("U")`，getProjectSnapshot 内联看
 * `line[0]==="U" || line[1]==="U" || startsWith("AA ") || startsWith("DD ")`——
 * 两处口径必须永远一致，否则出现「详情页 conflicted、项目卡片 dirty」的矛盾展示。
 * 统一后冲突定义只有这一份：两字符码任一位置为 U（UU/UA/AU/DU/UD），
 * 或双字符码恰为 AA/DD（both added / both deleted）。
 *
 * why 接受整行也接受裸状态码：快照解析拿到的是 `XY <path>` 整行，
 * 变更列表解析拿到的是裸 `XY`；先裁掉路径部分再判两字符，两种输入共用同一语义。
 */
export function isConflictStatus(lineOrStatus: string): boolean {
  // 整行形如 "XY path"：XY 之后必有空格；裸状态码没有空格。
  // slice(0, idx) 对裸码（idx=-1 → slice(0,-1)）会裁掉末字符，因此 -1 时取全长。
  const spaceIndex = lineOrStatus.indexOf(" ");
  const combined = (spaceIndex === -1 ? lineOrStatus : lineOrStatus.slice(0, spaceIndex)).trim();
  if (combined.length === 0) {
    return false;
  }
  if (combined.includes("U")) {
    return true;
  }
  return combined === "AA" || combined === "DD";
}

/**
 * 从 `git status --branch` 的分支行里取 `[ahead 3, behind 1]` 中的数值。
 * 例如 `## main...origin/main [ahead 2]` → bracketValue(line, "ahead") === "2"。
 */
export function bracketValue(branchLine: string, key: string): string | null {
  const marker = `${key} `;
  const start = branchLine.indexOf(marker);
  if (start === -1) {
    return null;
  }
  // P-35：split 结果按 noUncheckedIndexedAccess 语义可能为 undefined，
  // 显式判空比 `?? ""` 更准确——空串会伪装成「有值但为空」的合法进度。
  const value = branchLine
    .slice(start + marker.length)
    .split(/[,\]]/)[0]
    ?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * 从 `git clone --progress` 的输出里提取百分比。
 * 输出里可能有多段进度（Enumerating / Counting / Compressing / Receiving），
 * 取最后一次出现的百分比才是当前阶段真实进度。
 */
export function parseCloneProgress(output: string): number {
  const matches = output.matchAll(/(\d+)\s*%/g);
  let percent = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      percent = value;
    }
  }
  return Math.min(100, Math.max(0, percent));
}

/** git log 自定义格式串使用的字段分隔符与记录尾分隔符（见 parseCommitHistory）。 */
export const COMMIT_FIELD_SEP = "\x1f";
export const COMMIT_RECORD_SEP = "\x1e";

export type ParsedCommitRecord = {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
};

/**
 * 解析 `git log --format=%H<US>%an<US>%ae<US>%aI<US>%s<US>%b<RS>` 的输出
 * （US = \x1f 字段分隔，RS = \x1e 记录尾）。
 *
 * 设计理由：记录分隔符必须放在记录**末尾**。旧实现把 \x1f 放在 %s 与 %b 之间、
 * 依赖记录间的换行切分，结果第 2 条记录起的首字段是「上一条 body + 换行 + hash」，
 * 除最新提交外所有 hash 全部损坏，回退功能随之失效（2026-11-07 审查 P0-1）。
 *
 * 注意 tformat 语义：每条记录的 \x1e 之后还有一个换行，会落入下一段开头，
 * 切分后必须剥掉行首空白，否则会污染 hash。
 */
export function parseCommitHistory(output: string): ParsedCommitRecord[] {
  const records: ParsedCommitRecord[] = [];
  for (const record of output.split(COMMIT_RECORD_SEP)) {
    const fields = record.trimStart().split(COMMIT_FIELD_SEP);
    if (fields.length < 6) {
      continue;
    }
    const [hash, author, email, date, subject, ...rest] = fields;
    // P-35：解构结果可能为 undefined；subject 缺失按空串处理（无主题行的
    // 提交合法存在），其余字段缺失则该行不可信，跳过。
    if (!hash || !author || !email || !date) {
      continue;
    }
    // body 里理论上也可能出现 \x1f，把剩余字段拼回去而不是丢弃
    records.push({
      hash,
      author,
      email,
      date,
      subject: subject ?? "",
      body: rest.join(COMMIT_FIELD_SEP),
    });
  }
  return records;
}

/**
 * 构造 `git commit` 的提交信息参数。
 * 单条 `-m` 传原始多行文本：多个 `-m` 会被 git 以空行连接成段落，
 * 会把用户输入的列表/代码块等换行结构全部打散（2026-11-07 审查 P1-2）。
 */
export function buildCommitMessageArgs(message: string): string[] {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return [];
  }
  return ["-m", trimmed];
}

export type ParsedStatusEntry = {
  /** 原始两字符状态码（如 " M"、"??"、"R "），交由 parseChangeStatus 归类。 */
  status: string;
  path: string;
  staged: boolean;
};

/**
 * 解析 `git status --porcelain=v1 -z` 的输出。
 *
 * 关键点：-z 模式下 rename/copy 条目（XY 含 R/C）后跟第二个 \0 分隔的
 * 原始路径段，必须成对消费——把旧路径当独立条目解析的话，旧路径第 3
 * 字符恰为空格时会产生幻影 staged 记录（2026-11-07 审查 P2-3）。
 */
export function parseStatusPorcelainZ(output: string): ParsedStatusEntry[] {
  const entries: ParsedStatusEntry[] = [];
  const segments = output.split("\0");
  for (let index = 0; index < segments.length; index += 1) {
    // P-35：segments[index] 在 noUncheckedIndexedAccess 下为 string | undefined。
    // 索引循环无法被编译器证明有界，显式判空（undefined 段直接跳过，语义不变）。
    const segment = segments[index];
    if (!segment || segment.length < 4 || segment[2] !== " ") {
      continue;
    }
    const status = segment.slice(0, 2);
    const path = segment.slice(3);
    if (!path) {
      continue;
    }
    const isRenameLike = ["R", "C"].some((marker) => status.includes(marker));
    if (isRenameLike) {
      index += 1;
    }
    entries.push({
      status,
      path,
      staged: status[0] !== " " && status[0] !== "?",
    });
  }
  return entries;
}

/**
 * 从 `git diff --numstat` 输出提取变更路径。
 * 行格式 `added<TAB>removed<TAB>path`（rename 为 `old => new`，二进制为 `-\t-`）。
 * 改用它而非解析 `--stat` 人读格式：文件名含 `|`、重命名箭头、超长路径
 * 截断都会让后者出错（2026-11-07 审查 P2-4）。
 */
export function parseNumstatPaths(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const path = parts.slice(2).join("\t").trim();
    if (path) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * 把文件路径转成关闭 glob 语义的 pathspec。
 * 裸 pathspec 里 `[ ] * ?` 是通配符：文件名字面量为 `data[1].txt` 时
 * `git add -- data[1].txt` 会匹配 `data1.txt`（2026-11-07 审查 P2-2）。
 * `--` 只隔离选项，不关闭 glob，必须用 pathspec magic。
 */
export function toLiteralPathspec(filePath: string): string {
  return `:(literal)${filePath}`;
}

/**
 * 解析 `git branch -vv` 的单行输出。
 * 形如 `* main 1a2b3c4 [origin/main: ahead 2, behind 1] msg`。
 */
export function parseBranchLine(raw: string): {
  name: string;
  current: boolean;
  remote?: string;
  ahead: number;
  behind: number;
} | null {
  if (!raw.trim()) {
    return null;
  }
  const current = raw.trim().startsWith("*");
  const line = current ? raw.trim().slice(1).trim() : raw.trim();
  const match = line.match(/^([^\s]+)/);
  if (!match) {
    return null;
  }
  const tracking = line.match(/\[([^\]]+)\]/);
  const aheadMatch = tracking?.[1]?.match(/ahead (\d+)/);
  const behindMatch = tracking?.[1]?.match(/behind (\d+)/);
  const remotePart = tracking?.[1]?.split(":")[0];
  return {
    // P-35：match[1] 在 noUncheckedIndexedAccess 下可能为 undefined；
    // 正则 `^([^\s]+)` 保证捕获组非空，match 非 null 时 [1] 必有值，用 ! 收窄。
    name: match[1]!,
    current,
    remote: tracking ? (remotePart ?? undefined) : undefined,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}
