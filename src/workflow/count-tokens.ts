/**
 * Token counting + static componentisation workflow steps.
 * These run after parsing, before AI steps.
 */

import type { WorkflowState, Activity } from "./types";
import type { ComponentTimelineSnapshot } from "../componentisation";
import { WorkflowRunner } from "./runner";
import { addTokenCounts } from "../add-token-counts";
import { staticComponentise } from "../static-componentisation";

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const countTokensActivity: Activity<{
  conversation: import("../schema").Conversation;
}> = async (ctx) => {
  const conversation = await addTokenCounts(ctx.conversation!);
  return { conversation };
};

const staticComponentsActivity: Activity<{
  staticComponents: string[];
  staticMapping: Record<string, string>;
  staticTimeline: ComponentTimelineSnapshot[];
}> = async (ctx) => {
  const result = staticComponentise(ctx.conversation!);
  return {
    staticComponents: result.components,
    staticMapping: result.mapping,
    staticTimeline: result.timeline,
  };
};

// ---------------------------------------------------------------------------
// Step runners
// ---------------------------------------------------------------------------

export async function runCountTokens(ctx: WorkflowState, runner: WorkflowRunner) {
  runner.startStep(ctx, "counting-tokens");
  const { result, timing } = await runner.runActivity(ctx, countTokensActivity, "counting-tokens");
  ctx.conversation = result.conversation;
  ctx.stepTimings!["counting-tokens"] = timing;
}

/** Instant (no AI) — doesn't call runner.startStep. */
export async function runStaticComponents(ctx: WorkflowState, runner: WorkflowRunner) {
  const { result } = await runner.runActivity(ctx, staticComponentsActivity);
  ctx.staticComponents = result.staticComponents;
  ctx.staticMapping = result.staticMapping;
  ctx.staticTimeline = result.staticTimeline;
}
