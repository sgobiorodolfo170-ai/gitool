import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DetectCommandsResult, DetectedCommand, TaskType } from "../../../shared/types";

const DOTNET_PROJECT_EXTENSIONS = [".csproj", ".fsproj", ".vbproj"];

const OS_WINDOWS = "windows";
const OS_LINUX = "linux";
const OS_MACOS = "macos";
const OS_ALL = [OS_WINDOWS, OS_LINUX, OS_MACOS];

type CategoryBuilder = {
  build: DetectedCommand[];
  run: DetectedCommand[];
  package: DetectedCommand[];
  deploy: DetectedCommand[];
};

export function detectProjectCommands(projectPath: string): DetectCommandsResult {
  const packageManager = detectPackageManager(projectPath);
  const builder: CategoryBuilder = { build: [], run: [], package: [], deploy: [] };

  const push = (category: TaskType, commands: DetectedCommand[]) => {
    builder[category].push(...commands);
  };

  const npmCommands = detectPackageScripts(projectPath, packageManager);
  for (const cmd of npmCommands) {
    const category = classifyScript(cmd.args, cmd.label);
    push(category, [{ ...cmd, category, osSupport: OS_ALL }]);
  }

  push("build", detectCargoCommands(projectPath, "build"));
  push("run", detectCargoCommands(projectPath, "run"));
  push("package", detectCargoCommands(projectPath, "package"));

  push("run", detectPythonCommands(projectPath));
  push("build", detectGoCommands(projectPath, "build"));
  push("run", detectGoCommands(projectPath, "run"));
  push("build", detectMavenCommands(projectPath, "build"));
  push("package", detectMavenCommands(projectPath, "package"));
  push("build", detectGradleCommands(projectPath, "build"));
  push("package", detectGradleCommands(projectPath, "package"));
  push("build", detectDotnetCommands(projectPath, "build"));
  push("run", detectDotnetCommands(projectPath, "run"));
  push("package", detectDotnetCommands(projectPath, "package"));

  push("deploy", detectDeployCommands(projectPath, packageManager));

  const commands = [...builder.build, ...builder.run, ...builder.package, ...builder.deploy];
  return { commands, packageManager };
}

function classifyScript(args: string, label: string): TaskType {
  const lower = (args + " " + label).toLowerCase();
  if (lower.includes("deploy")) return "deploy";
  if (lower.includes("build") || lower.includes("compile") || lower.includes("tsc") || lower.includes("typecheck")) return "build";
  if (lower.includes("pack") || lower.includes("dist") || lower.includes("bundle") || lower.includes("release")) return "package";
  return "run";
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
      category: "run",
      osSupport: OS_ALL,
    });
  }
  return commands;
}

function detectCargoCommands(projectPath: string, category: TaskType): DetectedCommand[] {
  if (!existsSync(join(projectPath, "Cargo.toml"))) {
    return [];
  }
  const map: Record<TaskType, { label: string; args: string } | null> = {
    build: { label: "cargo build", args: "build" },
    run: { label: "cargo run", args: "run" },
    package: { label: "cargo build --release", args: "build --release" },
    deploy: null,
  };
  const entry = map[category];
  if (!entry) return [];
  return [{ label: entry.label, command: "cargo", args: entry.args, source: "cargo", category, osSupport: OS_ALL }];
}

function detectPythonCommands(projectPath: string): DetectedCommand[] {
  const hasPyproject = existsSync(join(projectPath, "pyproject.toml"));
  const hasRequirements = existsSync(join(projectPath, "requirements.txt"));
  if (!hasPyproject && !hasRequirements) {
    return [];
  }
  const commands: DetectedCommand[] = [
    { label: "python -m pytest", command: "python", args: "-m pytest", source: "python", category: "run", osSupport: OS_ALL },
  ];
  if (hasPyproject) {
    commands.push({ label: "uv run pytest", command: "uv", args: "run pytest", source: "python", category: "run", osSupport: OS_ALL });
  }
  return commands;
}

