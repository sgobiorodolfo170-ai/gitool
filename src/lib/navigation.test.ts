import { describe, expect, it } from "vitest";
import { buildNavGroups, workspaceLabel } from "./navigation";

describe("buildNavGroups", () => {
  it("返回两组导航，顺序固定", () => {
    const groups = buildNavGroups({ projects: 0, remotes: 0, tasks: 0 });
    expect(groups.map((group) => group.label)).toEqual(["工作区", "工具"]);
  });

  it("计数为 0 时不显示徽标", () => {
    const groups = buildNavGroups({ projects: 0, remotes: 0, tasks: 0 });
    const projects = groups[0].items.find((item) => item.id === "projects");
    expect(projects?.count).toBeUndefined();
  });

  it("计数大于 0 时显示字符串徽标", () => {
    const groups = buildNavGroups({ projects: 12, remotes: 3, tasks: 1 });
    expect(groups[0].items.find((item) => item.id === "projects")?.count).toBe("12");
    expect(groups[0].items.find((item) => item.id === "remotes")?.count).toBe("3");
    expect(groups[1].items.find((item) => item.id === "tasks")?.count).toBe("1");
  });

  it("覆盖全部 7 个视图且无重复", () => {
    const ids = buildNavGroups({ projects: 1, remotes: 1, tasks: 1 }).flatMap((group) =>
      group.items.map((item) => item.id),
    );
    expect(ids).toEqual(["overview", "projects", "remotes", "tasks", "backups", "logs", "settings"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("workspaceLabel", () => {
  it("返回中文标签", () => {
    expect(workspaceLabel("overview")).toBe("总览");
    expect(workspaceLabel("projects")).toBe("我的项目");
    expect(workspaceLabel("logs")).toBe("设置与记录");
  });

  it("每个视图都有标签，不返回 undefined", () => {
    for (const view of ["overview", "projects", "remotes", "tasks", "backups", "logs", "settings"] as const) {
      expect(workspaceLabel(view)).toBeTruthy();
    }
  });
});
