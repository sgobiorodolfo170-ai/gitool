// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

afterEach(cleanup);

describe("EmptyState", () => {
  it("三态使用各自的语义类名", () => {
    const { container, rerender } = render(<EmptyState variant="no-data" title="还没有项目" />);
    expect(container.querySelector(".empty-state-no-data")).not.toBeNull();

    rerender(<EmptyState variant="no-match" title="没有匹配的项目" />);
    expect(container.querySelector(".empty-state-no-match")).not.toBeNull();

    rerender(<EmptyState variant="error" title="加载失败" description="请重试" />);
    expect(container.querySelector(".empty-state-error")).not.toBeNull();
    expect(screen.getByText("请重试")).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("按行数渲染占位块，并对读屏隐藏", () => {
    const { container } = render(<Skeleton rows={4} />);

    expect(container.querySelectorAll(".skeleton-block")).toHaveLength(4);
    expect(container.querySelector(".skeleton")).toHaveAttribute("aria-hidden", "true");
  });
});
