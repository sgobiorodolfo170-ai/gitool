/**
 * vitest 全局测试初始化。
 *
 * 为什么在 Node 套件里也加载：jest-dom 的这一入口只做 `expect.extend`，
 * 定义匹配器时不访问 DOM；真正调用匹配器时组件测试已经切到 jsdom。
 * 若改成按环境条件加载，会引入 top-level await 或动态 import 的时序问题，
 * 收益不抵复杂度。
 *
 * 组件测试请使用本文件注册的 `toBeInTheDocument` 等匹配器，不要自己
 * 手写 `expect(container.innerHTML).toContain(...)`——后者会在结构微调时
 * 产生脆弱的断言。
 */
import "@testing-library/jest-dom/vitest";
