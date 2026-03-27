/**
 * Summary generation stage.
 * Generates an AI summary of a conversation.
 * No streaming — returns final text.
 */

import { generateText } from "ai";
import type { Conversation } from "../model/schema";
import type { PipelineState, ConversationMetadata } from "../model/types";
import type { AIConfig } from "../config";
import { getPrompt } from "./prompts";
import { getProviderOptions, createModel } from "../config";
import { stripLargeContent } from "./strip-large-content";
import { stageLogger } from "../logger";
import { upstreamError, type StageError } from "../errors";

const log = stageLogger("summarize");

export interface ConversationStats {
  messageCount: number;
  turnCount: number;
  durationMs?: number;
}

export async function generateConversationSummary(
  conversation: Conversation,
  config: AIConfig,
  customPrompt?: string,
  metadata?: ConversationMetadata,
  stats?: ConversationStats,
): Promise<{ summary: string; error?: StageError }> {
  log.info("Starting summary generation");

  const model = createModel(config);

  const strippedConversation = stripLargeContent(conversation);

  const prompt = getPrompt("conversation-summary", {
    conversationOverview: strippedConversation,
    customPrompt,
    metadata,
    stats,
  });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    log.info(`Generated summary (${result.text.length} chars)`);
    return { summary: result.text };
  } catch (error) {
    log.error("Error generating summary", error);
    return {
      summary: "",
      error: upstreamError("summarize", `AI call failed: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

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

/** Pipeline-level summary runner. */
export async function runSummary(
  ctx: PipelineState,
  config: AIConfig,
): Promise<{ error?: StageError }> {
  const stats = calculateConversationStats(ctx.conversation!);
  const { summary, error } = await generateConversationSummary(
    ctx.conversation!,
    config,
    ctx.customSummaryPrompt,
    ctx.metadata,
    stats,
  );

  ctx.aiSummary = summary;
  if (error) ctx.warnings!.push(error.message);
  return { error };
}
