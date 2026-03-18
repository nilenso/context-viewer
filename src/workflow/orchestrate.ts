/**
 * Workflow orchestration: who runs what, on which files/dimensions,
 * and where the results go.
 *
 * Pipeline steps live in pipeline.ts. This file wires them to the store.
 */

import type {
  WorkflowState,
  WorkflowCallbacks,
  WorkflowDataField,
  WorkflowOptions,
  WorkflowBatchResult,
  Group,
} from "./types";
import { PipelineStep } from "./types";
import {
  type Notify,
  markComplete,
  markFailed,
} from "./notify";
import { runDimensionSteps, processNewFile, resumeFromPause } from "./pipeline";
import { runSummary } from "./summarize";
import { runAnalysis, runEnsureSummaryThenAnalysis, regenerateAnalysisIfNeeded } from "./analyze";
import { getAIConfig } from "../ai-config";
import { generateId } from "../lib/id-generator";
import { buildBaseContext } from "./context";

// ---------------------------------------------------------------------------
// Store accessor
// ---------------------------------------------------------------------------

/** Minimal store interface for orchestration functions. */
export interface StoreAccessor {
  getState: () => {
    conversations: WorkflowState[];
    groups: Record<string, Group>;
    pendingSessionImport: any;
  };
  updateConversation: (id: string, update: Partial<WorkflowState>) => void;
  updateGroup: (id: string, update: Partial<Group>) => void;
  appendSummaryChunk: (id: string, chunk: string) => void;
  appendAnalysisChunk: (id: string, chunk: string) => void;
  set: (update: any) => void;
}

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
// Core reprocess
// ---------------------------------------------------------------------------

/**
 * Run the pipeline from `startFrom`, with error handling and store write-back.
 * This is the main reprocess entrypoint for prompt changes.
 */
