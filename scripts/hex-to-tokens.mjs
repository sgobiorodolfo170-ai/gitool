/**
 * 把 styles.css 中的硬编码色值收敛到 tokens（阶段 C10，一次性迁移工具）。
 *
 * 为什么用脚本：224 个唯一 hex 分布在 3000+ 行样式里，逐条手改既慢又容易
 * 漏；脚本按“属性类别 → 候选语义色 → RGB 最近邻”确定映射，并输出完整
 * 映射表供审计。脚本只处理 styles.css；tokens.css 是 hex 的唯一合法归宿。
 *
 * 属性类别：
 * - color / fill / stroke → ink 组（文本前景）
 * - background*            → surface 组
 * - border* / outline* / box-shadow → line 组
 *
 * 运行：node scripts/hex-to-tokens.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_FILE = join(ROOT, "src/styles.css");
const dryRun = process.argv.includes("--dry-run");

/** 候选语义色：(变量名, hex)。顺序不影响结果，按 RGB 距离取最近。 */
const PALETTES = {
  ink: [
    ["--text-strong", "#1e2b34"],
    ["--text-body", "#4b5b63"],
    ["--text-secondary", "#5a6c72"],
    ["--text-muted", "#5f6d74"],
    ["--text-tertiary", "#6b787e"],
    ["--text-subtle", "#727f85"],
    ["--text-faint", "#9aa6ab"],
    ["--text-on-dark", "#eef8f3"],
    ["--accent-strong", "#2d7664"],
    ["--accent", "#4a9a83"],
    ["--accent-light", "#82bdad"],
    ["--danger", "#a04a4a"],
    ["--danger-soft", "#f0cfcf"],
  ],
  surface: [
    ["--bg-surface", "#ffffff"],
    ["--bg-subtle", "#fbfcfc"],
    ["--bg-app", "#f5f7f9"],
    ["--bg-accent-soft", "#f2faf7"],
    ["--accent-light", "#82bdad"],
    ["--bg-sidebar", "#15232b"],
    ["--bg-sidebar-hover", "#20343c"],
    ["--status-clean-bg", "#e6f5ee"],
    ["--status-ahead-bg", "#e7f0f7"],
    ["--status-behind-bg", "#faf1d7"],
    ["--status-dirty-bg", "#fae8e1"],
    ["--status-conflict-bg", "#f8dfe4"],
    ["--status-clean-fg", "#256b59"],
    ["--status-ahead-fg", "#3d5f7d"],
    ["--status-behind-fg", "#7a5a1e"],
    ["--status-dirty-fg", "#8f4a38"],
    ["--status-conflict-fg", "#8a3547"],
    ["--feedback-error-bg", "#fdf1f3"],
    ["--provider-github", "#27323a"],
    ["--provider-gitee", "#c94d55"],
    ["--provider-gitlab", "#d97931"],
  ],
  line: [
    ["--border-subtle", "#edf0f1"],
    ["--border-default", "#dfe6e8"],
    ["--border-accent", "#bcdcd3"],
    ["--border-sidebar", "#2e4148"],
    ["--danger-soft", "#f0cfcf"],
    ["--feedback-warning-border", "#f0dfb8"],
    ["--feedback-info-border", "#d5e3f0"],
  ],
};

function parseHex(hex) {
  let value = hex.slice(1);
  if (value.length === 3)
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  if (value.length === 8) value = value.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function nearest(hex, palette) {
  const [r, g, b] = parseHex(hex);
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const [cr, cg, cb] = parseHex(candidate[1]);
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best[0];
}

function paletteFor(property) {
  if (/^background/.test(property)) return PALETTES.surface;
  if (/^border/.test(property) || /^outline/.test(property) || /^box-shadow/.test(property)) {
    return PALETTES.line;
  }
  return PALETTES.ink;
}

const lines = readFileSync(STYLE_FILE, "utf8").split(/\r?\n/);
const mapping = new Map();
const output = lines.map((line) => {
  const propertyMatch = line.match(/^\s*([a-z-]+)\s*:/);
  // 自定义属性（--xxx）属于 token 定义层，不在本脚本迁移范围
  if (!propertyMatch || propertyMatch[1].startsWith("--")) return line;
  const palette = paletteFor(propertyMatch[1]);

  return line.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => {
    const token = nearest(hex, palette);
    mapping.set(
      `${hex.toLowerCase()} → var(${token})`,
      (mapping.get(`${hex.toLowerCase()} → var(${token})`) ?? 0) + 1,
    );
    return `var(${token})`;
  });
});

console.log(`映射组合数：${mapping.size}`);
const sorted = [...mapping.entries()].sort((a, b) => b[1] - a[1]);
for (const [pair, count] of sorted.slice(0, 40)) console.log(`  ${pair}  ×${count}`);

if (dryRun) {
  console.log("dry-run：未写入文件");
} else {
  writeFileSync(STYLE_FILE, output.join("\n"), "utf8");
  console.log(`已写入 ${STYLE_FILE}`);
}
