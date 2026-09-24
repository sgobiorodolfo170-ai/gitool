import type { AiSummaryRequest, AiSummaryResult } from "../../../shared/types";
import { loadSettings } from "./storage";

export async function generateAiSummary(input: AiSummaryRequest): Promise<AiSummaryResult> {
  const settings = loadSettings();
  const baseUrl = (settings.aiBaseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const apiKey = settings.aiApiKey || (process.env.GITOOL_AI_API_KEY ?? "");
  const model = settings.aiModel || "gpt-3.5-turbo";

  if (!apiKey) {
    return {
      success: false,
      summary: "",
      error: "未配置 AI API Key，请在设置中填写或设置环境变量 GITOOL_AI_API_KEY",
    };
  }

  const prompt = [
    `请为以下软件项目生成一份简洁的中文项目摘要（80-150 字），概括项目用途、主要技术栈与当前状态。`,
    `项目名称：${input.projectName}`,
    ``,
    `项目背景信息：`,
    input.context.slice(0, 3000),
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是一个专业的开源项目分析助手，输出精炼、结构化、使用简体中文。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 600,
      }),
    });
  } catch (error) {
    return { success: false, summary: "", error: `AI 服务连接失败：${errorMessage(error)}` };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { success: false, summary: "", error: "AI API Key 无效或权限不足，请检查设置" };
    }
    if (response.status === 429) {
      return { success: false, summary: "", error: "AI 服务配额不足或限流，请稍后重试" };
    }
    return { success: false, summary: "", error: `AI 服务返回 HTTP ${response.status}` };
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const content = extractContent(payload);
  if (!content) {
    return { success: false, summary: "", error: "AI 服务响应解析失败" };
  }
  return { success: true, summary: content.trim() };
}

function extractContent(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0] as Record<string, unknown> | undefined;
  if (!first) {
    return null;
  }
  const message = first.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}