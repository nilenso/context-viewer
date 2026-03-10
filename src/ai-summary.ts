import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation } from "./schema";
import type { ComponentTimelineSnapshot, DimensionData } from "./componentisation";
import type { ConversationMetadata } from "./parser";
import { getPrompt } from "./prompts";
import { stripLargeContent } from "./strip-large-content";
import { getAIConfig } from "./ai-config";
import { workflowLog, type ProcessingPhase } from "./workflow-logger";

// Helper to log with optional conversation context
function logSummary(
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) {
  if (conversationId) {
    workflowLog(
      conversationId,
      "summary" as ProcessingPhase,
      "info",
      message,
      data,
    );
  } else {
    if (data !== undefined) {
      console.log(`[AI Summary] ${message}`, data);
    } else {
      console.log(`[AI Summary] ${message}`);
    }
  }
}

function logSummaryError(
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) {
  if (conversationId) {
    workflowLog(
      conversationId,
      "summary" as ProcessingPhase,
      "error",
      message,
      data,
    );
  } else {
    console.error(`[AI Summary] ${message}`, data);
  }
}

function logAnalysis(
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) {
  if (conversationId) {
    workflowLog(
      conversationId,
      "analysis" as ProcessingPhase,
      "info",
      message,
      data,
    );
  } else {
    if (data !== undefined) {
      console.log(`[Context Analysis] ${message}`, data);
    } else {
      console.log(`[Context Analysis] ${message}`);
    }
  }
}

function logAnalysisError(
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) {
  if (conversationId) {
    workflowLog(
      conversationId,
      "analysis" as ProcessingPhase,
      "error",
      message,
      data,
    );
  } else {
    console.error(`[Context Analysis] ${message}`, data);
  }
}

export interface ConversationStats {
  messageCount: number;
  turnCount: number;
  durationMs?: number;
}

/**
 * Generate a streaming AI summary of the conversation
 * Calls onChunk with each text chunk as it arrives
 * Returns a promise that resolves with the complete summary text and error info
 */
export async function generateConversationSummary(
  conversation: Conversation,
  onChunk?: (chunk: string) => void,
  customPrompt?: string,
  metadata?: ConversationMetadata,
  stats?: ConversationStats,
  conversationId?: string,
): Promise<{ summary: string; error?: string }> {
  logSummary(conversationId, "Starting summary generation");

  const config = getAIConfig("AI Summary");

  if (!config) {
    return { summary: "", error: "AI Summary: No API key configured" };
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  // Strip large content (images, files, truncate tool calls/results) - same as componentisation
  const strippedConversation = stripLargeContent(conversation);

  const prompt = getPrompt("conversation-summary", {
    conversationOverview: strippedConversation,
    customPrompt,
    metadata,
    stats,
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

    logSummary(conversationId, `Generated summary (${fullText.length} chars)`);
    return { summary: fullText };
  } catch (error) {
    logSummaryError(conversationId, "Error generating summary", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { summary: "", error: `AI Summary: ${errorMessage}` };
  }
}

/**
 * Generate CSV data from component timeline for analysis
 */
function generateComponentCSV(
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
  conversation: Conversation,
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
        const percentage =
          snapshot.totalTokens > 0
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
  onChunk?: (chunk: string) => void,
  customPrompt?: string,
  conversationId?: string,
  dimensions?: Record<string, DimensionData>,
): Promise<{ analysis: string; error?: string }> {
  logAnalysis(conversationId, "Starting analysis generation");

  const config = getAIConfig("Context Analysis");

  if (!config) {
    return { analysis: "", error: "Context Analysis: No API key configured" };
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  // Generate CSV of component data over time (default/legacy dimension)
  const componentDataCSV = generateComponentCSV(
    componentTimeline,
    components,
    conversation,
  );

  // Generate per-dimension CSV data if multiple dimensions exist
  let dimensionCSVs = "";
  if (dimensions && Object.keys(dimensions).length > 1) {
    const dimSections: string[] = [];
    for (const [dimName, dim] of Object.entries(dimensions)) {
      const dimCSV = generateComponentCSV(
        dim.componentTimeline,
        dim.components,
        conversation,
      );
      dimSections.push(`## Dimension: ${dimName}\n${dimCSV}`);
    }
    dimensionCSVs = "\n\n" + dimSections.join("\n\n");
  }

  const prompt = getPrompt("context-analysis", {
    conversationSummary: aiSummary,
    componentDataCSV: componentDataCSV + dimensionCSVs,
    customPrompt,
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

    logAnalysis(
      conversationId,
      `Generated analysis (${fullText.length} chars)`,
    );
    return { analysis: fullText };
  } catch (error) {
    logAnalysisError(conversationId, "Error generating analysis", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { analysis: "", error: `Context Analysis: ${errorMessage}` };
  }
}
