/**
 * 磁盘与文档域：项目体积统计（带 TTL 缓存）与 README 读取。
 *
 * 依赖方向：只依赖 core（目录断言）与 concurrency（并发池）；不 import 其他子域。
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ReadmeResult } from "../../../../shared/types";
import { mapLimit } from "../concurrency";
import { assertDirectory } from "./core";

const diskSizeCache = new Map<string, { value: number; at: number }>();
const DISK_SIZE_CACHE_TTL_MS = 60 * 1000;

export async function getDiskSize(projectPath: string): Promise<number> {
  assertDirectory(projectPath);
  const cached = diskSizeCache.get(projectPath);
  if (cached && Date.now() - cached.at < DISK_SIZE_CACHE_TTL_MS) {
    return cached.value;
  }
  const size = await computeDiskSize(projectPath);
  diskSizeCache.set(projectPath, { value: size, at: Date.now() });
  return size;
}

export function invalidateDiskSizeCache(projectPath: string): void {
  diskSizeCache.delete(projectPath);
}

/**
 * 全量重置磁盘缓存（P-33 测试隔离入口）。
 *
 * why 需要它：diskSizeCache 是模块级可变单例，TTL 60s——单测里「改文件后体积
 * 应变化」的断言会被上一用例的缓存污染，只能 vi.resetModules() 整个重载模块。
 * 有了显式重置入口后，beforeEach 调一次即可，测试间互不串扰。
 */
export function resetDiskSizeCacheForTest(): void {
  diskSizeCache.clear();
}

async function computeDiskSize(projectPath: string): Promise<number> {
  // 与 analysis.ts 相同的并发纪律：全异步 + worker 池。旧实现用
  // readdirSync/statSync 同步遍历，大项目上会把主进程事件循环（全部 IPC）
  // 卡住数秒（2026-11-07 审查 P1-5）。层内并发、层间串行，
  // visited 去重语义与旧实现保持一致。
  const visited = new Set<string>();
  const pending: string[] = [projectPath];
  let total = 0;

  while (pending.length > 0) {
    const directories = pending.splice(0, pending.length);
    await mapLimit(directories, DIRECTORY_SCAN_CONCURRENCY, async (directory) => {
      let realPath: string;
      try {
        realPath = realpathSync(directory);
      } catch {
        return;
      }
      if (visited.has(realPath)) {
        return;
      }
      visited.add(realPath);
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      const subdirectories: string[] = [];
      await mapLimit(entries, FILE_STAT_CONCURRENCY, async (entry) => {
        if (entry.isSymbolicLink()) {
          return;
        }
        const entryPath = join(directory, entry.name);
        try {
          if (entry.isDirectory()) {
            if (IGNORED_SIZE_DIRECTORIES.has(entry.name)) {
              return;
            }
            subdirectories.push(entryPath);
          } else if (entry.isFile()) {
            // 必须先 await 存变量再累加：`total += (await stat(...)).size` 的
            // 复合赋值会先读取 total 旧值再求值右侧，并发 worker 会互相覆盖
            // （lost update，实测同一目录会少算 99% 的体积）
            const fileStats = await stat(entryPath);
            total += fileStats.size;
          }
        } catch {
          // 跳过无法访问的条目
        }
      });
      pending.push(...subdirectories);
    });
  }
  return total;
}

const DIRECTORY_SCAN_CONCURRENCY = 8;
const FILE_STAT_CONCURRENCY = 64;

const IGNORED_SIZE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
]);

const README_FILE_NAMES = [
  "README.md",
  "README.MD",
  "readme.md",
  "README.markdown",
  "readme.txt",
  "README",
];

export async function readProjectReadme(projectPath: string): Promise<ReadmeResult> {
  assertDirectory(projectPath);
  for (const fileName of README_FILE_NAMES) {
    const candidate = join(projectPath, fileName);
    if (!existsSync(candidate)) {
      continue;
    }
    const stats = statSync(candidate);
    if (!stats.isFile() || stats.size > 512 * 1024) {
      continue;
    }
    try {
      const content = readFileSync(candidate, { encoding: "utf8" });
      return { found: true, content, fileName };
    } catch {
      continue;
    }
  }
  return { found: false, content: "", fileName: "" };
}
