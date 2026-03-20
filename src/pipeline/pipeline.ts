/**
 * Pipeline: imperative stage chain for processing conversation files.
 *
 * The pipeline reads top-to-bottom like pseudocode.
 * Each stage is pure — returns results, never mutates ctx directly.
 * The `run` wrapper handles logging, timing, and store notifications.
 *
 * This file also contains all orchestration: batch processing,
 * reprocessing, and on-demand summary/analysis.
 */

import type {
  PipelineState,
  PipelineDataField,
  PipelineOptions,
  PipelineBatchResult,
  Group,
  Stage,
  StageGroup,
} from "@/model/types";
import {
  type Notify,
  updateState,
  markComplete,
  markFailed,
  markPausedForApiKey,
} from "./notify";
import { markStepStart, markStepEnd } from "./logging";
import { hasApiKey, getAIConfig } from "@/stages/ai/config";
import { ensureDimensions, ensureDimension, getDimensionNames, createEmptyDimension } from "@/model/dimensions";
import { generateId } from "@/lib/id-generator";

import { parse, restorePreProcessedImport } from "@/stages/parse";
import { countTokens } from "@/stages/count-tokens";
import { segment } from "@/stages/segment";
import { identifyForDimension } from "@/stages/identify-components";
import { classifyForDimension } from "@/stages/classify-components";
import { colorForDimension } from "@/stages/color-components";
import { runSummary } from "@/stages/summarize";
import { runAnalysis, runEnsureSummaryThenAnalysis, regenerateAnalysisIfNeeded } from "@/stages/analyze";

// ---------------------------------------------------------------------------
// Stage runner — wraps a stage with logging, timing, and status notification
// ---------------------------------------------------------------------------

async function run<T>(
  name: Stage,
  group: StageGroup,
  ctx: PipelineState,
  notify: Notify,
  fn: () => Promise<T>,
): Promise<T> {
  markStepStart(ctx.id, name);
  notify(ctx.id, { status: "processing", step: group });
  const start = Date.now();
  const result = await fn();
  ctx.stepTimings![name] = Math.round((Date.now() - start) / 1000);
  markStepEnd(ctx.id, name);
  return result;
}

/** Merge a conversation stage result (with optional warnings) into ctx. */
function merge(ctx: PipelineState, result: Partial<PipelineState> & { warnings?: string[] }) {
  const { warnings, ...fields } = result;
  Object.assign(ctx, fields);
  if (warnings) ctx.warnings!.push(...warnings);
}

// ---------------------------------------------------------------------------
// The pipeline — imperative, reads top-to-bottom
// ---------------------------------------------------------------------------

/**
 * Run the pipeline. Each stage skips if its work is already done.
 *
 * Parse → CountTokens → Segment → Identify → (Classify ∥ Color)
 *
 * Each stage returns results. The pipeline merges them into ctx.
 * Dimension stages run per-dimension in parallel.
 * Classify and Color run in parallel within each dimension.
 *
 * To force a stage to re-run, clear its outputs before calling:
 *   - re-identify: clear dim.discoveredComponents
 *   - re-color:    clear dim.componentColors
 *   - re-segment:  segment always runs (cheap when no large parts)
 */
