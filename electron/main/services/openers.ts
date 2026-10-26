import { execFile, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type EditorTarget = "vscode" | "cursor";

export async function openInEditor(projectPath: string, editor: EditorTarget, newWindow: boolean): Promise<void> {
  assertDirectory(projectPath);
  const command = editor === "vscode" ? "code" : "cursor";
  await assertCommandExists(editor === "vscode" ? "VS Code" : "Cursor", command);
  const args = newWindow ? ["--new-window", projectPath] : [projectPath];
  spawnDetached(command, args);
}

export async function openInTerminal(projectPath: string): Promise<void> {
  assertDirectory(projectPath);
  await assertCommandExists("PowerShell", "powershell");
  // 刻意不用 `-Command "Set-Location -LiteralPath '<path>'"`：
  // Windows 目录名允许单引号，拼进脚本后可在词法解析阶段逃逸字符串并注入命令
  // （`-LiteralPath` 只影响参数绑定，挡不住注入）。改为把目录交给 spawn 的 cwd，
  // PowerShell 启动后初始位置即项目目录，全程零字符串拼接。
  spawnDetached("powershell", ["-NoExit"], projectPath);
}

async function assertCommandExists(label: string, command: string): Promise<void> {
  try {
    await execFileAsync("where", [command], { windowsHide: true });
  } catch {
    throw new Error(`${label} 未安装或不在 PATH 中，无法打开`);
  }
}

function assertDirectory(target: string): void {
  const stats = statSync(target);
  if (!stats.isDirectory()) {
    throw new Error("项目路径不是目录");
  }
}

function spawnDetached(command: string, args: string[], cwd?: string): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    ...(cwd ? { cwd } : {}),
  });
  child.on("error", () => {
    // 启动失败时静默，检测已在上层完成
  });
  child.unref();
}