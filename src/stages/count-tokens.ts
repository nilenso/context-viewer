/**
 * Token counting + static componentisation.
 * Run after parsing, before AI steps.
 */

import type { WorkflowState } from "@/model/types";
import { type Notify, startStep, endStep, timed } from "@/pipeline/notify";
import { addTokenCounts } from "@/operations/token-counting";
import { staticComponentise } from "@/operations/static-components";

export async function runCountTokens(ctx: WorkflowState, notify: Notify) {
  startStep(notify, ctx, "counting-tokens");
  const { result, timing } = await timed(() => addTokenCounts(ctx.conversation!));
  endStep(ctx, "counting-tokens");

  ctx.conversation = result;
  ctx.stepTimings!["counting-tokens"] = timing;
}

/** Instant (no AI) — no startStep call. */
export async function runStaticComponents(ctx: WorkflowState) {
  const result = staticComponentise(ctx.conversation!);
  ctx.staticComponents = result.components;
  ctx.staticMapping = result.mapping;
  ctx.staticTimeline = result.timeline;
}
