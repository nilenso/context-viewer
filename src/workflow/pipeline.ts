import type {
  WorkflowState,
  WorkflowCallbacks,
  WorkflowDataField,
  WorkflowOptions,
  WorkflowBatchResult,
} from "./types";
import { WorkflowEvent } from "./types";
import { WorkflowRunner } from "./runner";
import { hasApiKey } from "../ai-config";
import { generateId } from "../lib/id-generator";

// Domain imports — each file is a vertical slice (activity + step runner)
import { runParse, restorePreProcessedImport } from "./parse";
import { runCountTokens, runStaticComponents } from "./count-tokens";
import { runSegment } from "./segment";
import { identifyComponentsActivity } from "./component-identification";
import { classifyComponentsActivity } from "./component-classification";
import { runAssignColors } from "./color";
import { runSummary } from "./summarize";
import { runAnalysis, runEnsureSummaryThenAnalysis, regenerateAnalysisIfNeeded, completionFieldsForReprocess } from "./analyze";
import { getComponentisationConfig } from "./component-identification";

// ---------------------------------------------------------------------------
// Composite step: identify + classify components (single UI step)
// ---------------------------------------------------------------------------

async function runFindComponents(ctx: WorkflowState, runner: WorkflowRunner) {
  runner.startStep(ctx, "finding-components");

  // Step A: Identify component list per dimension
  const { result: idResult, timing: idTiming } = await runner.runActivity(
    ctx, identifyComponentsActivity, "finding-components",
  );
  ctx.dimensions = idResult.dimensions;
  const defaultDim = idResult.dimensions["default"];
  if (defaultDim) ctx.components = defaultDim.components;
  if (idResult.error) ctx.warnings!.push(idResult.error);

  // Step B: Classify each part into a component
  const { result: classResult, timing: classTiming } = await runner.runActivity(
    ctx, classifyComponentsActivity,
  );
  ctx.components = classResult.components;
  ctx.componentMapping = classResult.mapping;
  ctx.componentTimeline = classResult.timeline;
  ctx.dimensions = classResult.dimensions;
  if (classResult.error) ctx.warnings!.push(classResult.error);

  ctx.stepTimings!["finding-components"] = idTiming + classTiming;
}

// ---------------------------------------------------------------------------
// Composite sequences
// ---------------------------------------------------------------------------

/** Find components then assign colors. */
async function runComponentsAndColor(ctx: WorkflowState, runner: WorkflowRunner) {
  await runFindComponents(ctx, runner);
  runner.updateState(ctx, [
    "conversation", "components", "componentMapping", "componentTimeline", "dimensions",
  ], "coloring");
  await runAssignColors(ctx, runner);
}

/** Segment, then find components, then assign colors. */
async function runSegmentThenComponentsAndColor(ctx: WorkflowState, runner: WorkflowRunner) {
  await runSegment(ctx, runner);
  runner.updateState(ctx, ["conversation"], "finding-components");
  await runComponentsAndColor(ctx, runner);
}

// ---------------------------------------------------------------------------
// Field lists — what to write back for each event
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

/** Fields available after parsing + token counting + static components, before AI steps. */
const PARSED_FIELDS: WorkflowDataField[] = [
  "conversation", "summary", "metadata",
  "staticComponents", "staticMapping", "staticTimeline",
];

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleNewFile(
  ctx: WorkflowState,
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks,
) {
  await runParse(ctx, runner);
  runner.updateState(ctx, ["conversation", "summary", "metadata"], "counting-tokens");

  if (ctx.metadata!.parserName === "Context Viewer") {
    restorePreProcessedImport(ctx, ctx.metadata!, ctx.conversation!);
    runner.markComplete(ctx, PRE_PROCESSED_COMPLETE);
    return;
  }

  await runCountTokens(ctx, runner);
  await runStaticComponents(ctx, runner);

  if (!hasApiKey()) {
    runner.markPausedForApiKey(ctx, PARSED_FIELDS, "segmenting");
    return;
  }
  runner.updateState(ctx, PARSED_FIELDS, "segmenting");

  await runSegmentThenComponentsAndColor(ctx, runner);
  runner.markComplete(ctx, NEW_FILE_COMPLETE);
}

