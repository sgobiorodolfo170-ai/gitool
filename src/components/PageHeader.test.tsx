// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("渲染唯一 h1、中文 eyebrow 与描述", () => {
    render(
      <PageHeader
        eyebrow="项目目录"
        title="我的项目"
        description="集中查看本地项目"
        actions={<button>导入项目</button>}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("我的项目");
    expect(screen.getByText("项目目录")).toBeInTheDocument();
    expect(screen.getByText("集中查看本地项目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入项目" })).toBeInTheDocument();
  });

  it("没有描述与图标时不渲染多余节点", () => {
    const { container } = render(<PageHeader eyebrow="设置" title="设置" />);

    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector(".page-icon")).toBeNull();
  });
});
