import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { ProjectAnalysis } from "../../../shared/types";
import { mapLimit } from "./concurrency";

const analysisCache = new Map<string, { value: ProjectAnalysis; at: number }>();
const ANALYSIS_CACHE_TTL_MS = 30 * 1000;

/** 单次分析的文件数上限：超过后停止累加，保证大仓库也能在可接受时间内出结果。 */
const MAX_FILES = 20000;
/** 目录深度上限：防止异常目录结构（软链接环、生成的嵌套目录）把遍历拖死。 */
const MAX_DEPTH = 12;
/** stat 并发数：太高会在 Windows 上撞 EMFILE，太低则退化为串行。 */
const STAT_CONCURRENCY = 64;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".idea",
  ".venv",
  "__pycache__",
]);

const KEY_FILES = new Set([
  "README.md",
  "README.MD",
  "package.json",
  "pnpm-lock.yaml",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Dockerfile",
  ".env.example",
]);

const LANGUAGE_MAP: Record<string, { name: string; color: string }> = {
  ".ts": { name: "TypeScript", color: "#3178c6" },
  ".tsx": { name: "TypeScript", color: "#3178c6" },
  ".js": { name: "JavaScript", color: "#d8b429" },
  ".jsx": { name: "JavaScript", color: "#d8b429" },
  ".rs": { name: "Rust", color: "#ce412b" },
  ".py": { name: "Python", color: "#3776ab" },
  ".go": { name: "Go", color: "#00add8" },
  ".java": { name: "JVM", color: "#b07219" },
  ".kt": { name: "JVM", color: "#b07219" },
  ".cs": { name: "C#", color: "#178600" },
  ".vue": { name: "Vue", color: "#42b883" },
  ".html": { name: "HTML", color: "#e34c26" },
  ".css": { name: "CSS", color: "#563d7c" },
  ".scss": { name: "CSS", color: "#563d7c" },
  ".json": { name: "Config", color: "#8b97a8" },
  ".yaml": { name: "Config", color: "#8b97a8" },
  ".yml": { name: "Config", color: "#8b97a8" },
  ".toml": { name: "Config", color: "#8b97a8" },
};

export async function analyzeProject(projectPath: string): Promise<ProjectAnalysis> {
  const cached = analysisCache.get(projectPath);
  if (cached && Date.now() - cached.at < ANALYSIS_CACHE_TTL_MS) {
    return cached.value;
  }
  const analysis = await computeAnalysis(projectPath);
  analysisCache.set(projectPath, { value: analysis, at: Date.now() });
  return analysis;
}

export function invalidateAnalysisCache(projectPath: string): void {
  analysisCache.delete(projectPath);
}

async function computeAnalysis(projectPath: string): Promise<ProjectAnalysis> {
  const rootStats = await stat(projectPath).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error("项目路径不存在或不是目录");
  }

  const languages = new Map<string, { files: number; bytes: number; color: string }>();
  const projectTypes = new Set<string>();
  const keyFiles: string[] = [];
  let files = 0;
  let directories = 0;
  let totalBytes = 0;

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files >= MAX_FILES) {
      return;
    }
    // readdir 必须容错：一个无权限目录（System Volume Information、被占用的构建目录）
    // 就会让旧实现整体抛错，用户只看到「分析失败」。
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    const filePaths: string[] = [];
    const subdirectories: string[] = [];

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        directories += 1;
        subdirectories.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        filePaths.push(entryPath);
      }
    }

    // 同一层内的文件并发 stat，避免逐文件串行 await 造成的线性耗时。
    await mapLimit(filePaths, STAT_CONCURRENCY, async (entryPath) => {
      if (files >= MAX_FILES) {
        return;
      }
      files += 1;
      const fileStats = await stat(entryPath).catch(() => null);
      const size = fileStats?.size ?? 0;
      totalBytes += size;

      const name = basename(entryPath);
      if (KEY_FILES.has(name)) {
        keyFiles.push(relative(projectPath, entryPath).replaceAll("\\", "/"));
      }

      const language = LANGUAGE_MAP[extname(name).toLowerCase()];
      if (language) {
        const languageStat = languages.get(language.name) ?? {
          files: 0,
          bytes: 0,
          color: language.color,
        };
        languageStat.files += 1;
        languageStat.bytes += size;
        languages.set(language.name, languageStat);
      }

      const projectType = projectTypeFor(name);
      if (projectType) {
        projectTypes.add(projectType);
      }
    });

    for (const subdirectory of subdirectories) {
      await walk(subdirectory, depth + 1);
    }
  }

  await walk(projectPath, 0);

  return {
    files,
    directories,
    total_bytes: totalBytes,
    languages: [...languages.entries()]
      .map(([name, value]) => ({
        name,
        files: value.files,
        bytes: value.bytes,
        color: value.color,
      }))
      .sort((left, right) => right.bytes - left.bytes),
    project_types: [...projectTypes].sort(),
    key_files: keyFiles.sort(),
  };
}

function projectTypeFor(name: string): string | null {
  if (name === "package.json") return "Node.js";
  if (name === "Cargo.toml") return "Rust";
  if (name === "pyproject.toml" || name === "requirements.txt") return "Python";
  if (name === "go.mod") return "Go";
  if (name === "pom.xml" || name === "build.gradle") return "JVM";
  if (name.endsWith(".csproj")) return ".NET";
  return null;
}
