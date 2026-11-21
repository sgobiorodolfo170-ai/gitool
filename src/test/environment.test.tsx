// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * 测试基座自检：证明 jsdom 环境、React 挂载与 jest-dom 匹配器同时可用。
 * 这不是业务测试，而是防止 vitest 配置被后续改动破坏后，组件测试静默失效。
 */
describe("jsdom 测试基座", () => {
  it("能挂载 React 组件并使用 jest-dom 匹配器", () => {
    render(<p>hello</p>);

    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
