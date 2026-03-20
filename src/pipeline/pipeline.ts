/**
 * Pipeline: the step chain for processing conversation files.
 *
 * Conversation-level: Parse → CountTokens → Segment
 * Dimension-level:    Identify → (Classify + Color in parallel)
 *
 * The dimension loop lives here — each stage file exposes a
 * single-dimension function, and this module iterates over dimensions.
 *
 * Orchestration (who runs what, error handling, store write-back)
 * lives in orchestrate.ts. This file is just the steps.
 */

import type {
  PipelineState,
  PipelineCallbacks,
  PipelineDataField,
} from "@/model/types";
import { PipelineStep } from "@/model/types";
import {
  type Notify,
  startStep,
  endStep,
  updateState,
  markComplete,
  markFailed,
  markPausedForApiKey,
  timed,
} from "./notify";
import { hasApiKey, getAIConfig } from "@/stages/ai/config";
import { ensureDimensions, ensureDimension, getDimensionNames } from "@/model/dimensions";

import { runParse, restorePreProcessedImport } from "@/stages/parse";
import { runCountTokens, runStaticComponents } from "@/stages/count-tokens";
import { runSegment } from "@/stages/segment";
import { identifyForDimension } from "@/stages/identify-components";
import { classifyForDimension } from "@/stages/classify-components";
import { colorForDimension } from "@/stages/color-components";

// ---------------------------------------------------------------------------
// Dimension-level pipeline
// ---------------------------------------------------------------------------

/**
 * Run the dimension-level pipeline steps from `startFrom` through Color.
 * Throws on error — callers handle try/catch and markComplete/markFailed.
 *
 * When `dimNames` is provided, only those dimensions are processed.
 * When omitted, all dimensions run.
 */
export async function runDimensionSteps(
  startFrom: PipelineStep,
  ctx: PipelineState,
  notify: Notify,
  dimNames?: string[],
): Promise<void> {
  if (startFrom <= PipelineStep.Segment) {
    await runSegment(ctx, notify);
    updateState(notify, ctx, ["conversation"], "finding-components");
  }

  if (startFrom <= PipelineStep.Classify) {
    startStep(notify, ctx, "finding-components");

    const dims = ensureDimensions(ctx);
    const activeDimNames = dimNames ?? getDimensionNames(ctx);
    const config = getAIConfig("Componentisation");
    const errors: string[] = [];

    // Ensure each active dimension has an entry (new files start with empty dimensions)
    for (const dimName of activeDimNames) {
      ensureDimension(dims, dimName);
    }

    if (startFrom <= PipelineStep.Identify) {
      const { timing } = await timed(async () => {
        await Promise.all(
          activeDimNames.map(async (dimName) => {
            const dimData = dims[dimName]!;
            const result = await identifyForDimension(
              ctx.conversation!, dimData, config, ctx.id,
            );
            if (result.error) errors.push(`[${dimName}] ${result.error}`);
          }),
        );
      });
      ctx.stepTimings!["identifying-components"] = timing;
    }

    // Classify and Color run in parallel per dimension
    const { timing: classifyTiming } = await timed(async () => {
      await Promise.all(
        activeDimNames.map(async (dimName) => {
          const dimData = dims[dimName]!;
          if (!config) return;

          const [classifyResult, colorResult] = await Promise.all([
            classifyForDimension(ctx.conversation!, dimData, config, ctx.id),
            colorForDimension(dimData, config, ctx.id, ctx.presetColors),
          ]);

          if (classifyResult.error) errors.push(`[${dimName}] ${classifyResult.error}`);
          if (colorResult.error) errors.push(`[${dimName}] ${colorResult.error}`);
        }),
      );
    });
    ctx.stepTimings!["classifying-components"] = classifyTiming;

    ctx.dimensions = dims;
    if (errors.length > 0) ctx.warnings!.push(errors.join("; "));

    endStep(ctx, "finding-components");
    updateState(notify, ctx, ["conversation", "dimensions"]);
    return;
  }

  if (startFrom <= PipelineStep.Color) {
    const dims = ensureDimensions(ctx);
    const activeDimNames = dimNames ?? getDimensionNames(ctx);
    const config = getAIConfig("Componentisation");

    startStep(notify, ctx, "coloring");
    const { timing } = await timed(async () => {
      await Promise.all(
        activeDimNames.map(async (dimName) => {
          const dimData = dims[dimName];
          if (!dimData || !config) return;
          await colorForDimension(dimData, config, ctx.id, ctx.presetColors);
        }),
      );
    });
    ctx.dimensions = dims;
    ctx.stepTimings!.coloring = timing;
    endStep(ctx, "coloring");
  }
}

// ---------------------------------------------------------------------------
// New file processing
// ---------------------------------------------------------------------------

const PRE_PROCESSED_COMPLETE: PipelineDataField[] = [
  "conversation", "summary", "metadata", "title",
  "aiSummary", "analysis",
  "dimensions",
  "staticComponents", "staticMapping", "staticTimeline",
  "customSegmentationPrompt", "customSummaryPrompt",
  "customAnalysisPrompt",
];

const PARSED_FIELDS: PipelineDataField[] = [
  "conversation", "summary", "metadata",
  "staticComponents", "staticMapping", "staticTimeline",
];

const NEW_FILE_COMPLETE: PipelineDataField[] = [
  "conversation", "summary", "metadata",
  "dimensions",
  "staticComponents", "staticMapping", "staticTimeline",
  "customSegmentationPrompt",
];

export async function processNewFile(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    await runParse(ctx, notify);
    updateState(notify, ctx, ["conversation", "summary", "metadata"], "counting-tokens");

    if (ctx.metadata!.parserName === "Context Viewer") {
      restorePreProcessedImport(ctx, ctx.metadata!, ctx.conversation!);
      markComplete(notify, ctx, PRE_PROCESSED_COMPLETE);
      return;
    }

    await runCountTokens(ctx, notify);
    await runStaticComponents(ctx);

    if (!hasApiKey()) {
      markPausedForApiKey(notify, ctx, PARSED_FIELDS, "segmenting");
      return;
    }
    updateState(notify, ctx, PARSED_FIELDS, "segmenting");

    await runDimensionSteps(PipelineStep.Segment, ctx, notify);
    markComplete(notify, ctx, NEW_FILE_COMPLETE);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

// ---------------------------------------------------------------------------
// Resume from API key pause
// ---------------------------------------------------------------------------

const RESUME_COMPLETE: PipelineDataField[] = [
  "conversation", "dimensions",
];

export async function resumeFromPause(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    await runDimensionSteps(PipelineStep.Segment, ctx, notify);
    markComplete(notify, ctx, RESUME_COMPLETE);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}
