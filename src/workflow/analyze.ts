/**
 * Context analysis generation + composite sequences involving analysis.
 */

import type { WorkflowState, WorkflowCallbacks, WorkflowDataField } from "./types";
import { type Notify, startStep, endStep, timed, updateState } from "./runner";
import { generateContextAnalysis } from "../ai-summary";
import { runSummary } from "./summarize";

export async function runAnalysis(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
) {
  startStep(notify, ctx, "analysis");
  const { result, timing } = await timed(async () => {
    const allComponents = new Set(ctx.components || []);
    if (ctx.dimensions) {
      for (const dim of Object.values(ctx.dimensions)) {
        for (const c of dim.components) allComponents.add(c);
      }
    }

    if (!ctx.aiSummary || allComponents.size === 0) {
      const missing = [];
      if (!ctx.aiSummary) missing.push("aiSummary");
      if (allComponents.size === 0) missing.push("components");
      console.warn(`[analysis] Skipping: missing ${missing.join(", ")}`);
      return { analysis: "", error: undefined as string | undefined };
    }

    return generateContextAnalysis(
      ctx.conversation!,
      ctx.componentTimeline || [],
      [...allComponents],
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

/** Determine which data fields to write back for component/segmentation reprocess. */
export function completionFieldsForReprocess(
  event: "component" | "segmentation",
  hadAnalysis: boolean,
): WorkflowDataField[] {
  const base: WorkflowDataField[] = [
    "conversation", "components", "componentMapping", "componentTimeline",
    "componentColors", "dimensions",
  ];

  if (event === "component") {
    base.push("customPrompt");
  } else {
    base.push("customSegmentationPrompt", "segmentationThreshold");
  }

  if (hadAnalysis) {
    base.push("analysis", "aiSummary");
  }

  return base;
}
