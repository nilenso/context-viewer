import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation } from "./schema";

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
 * Returns a promise that resolves with the complete summary text
 */
export async function generateConversationSummary(
  conversation: Conversation,
  onChunk?: (chunk: string) => void
): Promise<string> {
  console.log("[AI Summary] Starting summary generation");

  const config = getSummaryConfig();

  if (!config) {
    console.log("[AI Summary] No config, skipping summary");
    return "";
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

  const prompt = `Analyze this conversation and provide a concise summary covering:

1. Goal: What is the main objective or task being discussed?
2. Turns: How many meaningful exchanges occurred? What was the flow?
3. Result: What was accomplished or concluded?

Keep it brief and to the point. Use simple markdown text formatting only (headings, paragraphs, lists, bold).
Do not use code blocks, tables, or complex formatting.

Conversation:
${JSON.stringify(conversationOverview, null, 2)}`;

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
    return fullText;
  } catch (error) {
    console.error("[AI Summary] Error generating summary:", error);
    return "";
  }
}
