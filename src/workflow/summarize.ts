/**
 * AI summary generation.
 */

import type { WorkflowState, WorkflowCallbacks } from "./types";
import { type Notify, startStep, endStep, timed } from "./runner";
import { generateConversationSummary, type ConversationStats } from "../ai-summary";

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
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
) {
  startStep(notify, ctx, "summary");
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
  endStep(ctx, "summary");

  ctx.aiSummary = result.summary;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.summary = timing;
}
