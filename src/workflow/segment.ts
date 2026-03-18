/**
 * Segmentation workflow step: split large text parts into semantic chunks.
 */

import type { WorkflowState, Activity } from "./types";
import type { Conversation } from "../schema";
import { WorkflowRunner } from "./runner";
import { segmentConversation } from "../segmentation";
import { addTokenCounts } from "../add-token-counts";

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const segmentActivity: Activity<{
  conversation: Conversation;
  error?: string;
}> = async (ctx) => {
  const result = await segmentConversation(
    ctx.conversation!,
    undefined,
    ctx.customSegmentationPrompt,
    ctx.id,
    ctx.segmentationThreshold,
  );
  const conversation = await addTokenCounts(result.conversation);
  return { conversation, error: result.error };
};

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

export async function runSegment(ctx: WorkflowState, runner: WorkflowRunner) {
  runner.startStep(ctx, "segmenting");
  const { result, timing } = await runner.runActivity(ctx, segmentActivity, "segmenting");
  ctx.conversation = result.conversation;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.segmenting = timing;
}
