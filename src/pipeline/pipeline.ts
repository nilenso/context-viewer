/**
 * Pipeline: the step chain for processing conversation files.
 *
 * Conversation-level: Parse → CountTokens → Segment
 * Dimension-level:    Identify → (Classify + Color in parallel)
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
} from "./notify";
import { hasApiKey } from "@/stages/ai/config";

import { runParse, restorePreProcessedImport } from "@/stages/parse";
import { runCountTokens, runStaticComponents } from "@/stages/count-tokens";
import { runSegment } from "@/stages/segment";
import { runIdentifyComponents } from "@/stages/identify-components";
import { runClassifyComponents } from "@/stages/classify-components";
import { runAssignColors } from "@/stages/color-components";

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
    if (startFrom <= PipelineStep.Identify) {
      const { timing } = await runIdentifyComponents(ctx, dimNames);
      ctx.stepTimings!["identifying-components"] = timing;
    }

    // Classify and Color both depend only on the component list from Identify,
    // not on each other, so they run in parallel.
    const [classifyResult] = await Promise.all([
      runClassifyComponents(ctx, dimNames),
      runAssignColors(ctx, notify, dimNames),
    ]);
    ctx.stepTimings!["classifying-components"] = classifyResult.timing;
    endStep(ctx, "finding-components");
    updateState(notify, ctx, ["conversation", "dimensions"]);
    return;
  }

  if (startFrom <= PipelineStep.Color) {
    await runAssignColors(ctx, notify, dimNames);
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
