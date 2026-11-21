// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { getFocusableElements, handleTabKey, nextFocusIndex } from "./focusTrap";

function buildContainer(): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <button id="first">一</button>
    <button id="disabled" disabled>禁用</button>
    <a id="link" href="#x">链接</a>
    <input id="hidden" type="hidden" value="x" />
    <input id="input" value="可编辑" />
    <button id="skip" tabindex="-1">跳过</button>
    <div aria-hidden="true"><button id="hidden-zone">隐藏区</button></div>
    <button id="last">末</button>
  `;
  document.body.replaceChildren(container);
  return container;
}

describe("nextFocusIndex", () => {
  it("没有可聚焦元素时返回 -1", () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
    expect(nextFocusIndex(3, 0, true)).toBe(-1);
  });

  it("未进入容器时 Tab 到第一个、Shift+Tab 到最后一个", () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it("在边界处循环", () => {
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(1, 3, false)).toBe(2);
  });
});

describe("getFocusableElements", () => {
  it("只返回可聚焦元素，按 DOM 顺序", () => {
    const container = buildContainer();
    const ids = getFocusableElements(container).map((element) => element.id);

    expect(ids).toEqual(["first", "link", "input", "last"]);
  });
});

describe("handleTabKey", () => {
  it("从最后一个元素按 Tab 回到第一个", () => {
    const container = buildContainer();
    const last = container.querySelector<HTMLElement>("#last")!;
    last.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    const prevent = vi.spyOn(event, "preventDefault");

    handleTabKey(container, event, document.activeElement);

    expect(prevent).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("first");
  });

  it("从第一个元素按 Shift+Tab 到最后一个", () => {
    const container = buildContainer();
    const first = container.querySelector<HTMLElement>("#first")!;
    first.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });

    handleTabKey(container, event, document.activeElement);

    expect(document.activeElement?.id).toBe("last");
  });

  it("非 Tab 键不拦截", () => {
    const container = buildContainer();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    const prevent = vi.spyOn(event, "preventDefault");

    handleTabKey(container, event, document.activeElement);

    expect(prevent).not.toHaveBeenCalled();
  });

  it("空容器阻止 Tab 逃逸", () => {
    const empty = document.createElement("div");
    document.body.replaceChildren(empty);
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    const prevent = vi.spyOn(event, "preventDefault");

    handleTabKey(empty, event, document.activeElement);

    expect(prevent).toHaveBeenCalled();
  });
});
