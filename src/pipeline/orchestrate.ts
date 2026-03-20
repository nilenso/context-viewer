/**
 * Pipeline orchestration: who runs what, on which files/dimensions,
 * and where the results go.
 *
 * Pipeline steps live in pipeline.ts. This file wires them to the store.
 */

import type {
  PipelineState,
  PipelineCallbacks,
  PipelineDataField,
  PipelineOptions,
  PipelineBatchResult,
  Group,
} from "@/model/types";
import { PipelineStep } from "@/model/types";
import {
  type Notify,
  markComplete,
  markFailed,
} from "./notify";
import { createEmptyDimension } from "@/model/dimensions";
import { runDimensionSteps, processNewFile, resumeFromPause } from "./pipeline";
import { runSummary } from "@/stages/summarize";
import { runAnalysis, runEnsureSummaryThenAnalysis, regenerateAnalysisIfNeeded } from "@/stages/analyze";
import { getAIConfig } from "@/stages/ai/config";
import { generateId } from "@/lib/id-generator";

// ---------------------------------------------------------------------------
// Inline buildBaseContext (was pipeline/context.ts)
// ---------------------------------------------------------------------------

function buildBaseContext(conv: PipelineState): PipelineState {
  return {
    id: conv.id,
    filename: conv.filename,
    conversation: conv.conversation,
    summary: conv.summary,
    metadata: conv.metadata,
    aiSummary: conv.aiSummary,
    analysis: conv.analysis,
    dimensions: conv.dimensions ? { ...conv.dimensions } : undefined,
    staticComponents: conv.staticComponents,
    staticMapping: conv.staticMapping,
    staticTimeline: conv.staticTimeline,
    customSummaryPrompt: conv.customSummaryPrompt,
    customSegmentationPrompt: conv.customSegmentationPrompt,
    customAnalysisPrompt: conv.customAnalysisPrompt,
    segmentationThreshold: conv.segmentationThreshold,
    config: conv.config || getAIConfig("Componentisation"),
    warnings: [],
    stepTimings: { ...conv.stepTimings },
  };
}

// ---------------------------------------------------------------------------
// Store accessor
// ---------------------------------------------------------------------------

/** Minimal store interface for orchestration functions. */
export interface StoreAccessor {
  getState: () => {
    conversations: PipelineState[];
    groups: Record<string, Group>;
    pendingSessionImport: any;
  };
  updateConversation: (id: string, update: Partial<PipelineState>) => void;
  updateGroup: (id: string, update: Partial<Group>) => void;
  appendSummaryChunk: (id: string, chunk: string) => void;
  appendAnalysisChunk: (id: string, chunk: string) => void;
  set: (update: any) => void;
}

// ---------------------------------------------------------------------------
// Field computation
// ---------------------------------------------------------------------------

