// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDetail } from "./ProjectDetail";
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

function renderDetail() {
  render(
    <ProjectDetail
      project={project}
      onToggleFavorite={() => {}}
      onUpdateProject={() => {}}
      onMoveProject={() => {}}
      onRunGitOperation={() => {}}
      activeOperation={null}
      externalBusy={false}
      operationOutput={null}
      onAnalyzeProject={() => {}}
      isAnalyzing={false}
      analysis={null}
    />,
  );
}

describe("详情选项卡（阶段 E4）", () => {
  it("使用 tablist/tab/tabpanel 语义并同步 aria-selected", () => {
    renderDetail();

    expect(screen.getByRole("tablist", { name: "项目详情分区" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-controls", "detail-tab-panel-overview");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "detail-tab-overview");
  });

  it("左右箭头切换并移动焦点，Home/End 跳首尾", () => {
    renderDetail();
    const tabs = screen.getAllByRole("tab");

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs[1]);

    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tabs[2]);

    fireEvent.keyDown(tabs[2]!, { key: "Home" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
  });
});