export async function runPipeline(
  ctx: PipelineState,
  notify: Notify,
  dimNames?: string[],
): Promise<void> {
  try {
    // --- Conversation-level stages ---

    if (!ctx.conversation) {
      merge(ctx, await run("parsing", "parsing", ctx, notify, () => parse(ctx)));
      updateState(notify, ctx, ["conversation", "summary", "metadata"], "counting-tokens");

      if (ctx.metadata!.parserName === "Context Viewer") {
        Object.assign(ctx, restorePreProcessedImport(ctx.metadata!, ctx.conversation!));
        markComplete(notify, ctx, [
          "conversation", "summary", "metadata", "title",
          "aiSummary", "analysis", "dimensions",
          "staticComponents", "staticMapping", "staticTimeline",
          "customSegmentationPrompt", "customSummaryPrompt", "customAnalysisPrompt",
        ]);
        return;
      }
    }

    if (!ctx.staticComponents) {
      merge(ctx, await run("counting-tokens", "counting-tokens", ctx, notify, () => countTokens(ctx)));
    }

    if (!hasApiKey()) {
      markPausedForApiKey(notify, ctx, [
        "conversation", "summary", "metadata",
        "staticComponents", "staticMapping", "staticTimeline",
      ], "segmenting");
      return;
    }

    updateState(notify, ctx, [
      "conversation", "summary", "metadata",
      "staticComponents", "staticMapping", "staticTimeline",
    ], "segmenting");

    // Segment always runs — it's cheap when there are no large parts
    merge(ctx, await run("segmenting", "segmenting", ctx, notify, () => segment(ctx)));
    updateState(notify, ctx, ["conversation"], "finding-components");

    // --- Dimension-level stages (each has its own idempotency) ---

    const dims = ensureDimensions(ctx);
    const activeDimNames = dimNames ?? getDimensionNames(ctx);
    for (const name of activeDimNames) ensureDimension(dims, name);
    const config = getAIConfig("Componentisation");
    if (!config) return;
    const errors: string[] = [];

    // Identify — all dimensions in parallel (skips if discoveredComponents exist)
    await run("identifying-components", "finding-components", ctx, notify, () =>
      Promise.all(activeDimNames.map(async (dimName) => {
        const { result, error } = await identifyForDimension(
          ctx.conversation!, dims[dimName]!, config, ctx.id,
        );
        Object.assign(dims[dimName]!, result);
        if (error) errors.push(`[${dimName}] ${error}`);
      })),
    );

    // Classify + Color — parallel per dimension, both stages parallel within each
    await run("classifying-components", "finding-components", ctx, notify, () =>
      Promise.all(activeDimNames.map(async (dimName) => {
        const dim = dims[dimName]!;
        const [classified, colored] = await Promise.all([
          classifyForDimension(ctx.conversation!, dim, config, ctx.id),
          colorForDimension(dim, config, ctx.id, ctx.presetColors),
        ]);
        Object.assign(dim, classified.result, colored.result);
        if (classified.error) errors.push(`[${dimName}] ${classified.error}`);
        if (colored.error) errors.push(`[${dimName}] ${colored.error}`);
      })),
    );

    ctx.dimensions = dims;
    if (errors.length > 0) ctx.warnings!.push(errors.join("; "));
    markComplete(notify, ctx, ["conversation", "dimensions", "customSegmentationPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

// ---------------------------------------------------------------------------
// Store accessor
// ---------------------------------------------------------------------------

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
// Reprocessing
// ---------------------------------------------------------------------------

/**
 * Reprocess a target (file or group).
 * The contextModifier should set new inputs AND clear outputs of stages
 * that need to re-run (e.g., clear dim.discoveredComponents to force re-identify).
 */
export async function reprocessTarget(
  store: StoreAccessor,
  targetId: string,
  contextModifier: (ctx: PipelineState) => void,
  callbacks: { onAnalysisChunk?: (id: string, chunk: string) => void },
  dimNames?: string[],
): Promise<void> {
  const { conversations, groups } = store.getState();
  const group = groups[targetId];
  const notify: Notify = (id, update) => store.updateConversation(id, update);

  const convs = group
    ? group.fileIds
        .map((fid) => conversations.find((c) => c.id === fid))
        .filter((c): c is PipelineState => !!c?.conversation)
    : [conversations.find((c) => c.id === targetId)].filter(
        (c): c is PipelineState => !!c?.conversation,
      );

  await Promise.all(
    convs.map(async (conv) => {
      const ctx = buildBaseContext(conv);
      contextModifier(ctx);
      await runPipeline(ctx, notify, dimNames);

      // Re-generate analysis if it existed before
      if (callbacks.onAnalysisChunk) {
        await regenerateAnalysisIfNeeded(ctx, notify, { onAnalysisChunk: callbacks.onAnalysisChunk });
      }
    }),
  );
}

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

      ctx.customSegmentationPrompt = source.customSegmentationPrompt;
      ctx.customSummaryPrompt = source.customSummaryPrompt;
      ctx.customAnalysisPrompt = source.customAnalysisPrompt;
      ctx.segmentationThreshold = source.segmentationThreshold;

      store.updateConversation(conv.id, {
        customSegmentationPrompt: source.customSegmentationPrompt,
        customSummaryPrompt: source.customSummaryPrompt,
        customAnalysisPrompt: source.customAnalysisPrompt,
        segmentationThreshold: source.segmentationThreshold,
      });

      if (!source.dimensions) return;

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

      await runPipeline(ctx, notify);
    }),
  );
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

      await runPipeline(ctx, notify);

      const { file: _file, config: _config, ...result } = ctx;
      if (!result.warnings?.length) result.warnings = undefined;
      return result;
    }),
  );

  return {
    pipelineStates: pipelineStates.filter((c): c is PipelineState => c !== null),
  };
}

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
          ? { ...conv, ...completed, aiSummary: completed.aiSummary || conv.aiSummary, analysis: completed.analysis || conv.analysis }
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
// On-demand summary / analysis (outside the pipeline)
// ---------------------------------------------------------------------------

