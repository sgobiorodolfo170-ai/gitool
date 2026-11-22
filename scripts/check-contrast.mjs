/**
 * 语义色对比度检查（阶段 F6）。
 *
 * 为什么单独成脚本：axe 在 jsdom 下无法算真实对比度（已关闭 color-contrast），
 * 而「暗色下状态色 ≥ 4.5:1」是阶段 F 的硬验收。这里直接读两个 token 层的
 * CSS 变量，解析 var() 引用后按 WCAG 2.1 计算相对亮度比。
 *
 * 检查范围：正文/按钮/状态胶囊/反馈条等承载文字的组合（阈值 4.5:1）。
 * 不检查 `--text-faint` 这类纯装饰/元信息 token——浅色主题下它们本就低于
 * 4.5（阶段 C 的既有取舍），本脚本只对阶段 F 新增的暗色承诺负责，
 * 同时把浅色的正文级组合一并守住，避免暗色改动回退浅色基线。
 *
 * 用法：node scripts/check-contrast.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_RATIO = 4.5;

function readBlock(file, selectorPattern) {
  const css = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const match = selectorPattern.exec(css);
  if (!match) throw new Error(`${file}: 未找到 ${selectorPattern}`);
  const block = css.slice(match.index + match[0].length);
  const end = block.indexOf("}");
  const map = new Map();
  for (const line of block.slice(0, end).split(/\r?\n/)) {
    const declaration = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line);
    if (declaration) map.set(declaration[1], declaration[2].trim());
  }
  return map;
}

function resolve(map, name, seen = new Set()) {
  const key = name.startsWith("--") ? name : `--${name}`;
  if (seen.has(key)) throw new Error(`循环变量引用：${key}`);
  const value = map.get(key);
  if (value === undefined) throw new Error(`未定义的 token：${key}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (!reference) return value;
  return resolve(map, reference[1], new Set([...seen, key]));
}

function luminance(hex) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAIRS = [
  ["text-strong", "bg-surface"],
  ["text-body", "bg-surface"],
  ["text-body", "bg-app"],
  ["text-secondary", "bg-surface"],
  ["accent-strong", "bg-surface"],
  ["danger", "bg-surface"],
  ["status-clean-fg", "status-clean-bg"],
  ["status-ahead-fg", "status-ahead-bg"],
  ["status-behind-fg", "status-behind-bg"],
  ["status-dirty-fg", "status-dirty-bg"],
  ["status-conflict-fg", "status-conflict-bg"],
  ["feedback-error-fg", "feedback-error-bg"],
  ["feedback-warning-fg", "feedback-warning-bg"],
  ["feedback-info-fg", "feedback-info-bg"],
  // 主按钮：文字用 --bg-surface，底色用 --status-clean-fg
  ["bg-surface", "status-clean-fg"],
];

const light = readBlock("src/styles/tokens.css", /:root\s*\{/);
const dark = new Map([
  ...light,
  ...readBlock("src/styles/dark.css", /:root\[data-theme="dark"\]\s*\{/),
]);

let failed = false;
for (const [theme, tokens] of [
  ["light", light],
  ["dark", dark],
]) {
  const rows = PAIRS.map(([foreground, background]) => {
    const ratio = contrast(resolve(tokens, foreground), resolve(tokens, background));
    const ok = ratio >= MIN_RATIO;
    if (!ok) failed = true;
    return { foreground, background, ratio, ok };
  });

  console.log(`\n${theme} 主题（阈值 4.5:1）`);
  for (const row of rows) {
    console.log(
      `${row.ok ? "OK  " : "FAIL"} ${row.foreground.padEnd(22)} on ${row.background.padEnd(22)} ${row.ratio.toFixed(2)}:1`,
    );
  }
}

if (failed) {
  console.error("\n存在低于 4.5:1 的语义配色，请调整 tokens.css / dark.css。");
  process.exit(1);
}
console.log("\n通过：两个主题的正文级配色均 ≥ 4.5:1。");
