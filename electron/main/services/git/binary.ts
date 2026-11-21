/**
 * git 可执行文件探测（叶子模块）。
 *
 * 依赖方向：只依赖设置存储；被 core 与 clone 引用，自身不 import 任何 git 子域。
 */
import { loadSettings } from "../storage/settings";

// 解析当前应使用的 git 可执行文件路径：优先使用 settings.gitPath，
// 为空时回退到系统 PATH 中的 "git"。
// 设计理由：装完 Git 后 PATH 变更不会传播到运行中的 Electron 进程，
// 显式指向 git.exe 是「免重启」的必要前提。导出供 environment.ts 复用。
export function getActiveGitBinary(): string {
  try {
    const candidate = loadSettings().gitPath.trim();
    return candidate || "git";
  } catch {
    return "git";
  }
}
