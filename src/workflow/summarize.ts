/**
 * AI summary generation workflow step.
 */

import type { WorkflowState, WorkflowCallbacks, Activity } from "./types";
import { WorkflowRunner } from "./runner";
import { generateConversationSummary, type ConversationStats } from "../ai-summary";

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Activity factory
// ---------------------------------------------------------------------------

export const createSummaryActivity = (
  onChunk?: (id: string, chunk: string) => void,
): Activity<{ summary: string; error?: string }> => {
  return async (ctx) => {
    const stats = calculateConversationStats(ctx.conversation!);
    const result = await generateConversationSummary(
      ctx.conversation!,
      (chunk) => onChunk?.(ctx.id, chunk),
      ctx.customSummaryPrompt,
      ctx.metadata,
      stats,
      ctx.id,
    );
    return { summary: result.summary, error: result.error };
  };
};

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

export async function runSummary(
  ctx: WorkflowState,
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks,
) {
  runner.startStep(ctx, "summary");
  const { result, timing } = await runner.runActivity(
    ctx,
    createSummaryActivity(callbacks.onSummaryChunk),
    "summary",
  );
  ctx.aiSummary = result.summary;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.summary = timing;
}
