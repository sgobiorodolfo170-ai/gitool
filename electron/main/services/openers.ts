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
  spawnDetached("powershell", ["-NoExit", "-Command", `Set-Location -LiteralPath '${projectPath}'`]);
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

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.on("error", () => {
    // 启动失败时静默，检测已在上层完成
  });
  child.unref();
}