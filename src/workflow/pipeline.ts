import type {
  WorkflowState,
  WorkflowCallbacks,
  WorkflowDataField,
  WorkflowOptions,
  WorkflowBatchResult,
} from "./types";
import { WorkflowEvent } from "./types";
import {
  type Notify,
  startStep,
  endStep,
  updateState,
  markComplete,
  markFailed,
  markPausedForApiKey,
  timed,
} from "./runner";
import { hasApiKey } from "../ai-config";
import { generateId } from "../lib/id-generator";

import { runParse, restorePreProcessedImport } from "./parse";
import { runCountTokens, runStaticComponents } from "./count-tokens";
import { runSegment } from "./segment";
import { runIdentifyComponents } from "./component-identification";
import { runClassifyComponents } from "./component-classification";
import { runAssignColors } from "./color";
import { runSummary } from "./summarize";
import { runAnalysis, runEnsureSummaryThenAnalysis, regenerateAnalysisIfNeeded, completionFieldsForReprocess } from "./analyze";
import { getComponentisationConfig } from "./component-identification";

// ---------------------------------------------------------------------------
// Composite steps
// ---------------------------------------------------------------------------

/** Identify + classify components (single UI step). */
async function runFindComponents(ctx: WorkflowState, notify: Notify) {
  startStep(notify, ctx, "finding-components");
  const { timing: idTiming } = await runIdentifyComponents(ctx);
  const { timing: classTiming } = await runClassifyComponents(ctx);
  endStep(ctx, "finding-components");
  ctx.stepTimings!["finding-components"] = idTiming + classTiming;
}

/** Find components then assign colors. */
async function runComponentsAndColor(ctx: WorkflowState, notify: Notify) {
  await runFindComponents(ctx, notify);
  updateState(notify, ctx, [
    "conversation", "components", "componentMapping", "componentTimeline", "dimensions",
  ], "coloring");
  await runAssignColors(ctx, notify);
}

/** Segment → find components → assign colors. */
async function runSegmentThenComponentsAndColor(ctx: WorkflowState, notify: Notify) {
  await runSegment(ctx, notify);
  updateState(notify, ctx, ["conversation"], "finding-components");
  await runComponentsAndColor(ctx, notify);
}

// ---------------------------------------------------------------------------
// Field lists
// ---------------------------------------------------------------------------

const NEW_FILE_COMPLETE: WorkflowDataField[] = [
  "conversation", "summary", "metadata",
  "components", "componentMapping", "componentTimeline", "componentColors",
  "dimensions",
  "staticComponents", "staticMapping", "staticTimeline",
  "customPrompt", "customSegmentationPrompt",
];

const PRE_PROCESSED_COMPLETE: WorkflowDataField[] = [
  "conversation", "summary", "metadata", "title",
  "aiSummary", "analysis",
  "components", "componentMapping", "componentTimeline", "componentColors",
  "dimensions",
  "staticComponents", "staticMapping", "staticTimeline",
  "customPrompt", "customSegmentationPrompt", "customSummaryPrompt",
  "customAnalysisPrompt", "customColoringPrompt",
];

const RESUME_COMPLETE: WorkflowDataField[] = [
  "conversation", "components", "componentMapping", "componentTimeline",
  "componentColors", "dimensions",
];

const GROUPED_COMPLETE: WorkflowDataField[] = [
  "conversation", "summary", "title",
  "isGrouped", "sourceConversations", "messageSourceMap",
  "components", "componentMapping", "componentTimeline", "componentColors",
  "staticComponents", "staticMapping", "staticTimeline",
];

const PARSED_FIELDS: WorkflowDataField[] = [
  "conversation", "summary", "metadata",
  "staticComponents", "staticMapping", "staticTimeline",
];

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleNewFile(ctx: WorkflowState, notify: Notify, callbacks: WorkflowCallbacks) {
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

  await runSegmentThenComponentsAndColor(ctx, notify);
  markComplete(notify, ctx, NEW_FILE_COMPLETE);
}

