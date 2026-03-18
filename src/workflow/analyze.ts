/**
 * Context analysis generation + composite sequences involving analysis.
 */

import type { WorkflowState, WorkflowCallbacks } from "./types";
import { type Notify, startStep, endStep, timed, updateState } from "./notify";
import { generateContextAnalysis } from "../ai-summary";
import { runSummary } from "./summarize";
import { getAllComponents, getDefaultDimension } from "./dimensions";

export async function runAnalysis(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
) {
  startStep(notify, ctx, "analysis");
  const { result, timing } = await timed(async () => {
    const allComponents = getAllComponents(ctx);

    if (!ctx.aiSummary || allComponents.length === 0) {
      const missing = [];
      if (!ctx.aiSummary) missing.push("aiSummary");
      if (allComponents.length === 0) missing.push("components");
      console.warn(`[analysis] Skipping: missing ${missing.join(", ")}`);
      return { analysis: "", error: undefined as string | undefined };
    }

    const defaultDim = getDefaultDimension(ctx);
    return generateContextAnalysis(
      ctx.conversation!,
      defaultDim?.componentTimeline || [],
      allComponents,
      ctx.aiSummary,
      (chunk) => callbacks.onAnalysisChunk?.(ctx.id, chunk),
      ctx.customAnalysisPrompt,
      ctx.id,
      ctx.dimensions,
    );
  });
  endStep(ctx, "analysis");

  ctx.analysis = result.analysis;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.analysis = timing;
}

// ---------------------------------------------------------------------------
// Composite sequences
// ---------------------------------------------------------------------------

/** Generate summary if missing, then generate analysis. */
export async function runEnsureSummaryThenAnalysis(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
) {
  if (!ctx.aiSummary) {
    await runSummary(ctx, notify, callbacks);
  }
  await runAnalysis(ctx, notify, callbacks);
}

/**
 * Re-generate analysis if it was previously generated.
 * Returns whether analysis was regenerated.
 */
export async function regenerateAnalysisIfNeeded(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
): Promise<boolean> {
  const hadAnalysis = !!ctx.analysis || ctx.stepTimings?.analysis !== undefined;
  if (!hadAnalysis) return false;

  ctx.analysis = "";
  updateState(notify, ctx, ["analysis"], "analysis");
  await runEnsureSummaryThenAnalysis(ctx, notify, callbacks);
  return true;
}

