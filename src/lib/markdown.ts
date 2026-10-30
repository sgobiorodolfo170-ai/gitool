import MarkdownIt from "markdown-it";

/**
 * README 渲染器。
 *
 * 安全基线（改动时务必保持）：
 * 1. `html: false` —— 源文件里的原始 HTML 一律转义。README 中的 `<script>`、
 *    `<img onerror=...>` 不会变成可执行标签，输出只包含 markdown-it 自己生成的
 *    标签，因此可以安全地交给 `dangerouslySetInnerHTML`。
 * 2. 链接与图片都经过协议白名单（见 `validateLink`），`javascript:`、`file:` 等
 *    不会进入 href/src。
 *
 * 之所以从自实现的 40 行渲染器换成 markdown-it：自实现只覆盖标题 / 列表 / 代码块 /
 * 粗斜体 / 链接，README 里常见的表格、图片、引用、分隔线、任务列表、嵌套列表全部
 * 渲染错误（表格退化成带竖线的段落、嵌套列表被拍平）。这些是阅读体验的主要瓶颈，
 * 不是 CSS 能补的。
 */
export function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 带协议头的绝对地址只放行这三种。 */
const SAFE_PROTOCOL = /^(?:https?:|mailto:)/i;
/** 图片额外允许内联的 data:image。 */
const SAFE_IMAGE_DATA = /^data:image\//i;
/** 判断是否带协议头（`javascript:`、`file:`、`data:` 都算）。 */
const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

const markdown = new MarkdownIt({
  html: false,
  // 裸链接自动识别：README 里直接写 https://... 很常见
  linkify: true,
  // 单个换行不转 <br>：GitHub 的 README 靠空行分段，转成 <br> 会让段落黏在一起
  breaks: false,
});

markdown.validateLink = (url) => {
  const trimmed = url.trim();
  // 相对路径放行：`![](./shot.png)` 要先被识别成图片，才能在下方的 image 规则里
  // 替换成占位提示（桌面端没有 web 基址，相对路径一定加载失败）。
  if (!HAS_PROTOCOL.test(trimmed)) return true;
  return SAFE_PROTOCOL.test(trimmed) || SAFE_IMAGE_DATA.test(trimmed);
};

const baseLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

// 链接一律新窗口打开：主进程的 setWindowOpenHandler 会转交给系统浏览器，
// 否则点击会顶掉应用自己的界面。
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noreferrer noopener");
  return baseLinkOpen(tokens, idx, options, env, self);
};

const baseImage =
  markdown.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
  // attrGet 的返回类型是 string | number | null，统一成字符串再判断
  const src = String(tokens[idx].attrGet("src") ?? "");
  if (SAFE_PROTOCOL.test(src) || SAFE_IMAGE_DATA.test(src)) {
    return baseImage(tokens, idx, options, env, self);
  }
  // 相对路径的图片在桌面应用里没有可用的基址，直接渲染只会得到裂图。
  // 改为占位提示，至少让人知道这里本该有张图、路径是什么。
  const alt = (tokens[idx].content || "").trim() || src;
  return (
    `<span class="md-image-placeholder" title="${escapeHtml(src)}">` +
    `图片：${escapeHtml(alt)}</span>`
  );
};

export function renderMarkdownSafe(source: string): string {
  return markdown.render(source);
}
