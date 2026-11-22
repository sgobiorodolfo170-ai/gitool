/**
 * 标签域：标签列表、创建（轻量/附注）、删除。
 *
 * 依赖方向：只依赖 core 与 gitParsing；不 import 其他子域。
 */
import type { CreateTagInput, GitTag } from "../../../../shared/types";
import { isValidRefName, refNameInvalidReason } from "../gitParsing";
import { assertDirectory, runGit, runGitProcess } from "./core";

/**
 * `git for-each-ref refs/tags --sort=-creatordate --format=<4 行固定字段>`。
 *
 * why 格式串字段顺序不可改：name / objectname:short / creatordate / contents:subject
 * 必须与 listTags 里「4 行一组」的解析顺序一一对应，改序会让标签列表整体错位。
 * why `--sort=-creatordate`：负号表示降序，最新的标签排在最前。
 */
export function buildListTagsArgs(): string[] {
  return [
    "for-each-ref",
    "refs/tags",
    "--sort=-creatordate",
    "--format=%(refname:short)\n%(objectname:short)\n%(creatordate:iso8601-strict)\n%(contents:subject)",
  ];
}

/**
 * `git tag -a <name> -m <message>` 或 `git tag <name>`（轻量标签）。
 *
 * why 有说明才加 `-a`：无说明时创建轻量标签，多传 `-m` 会让 git 报错。
 * why `-m` 紧跟 `-a <name>`：message 必须以选项值身份出现，否则会被当成第二个
 * 位置参数（`git tag` 只接受一个标签名）。
 */
export function buildCreateTagArgs(name: string, message: string): string[] {
  return message.length > 0 ? ["tag", "-a", name, "-m", message] : ["tag", name];
}

/**
 * `git tag -d <name>`：`-d` 在前、标签名在后；名称已过 isValidRefName 白名单，
 * 不会以 `-` 开头被解析成选项。
 */
export function buildDeleteTagArgs(name: string): string[] {
  return ["tag", "-d", name];
}

export async function listTags(projectPath: string): Promise<GitTag[]> {
  assertDirectory(projectPath);
  const output = await runGit(projectPath, buildListTagsArgs()).catch(() => "");
  const lines = output.split(/\r?\n/);
  const tags: GitTag[] = [];
  for (let index = 0; index + 3 < lines.length; index += 4) {
    // P-35：四元组按固定步进取值，循环条件已保证 index+3 有界；
    // 判空 + 兜底空串，防止最后一段被截断时 undefined 穿透到 UI。
    const name = lines[index]?.trim() ?? "";
    const shortCommit = lines[index + 1]?.trim() ?? "";
    const createdAt = lines[index + 2]?.trim() ?? "";
    const message = lines[index + 3]?.trim() ?? "";
    if (!name) continue;
    tags.push({
      name,
      commit: shortCommit,
      shortCommit,
      createdAt,
      message: message || undefined,
    });
  }
  return tags;
}

export async function createTag(input: CreateTagInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  // why 用 refNameInvalidReason 而不是 isValidRefName：需要把「过长」与「字符集
  // 不合法」两种原因分别告诉用户。500 字符的名字报「只能包含字母…」会误导排查方向
  // （2026-11-21 冒烟 P2-1）。判定结果与 isValidRefName 完全一致。
  const invalidReason = refNameInvalidReason(name);
  if (invalidReason) {
    throw new Error(`标签名${invalidReason}`);
  }
  const message = input.message?.trim() ?? "";
  const result = await runGitProcess(input.path, buildCreateTagArgs(name, message));
  if (!result.success) {
    throw new Error(result.output || "创建标签失败");
  }
}

export async function deleteTag(projectPath: string, name: string): Promise<void> {
  assertDirectory(projectPath);
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("标签名不能为空");
  }
  // 删除是不可逆操作，必须与创建用同一套白名单，避免 `-d` 之后被注入选项。
  if (!isValidRefName(trimmed)) {
    throw new Error("标签名不合法");
  }
  const result = await runGitProcess(projectPath, buildDeleteTagArgs(trimmed));
  if (!result.success) {
    throw new Error(result.output || "删除标签失败");
  }
}