function detectGoCommands(projectPath: string, category: TaskType): DetectedCommand[] {
  if (!existsSync(join(projectPath, "go.mod"))) {
    return [];
  }
  const map: Record<TaskType, { label: string; args: string } | null> = {
    build: { label: "go build", args: "build ./..." },
    run: { label: "go run", args: "run ." },
    package: { label: "go build -o bin", args: "build -o bin ./..." },
    deploy: null,
  };
  const entry = map[category];
  if (!entry) return [];
  return [{ label: entry.label, command: "go", args: entry.args, source: "go", category, osSupport: OS_ALL }];
}

function detectMavenCommands(projectPath: string, category: TaskType): DetectedCommand[] {
  if (!existsSync(join(projectPath, "pom.xml"))) {
    return [];
  }
  const map: Record<TaskType, { label: string; args: string } | null> = {
    build: { label: "mvn compile", args: "compile" },
    run: { label: "mvn spring-boot:run", args: "spring-boot:run" },
    package: { label: "mvn package", args: "package -DskipTests" },
    deploy: null,
  };
  const entry = map[category];
  if (!entry) return [];
  return [{ label: entry.label, command: "mvn", args: entry.args, source: "maven", category, osSupport: OS_ALL }];
}

function detectGradleCommands(projectPath: string, category: TaskType): DetectedCommand[] {
  const gradleFound = existsSync(join(projectPath, "build.gradle")) || existsSync(join(projectPath, "build.gradle.kts"));
  if (!gradleFound) {
    return [];
  }
  const map: Record<TaskType, { label: string; args: string } | null> = {
    build: { label: "gradle build", args: "build" },
    run: { label: "gradle run", args: "run" },
    package: { label: "gradle bootJar", args: "bootJar" },
    deploy: null,
  };
  const entry = map[category];
  if (!entry) return [];
  return [{ label: entry.label, command: "gradle", args: entry.args, source: "gradle", category, osSupport: OS_ALL }];
}

function detectDotnetCommands(projectPath: string, category: TaskType): DetectedCommand[] {
  const hasProjectFile = readdirSync(projectPath, { withFileTypes: true }).some(
    (entry) => entry.isFile() && DOTNET_PROJECT_EXTENSIONS.some((ext) => entry.name.endsWith(ext)),
  );
  if (!hasProjectFile) {
    return [];
  }
  const map: Record<TaskType, { label: string; args: string } | null> = {
    build: { label: "dotnet build", args: "build" },
    run: { label: "dotnet run", args: "run" },
    package: { label: "dotnet publish", args: "publish -c Release" },
    deploy: null,
  };
  const entry = map[category];
  if (!entry) return [];
  return [{ label: entry.label, command: "dotnet", args: entry.args, source: "dotnet", category, osSupport: OS_ALL }];
}

function detectDeployCommands(projectPath: string, packageManager: string): DetectedCommand[] {
  const commands: DetectedCommand[] = [];
  const manager = packageManager || "npm";

  const manifestPath = join(projectPath, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, { encoding: "utf8" })) as Record<string, unknown>;
      const scripts = parsed.scripts;
      if (typeof scripts === "object" && scripts !== null) {
        for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
          if (typeof value !== "string") continue;
          const lower = value.toLowerCase();
          if (lower.includes("deploy") || lower.includes("publish") && lower.includes("gh-pages")) {
            commands.push({
              label: `${manager} run ${name}`,
              command: manager,
              args: `run ${name}`,
              source: "npm-script",
              category: "deploy",
              osSupport: OS_ALL,
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (existsSync(join(projectPath, "Dockerfile"))) {
    commands.push({ label: "docker build", command: "docker", args: "build -t app .", source: "docker", category: "deploy", osSupport: OS_ALL });
    commands.push({ label: "docker compose up", command: "docker", args: "compose up -d", source: "docker", category: "deploy", osSupport: OS_ALL });
  }

  return commands;
}
