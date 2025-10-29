import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation } from "./schema";
import type { ComponentTimelineSnapshot } from "./componentisation";
import { getPrompt } from "./prompts";

/**
 * Configuration for AI model used in summarization
 */
interface SummaryConfig {
  apiKey: string;
  model: string;
}

/**
 * Get summary configuration from environment variables
 */
export function getSummaryConfig(): SummaryConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    console.log("[AI Summary] No API key configured, skipping AI summary");
    return null;
  }

  console.log(`[AI Summary] Config loaded: model=${model}`);
  return { apiKey, model };
}

/**
 * Generate a streaming AI summary of the conversation
 * Calls onChunk with each text chunk as it arrives
 * Returns a promise that resolves with the complete summary text and error info
 */
export async function generateConversationSummary(
  conversation: Conversation,
  onChunk?: (chunk: string) => void
): Promise<{ summary: string; error?: string }> {
  console.log("[AI Summary] Starting summary generation");

  const config = getSummaryConfig();

  if (!config) {
    console.log("[AI Summary] No config, skipping summary");
    return { summary: "", error: "AI Summary: No API key configured" };
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  // Create a condensed version of the conversation for the prompt
  const conversationOverview = {
    totalMessages: conversation.messages.length,
    messages: conversation.messages.map((msg, idx) => ({
      index: idx,
      role: msg.role,
      partTypes: msg.parts.map((p) => p.type),
      textPreview: msg.parts
        .filter((p) => p.type === "text" || p.type === "reasoning")
        .map((p) => {
          const text = p.type === "text" || p.type === "reasoning" ? p.text : "";
          return text.slice(0, 500); // First 500 chars of each text part
        })
        .join(" "),
    })),
  };

  const prompt = getPrompt("conversation-summary", { conversationOverview });

  try {
    const result = streamText({
      model: openai(config.model),
      prompt,
    });

    let fullText = "";

    // Stream the chunks
    for await (const chunk of result.textStream) {
      fullText += chunk;
      onChunk?.(chunk);
    }

    console.log(`[AI Summary] Generated summary (${fullText.length} chars)`);
    return { summary: fullText };
  } catch (error) {
    console.error("[AI Summary] Error generating summary:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { summary: "", error: `AI Summary: ${errorMessage}` };
  }
}

/**
 * Generate CSV data from component timeline for analysis
 */
function generateComponentCSV(
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
  conversation: Conversation
): string {
  // CSV header
  const header = ["Message", "Total Tokens", ...components].join(",");

  // CSV rows
  const rows = componentTimeline.map((snapshot, idx) => {
    const row = [
      `Msg ${idx + 1}`,
      snapshot.totalTokens.toString(),
      ...components.map((component) => {
        const tokens = snapshot.componentTokens[component] || 0;
        const percentage = snapshot.totalTokens > 0
          ? ((tokens / snapshot.totalTokens) * 100).toFixed(1)
          : "0.0";
        return `${tokens} (${percentage}%)`;
      }),
    ];
    return row.join(",");
  });

  return [header, ...rows].join("\n");
}

/**
 * Generate AI analysis of context usage patterns
 * Analyzes component distribution and provides recommendations for improvement
 */
export async function generateContextAnalysis(
  conversation: Conversation,
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
  aiSummary: string,
  componentMapping: Record<string, string>,
  onChunk?: (chunk: string) => void
): Promise<{ analysis: string; error?: string }> {
  console.log("[Context Analysis] Starting analysis generation");

  const config = getSummaryConfig();

  if (!config) {
    console.log("[Context Analysis] No config, skipping analysis");
    return { analysis: "", error: "Context Analysis: No API key configured" };
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  // Generate CSV of component data over time
  const componentDataCSV = generateComponentCSV(componentTimeline, components, conversation);

  // Enrich conversation with component information
  const enrichedConversation = {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => ({
        ...part,
        component: componentMapping[part.id] || "unmapped",
      })),
    })),
  };

  const prompt = getPrompt("context-analysis", {
    conversationSummary: aiSummary,
    componentDataCSV,
    conversationJson: JSON.stringify(enrichedConversation, null, 2),
  });

  try {
    const result = streamText({
      model: openai(config.model),
      prompt,
    });

    let fullText = "";

    // Stream the chunks
    for await (const chunk of result.textStream) {
      fullText += chunk;
      onChunk?.(chunk);
    }

    console.log(`[Context Analysis] Generated analysis (${fullText.length} chars)`);
    return { analysis: fullText };
  } catch (error) {
    console.error("[Context Analysis] Error generating analysis:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { analysis: "", error: `Context Analysis: ${errorMessage}` };
  }
}
