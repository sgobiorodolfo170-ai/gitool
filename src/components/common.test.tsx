// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../../shared/entities";
import {
  AnalysisMetric,
  DetailStat,
  EmptyProjects,
  FilterButton,
  GitOperationButton,
  MetricCard,
  ProjectRow,
} from "./common";

/**
 * 纯展示件测试（P-18 第二阶段：组件层引入 @testing-library/react）。
 *
 * why 从 common.tsx 起步：这些组件零 bridge 依赖、纯 props 驱动——
 * 不需要 mock window.gitool 或 localStorage，断言聚焦「渲染结构 + 回调接线」，
 * 是组件测试里成本最低、回归价值最直接的起点。
 */

afterEach(cleanup);

describe("MetricCard", () => {
  it("无 onClick 时渲染静态卡片，不伪装成可点按钮", () => {
    render(<MetricCard label="项目总数" value="12" detail="个仓库" icon={<svg />} tone="info" />);
    expect(screen.getByText("项目总数")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("有 onClick 时渲染为按钮并响应点击", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <MetricCard label="待处理" value="3" detail="需关注" icon={<svg />} tone="warn" onClick={onClick} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("FilterButton", () => {
  it("active 时附加 active 类名并透传点击", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterButton active={false} onClick={onClick}>
        全部
      </FilterButton>,
    );
    const button = screen.getByRole("button", { name: "全部" });
    expect(button.className).not.toContain("active");
    rerender(
      <FilterButton active onClick={onClick}>
        全部
      </FilterButton>,
    );
    expect(button.className).toContain("active");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectRow", () => {
  function renderRow(overrides: Partial<Parameters<typeof ProjectRow>[0]> = {}) {
    const project = createProject({
      id: "p-1",
      name: "demo-repo",
      path: "C:\\repos\\demo-repo",
      branch: "main",
      diskSizeBytes: 2048,
      syncLabel: "已同步",
      alias: "演示项目",
    });
    const props = {
      project,
      selected: false,
      bulkSelected: false,
      onToggleBulk: vi.fn(),
      onSelect: vi.fn(),
      onToggleFavorite: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    };
    render(<ProjectRow {...props} />);
    return props;
  }

  it("渲染别名、分支与磁盘大小（别名优先于项目名）", () => {
    renderRow();
    expect(screen.getByText("演示项目")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("已同步")).toBeInTheDocument();
  });

  it("主信息区/收藏/删除/复选框分别触发各自回调，互不串扰", async () => {
    const user = userEvent.setup();
    const props = renderRow();
    await user.click(screen.getByRole("button", { name: /演示项目/ }));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "收藏项目" }));
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "从我的项目移除" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("checkbox", { name: "选择项目" }));
    expect(props.onToggleBulk).toHaveBeenCalledTimes(1);
  });

  it("未收藏时收藏按钮可切到取消收藏文案", () => {
    const project = createProject({ id: "p-2", name: "fav", path: "C:\\fav", favorite: true });
    render(<ProjectRow
      project={project}
      selected={false}
      bulkSelected={false}
      onToggleBulk={vi.fn()}
      onSelect={vi.fn()}
      onToggleFavorite={vi.fn()}
      onDelete={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "取消收藏" })).toBeInTheDocument();
  });
});

describe("EmptyProjects", () => {
  it("没有任何项目时展示导入引导", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(<EmptyProjects hasProjects={false} onImport={onImport} onResetFilters={vi.fn()} />);
    expect(screen.getByText("还没有项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /导入项目/ }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("有项目但筛选无结果时展示清除筛选", async () => {
    const onResetFilters = vi.fn();
    const user = userEvent.setup();
    render(<EmptyProjects hasProjects onImport={vi.fn()} onResetFilters={onResetFilters} />);
    expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });
});

describe("AnalysisMetric 与 DetailStat", () => {
  it("按 label/value 原样渲染", () => {
    render(<AnalysisMetric label="文件数" value="1,234" />);
    expect(screen.getByText("文件数")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();

    render(<DetailStat icon={<svg />} label="分支" value="main" />);
    expect(screen.getByText("分支")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });
});

describe("GitOperationButton", () => {
  it("空闲时按操作名渲染并透传点击", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<GitOperationButton operation="pull" activeOperation={null} onRun={onRun} icon={<svg />} />);
    await user.click(screen.getByRole("button"));
    expect(onRun).toHaveBeenCalledWith("pull");
  });

  it("有其他操作执行中时禁用；本操作执行中时显示执行中", () => {
    const { rerender } = render(
      <GitOperationButton operation="push" activeOperation="pull" onRun={vi.fn()} icon={<svg />} />,
    );
    expect(screen.getByRole("button")).toBeDisabled();

    rerender(<GitOperationButton operation="push" activeOperation="push" onRun={vi.fn()} icon={<svg />} />);
    expect(screen.getByRole("button")).toHaveTextContent("执行中");
  });
});