async function handleResumeFromApiKeyPause(ctx: WorkflowState, notify: Notify) {
  await runSegmentThenComponentsAndColor(ctx, notify);
  markComplete(notify, ctx, RESUME_COMPLETE);
}

async function handleGroupedConversation(ctx: WorkflowState, notify: Notify) {
  markComplete(notify, ctx, GROUPED_COMPLETE);
}

async function handleGenerateSummary(ctx: WorkflowState, notify: Notify, callbacks: WorkflowCallbacks) {
  await runSummary(ctx, notify, callbacks);
  markComplete(notify, ctx, ["aiSummary", "customSummaryPrompt"]);
}

async function handleGenerateAnalysis(ctx: WorkflowState, notify: Notify, callbacks: WorkflowCallbacks) {
  await runEnsureSummaryThenAnalysis(ctx, notify, callbacks);
  markComplete(notify, ctx, ["analysis", "aiSummary", "customAnalysisPrompt"]);
}

async function handleSummaryPromptChanged(ctx: WorkflowState, notify: Notify, callbacks: WorkflowCallbacks) {
  ctx.aiSummary = "";
  await runSummary(ctx, notify, callbacks);

  const fields: WorkflowDataField[] = ["aiSummary", "customSummaryPrompt"];
  if (ctx.regenerateAnalysis) {
    ctx.analysis = "";
    await runAnalysis(ctx, notify, callbacks);
    fields.push("analysis");
  }
  markComplete(notify, ctx, fields);
}

async function handleColoringPromptChanged(ctx: WorkflowState, notify: Notify) {
  await runAssignColors(ctx, notify);
  markComplete(notify, ctx, ["componentColors", "dimensions", "customColoringPrompt"]);
}

async function handleSegmentationPromptChanged(ctx: WorkflowState, notify: Notify, callbacks: WorkflowCallbacks) {
  await runSegment(ctx, notify);
  updateState(notify, ctx, ["conversation", "customSegmentationPrompt", "segmentationThreshold"], "finding-components");
  await runComponentsAndColor(ctx, notify);
  const regenerated = await regenerateAnalysisIfNeeded(ctx, notify, callbacks);
  markComplete(notify, ctx, completionFieldsForReprocess("segmentation", regenerated));
}

async function handleComponentPromptChanged(ctx: WorkflowState, notify: Notify, callbacks: WorkflowCallbacks) {
  await runComponentsAndColor(ctx, notify);
  const regenerated = await regenerateAnalysisIfNeeded(ctx, notify, callbacks);
  markComplete(notify, ctx, completionFieldsForReprocess("component", regenerated));
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function processConversationWorkflow(
  event: WorkflowEvent,
  ctx: WorkflowState,
  notify: Notify,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    switch (event) {
      case WorkflowEvent.NewFile:
        return await handleNewFile(ctx, notify, callbacks);
      case WorkflowEvent.ResumeFromApiKeyPause:
        return await handleResumeFromApiKeyPause(ctx, notify);
      case WorkflowEvent.GroupedConversation:
        return await handleGroupedConversation(ctx, notify);
      case WorkflowEvent.GenerateSummary:
        return await handleGenerateSummary(ctx, notify, callbacks);
      case WorkflowEvent.GenerateAnalysis:
        return await handleGenerateAnalysis(ctx, notify, callbacks);
      case WorkflowEvent.SummaryPromptChanged:
        return await handleSummaryPromptChanged(ctx, notify, callbacks);
      case WorkflowEvent.ColoringPromptChanged:
        return await handleColoringPromptChanged(ctx, notify);
      case WorkflowEvent.SegmentationPromptChanged:
        return await handleSegmentationPromptChanged(ctx, notify, callbacks);
      case WorkflowEvent.ComponentPromptChanged:
        return await handleComponentPromptChanged(ctx, notify, callbacks);
    }
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
        config: getComponentisationConfig(),
        customComponents: options?.customComponents,
        presetColors: options?.presetColors,
        customPrompt: options?.customPrompt,
        customSegmentationPrompt: options?.customSegmentationPrompt,
      };

      await processConversationWorkflow(WorkflowEvent.NewFile, ctx, notify, {
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
