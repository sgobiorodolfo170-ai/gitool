/**
 * UI 约束守卫（棘轮基线）。
 *
 * 为什么需要基线而不是直接“必须为 0”：阶段 A 开始时存量代码里还有
 * 16 处原生对话框、17 处未分发字体、75 处 8/9px 字号、31 处失败仍走
 * 普通提示。如果 CI 从第一天就要求 0，只能整段跳过检查；基线允许
 * “不新增”，并在每完成一项整改后手动下调到新值（棘轮），最终归零。
 *
 * 用法：
 *   node scripts/ui-guard.mjs
 *
 * 规则与对应整改任务：
 * - native-dialogs   → B6 归零
 * - dm-mono          → C6 归零
 * - tiny-fonts       → C2–C4 归零
 * - failure-notice   → B4/B5 归零
 * - important        → C11 归零
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** 当前允许的存量上限。每完成一项整改，把对应值下调；归零后保持 0。 */
const BASELINE = {
  nativeDialogs: 0,
  dmMono: 17,
  tinyFonts: 75,
  failureNotice: 0,
  important: 8,
};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

const codeFiles = walk(SRC).filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file),
);
const styleFile = join(SRC, "styles.css");

/** 返回 `相对路径:行号` 列表；一行多次命中只记一次（与人工核对口径一致）。 */
function scanLines(files, pattern) {
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) hits.push(`${relative(ROOT, file)}:${index + 1}`);
    });
  }
  return hits;
}

/**
 * 失败语义调用：跨行匹配整个 `onNotice(...)` 调用，只有“文案含失败词
 * 且参数里没有显式 kind”才算违规。逐行匹配会把已经补了 `{ kind }` 的
 * 调用继续算成问题，导致棘轮永远无法下调。
 */
function scanFailureNoticeCalls(files) {
  const hits = [];
  const callPattern = /onNotice\(([\s\S]*?)\)\s*;/g;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(callPattern)) {
      const args = match[1];
      if (!/失败|错误|无法|不可用|未完成/.test(args)) continue;
      if (/kind\s*:/.test(args)) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      hits.push(`${relative(ROOT, file)}:${line}`);
    }
  }

  return hits;
}

const checks = [
  {
    label: "原生 confirm/alert",
    baseline: BASELINE.nativeDialogs,
    // ConfirmProvider 的 window.confirm 是“Provider 未挂载”时的唯一兜底
    // （浏览器预览 / 单测），不是界面交互路径，按设计豁免。
    hits: scanLines(
      codeFiles.filter((file) => !file.endsWith("ConfirmProvider.tsx")),
      /window\.(?:confirm|alert)\s*\(/,
    ),
  },
  {
    label: "未分发字体 DM Mono",
    baseline: BASELINE.dmMono,
    hits: scanLines([styleFile], /"DM Mono"/),
  },
  {
    label: "8/9px 字号",
    baseline: BASELINE.tinyFonts,
    hits: scanLines([styleFile], /calc\((?:8|9)px\s*\*\s*var\(--font-scale\)\)/),
  },
  {
    label: "失败语义仍走普通提示",
    baseline: BASELINE.failureNotice,
    hits: scanFailureNoticeCalls(codeFiles),
  },
  {
    label: "!important",
    baseline: BASELINE.important,
    hits: scanLines([styleFile], /!important/),
  },
];

let failed = false;
console.log("UI 约束守卫（当前 / 基线）\n");

for (const check of checks) {
  const ok = check.hits.length <= check.baseline;
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "FAIL"} ${check.label}: ${check.hits.length} / ${check.baseline}`);

  if (!ok) {
    for (const hit of check.hits.slice(0, 10)) console.log(`       ${hit}`);
    if (check.hits.length > 10) console.log(`       …另有 ${check.hits.length - 10} 处`);
  } else if (check.hits.length < check.baseline) {
    console.log(`       低于基线，可下调 BASELINE 到 ${check.hits.length}（棘轮）`);
  }
}

if (failed) {
  console.log("\n存在新增违规：请修复，或如果本次整改确实消除了旧问题，同步下调基线。");
  process.exit(1);
}

console.log("\n通过：没有超过既有基线。");
