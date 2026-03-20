/**
 * Pipeline: declarative stage chain for processing conversation files.
 *
 * The PIPELINE array defines the stages, their order, scope, and outputs.
 * runPipeline() executes them with middleware for logging, timing, and
 * store notifications.
 *
 * Stages are pure — they return results, the runner merges them into ctx.
 * Stages never import from pipeline/.
 */

import type {
  PipelineState,
  PipelineCallbacks,
  PipelineDataField,
  DimensionData,
  Stage,
  StageGroup,
} from "@/model/types";
import type { Conversation } from "@/model/schema";
import type { AIConfig } from "@/stages/ai/config";
import {
  type Notify,
  updateState,
  markComplete,
  markFailed,
  markPausedForApiKey,
} from "./notify";
import { markStepStart, markStepEnd } from "./logging";
import { hasApiKey, getAIConfig } from "@/stages/ai/config";
import { ensureDimensions, ensureDimension, getDimensionNames } from "@/model/dimensions";

import { parse, restorePreProcessedImport } from "@/stages/parse";
import { countTokens } from "@/stages/count-tokens";
import { segment } from "@/stages/segment";
import { identifyForDimension } from "@/stages/identify-components";
import { classifyForDimension } from "@/stages/classify-components";
import { colorForDimension } from "@/stages/color-components";

// ---------------------------------------------------------------------------
// Stage descriptor types
// ---------------------------------------------------------------------------

type ConversationStageRunner = (
  ctx: PipelineState,
) => Promise<Partial<PipelineState> & { warnings?: string[] }>;

type DimensionStageRunner = (
  conversation: Conversation,
  dimData: DimensionData,
  config: AIConfig,
  conversationId?: string,
) => Promise<{ result: Partial<DimensionData>; error?: string }>;

export interface StageDescriptor {
  name: Stage;
  group: StageGroup;
  scope: "conversation" | "dimension";
  run: ConversationStageRunner | DimensionStageRunner;
  emits: readonly PipelineDataField[];
  /** Name of another stage to run in parallel with. */
  parallel?: Stage;
}

// ---------------------------------------------------------------------------
// Pipeline definition
// ---------------------------------------------------------------------------