/** Collect all data fields affected by running the pipeline from `startFrom`. */
function collectFieldsFrom(startFrom: PipelineStep, includeAnalysis: boolean = false): PipelineDataField[] {
  const fields = new Set<PipelineDataField>();

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
  ctx: PipelineState,
  notify: Notify,
  callbacks?: PipelineCallbacks,
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
  conv: PipelineState,
  startFrom: PipelineStep,
  contextModifier: (ctx: PipelineState) => void,
  callbacks: PipelineCallbacks,
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
  contextModifier: (ctx: PipelineState) => void,
  callbacks: PipelineCallbacks,
  dimNames?: string[],
): Promise<void> {
  const { conversations, groups } = store.getState();
  const group = groups[targetId];

  if (group) {
    const memberConvs = group.fileIds
      .map((fid) => conversations.find((c) => c.id === fid))
      .filter((c): c is PipelineState => !!c?.conversation);

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

  const targets = conversations.filter(
    (c) => c.id !== sourceId && c.status === "success" && c.conversation,
  );

  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (conv) => {
      const notify: Notify = (id, update) => store.updateConversation(id, update);
      const ctx = buildBaseContext(conv);

      // Copy conversation-level prompts
      ctx.customSegmentationPrompt = source.customSegmentationPrompt;
      ctx.customSummaryPrompt = source.customSummaryPrompt;
      ctx.customAnalysisPrompt = source.customAnalysisPrompt;
      ctx.segmentationThreshold = source.segmentationThreshold;

      // Persist prompts immediately (summary/analysis prompts aren't pipeline outputs)
      store.updateConversation(conv.id, {
        customSegmentationPrompt: source.customSegmentationPrompt,
        customSummaryPrompt: source.customSummaryPrompt,
        customAnalysisPrompt: source.customAnalysisPrompt,
        segmentationThreshold: source.segmentationThreshold,
      });

      if (!source.dimensions) return;

      // Copy dimension-level prompts, components, and colors
      const dims = ctx.dimensions || {};
      for (const [dimName, sourceDim] of Object.entries(source.dimensions)) {
        dims[dimName] = {
          ...(dims[dimName] || createEmptyDimension(dimName)),
          prompt: sourceDim.prompt,
          customColoringPrompt: sourceDim.customColoringPrompt,
          customComponents: sourceDim.discoveredComponents?.length ? sourceDim.discoveredComponents : sourceDim.customComponents,
          discoveredComponents: sourceDim.discoveredComponents || [],
          componentColors: { ...sourceDim.componentColors },
        };
      }
      ctx.dimensions = dims;

      // Run full pipeline — each step skips if its inputs match its outputs
      await runPipelineFrom(PipelineStep.Segment, ctx, notify, {
        onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// On-demand summary / analysis
// ---------------------------------------------------------------------------

export async function generateSummaryOnDemand(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    await runSummary(ctx, notify, callbacks);
    markComplete(notify, ctx, ["aiSummary", "customSummaryPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

export async function generateAnalysisOnDemand(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    await runEnsureSummaryThenAnalysis(ctx, notify, callbacks);
    markComplete(notify, ctx, ["analysis", "aiSummary", "customAnalysisPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

export async function rerunSummary(
  ctx: PipelineState,
  notify: Notify,
  callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    ctx.aiSummary = "";
    await runSummary(ctx, notify, callbacks);

    const fields: PipelineDataField[] = ["aiSummary", "customSummaryPrompt"];
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

export async function runPipelines(
  files: File[],
  fileIds: Map<number, string>,
  onFileComplete: (conversation: PipelineState) => void,
  onAISummaryChunk: (id: string, chunk: string) => void,
  onAnalysisChunk: (id: string, chunk: string) => void,
  options?: PipelineOptions,
): Promise<PipelineBatchResult> {
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pipelineStates = await Promise.all(
    files.map(async (file, i) => {
      if (!file) return null;

      const id = fileIds.get(i) || generateId();

      const notify: Notify = (id, update) => {
        onFileComplete({ id, filename: file.name, ...update } as PipelineState);
      };

      const ctx: PipelineState = {
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
            ...createEmptyDimension("default"),
            prompt: options?.customPrompt,
            customComponents: options?.customComponents,
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
    pipelineStates: pipelineStates.filter((c): c is PipelineState => c !== null),
  };
}

// ---------------------------------------------------------------------------
// Store-level orchestration
// ---------------------------------------------------------------------------

/** Run pipelines for dropped files, creating placeholders and processing. */
export async function runPipelineMutation(
  store: StoreAccessor,
  files: File[],
  presetIds: Map<number, string> | undefined,
  options?: PipelineOptions,
): Promise<void> {
  const fileIds = new Map<number, string>();
  const placeholders: PipelineState[] = files.map((file, index) => {
    const id = presetIds?.get(index) || generateId();
    fileIds.set(index, id);
    return { id, filename: file.name, status: "pending" };
  });

  store.set((state: any) => ({
    conversations: [...state.conversations, ...placeholders],
    fileIdsRef: fileIds,
  }));

  const onFileComplete = (completed: PipelineState) => {
    store.set((state: any) => ({
      conversations: state.conversations.map((conv: PipelineState) =>
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
    await runPipelines(files, fileIds, onFileComplete, onSummaryChunk, onAnalysisChunk, options);
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
  conv: PipelineState,
  options: { customAnalysisPrompt?: string } = {},
): Promise<void> {
  const group = store.getState().groups[id];
  const notify = makeGroupAwareNotify(store, id, group);
  const ctx: PipelineState = {
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
  conv: PipelineState,
  options: { customSummaryPrompt?: string } = {},
): Promise<void> {
  const group = store.getState().groups[id];
  const notify = makeGroupAwareNotify(store, id, group);
  const ctx: PipelineState = {
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
  conv: PipelineState,
  options: { customSummaryPrompt?: string } = {},
): Promise<void> {
  const notify: Notify = (id, update) => store.updateConversation(id, update);
  const shouldRegenerateAnalysis =
    !!conv.analysis || conv.stepTimings?.analyzing !== undefined;

  const ctx = buildBaseContext(conv);
  ctx.aiSummary = "";
  ctx.analysis = shouldRegenerateAnalysis ? "" : ctx.analysis;
  ctx.customSummaryPrompt = options.customSummaryPrompt;
  ctx.regenerateAnalysis = shouldRegenerateAnalysis;
  ctx.stepTimings = {
    ...ctx.stepTimings,
    summarizing: undefined,
    ...(shouldRegenerateAnalysis ? { analyzing: undefined } : {}),
  };

  await rerunSummary(ctx, notify, {
    onSummaryChunk: (id, chunk) => store.appendSummaryChunk(id, chunk),
    onAnalysisChunk: shouldRegenerateAnalysis
      ? (id, chunk) => store.appendAnalysisChunk(id, chunk)
      : undefined,
  });
}

/** Resume all paused pipelines after API key is provided. */
export function resumePipelinesWithApiKey(store: StoreAccessor): void {
  const { conversations } = store.getState();
  const pausedPipelines = conversations.filter((c) => c.status === "paused-for-api-key");

  for (const conv of pausedPipelines) {
    if (!conv.conversation) continue;

    const notify: Notify = (id, update) => store.updateConversation(id, update);
    const ctx = buildBaseContext(conv);

    resumeFromPause(ctx, notify, {
      onSummaryChunk: (id, chunk) => store.appendSummaryChunk(id, chunk),
      onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
    });
  }
}
