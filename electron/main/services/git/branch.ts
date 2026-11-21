/**
 * 分支域：分支列表、新建、切换、删除。
 *
 * 依赖方向：只依赖 core（执行层与共享参数）与 gitParsing（解析/白名单）；不 import 其他子域。
 */
import type {
  BranchInfo,
  CreateBranchInput,
  DeleteBranchInput,
  SwitchBranchInput,
} from "../../../../shared/types";
import { isValidRefName, parseBranchLine } from "../gitParsing";
import { assertDirectory, buildCurrentBranchArgs, runGit, runGitProcess } from "./core";

/**
 * `git branch -vv`：`-vv` 才带上游与 `[origin/main: ahead 2, behind 1]` 段，
 * parseBranchLine 的 ahead/behind 解析依赖它；只加 `-v` 会让这两个数字永远为 0。
 */
export function buildBranchListArgs(): string[] {
  return ["branch", "-vv"];
}

/** `git checkout -b <name>`：`-b` 表示新建并切到该分支，名称由调用方白名单校验。 */
export function buildCreateBranchArgs(name: string): string[] {
  return ["checkout", "-b", name];
}

/** `git checkout <name>`：切换已有分支（名称已校验，不会以 `-` 开头）。 */
export function buildSwitchBranchArgs(name: string): string[] {
  return ["checkout", name];
}

/**
 * `git branch -D <name>`：`-D` 等于 `-d --force`，删除未合并分支也不报错；
 * 删除前的「不能删当前分支」与用户确认都在调用方完成。
 */
export function buildDeleteBranchArgs(name: string): string[] {
  return ["branch", "-D", name];
}

export async function listBranches(projectPath: string): Promise<BranchInfo[]> {
  assertDirectory(projectPath);
  const output = await runGit(projectPath, buildBranchListArgs()).catch(() => "");
  const branches: BranchInfo[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const parsed = parseBranchLine(raw);
    if (parsed) {
      branches.push(parsed);
    }
  }
  return branches;
}

export async function createBranch(input: CreateBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!isValidRefName(name)) {
    throw new Error("分支名只能包含字母、数字、点、下划线、斜杠和连字符");
  }
  await runGit(input.path, buildCreateBranchArgs(name));
}

export async function switchBranch(input: SwitchBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!isValidRefName(name)) {
    throw new Error("分支名不合法");
  }
  const result = await runGitProcess(input.path, buildSwitchBranchArgs(name));
  if (!result.success) {
    throw new Error(result.output || "切换分支失败");
  }
}

export async function deleteBranch(input: DeleteBranchInput): Promise<void> {
  assertDirectory(input.path);
  const name = input.name.trim();
  if (!name) {
    throw new Error("分支名不能为空");
  }
  if (!isValidRefName(name)) {
    throw new Error("分支名不合法");
  }
  const current = await runGit(input.path, buildCurrentBranchArgs()).catch(() => "");
  if (current === name) {
    throw new Error("不能删除当前所在分支，请先切换到其他分支");
  }
  const result = await runGitProcess(input.path, buildDeleteBranchArgs(name));
  if (!result.success) {
    throw new Error(result.output || "删除分支失败");
  }
}
