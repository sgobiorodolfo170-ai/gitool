import { Blocks, Cloud, FolderGit2, Github } from "lucide-react";
import type { Project } from "../types";

/** 平台图标映射。与 meta.ts 分开是因为它依赖 lucide，而 meta.ts 保持零 UI 依赖以便单测。 */
export const providerIcons: Record<Project["provider"], typeof Github> = {
  local: FolderGit2,
  github: Github,
  gitee: Cloud,
  gitlab: Blocks,
};
