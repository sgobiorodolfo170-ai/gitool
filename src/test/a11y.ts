import axe from "axe-core";
import { expect } from "vitest";

/**
 * 组件级可访问性断言（仅在 jsdom 测试中使用）。
 *
 * 只拦截 serious / critical：jsdom 没有布局与计算样式，moderate / minor
 * 的误报率高，若一并失败会让团队很快学会忽略这条断言。
 *
 * color-contrast 必须关闭：该规则依赖真实渲染后的颜色与几何信息，在
 * jsdom 中永远无法得出可信结论。对比度由两处覆盖：
 * 1. `src/styles/tokens.test.ts` 对语义色做静态计算；
 * 2. 阶段 C/G 的人工截图走查。
 *
 * 用法：
 *   const { container } = render(<X />);
 *   await expectNoA11yViolations(container);
 */
export async function expectNoA11yViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });

  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  const detail = blocking
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}`)
    .join("\n");

  expect(blocking, detail).toEqual([]);
}
