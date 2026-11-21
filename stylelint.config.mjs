/**
 * 样式约束（阶段 A 建立，阶段 C 收紧）。
 *
 * 分成两层：
 * 1. 全局限定：新增/迁移后的样式文件必须遵守 token、字号、!important 规则；
 * 2. 存量豁免：`styles.css` 还有 243 个硬编码色值与 75 处 8/9px 字号，
 *    整文件暂时关闭三条规则，避免 CI 从第一天就红。阶段 C 完成字号与
 *    hex 收敛后，删除 `src/styles.css` 这条 override，规则即在存量文件生效。
 *
 * 为什么用 override 而不是 stylelint-disable 注释：
 * 注释会散落在 3000 行文件里，未来清理时容易漏；override 只有一处，
 * 删掉即全量生效，也便于在评审时看见“还欠哪一条规则”。
 */

/** @type {import("stylelint").Config} */
export default {
  rules: {
    // tokens.css 是唯一允许写 hex 的文件；其余样式必须使用 var(--token)。
    "color-no-hex": true,
    // !important 会破坏 token/主题覆盖的层叠关系，禁止新增。
    "declaration-no-important": true,
    // 8/9px 在 1440×900 下已接近不可读；最小字号统一到 10px。
    "declaration-property-value-disallowed-list": {
      "font-size": ["/^8px$/", "/^9px$/", "/^calc\\(8px/", "/^calc\\(9px/"],
    },
  },
  overrides: [
    {
      files: ["src/styles/tokens.css"],
      rules: {
        // token 层是 hex 的唯一合法归宿
        "color-no-hex": null,
      },
    },
  ],
};
