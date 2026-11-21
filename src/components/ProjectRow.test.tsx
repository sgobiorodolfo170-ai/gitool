// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRow } from "./common";
import type { Project } from "../types";

afterEach(cleanup);

const project: Project = {
  id: "p1",
  name: "gitool",
  path: "D:\\work\\gitool",
  provider: "github",
  branch: "main",
  status: "clean",
  commit: "abc1234",
  favorite: false,
  tags: [],
  files: 1,
  syncLabel: "已同步",
  language: "TypeScript",
  languageColor: "#3178c6",
  summary: "demo",
  updatedAt: "2026-11-21T10:00:00.000Z",
  diskSizeBytes: 1024,
};

function renderRow() {
  const props = {
    project,
    selected: false,
    bulkSelected: false,
    onToggleBulk: vi.fn(),
    onSelect: vi.fn(),
    onToggleFavorite: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <ul>
      <ProjectRow {...props} />
    </ul>,
  );
  return props;
}

describe("ProjectRow（阶段 E3）", () => {
  it("列表项内不再嵌套交互：主信息是独立按钮，操作为同级按钮", () => {
    const { container } = render(
      <ul>
        <ProjectRow
          project={project}
          selected={false}
          bulkSelected={false}
          onToggleBulk={() => {}}
          onSelect={() => {}}
          onToggleFavorite={() => {}}
          onDelete={() => {}}
        />
      </ul>,
    );
    const row = container.querySelector("li.project-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector('button [role="button"]')).toBeNull();
    expect(row?.querySelector(".project-row-select")).not.toBeNull();
    // 行本身不再是 role=button（避免读屏把操作按钮读成行内容）
    expect(row).not.toHaveAttribute("role", "button");
  });

  it("主按钮支持 Enter 与 Space 选择（原生按钮语义）", async () => {
    const user = userEvent.setup();
    const props = renderRow();
    const select = screen.getByRole("button", { name: /gitool/ });
    select.focus();

    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(props.onSelect).toHaveBeenCalledTimes(2);
  });

  it("删除/收藏是同级按钮，点击不会误触选择", () => {
    const props = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "从我的项目移除" }));
    fireEvent.click(screen.getByRole("button", { name: "收藏项目" }));

    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
