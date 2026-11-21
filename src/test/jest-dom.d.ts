/**
 * 让 tsc 在测试文件中看到 jest-dom 的匹配器类型。
 *
 * 运行时注册在 `src/test/setup.ts`；这里显式引入一份类型入口，
 * 避免 tsc 因为 setup 未被测试文件 import 而漏掉全局 expect 扩展。
 */
import "@testing-library/jest-dom/vitest";