function makeGroupAwareNotify(store: StoreAccessor, id: string, group: Group | undefined): Notify {
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

function makeGroupAwareCallbacks(store: StoreAccessor, id: string, group: Group | undefined) {
  return {
    onSummaryChunk: group
      ? (_: string, chunk: string) => store.updateGroup(id, { aiSummary: (store.getState().groups[id]?.aiSummary || "") + chunk })
      : (id: string, chunk: string) => store.appendSummaryChunk(id, chunk),
    onAnalysisChunk: group
      ? (_: string, chunk: string) => store.updateGroup(id, { analysis: (store.getState().groups[id]?.analysis || "") + chunk })
      : (id: string, chunk: string) => store.appendAnalysisChunk(id, chunk),
  };
}

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

  try {
    await runEnsureSummaryThenAnalysis(ctx, notify, makeGroupAwareCallbacks(store, id, group));
    markComplete(notify, ctx, ["analysis", "aiSummary", "customAnalysisPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

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

  try {
    await runSummary(ctx, notify, makeGroupAwareCallbacks(store, id, group));
    markComplete(notify, ctx, ["aiSummary", "customSummaryPrompt"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

export async function rerunSummaryForTarget(
  store: StoreAccessor,
  conv: PipelineState,
  options: { customSummaryPrompt?: string } = {},
): Promise<void> {
  const notify: Notify = (id, update) => store.updateConversation(id, update);
  const shouldRegenerateAnalysis = !!conv.analysis || conv.stepTimings?.analyzing !== undefined;

  const ctx = buildBaseContext(conv);
  ctx.aiSummary = "";
  ctx.analysis = shouldRegenerateAnalysis ? "" : ctx.analysis;
  ctx.customSummaryPrompt = options.customSummaryPrompt;
  ctx.regenerateAnalysis = shouldRegenerateAnalysis;

  try {
    await runSummary(ctx, notify, {
      onSummaryChunk: (id, chunk) => store.appendSummaryChunk(id, chunk),
    });

    const fields: PipelineDataField[] = ["aiSummary", "customSummaryPrompt"];
    if (shouldRegenerateAnalysis) {
      ctx.analysis = "";
      await runAnalysis(ctx, notify, {
        onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
      });
      fields.push("analysis");
    }
    markComplete(notify, ctx, fields);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

/** Resume all paused pipelines after API key is provided. */
export function resumePipelinesWithApiKey(store: StoreAccessor): void {
  const { conversations } = store.getState();
  for (const conv of conversations) {
    if (conv.status !== "paused-for-api-key" || !conv.conversation) continue;
    const notify: Notify = (id, update) => store.updateConversation(id, update);
    runPipeline(buildBaseContext(conv), notify);
  }
}
