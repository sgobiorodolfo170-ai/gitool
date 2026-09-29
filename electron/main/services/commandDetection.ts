import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DetectCommandsResult, DetectedCommand } from "../../../shared/types";

const DOTNET_PROJECT_EXTENSIONS = [".csproj", ".fsproj", ".vbproj"];

export function detectProjectCommands(projectPath: string): DetectCommandsResult {
  const commands: DetectedCommand[] = [];
  let packageManager = "";

  packageManager = detectPackageManager(projectPath);
  commands.push(...detectPackageScripts(projectPath, packageManager));
  commands.push(...detectCargoCommands(projectPath));
  commands.push(...detectPythonCommands(projectPath));
  commands.push(...detectGoCommands(projectPath));
  commands.push(...detectMavenCommands(projectPath));
  commands.push(...detectGradleCommands(projectPath));
  commands.push(...detectDotnetCommands(projectPath));

  return { commands, packageManager };
}

function detectPackageManager(projectPath: string): string {
  if (existsSync(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectPath, "package-lock.json"))) return "npm";
  return "";
}

function detectPackageScripts(projectPath: string, packageManager: string): DetectedCommand[] {
  const manifestPath = join(projectPath, "package.json");
  if (!existsSync(manifestPath)) {
    return [];
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, { encoding: "utf8" })) as Record<string, unknown>;
  } catch {
    return [];
  }
  const scripts = parsed.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return [];
  }
  const manager = packageManager || "npm";
  const commands: DetectedCommand[] = [];
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") {
      continue;
    }
    commands.push({
      label: `${manager} run ${name}`,
      command: manager,
      args: `run ${name}`,
      source: "npm-script",
    });
  }
  return commands;
}

function detectCargoCommands(projectPath: string): DetectedCommand[] {
  if (!existsSync(join(projectPath, "Cargo.toml"))) {
    return [];
  }
  return [
    { label: "cargo build", command: "cargo", args: "build", source: "cargo" },
    { label: "cargo run", command: "cargo", args: "run", source: "cargo" },
    { label: "cargo test", command: "cargo", args: "test", source: "cargo" },
    { label: "cargo check", command: "cargo", args: "check", source: "cargo" },
  ];
}

function detectPythonCommands(projectPath: string): DetectedCommand[] {
  const hasPyproject = existsSync(join(projectPath, "pyproject.toml"));
  const hasRequirements = existsSync(join(projectPath, "requirements.txt"));
  if (!hasPyproject && !hasRequirements) {
    return [];
  }
  const commands: DetectedCommand[] = [
    { label: "python -m pytest", command: "python", args: "-m pytest", source: "python" },
  ];
  if (hasPyproject) {
    commands.push({ label: "uv run pytest", command: "uv", args: "run pytest", source: "python" });
  }
  return commands;
}

function detectGoCommands(projectPath: string): DetectedCommand[] {
  if (!existsSync(join(projectPath, "go.mod"))) {
    return [];
  }
  return [
    { label: "go build", command: "go", args: "build ./...", source: "go" },
    { label: "go test", command: "go", args: "test ./...", source: "go" },
    { label: "go run", command: "go", args: "run .", source: "go" },
  ];
}

function detectMavenCommands(projectPath: string): DetectedCommand[] {
  if (!existsSync(join(projectPath, "pom.xml"))) {
    return [];
  }
  return [
    { label: "mvn compile", command: "mvn", args: "compile", source: "maven" },
    { label: "mvn test", command: "mvn", args: "test", source: "maven" },
    { label: "mvn package", command: "mvn", args: "package -DskipTests", source: "maven" },
  ];
}

function detectGradleCommands(projectPath: string): DetectedCommand[] {
  const gradleFound = existsSync(join(projectPath, "build.gradle")) || existsSync(join(projectPath, "build.gradle.kts"));
  if (!gradleFound) {
    return [];
  }
  return [
    { label: "gradle build", command: "gradle", args: "build", source: "gradle" },
    { label: "gradle run", command: "gradle", args: "run", source: "gradle" },
    { label: "gradle test", command: "gradle", args: "test", source: "gradle" },
  ];
}

function detectDotnetCommands(projectPath: string): DetectedCommand[] {
  const hasProjectFile = readdirSync(projectPath, { withFileTypes: true }).some(
    (entry) => entry.isFile() && DOTNET_PROJECT_EXTENSIONS.some((ext) => entry.name.endsWith(ext)),
  );
  if (!hasProjectFile) {
    return [];
  }
  return [
    { label: "dotnet build", command: "dotnet", args: "build", source: "dotnet" },
    { label: "dotnet run", command: "dotnet", args: "run", source: "dotnet" },
    { label: "dotnet test", command: "dotnet", args: "test", source: "dotnet" },
  ];
}
