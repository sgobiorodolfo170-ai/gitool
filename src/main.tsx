import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// 主进程把启动时的最终主题随首屏 query 传入：在 React 挂载前落 data-theme，
// 深色用户不会先看到浅色页面再切换（阶段 F2/F4）。
const initialTheme = new URLSearchParams(window.location.search).get("theme");
if (initialTheme === "dark" || initialTheme === "light") {
  document.documentElement.dataset.theme = initialTheme;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
