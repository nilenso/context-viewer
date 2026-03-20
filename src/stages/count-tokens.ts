/**
 * Token counting + static componentisation.
 * Run after parsing, before AI steps.
 */

import type { PipelineState } from "@/model/types";
import { addTokenCounts } from "@/operations/token-counting";
import { staticComponentise } from "@/operations/static-components";

/** Pure — returns conversation with token counts + static component data. */
export async function countTokens(
  ctx: PipelineState,
): Promise<Pick<PipelineState, "conversation" | "staticComponents" | "staticMapping" | "staticTimeline">> {
  const conversation = await addTokenCounts(ctx.conversation!);
  const staticResult = staticComponentise(conversation);
  return {
    conversation,
    staticComponents: staticResult.components,
    staticMapping: staticResult.mapping,
    staticTimeline: staticResult.timeline,
  };
}
