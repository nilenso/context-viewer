/**
 * Context analysis workflow step + composite sequences involving analysis.
 */

import type { WorkflowState, WorkflowCallbacks, WorkflowDataField, Activity } from "./types";
import { WorkflowRunner } from "./runner";
import { generateContextAnalysis } from "../ai-summary";
import { runSummary } from "./summarize";

// ---------------------------------------------------------------------------
// Activity factory
// ---------------------------------------------------------------------------

export const createAnalysisActivity = (
  onChunk?: (id: string, chunk: string) => void,
): Activity<{ analysis: string; error?: string }> => {
  return async (ctx) => {
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
      return { analysis: "" };
    }

    const result = await generateContextAnalysis(
      ctx.conversation!,
      ctx.componentTimeline || [],
      [...allComponents],
      ctx.aiSummary,
      (chunk) => onChunk?.(ctx.id, chunk),
      ctx.customAnalysisPrompt,
      ctx.id,
      ctx.dimensions,
    );
    return { analysis: result.analysis, error: result.error };
  };
};

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

export async function runAnalysis(
  ctx: WorkflowState,
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks,
) {
  runner.startStep(ctx, "analysis");
  const { result, timing } = await runner.runActivity(
    ctx,
    createAnalysisActivity(callbacks.onAnalysisChunk),
    "analysis",
  );
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
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks,
) {
  if (!ctx.aiSummary) {
    await runSummary(ctx, runner, callbacks);
  }
  await runAnalysis(ctx, runner, callbacks);
}

/**
 * Re-generate analysis if it was previously generated.
 * Returns whether analysis was regenerated (needed for field list computation).
 */
export async function regenerateAnalysisIfNeeded(
  ctx: WorkflowState,
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks,
): Promise<boolean> {
  const hadAnalysis = !!ctx.analysis || ctx.stepTimings?.analysis !== undefined;
  if (!hadAnalysis) return false;

  ctx.analysis = "";
  runner.updateState(ctx, ["analysis"], "analysis");
  await runEnsureSummaryThenAnalysis(ctx, runner, callbacks);
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
