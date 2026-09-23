import { spawn } from "node:child_process";
import { statSync } from "node:fs";

export type EditorTarget = "vscode" | "cursor";

export async function openInEditor(projectPath: string, editor: EditorTarget, newWindow: boolean): Promise<void> {
  assertDirectory(projectPath);
  const command = editor === "vscode" ? "code" : "cursor";
  const args = newWindow ? ["--new-window", projectPath] : [projectPath];
  spawnDetached(command, args);
}

export async function openInTerminal(projectPath: string): Promise<void> {
  assertDirectory(projectPath);
  spawnDetached("powershell", ["-NoExit", "-Command", `Set-Location -LiteralPath '${projectPath}'`]);
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
    // 编辑器或终端不存在时静默失败，由渲染层提示
  });
  child.unref();
}