import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdownSafe } from "./markdown";

describe("escapeHtml", () => {
  it("转义全部 HTML 敏感字符", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("先转义 & 再处理其他字符，避免二次转义", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("单引号也转义，防止属性逃逸", () => {
    expect(escapeHtml("' onmouseover='alert(1)")).toBe("&#39; onmouseover=&#39;alert(1)");
  });
});

describe("renderMarkdownSafe 安全基线", () => {
  it("把 README 里的 script 标签转义为纯文本", () => {
    const html = renderMarkdownSafe('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("img onerror 不会成为可执行标签", () => {
    const html = renderMarkdownSafe('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("javascript: 与 file: 协议不会进入 href", () => {
    // 被拒绝的链接不会生成锚点，原文作为纯文本保留——所以只能断言「没有 a 标签」，
    // 不能断言输出里不含 "javascript:" 字样。
    const js = renderMarkdownSafe("[点我](javascript:alert(1))");
    expect(js).not.toContain("<a ");
    expect(js).not.toContain('href="javascript:');
    const file = renderMarkdownSafe("[本地](file:///C:/x)");
    expect(file).not.toContain("<a ");
    expect(file).not.toContain('href="file:');
  });

  it("链接一律带 target=_blank 与 rel=noreferrer", () => {
    const html = renderMarkdownSafe("[站点](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("链接 URL 中的引号不会逃逸 href 属性", () => {
    const html = renderMarkdownSafe('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toContain('onmouseover="alert(1)"');
  });
});

describe("renderMarkdownSafe 语法覆盖", () => {
  it("标题按层级输出", () => {
    expect(renderMarkdownSafe("# 一级")).toContain("<h1>一级</h1>");
    expect(renderMarkdownSafe("### 三级")).toContain("<h3>三级</h3>");
  });

  it("表格渲染为 table 而非竖线段落", () => {
    const html = renderMarkdownSafe("| 参数 | 说明 |\n| --- | --- |\n| a | 甲 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>参数</th>");
    expect(html).toContain("<td>甲</td>");
    expect(html).not.toContain("| --- |");
  });

  it("引用块渲染为 blockquote", () => {
    expect(renderMarkdownSafe("> 提示")).toContain("<blockquote>");
  });

  it("分隔线渲染为 hr", () => {
    expect(renderMarkdownSafe("---")).toContain("<hr>");
  });

  it("有序列表渲染为 ol，嵌套列表保留层级", () => {
    expect(renderMarkdownSafe("1. 一\n2. 二")).toContain("<ol>");
    const nested = renderMarkdownSafe("- 一级\n  - 二级");
    // 嵌套时 li 内部还会再出现一层 ul
    expect(nested.match(/<ul>/g)?.length).toBe(2);
  });

  it("裸链接自动识别为锚点", () => {
    const html = renderMarkdownSafe("见 https://example.com/a");
    expect(html).toContain('href="https://example.com/a"');
  });

  it("http 图片正常输出 img，相对路径图片降级为占位", () => {
    expect(renderMarkdownSafe("![图](https://a.com/x.png)")).toContain("<img");
    const local = renderMarkdownSafe("![截图](./shot.png)");
    expect(local).not.toContain("<img");
    expect(local).toContain("md-image-placeholder");
    expect(local).toContain("截图");
  });

  it("代码块内容不做 Markdown 解析，但依然转义", () => {
    const html = renderMarkdownSafe("```\n**not bold** <b>x</b>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("**not bold**");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<strong>");
  });

  it("行内代码与粗斜体", () => {
    const html = renderMarkdownSafe("**粗** *斜* `code`");
    expect(html).toContain("<strong>粗</strong>");
    expect(html).toContain("<em>斜</em>");
    expect(html).toContain("<code>code</code>");
  });

  it("空输入返回空字符串", () => {
    expect(renderMarkdownSafe("")).toBe("");
  });
});
