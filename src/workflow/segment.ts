/**
 * Segmentation: split large text parts into semantic chunks.
 */

import type { WorkflowState } from "./types";
import { type Notify, startStep, endStep, timed } from "./runner";
import { segmentConversation } from "../segmentation";
import { addTokenCounts } from "../add-token-counts";

export async function runSegment(ctx: WorkflowState, notify: Notify) {
  startStep(notify, ctx, "segmenting");
  const { result, timing } = await timed(async () => {
    const segResult = await segmentConversation(
      ctx.conversation!,
      undefined,
      ctx.customSegmentationPrompt,
      ctx.id,
      ctx.segmentationThreshold,
    );
    const conversation = await addTokenCounts(segResult.conversation);
    return { conversation, error: segResult.error };
  });
  endStep(ctx, "segmenting");

  ctx.conversation = result.conversation;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.segmenting = timing;
}
