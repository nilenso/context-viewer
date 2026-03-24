/**
 * Context analysis stage.
 *
 * Algorithm: generate AI analysis of context usage patterns by analyzing
 * component distribution and providing recommendations.
 *
 * Pipeline wrapper: runAnalysis, runEnsureSummaryThenAnalysis,
 * regenerateAnalysisIfNeeded.
 */

import { streamText } from "ai";
import type { Conversation } from "@/model/schema";
import type {
  PipelineState,
  PipelineCallbacks,
  DimensionData,
  ComponentTimelineSnapshot,
} from "@/model/types";
import { computeTupleTokens, generateComponentCSV } from "@/operations/aggregation";
import { getPrompt } from "./ai/prompts";
import { getAIConfig, getProviderOptions, createModel } from "./ai/config";
import { createPhaseLogger } from "@/pipeline/stage-logger";
import { recordCall } from "@/lib/session-recorder";
import { type Notify, startStep, endStep, timed, updateState } from "@/pipeline/notify";
import { getAllComponents, getDefaultDimension } from "@/model/dimensions";
import { runSummary } from "./summarize";

// ---------------------------------------------------------------------------
// Loggers
// ---------------------------------------------------------------------------

const logAnalysis = createPhaseLogger("analyzing", "Context Analysis");
const logAnalysisError = createPhaseLogger(
  "analyzing",
  "Context Analysis",
  "error",
);

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

/**
 * Generate AI analysis of context usage patterns
 * Analyzes component distribution and provides recommendations for improvement
 */
export async function generateContextAnalysis(
  conversation: Conversation,
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
  aiSummary: string,
  onChunk?: (chunk: string) => void,
  customPrompt?: string,
  conversationId?: string,
  dimensions?: Record<string, DimensionData>,
): Promise<{ analysis: string; error?: string }> {
  return recordCall("stages/analyze", "generateContextAnalysis", [{ messageCount: conversation.messages.length, components, hasCustomPrompt: !!customPrompt }], () => _generateContextAnalysis(conversation, componentTimeline, components, aiSummary, onChunk, customPrompt, conversationId, dimensions));
}

async function _generateContextAnalysis(
  conversation: Conversation,
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
  aiSummary: string,
  onChunk?: (chunk: string) => void,
  customPrompt?: string,
  conversationId?: string,
  dimensions?: Record<string, DimensionData>,
): Promise<{ analysis: string; error?: string }> {
  logAnalysis(conversationId, "Starting analysis generation");

  const config = getAIConfig("Context Analysis");

  if (!config) {
    return { analysis: "", error: "Context Analysis: No API key configured" };
  }

  const model = createModel(config);

  // Generate component data for analysis
  let allCSVData: string;
  if (dimensions && Object.keys(dimensions).length > 1) {
    // Multi-dimension: use shared tuple computation (same data as waffle chart)
    const { tupleTokens, total } = computeTupleTokens(conversation, dimensions);
    const sorted = Object.entries(tupleTokens).sort((a, b) => b[1] - a[1]);
    const dimNames = Object.keys(dimensions).sort();
    const lines = sorted.map(([tuple, tokens]) => {
      const pct = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0";
      return `${tuple}: ${tokens} tokens (${pct}%)`;
    });
    allCSVData = `Dimensions: ${dimNames.join(", ")}\nTotal: ${total} tokens\n\n${lines.join("\n")}`;
  } else if (dimensions && Object.keys(dimensions).length === 1) {
    // Single dimension: use its timeline
    const dim = Object.values(dimensions)[0]!;
    allCSVData = generateComponentCSV(
      dim.componentTimeline,
      [...new Set(dim.discoveredComponents)],
    );
  } else {
    // Fallback to legacy single-dimension data
    allCSVData = generateComponentCSV(
      componentTimeline,
      components,
    );
  }

  const prompt = getPrompt("context-analysis", {
    conversationSummary: aiSummary,
    componentDataCSV: allCSVData,
    customPrompt,
  });

  try {
    const result = streamText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    let fullText = "";

    // Stream the chunks
    for await (const chunk of result.textStream) {
      fullText += chunk;
      onChunk?.(chunk);
    }

    logAnalysis(
      conversationId,
      `Generated analysis (${fullText.length} chars)`,
    );
    return { analysis: fullText };
  } catch (error) {
    logAnalysisError(conversationId, "Error generating analysis", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { analysis: "", error: `Context Analysis: ${errorMessage}` };
  }
}

// ---------------------------------------------------------------------------
// Pipeline wrapper
// ---------------------------------------------------------------------------

export async function runAnalysis(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
) {
  startStep(notify, ctx, "analyzing");
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
  endStep(ctx, "analyzing");

  ctx.analysis = result.analysis;
  if (result.error) ctx.warnings!.push(result.error);
  ctx.stepTimings!.analyzing = timing;
}

// ---------------------------------------------------------------------------
// Composite sequences
// ---------------------------------------------------------------------------

/** Generate summary if missing, then generate analysis. */
export async function runEnsureSummaryThenAnalysis(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
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
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
): Promise<boolean> {
  const hadAnalysis = !!ctx.analysis || ctx.stepTimings?.analyzing !== undefined;
  if (!hadAnalysis) return false;

  ctx.analysis = "";
  updateState(notify, ctx, ["analysis"], "analyzing");
  await runEnsureSummaryThenAnalysis(ctx, notify, callbacks);
  return true;
}
