/**
 * Summary generation stage.
 *
 * Algorithm: generate a streaming AI summary of a conversation.
 *
 * Pipeline wrapper: runSummary orchestrates summary generation with
 * step tracking and state updates.
 */

import { streamText } from "ai";
import type { Conversation } from "@/model/schema";
import type {
  PipelineState,
  PipelineCallbacks,
  ConversationMetadata,
} from "@/model/types";
import { getPrompt } from "./ai/prompts";
import { getAIConfig, getProviderOptions, createModel } from "./ai/config";
import { stripLargeContent } from "./ai/strip-large-content";
import { createPhaseLogger } from "@/pipeline/stage-logger";
import { type Notify, startStep, endStep, timed } from "@/pipeline/notify";

// ---------------------------------------------------------------------------
// Loggers
// ---------------------------------------------------------------------------

const logSummary = createPhaseLogger("summarizing", "AI Summary");
const logSummaryError = createPhaseLogger("summarizing", "AI Summary", "error");

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

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

  const model = createModel(config);

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
      model,
      prompt,
      providerOptions: getProviderOptions(config),
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

// ---------------------------------------------------------------------------
// Pipeline wrapper
// ---------------------------------------------------------------------------

function calculateConversationStats(conversation: {
  messages: Array<{ role: string; timestamp?: string }>;
}): ConversationStats {
  const messages = conversation.messages;
  const messageCount = messages.length;
  const turnCount = messages.filter((m) => m.role === "user").length;

  let durationMs: number | undefined;
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;

  for (const message of messages) {
    if (message.timestamp) {
      const ts = new Date(message.timestamp);
      if (!isNaN(ts.getTime())) {
        if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
        if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
      }
    }
  }

  if (firstTimestamp && lastTimestamp) {
    durationMs = lastTimestamp.getTime() - firstTimestamp.getTime();
  }

  return { messageCount, turnCount, durationMs };
}

export async function runSummary(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
) {
  startStep(notify, ctx, "summarizing");
  const { result, timing } = await timed(async () => {
    const stats = calculateConversationStats(ctx.conversation!);
    return generateConversationSummary(
      ctx.conversation!,
      (chunk) => callbacks.onSummaryChunk?.(ctx.id, chunk),
      ctx.customSummaryPrompt,
      ctx.metadata,
      stats,
      ctx.id,
    );
  });
  endStep(ctx, "summarizing");

  ctx.aiSummary = result.summary;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.summarizing = timing;
}
