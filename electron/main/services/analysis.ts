import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { ProjectAnalysis } from "../../../shared/types";

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

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        directories += 1;
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      files += 1;
      const fileStats = await stat(entryPath).catch(() => null);
      const size = fileStats?.size ?? 0;
      totalBytes += size;

      if (KEY_FILES.has(entry.name)) {
        keyFiles.push(relative(projectPath, entryPath).replaceAll("\\", "/"));
      }

      const language = LANGUAGE_MAP[extname(entry.name).toLowerCase()];
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

      const projectType = projectTypeFor(entry.name);
      if (projectType) {
        projectTypes.add(projectType);
      }
    }
  }

  await walk(projectPath);

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
