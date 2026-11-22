// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import type { WorkspaceEntity } from "../types";

afterEach(cleanup);

const workspaces: WorkspaceEntity[] = [
  { id: "w1", name: "个人工作区", createdAt: "2026-11-21", updatedAt: "2026-11-21" },
  { id: "w2", name: "团队工作区", createdAt: "2026-11-21", updatedAt: "2026-11-21" },
];

function renderSwitcher(overrides: Partial<Parameters<typeof WorkspaceSwitcher>[0]> = {}) {
  const props = {
    workspaces,
    activeId: "w1",
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<WorkspaceSwitcher {...props} />);
  return props;
}

describe("WorkspaceSwitcher（阶段 E2）", () => {
  it("触发区是带 aria-haspopup/aria-expanded 的按钮", () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: /个人工作区/ });

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("打开后焦点落第一项，方向键循环、Home/End 跳首尾", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: /个人工作区/ });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0]!, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(items[items.length - 1]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("Escape 关闭菜单并把焦点还给触发按钮", () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: /个人工作区/ });
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("触发按钮上按 ArrowDown 直接打开菜单", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: /个人工作区/ });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it("选择工作区后关闭菜单并回调", () => {
    const props = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /个人工作区/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /团队工作区/ }));

    expect(props.onSwitch).toHaveBeenCalledWith("w2");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
