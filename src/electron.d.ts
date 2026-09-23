import type { DesktopBridge } from "../shared/types";

declare global {
  interface Window {
    gitool?: DesktopBridge;
  }
}

export {};
