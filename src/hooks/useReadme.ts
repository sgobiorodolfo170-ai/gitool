import { useEffect, useState } from "react";
import { getDesktopBridge } from "../lib/bridge";

export type ReadmeState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; content: string; fileName: string };

/**
 * 读取项目 README。
 *
 * 提成 hook 而不是留在组件里：卡片内视图和全屏阅读视图要共用同一份内容，
 * 各自调一次会重复读盘（README 动辄几百 KB）。
 */
export function useReadme(projectPath: string): ReadmeState {
  const [state, setState] = useState<ReadmeState>({ status: "loading" });

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      // 浏览器预览没有文件系统访问能力
      setState({ status: "missing" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void bridge
      .readProjectReadme(projectPath)
      .then((result) => {
        if (cancelled) return;
        setState(
          result.found && result.content.trim()
            ? { status: "ready", content: result.content, fileName: result.fileName }
            : { status: "missing" },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return state;
}
