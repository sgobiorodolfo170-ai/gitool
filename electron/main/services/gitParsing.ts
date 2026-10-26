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

export function isValidRefName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 255) {
    return false;
  }
  return REF_NAME_PATTERN.test(trimmed);
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
  if (combined.includes("U") || combined === "AA" || combined === "DD") {
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
 * 从 `git status --branch` 的分支行里取 `[ahead 3, behind 1]` 中的数值。
 * 例如 `## main...origin/main [ahead 2]` → bracketValue(line, "ahead") === "2"。
 */
export function bracketValue(branchLine: string, key: string): string | null {
  const marker = `${key} `;
  const start = branchLine.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const value = branchLine
    .slice(start + marker.length)
    .split(/[,\]]/)[0]
    .trim();
  return value.length > 0 ? value : null;
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

/**
 * 把多行提交信息拆成 git 的 `-m` 参数序列。
 * 空行被丢弃：git 会把每个 `-m` 视为一个段落，保留空行会产生多余空段。
 */
export function buildCommitMessageArgs(message: string): string[] {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const args: string[] = [];
  for (const line of lines) {
    args.push("-m", line);
  }
  return args;
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
    name: match[1],
    current,
    remote: tracking ? (remotePart ?? undefined) : undefined,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}
