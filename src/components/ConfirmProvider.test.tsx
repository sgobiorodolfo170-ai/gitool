// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmProvider, useConfirm } from "./ConfirmProvider";

afterEach(cleanup);

function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState("未触发");

  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm({
            title: "删除任务？",
            description: "删除后运行记录仍保留。",
            confirmLabel: "删除",
            danger: true,
          });
          setResult(ok ? "已确认" : "已取消");
        }}
      >
        打开确认框
      </button>
      <output>{result}</output>
    </div>
  );
}

function renderHarness() {
  return render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  );
}

describe("ConfirmProvider", () => {
  it("打开后显示标题与描述，确认返回 true", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "打开确认框" }));

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "删除任务？" })).toBeInTheDocument();
    expect(screen.getByText("删除后运行记录仍保留。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(screen.getByText("已确认")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("取消返回 false", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "打开确认框" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.getByText("已取消")).toBeInTheDocument());
  });

  it("Escape 等同取消", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "打开确认框" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByText("已取消")).toBeInTheDocument());
  });

  it("关闭后焦点回到触发按钮", async () => {
    const user = userEvent.setup();
    renderHarness();

    const trigger = screen.getByRole("button", { name: "打开确认框" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
