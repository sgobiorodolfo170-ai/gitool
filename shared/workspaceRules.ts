import type { WorkspaceEntity } from "./types";

/**
 * 工作区领域规则（纯函数，双端共用）。
 *
 * why 抽到 shared/：P-10（架构评审 L-07）——「至少保留一个工作区」「名称非空」
 * 「删除前项目数校验」三条规则原先在渲染层（src/lib/workspaces.ts）与主进程
 * （storage/workspaces.ts + ipc/schemas.ts）各写一份，无共享代码/测试，已经
 * 出现行为漂移（渲染版对损坏数据静默放行、主进程版用 SQL 计数）。
 * 抽成纯函数后两端共用同一实现，单测一处覆盖。
 *
 * why 放独立文件而不并入 shared/types.ts：types.ts 是纯类型叶（零运行时代码），
 * 本文件是运行时值；混入会让任何只想引用类型的模块被迫把运行时代码拖进产物。
 */

/** 至少保留一个工作区：最后一个工作区禁止删除。 */
export function assertCanDeleteWorkspace(count: number): void {
  if (count <= 1) {
    throw new Error("至少保留一个工作区，无法删除最后一个工作区");
  }
}

/** 工作区名称不能为空（trim 后校验）。 */
export function assertWorkspaceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("工作区名称不能为空");
  }
  return trimmed;
}

/**
 * 删除工作区前校验：工作区还有项目时禁止删除。
 *
 * @param projectCount 该工作区当前的项目数量。
 */
export function assertWorkspaceEmpty(projectCount: number): void {
  if (projectCount > 0) {
    throw new Error(`该工作区还有 ${projectCount} 个项目，请先清空或移动项目后再删除`);
  }
}

/**
 * 从候选工作区中解析「当前应激活的工作区」：
 * 上次激活的 ID 仍存在则沿用，否则回退到第一个。
 *
 * why 抽函数：该逻辑原先在 App.tsx 的 desktop/浏览器两条 bootstrap 分支各写一遍，
 * 已经漂移（浏览器分支不设 selectedId）；抽成纯函数后 useBootstrap 单点调用。
 */
export function resolveActiveWorkspace(
  workspaces: readonly WorkspaceEntity[],
  lastActiveId: string | null,
  fallbackId: WorkspaceEntity["id"],
): string {
  if (lastActiveId && workspaces.some((item) => item.id === lastActiveId)) {
    return lastActiveId;
  }
  return workspaces[0]?.id ?? fallbackId;
}