async function handleResumeFromApiKeyPause(ctx: WorkflowState, runner: WorkflowRunner) {
  await runSegmentThenComponentsAndColor(ctx, runner);
  runner.markComplete(ctx, RESUME_COMPLETE);
}

async function handleGroupedConversation(ctx: WorkflowState, runner: WorkflowRunner) {
  runner.markComplete(ctx, GROUPED_COMPLETE);
}

async function handleGenerateSummary(
  ctx: WorkflowState, runner: WorkflowRunner, callbacks: WorkflowCallbacks,
) {
  await runSummary(ctx, runner, callbacks);
  runner.markComplete(ctx, ["aiSummary", "customSummaryPrompt"]);
}

async function handleGenerateAnalysis(
  ctx: WorkflowState, runner: WorkflowRunner, callbacks: WorkflowCallbacks,
) {
  await runEnsureSummaryThenAnalysis(ctx, runner, callbacks);
  runner.markComplete(ctx, ["analysis", "aiSummary", "customAnalysisPrompt"]);
}

async function handleSummaryPromptChanged(
  ctx: WorkflowState, runner: WorkflowRunner, callbacks: WorkflowCallbacks,
) {
  ctx.aiSummary = "";
  await runSummary(ctx, runner, callbacks);

  const fields: WorkflowDataField[] = ["aiSummary", "customSummaryPrompt"];
  if (ctx.regenerateAnalysis) {
    ctx.analysis = "";
    await runAnalysis(ctx, runner, callbacks);
    fields.push("analysis");
  }
  runner.markComplete(ctx, fields);
}

async function handleColoringPromptChanged(ctx: WorkflowState, runner: WorkflowRunner) {
  await runAssignColors(ctx, runner);
  runner.markComplete(ctx, ["componentColors", "dimensions", "customColoringPrompt"]);
}

async function handleSegmentationPromptChanged(
  ctx: WorkflowState, runner: WorkflowRunner, callbacks: WorkflowCallbacks,
) {
  await runSegment(ctx, runner);
  runner.updateState(ctx, ["conversation", "customSegmentationPrompt", "segmentationThreshold"], "finding-components");
  await runComponentsAndColor(ctx, runner);
  const regenerated = await regenerateAnalysisIfNeeded(ctx, runner, callbacks);
  runner.markComplete(ctx, completionFieldsForReprocess("segmentation", regenerated));
}

async function handleComponentPromptChanged(
  ctx: WorkflowState, runner: WorkflowRunner, callbacks: WorkflowCallbacks,
) {
  await runComponentsAndColor(ctx, runner);
  const regenerated = await regenerateAnalysisIfNeeded(ctx, runner, callbacks);
  runner.markComplete(ctx, completionFieldsForReprocess("component", regenerated));
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function processConversationWorkflow(
  event: WorkflowEvent,
  ctx: WorkflowState,
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    switch (event) {
      case WorkflowEvent.NewFile:
        return await handleNewFile(ctx, runner, callbacks);
      case WorkflowEvent.ResumeFromApiKeyPause:
        return await handleResumeFromApiKeyPause(ctx, runner);
      case WorkflowEvent.GroupedConversation:
        return await handleGroupedConversation(ctx, runner);
      case WorkflowEvent.GenerateSummary:
        return await handleGenerateSummary(ctx, runner, callbacks);
      case WorkflowEvent.GenerateAnalysis:
        return await handleGenerateAnalysis(ctx, runner, callbacks);
      case WorkflowEvent.SummaryPromptChanged:
        return await handleSummaryPromptChanged(ctx, runner, callbacks);
      case WorkflowEvent.ColoringPromptChanged:
        return await handleColoringPromptChanged(ctx, runner);
      case WorkflowEvent.SegmentationPromptChanged:
        return await handleSegmentationPromptChanged(ctx, runner, callbacks);
      case WorkflowEvent.ComponentPromptChanged:
        return await handleComponentPromptChanged(ctx, runner, callbacks);
    }
  } catch (error: any) {
    runner.markFailed(ctx.id, error.message);
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

      const runner = new WorkflowRunner((id, update) => {
        onFileComplete({ id, filename: file.name, ...update } as WorkflowState);
      });

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

      await processConversationWorkflow(WorkflowEvent.NewFile, ctx, runner, {
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
