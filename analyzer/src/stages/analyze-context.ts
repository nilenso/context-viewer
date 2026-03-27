/**
 * Context analysis stage.
 * Generates AI analysis of context usage patterns.
 * No streaming — returns final text.
 */

import { generateText } from "ai";
import type { Conversation } from "../model/schema";
import type { PipelineState, DimensionData, ComponentTimelineSnapshot } from "../model/types";
import type { AIConfig } from "../config";
import { computeTupleTokens, generateComponentCSV } from "../operations/aggregation";
import { getPrompt } from "./prompts";
import { getProviderOptions, createModel } from "../config";
import { stageLogger } from "../logger";
import { getAllComponents, getDefaultDimension } from "../model/dimensions";
import { upstreamError, type StageError } from "../errors";
import { runSummary } from "./summarize";

const log = stageLogger("analyze-context");

export async function generateContextAnalysis(
  conversation: Conversation,
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
  aiSummary: string,
  config: AIConfig,
  customPrompt?: string,
  dimensions?: Record<string, DimensionData>,
): Promise<{ analysis: string; error?: StageError }> {
  log.info("Starting analysis generation");

  const model = createModel(config);

  let allCSVData: string;
  if (dimensions && Object.keys(dimensions).length > 1) {
    const { tupleTokens, total } = computeTupleTokens(conversation, dimensions);
    const sorted = Object.entries(tupleTokens).sort((a, b) => b[1] - a[1]);
    const dimNames = Object.keys(dimensions).sort();
    const lines = sorted.map(([tuple, tokens]) => {
      const pct = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0";
      return `${tuple}: ${tokens} tokens (${pct}%)`;
    });
    allCSVData = `Dimensions: ${dimNames.join(", ")}\nTotal: ${total} tokens\n\n${lines.join("\n")}`;
  } else if (dimensions && Object.keys(dimensions).length === 1) {
    const dim = Object.values(dimensions)[0]!;
    allCSVData = generateComponentCSV(dim.componentTimeline, [...new Set(dim.discoveredComponents)]);
  } else {
    allCSVData = generateComponentCSV(componentTimeline, components);
  }

  const prompt = getPrompt("context-analysis", {
    conversationSummary: aiSummary,
    componentDataCSV: allCSVData,
    customPrompt,
  });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    log.info(`Generated analysis (${result.text.length} chars)`);
    return { analysis: result.text };
  } catch (error) {
    log.error("Error generating analysis", error);
    return {
      analysis: "",
      error: upstreamError("analyze-context", `AI call failed: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/** Pipeline-level analysis runner. */
export async function runAnalysis(
  ctx: PipelineState,
  config: AIConfig,
): Promise<{ error?: StageError }> {
  const allComponents = getAllComponents(ctx);

  if (!ctx.aiSummary || allComponents.length === 0) {
    const missing = [];
    if (!ctx.aiSummary) missing.push("aiSummary");
    if (allComponents.length === 0) missing.push("components");
    log.warn(`Skipping: missing ${missing.join(", ")}`);
    return {};
  }

  const defaultDim = getDefaultDimension(ctx);
  const { analysis, error } = await generateContextAnalysis(
    ctx.conversation!,
    defaultDim?.componentTimeline || [],
    allComponents,
    ctx.aiSummary,
    config,
    ctx.customAnalysisPrompt,
    ctx.dimensions,
  );

  ctx.analysis = analysis;
  if (error) ctx.warnings!.push(error.message);
  return { error };
}

/** Generate summary if missing, then generate analysis. */
export async function runEnsureSummaryThenAnalysis(
  ctx: PipelineState,
  config: AIConfig,
): Promise<{ errors: StageError[] }> {
  const errors: StageError[] = [];

  if (!ctx.aiSummary) {
    const { error } = await runSummary(ctx, config);
    if (error) errors.push(error);
  }

  const { error } = await runAnalysis(ctx, config);
  if (error) errors.push(error);

  return { errors };
}
