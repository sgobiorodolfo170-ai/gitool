/**
 * 极简 Markdown 渲染器（用于 README 预览）。
 *
 * 安全约定（改动时务必保持）：
 * **必须先 escapeHtml，再套用 Markdown 标签**。顺序反了就会把仓库 README 里的
 * `<img onerror=...>` 变成可执行 HTML。本模块的输出会被 `dangerouslySetInnerHTML` 消费，
 * 因此任何新增的标签生成逻辑都只能作用在已转义文本上。
 *
 * 之所以不引入 markdown-it 之类的库：README 预览只需要标题 / 列表 / 代码块 / 粗斜体 / 链接，
 * 自实现 40 行足够，且不增加渲染层的包体积与供应链面。
 */

export function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 行内语法。入参必须已经过 escapeHtml。
 * 链接只放行 http/https，并排除引号与尖括号——即使转义失效也不会逃逸 href 属性。
 */
export function inlineMarkdown(source: string): string {
  return source
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

export function renderMarkdownSafe(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(escapeHtml(line));
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 6);
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(line.replace(/^\s*[-*+]\s+/, "")))}</li>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(line.replace(/^\s*\d+[.)]\s+/, "")))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(escapeHtml(line))}</p>`);
  }

  if (inCode) html.push("</code></pre>");
  closeList();
  return html.join("\n");
}