async function runPipelineFrom(
  startFrom: PipelineStep,
  ctx: WorkflowState,
  notify: Notify,
  callbacks?: WorkflowCallbacks,
  dimNames?: string[],
): Promise<void> {
  try {
    await runDimensionSteps(startFrom, ctx, notify, dimNames);

    const regenerated = callbacks
      ? await regenerateAnalysisIfNeeded(ctx, notify, callbacks)
      : false;

    markComplete(notify, ctx, collectFieldsFrom(startFrom, regenerated));
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

/** Reprocess a single conversation from a given pipeline step. */
export async function reprocessWithRunner(
  store: StoreAccessor,
  conv: WorkflowState,
  startFrom: PipelineStep,
  contextModifier: (ctx: WorkflowState) => void,
  callbacks: WorkflowCallbacks,
  dimNames?: string[],
): Promise<void> {
  const notify: Notify = (id, update) => store.updateConversation(id, update);
  const ctx = buildBaseContext(conv);
  contextModifier(ctx);
  await runPipelineFrom(startFrom, ctx, notify, callbacks, dimNames);
}

/**
 * Reprocess a target (file or group) from a given pipeline step.
 * If the target is a group, fans out to all member files.
 */
export async function reprocessTarget(
  store: StoreAccessor,
  targetId: string,
  startFrom: PipelineStep,
  contextModifier: (ctx: WorkflowState) => void,
  callbacks: WorkflowCallbacks,
  dimNames?: string[],
): Promise<void> {
  const { conversations, groups } = store.getState();
  const group = groups[targetId];

  if (group) {
    const memberConvs = group.fileIds
      .map((fid) => conversations.find((c) => c.id === fid))
      .filter((c): c is WorkflowState => !!c?.conversation);

    await Promise.all(
      memberConvs.map((conv) =>
        reprocessWithRunner(store, conv, startFrom, contextModifier, callbacks, dimNames),
      ),
    );
  } else {
    const conv = conversations.find((c) => c.id === targetId);
    if (!conv?.conversation) return;
    await reprocessWithRunner(store, conv, startFrom, contextModifier, callbacks, dimNames);
  }
}

// ---------------------------------------------------------------------------
// Apply prompts to all
// ---------------------------------------------------------------------------

/** Apply prompts, component list, and colors from one conversation to all others. */
export async function applyPromptsToAll(
  store: StoreAccessor,
  sourceId: string,
): Promise<void> {
  const { conversations } = store.getState();
  const source = conversations.find((c) => c.id === sourceId);
  if (!source) return;

  const convPrompts = {
    customSegmentationPrompt: source.customSegmentationPrompt,
    customSummaryPrompt: source.customSummaryPrompt,
    customAnalysisPrompt: source.customAnalysisPrompt,
    segmentationThreshold: source.segmentationThreshold,
  };

  const targets = conversations.filter(
    (c) => c.id !== sourceId && c.status === "success" && c.conversation,
  );

  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (conv) => {
      const segChanged =
        convPrompts.customSegmentationPrompt !== conv.customSegmentationPrompt ||
        convPrompts.segmentationThreshold !== conv.segmentationThreshold;

      store.updateConversation(conv.id, convPrompts);

      if (segChanged) {
        const notify: Notify = (id, update) => store.updateConversation(id, update);
        const ctx = buildBaseContext(conv);
        Object.assign(ctx, convPrompts);
        if (source.dimensions) {
          const dims = ctx.dimensions || {};
          for (const [dimName, sourceDim] of Object.entries(source.dimensions)) {
            dims[dimName] = {
              ...(dims[dimName] || { name: dimName, components: [], componentMapping: {}, componentTimeline: [], componentColors: {} }),
              prompt: sourceDim.prompt,
              customColoringPrompt: sourceDim.customColoringPrompt,
              customComponents: sourceDim.customComponents,
            };
          }
          ctx.dimensions = dims;
        }
        await runPipelineFrom(PipelineStep.Segment, ctx, notify, {
          onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
        });
        return;
      }

      if (!source.dimensions) return;

      const notify: Notify = (id, update) => store.updateConversation(id, update);
      const ctx = buildBaseContext(conv);
      const dims = ctx.dimensions || {};

      const identifyDims: string[] = [];
      const colorDims: string[] = [];

      for (const [dimName, sourceDim] of Object.entries(source.dimensions)) {
        const targetDim = dims[dimName];
        dims[dimName] = {
          ...(targetDim || { name: dimName, components: [], componentMapping: {}, componentTimeline: [], componentColors: {} }),
          prompt: sourceDim.prompt,
          customColoringPrompt: sourceDim.customColoringPrompt,
          customComponents: sourceDim.customComponents,
        };

        if (sourceDim.prompt !== targetDim?.prompt ||
            JSON.stringify(sourceDim.customComponents) !== JSON.stringify(targetDim?.customComponents)) {
          identifyDims.push(dimName);
        } else if (sourceDim.customColoringPrompt !== targetDim?.customColoringPrompt) {
          colorDims.push(dimName);
        }
      }

      ctx.dimensions = dims;

      for (const dimName of identifyDims) {
        const sourceDim = source.dimensions![dimName];
        if (!sourceDim) continue;
        if (sourceDim.components?.length) {
          dims[dimName]!.customComponents = sourceDim.components;
        }
      }

      if (identifyDims.length > 0) {
        await runPipelineFrom(PipelineStep.Identify, ctx, notify, {
          onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
        }, identifyDims);
      }

      if (colorDims.length > 0) {
        await runPipelineFrom(PipelineStep.Color, ctx, notify, undefined, colorDims);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// On-demand summary / analysis
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
// Batch processing
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

// ---------------------------------------------------------------------------
// Store-level orchestration
// ---------------------------------------------------------------------------

/** Run workflows for dropped files, creating placeholders and processing. */
export async function runWorkflowMutation(
  store: StoreAccessor,
  files: File[],
  presetIds: Map<number, string> | undefined,
  options?: WorkflowOptions,
): Promise<void> {
  const fileIds = new Map<number, string>();
  const placeholders: WorkflowState[] = files.map((file, index) => {
    const id = presetIds?.get(index) || generateId();
    fileIds.set(index, id);
    return { id, filename: file.name, status: "pending" };
  });

  store.set((state: any) => ({
    conversations: [...state.conversations, ...placeholders],
    fileIdsRef: fileIds,
  }));

  const onFileComplete = (completed: WorkflowState) => {
    store.set((state: any) => ({
      conversations: state.conversations.map((conv: WorkflowState) =>
        conv.id === completed.id
          ? {
              ...conv,
              ...completed,
              aiSummary: completed.aiSummary || conv.aiSummary,
              analysis: completed.analysis || conv.analysis,
            }
          : conv,
      ),
    }));
  };

  const onSummaryChunk = (id: string, chunk: string) => store.appendSummaryChunk(id, chunk);
  const onAnalysisChunk = (id: string, chunk: string) => store.appendAnalysisChunk(id, chunk);

  try {
    await runWorkflows(files, fileIds, onFileComplete, onSummaryChunk, onAnalysisChunk, options);
    if (!store.getState().pendingSessionImport) {
      store.set({ fileIdsRef: new Map() });
    }
  } catch {
    store.set({ fileIdsRef: new Map() });
  }
}

// ---------------------------------------------------------------------------
// Store-level summary / analysis
// ---------------------------------------------------------------------------

/** Build a notify function that routes to group or conversation. */
function makeGroupAwareNotify(
  store: StoreAccessor,
  id: string,
  group: Group | undefined,
): Notify {
  return (rid, update) => {
    if (group) {
      store.updateGroup(id, {
        ...(update.analysis !== undefined ? { analysis: update.analysis } : {}),
        ...(update.aiSummary !== undefined ? { aiSummary: update.aiSummary } : {}),
        ...(update.customSummaryPrompt !== undefined ? { customSummaryPrompt: update.customSummaryPrompt } : {}),
        ...(update.customAnalysisPrompt !== undefined ? { customAnalysisPrompt: update.customAnalysisPrompt } : {}),
      });
    } else {
      store.updateConversation(rid, update);
    }
  };
}

/** Generate or regenerate analysis for a file or group. */
export async function generateAnalysisForTarget(
  store: StoreAccessor,
  id: string,
  conv: WorkflowState,
  options: { customAnalysisPrompt?: string } = {},
): Promise<void> {
  const group = store.getState().groups[id];
  const notify = makeGroupAwareNotify(store, id, group);
  const ctx: WorkflowState = {
    ...buildBaseContext(conv),
    analysis: "",
    customAnalysisPrompt: options.customAnalysisPrompt || conv.customAnalysisPrompt || group?.customAnalysisPrompt,
  };

  await generateAnalysisOnDemand(ctx, notify, {
    onSummaryChunk: group
      ? (_, chunk) => store.updateGroup(id, { aiSummary: (store.getState().groups[id]?.aiSummary || "") + chunk })
      : (id, chunk) => store.appendSummaryChunk(id, chunk),
    onAnalysisChunk: group
      ? (_, chunk) => store.updateGroup(id, { analysis: (store.getState().groups[id]?.analysis || "") + chunk })
      : (id, chunk) => store.appendAnalysisChunk(id, chunk),
  });
}

/** Generate summary for a file or group. */
export async function generateSummaryForTarget(
  store: StoreAccessor,
  id: string,
  conv: WorkflowState,
  options: { customSummaryPrompt?: string } = {},
): Promise<void> {
  const group = store.getState().groups[id];
  const notify = makeGroupAwareNotify(store, id, group);
  const ctx: WorkflowState = {
    ...buildBaseContext(conv),
    aiSummary: "",
    customSummaryPrompt: options.customSummaryPrompt || conv.customSummaryPrompt || group?.customSummaryPrompt,
  };

  await generateSummaryOnDemand(ctx, notify, {
    onSummaryChunk: group
      ? (_, chunk) => store.updateGroup(id, { aiSummary: (store.getState().groups[id]?.aiSummary || "") + chunk })
      : (id, chunk) => store.appendSummaryChunk(id, chunk),
  });
}

/** Rerun summary (and optionally analysis) for a conversation. */
export async function rerunSummaryForTarget(
  store: StoreAccessor,
  conv: WorkflowState,
  options: { customSummaryPrompt?: string } = {},
): Promise<void> {
  const notify: Notify = (id, update) => store.updateConversation(id, update);
  const shouldRegenerateAnalysis =
    !!conv.analysis || conv.stepTimings?.analysis !== undefined;

  const ctx = buildBaseContext(conv);
  ctx.aiSummary = "";
  ctx.analysis = shouldRegenerateAnalysis ? "" : ctx.analysis;
  ctx.customSummaryPrompt = options.customSummaryPrompt;
  ctx.regenerateAnalysis = shouldRegenerateAnalysis;
  ctx.stepTimings = {
    ...ctx.stepTimings,
    summary: undefined,
    ...(shouldRegenerateAnalysis ? { analysis: undefined } : {}),
  };

  await rerunSummary(ctx, notify, {
    onSummaryChunk: (id, chunk) => store.appendSummaryChunk(id, chunk),
    onAnalysisChunk: shouldRegenerateAnalysis
      ? (id, chunk) => store.appendAnalysisChunk(id, chunk)
      : undefined,
  });
}

/** Resume all paused workflows after API key is provided. */
export function resumeWorkflowsWithApiKey(store: StoreAccessor): void {
  const { conversations } = store.getState();
  const pausedWorkflows = conversations.filter((c) => c.status === "paused-for-api-key");

  for (const conv of pausedWorkflows) {
    if (!conv.conversation) continue;

    const notify: Notify = (id, update) => store.updateConversation(id, update);
    const ctx = buildBaseContext(conv);

    resumeFromPause(ctx, notify, {
      onSummaryChunk: (id, chunk) => store.appendSummaryChunk(id, chunk),
      onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
    });
  }
}
