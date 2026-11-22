// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeViewport } from "./NoticeViewport";
import type { Notice } from "../lib/notice";

// vitest 未开启 globals，RTL 不会自动 cleanup；不清理会让后一个用例
// 同时看到前一个用例的 DOM，导致 getAllByRole 取到旧节点。
afterEach(cleanup);

const notices: Notice[] = [
  { id: "1", kind: "success", message: "设置已保存" },
  { id: "2", kind: "error", message: "保存失败：磁盘只读" },
];

describe("NoticeViewport", () => {
  it("成功用 status，失败用 alert", () => {
    render(<NoticeViewport notices={notices} onDismiss={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("设置已保存");
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败：磁盘只读");
  });

  it("每条提示都可单独关闭并回传 id", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<NoticeViewport notices={notices} onDismiss={onDismiss} />);

    const buttons = screen.getAllByRole("button", { name: "关闭提示" });
    await user.click(buttons[1]!);

    expect(onDismiss).toHaveBeenCalledWith("2");
  });

  it("四种类型使用各自的样式类", () => {
    const all: Notice[] = [
      { id: "a", kind: "success", message: "成功" },
      { id: "b", kind: "error", message: "失败" },
      { id: "c", kind: "warning", message: "警告" },
      { id: "d", kind: "info", message: "信息" },
    ];
    const { container } = render(<NoticeViewport notices={all} onDismiss={vi.fn()} />);

    for (const kind of ["success", "error", "warning", "info"]) {
      expect(container.querySelector(`.notice-${kind}`)).not.toBeNull();
    }
  });

  it("空列表不渲染任何内容", () => {
    const { container } = render(<NoticeViewport notices={[]} onDismiss={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
