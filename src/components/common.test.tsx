// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyProjects, MetricCard } from "./common";

afterEach(cleanup);

describe("MetricCard（阶段 D6）", () => {
  it("提供 onClick 时渲染为按钮并可触发跳转", () => {
    const onClick = vi.fn();
    render(
      <MetricCard
        label="全部项目"
        value="3"
        detail="本地已登记"
        icon={<span />}
        tone="teal"
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /全部项目/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("没有 onClick 时保持静态卡片，不产生虚假按钮", () => {
    const { container } = render(
      <MetricCard label="连接平台" value="2" detail="远程与本地" icon={<span />} tone="blue" />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".metric-card")).not.toBeNull();
  });
});

describe("EmptyProjects（阶段 D5）", () => {
  it("确实没有项目时引导导入", () => {
    render(<EmptyProjects hasProjects={false} onImport={() => {}} onResetFilters={() => {}} />);

    expect(screen.getByText("还没有项目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /导入项目/ })).toBeInTheDocument();
  });

  it("有项目但筛选无结果时引导清除筛选", () => {
    const onResetFilters = vi.fn();
    render(<EmptyProjects hasProjects onImport={() => {}} onResetFilters={onResetFilters} />);

    expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });
});
