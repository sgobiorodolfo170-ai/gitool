import { useCallback, useState } from "react";
import type { CommitEntry, Project, ProjectAnalysis } from "../types";
import { getDesktopBridge } from "../lib/bridge";
import { buildFallbackSummary, buildSummaryContext } from "../lib/aiContext";

/**
 * AI 摘要 hook（P-17 / 架构评审 L-10）：封装「取数 → 拼上下文 → AI 调用 → 回退」的完整编排。
 *
 * why 从组件中抽离：
 * 1. 可单测：不依赖 React 生命周期，可独立测试
 * 2. 可复用：批量生成摘要、其他 UI 场景都能调用
 * 3. 可配置：降级策略、提示词工程集中管理
 */
export interface UseAiSummaryResult {
  /** 当前状态：idle / loading / success / error。 */
  status: "idle" | "loading" | "success" | "error";
  /** 用户可见的状态消息。 */
  actionMessage: string | null;
  /** 是否使用 AI 生成（true）还是本地回退（false）。 */
  isAiGenerated: boolean;
  /** 生成摘要的主函数：成功时经 onUpdateProject 写回项目实体。 */
  generateSummary: (input: {
    project: Project;
    analysis: ProjectAnalysis | null;
    onUpdateProject: (data: Partial<Project>) => void;
  }) => Promise<void>;
}

export function useAiSummary(): UseAiSummaryResult {
  const bridge = getDesktopBridge();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isAiGenerated, setIsAiGenerated] = useState(false);

  const generateSummary = useCallback(
    async (input: {
      project: Project;
      analysis: ProjectAnalysis | null;
      onUpdateProject: (data: Partial<Project>) => void;
    }): Promise<void> => {
      const { project, analysis, onUpdateProject } = input;

      if (!bridge) {
        setActionMessage("浏览器预览无法生成摘要");
        setStatus("error");
        return;
      }

      setStatus("loading");
      setActionMessage("正在生成摘要...");
      setIsAiGenerated(false);

      try {
        // 1. 并发取数（原 OverviewPanel.tsx:95-100）
        const [readme, history, disk, settings] = await Promise.all([
          bridge.readProjectReadme(project.path),
          bridge.listCommitHistory(project.path).catch((): CommitEntry[] => []),
          bridge.getDiskSize(project.path).catch((): number => 0),
          bridge.loadSettings().catch(() => null),
        ]);

        // 2. 拼上下文（纯函数，src/lib/aiContext.ts）
        const context = buildSummaryContext({ project, readme, history, disk, analysis });

        // 3. AI 调用 + 降级决策（原 OverviewPanel.tsx:132-160）
        const aiConfigured = Boolean(settings?.aiApiKeyConfigured);
        if (aiConfigured) {
          setActionMessage("正在调用 AI 服务生成摘要...");
          const aiResult = await bridge.generateAiSummary({
            projectName: project.name,
            context: context.forAi,
          });
          if (aiResult.success) {
            onUpdateProject({ summary: aiResult.summary });
            setActionMessage("AI 摘要已生成并保存");
            setStatus("success");
            setIsAiGenerated(true);
            return;
          }
          setActionMessage(`${aiResult.error ?? "AI 摘要失败"}，已回退到本地摘要`);
        }

        // 4. 本地回退
        onUpdateProject({ summary: buildFallbackSummary(context.fallbackParts) });
        setActionMessage(
          aiConfigured
            ? "已保存本地智能摘要（AI 服务不可用）"
            : "本地智能摘要已生成（未发送到任何外部服务）",
        );
        setStatus("success");
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "生成摘要失败");
        setStatus("error");
      }
    },
    [bridge],
  );

  return { status, actionMessage, isAiGenerated, generateSummary };
}
