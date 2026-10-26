import { describe, expect, it } from "vitest";
import { escapeHtml, inlineMarkdown, renderMarkdownSafe } from "./markdown";

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

describe("inlineMarkdown", () => {
  it("渲染粗体、斜体与行内代码", () => {
    expect(inlineMarkdown("**粗** *斜* `code`")).toBe(
      "<strong>粗</strong> <em>斜</em> <code>code</code>",
    );
  });

  it("只把 http/https 链接转为锚点", () => {
    expect(inlineMarkdown("[站点](https://example.com)")).toContain(
      '<a href="https://example.com"',
    );
    expect(inlineMarkdown("[伪协议](javascript:alert(1))")).not.toContain("<a");
    expect(inlineMarkdown("[文件](file:///C:/x)")).not.toContain("<a");
  });

  it("链接 URL 中的引号不会逃逸 href 属性", () => {
    const output = inlineMarkdown('[x](https://a.com/"onmouseover="alert(1))');
    expect(output).not.toContain('onmouseover="alert(1)"');
  });
});

describe("renderMarkdownSafe", () => {
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

  it("渲染标题与无序列表", () => {
    const html = renderMarkdownSafe("# 标题\n\n- 一\n- 二");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>一</li>");
    expect(html).toContain("<li>二</li>");
    expect(html).toContain("</ul>");
  });

  it("代码块内容不做 Markdown 解析，但依然转义", () => {
    const html = renderMarkdownSafe("```\n**not bold** <b>x</b>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("**not bold**");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<strong>");
  });

  it("代码块未闭合时自动收尾，不产生残缺标签", () => {
    const html = renderMarkdownSafe("```\ncode");
    expect(html).toContain("</code></pre>");
  });

  it("空输入返回空字符串", () => {
    expect(renderMarkdownSafe("")).toBe("");
  });
});