export const PIPELINE: StageDescriptor[] = [
  {
    name: "parsing",
    group: "parsing",
    scope: "conversation",
    run: parse,
    emits: ["conversation", "summary", "metadata"],
  },
  {
    name: "counting-tokens",
    group: "counting-tokens",
    scope: "conversation",
    run: countTokens,
    emits: ["conversation", "staticComponents", "staticMapping", "staticTimeline"],
  },
  {
    name: "segmenting",
    group: "segmenting",
    scope: "conversation",
    run: segment,
    emits: ["conversation", "customSegmentationPrompt"],
  },
  {
    name: "identifying-components",
    group: "finding-components",
    scope: "dimension",
    run: identifyForDimension,
    emits: ["dimensions"],
  },
  {
    name: "classifying-components",
    group: "finding-components",
    scope: "dimension",
    run: classifyForDimension,
    emits: ["dimensions"],
    parallel: "coloring",
  },
  {
    name: "coloring",
    group: "finding-components",
    scope: "dimension",
    // colorForDimension has extra presetColors param — runner calls it directly,
    // not through the DimensionStageRunner interface. Cast is for array type only.
    run: colorForDimension as unknown as DimensionStageRunner,
    emits: ["dimensions"],
    parallel: "classifying-components",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect emitted fields for all stages from startIndex..endIndex inclusive. */
function collectEmittedFields(startIndex: number, endIndex: number): PipelineDataField[] {
  const fields = new Set<PipelineDataField>();
  for (let i = startIndex; i <= endIndex; i++) {
    for (const f of PIPELINE[i]!.emits) fields.add(f);
  }
  return [...fields];
}

/** Find stage index by name. */
function stageIndex(name: Stage): number {
  const idx = PIPELINE.findIndex(s => s.name === name);
  if (idx === -1) throw new Error(`Unknown stage: ${name}`);
  return idx;
}

// Pre-computed field lists (derived from PIPELINE, not hand-maintained)
const API_KEY_GATE_INDEX = stageIndex("segmenting");
const PRE_API_KEY_FIELDS: PipelineDataField[] = collectEmittedFields(0, API_KEY_GATE_INDEX - 1);
const ALL_PIPELINE_FIELDS: PipelineDataField[] = collectEmittedFields(0, PIPELINE.length - 1);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface RunOptions {
  startFrom?: Stage;
  dimNames?: string[];
  notify: Notify;
  /** Extra args passed to dimension stages (e.g. presetColors for coloring). */
  presetColors?: Record<string, string>;
}

/**
 * Run the pipeline from startFrom through the end.
 * Merges stage results into ctx. Applies middleware (logging, timing, store updates).
 * Throws on error — callers handle markFailed.
 */
async function runPipeline(
  ctx: PipelineState,
  options: RunOptions,
): Promise<void> {
  const { notify, dimNames, presetColors } = options;
  const startIdx = options.startFrom ? stageIndex(options.startFrom) : 0;
  const config = getAIConfig("Componentisation");

  // Group parallel stages so we can run them together
  const processed = new Set<number>();

  for (let i = startIdx; i < PIPELINE.length; i++) {
    if (processed.has(i)) continue;

    const stage = PIPELINE[i]!;

    // Find parallel partner if any
    const parallelIdx = stage.parallel
      ? PIPELINE.findIndex((s, j) => j > i && s.name === stage.parallel)
      : -1;
    const parallelStage = parallelIdx >= 0 ? PIPELINE[parallelIdx]! : undefined;

    if (parallelStage) {
      processed.add(parallelIdx);
      await runParallelDimensionStages(
        [stage, parallelStage], ctx, notify, config, dimNames, presetColors,
      );
    } else if (stage.scope === "conversation") {
      await runConversationStage(stage, ctx, notify);
    } else {
      await runDimensionStage(stage, ctx, notify, config, dimNames, presetColors);
    }

    // Notify store with accumulated state
    const lastIdx = parallelStage ? Math.max(i, parallelIdx) : i;
    const nextStage = findNextStage(lastIdx, processed);
    updateState(notify, ctx, collectEmittedFields(startIdx, lastIdx), nextStage?.group);
  }
}

function findNextStage(afterIdx: number, processed: Set<number>): StageDescriptor | undefined {
  for (let j = afterIdx + 1; j < PIPELINE.length; j++) {
    if (!processed.has(j)) return PIPELINE[j];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Stage executors (middleware is inlined — logging, timing, status)
// ---------------------------------------------------------------------------

async function runConversationStage(
  stage: StageDescriptor,
  ctx: PipelineState,
  notify: Notify,
): Promise<void> {
  markStepStart(ctx.id, stage.name);
  notify(ctx.id, { status: "processing", step: stage.group });

  const start = Date.now();
  const result = await (stage.run as ConversationStageRunner)(ctx);
  const timing = Math.round((Date.now() - start) / 1000);

  const { warnings: stageWarnings, ...fields } = result;
  Object.assign(ctx, fields);
  if (stageWarnings) ctx.warnings!.push(...stageWarnings);
  ctx.stepTimings![stage.name] = timing;

  markStepEnd(ctx.id, stage.name);
}

async function runDimensionStage(
  stage: StageDescriptor,
  ctx: PipelineState,
  notify: Notify,
  config: AIConfig | null,
  dimNames?: string[],
  presetColors?: Record<string, string>,
): Promise<void> {
  markStepStart(ctx.id, stage.name);
  notify(ctx.id, { status: "processing", step: stage.group });

  const dims = ensureDimensions(ctx);
  const activeDimNames = dimNames ?? getDimensionNames(ctx);
  for (const name of activeDimNames) ensureDimension(dims, name);
  const errors: string[] = [];

  const start = Date.now();
  await Promise.all(
    activeDimNames.map(async (dimName) => {
      const dimData = dims[dimName]!;
      if (!config) return;

      const runFn = stage.run as DimensionStageRunner;
      const { result, error } = stage.name === "coloring"
        ? await colorForDimension(dimData, config, ctx.id, presetColors)
        : await runFn(ctx.conversation!, dimData, config, ctx.id);

      Object.assign(dimData, result);
      if (error) errors.push(`[${dimName}] ${error}`);
    }),
  );
  const timing = Math.round((Date.now() - start) / 1000);

  ctx.dimensions = dims;
  ctx.stepTimings![stage.name] = timing;
  if (errors.length > 0) ctx.warnings!.push(errors.join("; "));

  markStepEnd(ctx.id, stage.name);
}

async function runParallelDimensionStages(
  stages: StageDescriptor[],
  ctx: PipelineState,
  notify: Notify,
  config: AIConfig | null,
  dimNames?: string[],
  presetColors?: Record<string, string>,
): Promise<void> {
  for (const stage of stages) markStepStart(ctx.id, stage.name);
  notify(ctx.id, { status: "processing", step: stages[0]!.group });

  const dims = ensureDimensions(ctx);
  const activeDimNames = dimNames ?? getDimensionNames(ctx);
  for (const name of activeDimNames) ensureDimension(dims, name);
  const errors: string[] = [];

  const start = Date.now();
  await Promise.all(
    activeDimNames.map(async (dimName) => {
      const dimData = dims[dimName]!;
      if (!config) return;

      // Run all parallel stages for this dimension concurrently
      const results = await Promise.all(
        stages.map(stage =>
          stage.name === "coloring"
            ? colorForDimension(dimData, config, ctx.id, presetColors)
            : (stage.run as DimensionStageRunner)(ctx.conversation!, dimData, config, ctx.id),
        ),
      );

      // Merge all results after both complete — no race
      for (const { result, error } of results) {
        Object.assign(dimData, result);
        if (error) errors.push(`[${dimName}] ${error}`);
      }
    }),
  );
  const timing = Math.round((Date.now() - start) / 1000);

  ctx.dimensions = dims;
  for (const stage of stages) {
    ctx.stepTimings![stage.name] = timing;
    markStepEnd(ctx.id, stage.name);
  }
  if (errors.length > 0) ctx.warnings!.push(errors.join("; "));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a new file through the full pipeline.
 */
export async function processNewFile(
  ctx: PipelineState,
  notify: Notify,
  _callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    // --- Parse ---
    await runConversationStage(PIPELINE[0]!, ctx, notify);
    updateState(notify, ctx, ["conversation", "summary", "metadata"], "counting-tokens");

    // --- Pre-processed import short-circuit ---
    if (ctx.metadata!.parserName === "Context Viewer") {
      const restored = restorePreProcessedImport(ctx.metadata!, ctx.conversation!);
      Object.assign(ctx, restored);
      markComplete(notify, ctx, [
        "conversation", "summary", "metadata", "title",
        "aiSummary", "analysis", "dimensions",
        "staticComponents", "staticMapping", "staticTimeline",
        "customSegmentationPrompt", "customSummaryPrompt", "customAnalysisPrompt",
      ]);
      return;
    }

    // --- Count tokens ---
    await runConversationStage(PIPELINE[1]!, ctx, notify);

    // --- API key gate ---
    if (!hasApiKey()) {
      markPausedForApiKey(notify, ctx, PRE_API_KEY_FIELDS, "segmenting");
      return;
    }
    updateState(notify, ctx, PRE_API_KEY_FIELDS, "segmenting");

    // --- Segment through Color ---
    await runPipeline(ctx, {
      startFrom: "segmenting",
      notify,
      presetColors: ctx.presetColors,
    });
    markComplete(notify, ctx, ALL_PIPELINE_FIELDS);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

/**
 * Resume from API key pause — run from Segment through Color.
 */
export async function resumeFromPause(
  ctx: PipelineState,
  notify: Notify,
  _callbacks: PipelineCallbacks,
): Promise<void> {
  try {
    await runPipeline(ctx, {
      startFrom: "segmenting",
      notify,
      presetColors: ctx.presetColors,
    });
    markComplete(notify, ctx, ["conversation", "dimensions"]);
  } catch (error: any) {
    markFailed(notify, ctx.id, error.message);
  }
}

/**
 * Run dimension steps from a given starting stage.
 * Used by orchestrate.ts for reprocessing after prompt changes.
 *
 * Accepts numeric PipelineStep for backward compatibility with callers.
 */
export async function runDimensionSteps(
  startFrom: number,
  ctx: PipelineState,
  notify: Notify,
  dimNames?: string[],
): Promise<void> {
  // Map numeric PipelineStep values to stage names
  const stageNames: Stage[] = [
    "parsing", "counting-tokens", "segmenting",
    "identifying-components", "classifying-components", "coloring",
  ];
  const stageName = stageNames[startFrom];
  if (!stageName) throw new Error(`Invalid startFrom: ${startFrom}`);

  await runPipeline(ctx, {
    startFrom: stageName,
    dimNames,
    notify,
    presetColors: ctx.presetColors,
  });
}
