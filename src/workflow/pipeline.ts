import type {
  WorkflowState,
  WorkflowCallbacks,
  WorkflowDataField,
  WorkflowOptions,
  WorkflowBatchResult,
} from "./types";
import { PipelineStep } from "./types";
import {
  type Notify,
  startStep,
  endStep,
  updateState,
  markComplete,
  markFailed,
  markPausedForApiKey,
} from "./runner";
import { hasApiKey, getAIConfig } from "../ai-config";
import { generateId } from "../lib/id-generator";

import { runParse, restorePreProcessedImport } from "./parse";
import { runCountTokens, runStaticComponents } from "./count-tokens";
import { runSegment } from "./segment";
import { runIdentifyComponents } from "./component-identification";
import { runClassifyComponents } from "./component-classification";
import { runAssignColors } from "./color";
import { runSummary } from "./summarize";
import { runAnalysis, runEnsureSummaryThenAnalysis, regenerateAnalysisIfNeeded } from "./analyze";

// ---------------------------------------------------------------------------
// Field computation
// ---------------------------------------------------------------------------

/** Collect all data fields affected by running the pipeline from `startFrom`. */
function collectFieldsFrom(startFrom: PipelineStep, includeAnalysis: boolean = false): WorkflowDataField[] {
  const fields = new Set<WorkflowDataField>();

  if (startFrom <= PipelineStep.Segment) {
    fields.add("conversation");
    fields.add("customSegmentationPrompt");
    fields.add("segmentationThreshold");
  }
  if (startFrom <= PipelineStep.Identify) {
    fields.add("dimensions");
  }
  if (startFrom <= PipelineStep.Classify) {
    fields.add("dimensions");
  }
  if (startFrom <= PipelineStep.Color) {
    fields.add("dimensions");
  }

  if (includeAnalysis) {
    fields.add("analysis");
    fields.add("aiSummary");
  }

  return [...fields];
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * Run the dimension-level pipeline steps from `startFrom` through Color.
 * Throws on error — callers handle try/catch and markComplete/markFailed.
 *
 * When `dimNames` is provided, only those dimensions are processed.
 * When omitted, all dimensions run.
 */
async function runDimensionSteps(
  startFrom: PipelineStep,
  ctx: WorkflowState,
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
      ctx.stepTimings!["identifying-components" as any] = timing;
    }
    const { timing: classTiming } = await runClassifyComponents(ctx, dimNames);
    ctx.stepTimings!["classifying-components" as any] = classTiming;
    endStep(ctx, "finding-components");
    updateState(notify, ctx, ["conversation", "dimensions"], "coloring");
  }

  if (startFrom <= PipelineStep.Color) {
    await runAssignColors(ctx, notify, dimNames);
  }
}

/**
 * Run the processing pipeline from `startFrom` through the end.
 * This is the main reprocess entrypoint for prompt changes.
 *
 * When `dimNames` is provided, only those dimensions are processed
 * (for dimension-scoped changes like editing one dimension's prompt).
 * When omitted, all dimensions are processed (for conversation-level
 * changes like segmentation, or new file processing).
 */
export async function runPipelineFrom(
  startFrom: PipelineStep,
  ctx: WorkflowState,
  notify: Notify,
  callbacks?: WorkflowCallbacks,
  dimNames?: string[],
): Promise<void> {
  try {
    await runDimensionSteps(startFrom, ctx, notify, dimNames);

    // Regenerate analysis if it existed before
    const regenerated = callbacks
      ? await regenerateAnalysisIfNeeded(ctx, notify, callbacks)
      : false;

    markComplete(notify, ctx, collectFieldsFrom(startFrom, regenerated));
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

// ---------------------------------------------------------------------------
// New file processing
// ---------------------------------------------------------------------------

const PRE_PROCESSED_COMPLETE: WorkflowDataField[] = [
  "conversation", "summary", "metadata", "title",
  "aiSummary", "analysis",
  "dimensions",
  "staticComponents", "staticMapping", "staticTimeline",
  "customSegmentationPrompt", "customSummaryPrompt",
  "customAnalysisPrompt",
];

const PARSED_FIELDS: WorkflowDataField[] = [
  "conversation", "summary", "metadata",
  "staticComponents", "staticMapping", "staticTimeline",
];

const NEW_FILE_COMPLETE: WorkflowDataField[] = [
  "conversation", "summary", "metadata",
  "dimensions",
  "staticComponents", "staticMapping", "staticTimeline",
  "customSegmentationPrompt",
];

export async function processNewFile(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
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

const RESUME_COMPLETE: WorkflowDataField[] = [
  "conversation", "dimensions",
];

export async function resumeFromPause(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    await runDimensionSteps(PipelineStep.Segment, ctx, notify);
    markComplete(notify, ctx, RESUME_COMPLETE);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

// ---------------------------------------------------------------------------
// On-demand summary / analysis (not part of the pipeline)
// ---------------------------------------------------------------------------

export async function generateSummaryOnDemand(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    await runSummary(ctx, notify, callbacks);
    markComplete(notify, ctx, ["aiSummary", "customSummaryPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

export async function generateAnalysisOnDemand(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    await runEnsureSummaryThenAnalysis(ctx, notify, callbacks);
    markComplete(notify, ctx, ["analysis", "aiSummary", "customAnalysisPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

export async function rerunSummary(
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    ctx.aiSummary = "";
    await runSummary(ctx, notify, callbacks);

    const fields: WorkflowDataField[] = ["aiSummary", "customSummaryPrompt"];
    if (ctx.regenerateAnalysis) {
      ctx.analysis = "";
      await runAnalysis(ctx, notify, callbacks);
      fields.push("analysis");
    }
    markComplete(notify, ctx, fields);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

// ---------------------------------------------------------------------------
// Batch orchestration
// ---------------------------------------------------------------------------

export async function runWorkflows(
  files: File[],
  fileIds: Map<number, string>,
  onFileComplete: (conversation: WorkflowState) => void,
  onAISummaryChunk: (id: string, chunk: string) => void,
  onAnalysisChunk: (id: string, chunk: string) => void,
  options?: WorkflowOptions,
): Promise<WorkflowBatchResult> {
  await new Promise((resolve) => setTimeout(resolve, 0));

  const workflowStates = await Promise.all(
    files.map(async (file, i) => {
      if (!file) return null;

      const id = fileIds.get(i) || generateId();

      const notify: Notify = (id, update) => {
        onFileComplete({ id, filename: file.name, ...update } as WorkflowState);
      };

      const ctx: WorkflowState = {
        id,
        filename: file.name,
        file,
        conversation: null as any,
        warnings: [],
        stepTimings: {},
        config: getAIConfig("Componentisation"),
        presetColors: options?.presetColors,
        customSegmentationPrompt: options?.customSegmentationPrompt,
        dimensions: (options?.customPrompt || options?.customComponents) ? {
          default: {
            name: "default",
            prompt: options?.customPrompt,
            customComponents: options?.customComponents,
            components: [],
            componentMapping: {},
            componentTimeline: [],
            componentColors: {},
          },
        } : undefined,
      };

      await processNewFile(ctx, notify, {
        onSummaryChunk: onAISummaryChunk,
        onAnalysisChunk,
      });

      const { file: _file, config: _config, ...result } = ctx;
      if (!result.warnings?.length) result.warnings = undefined;
      return result;
    }),
  );

  return {
    workflowStates: workflowStates.filter((c): c is WorkflowState => c !== null),
  };
}
