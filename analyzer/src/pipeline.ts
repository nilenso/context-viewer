/**
 * Pipeline: imperative stage chain for processing conversation files.
 *
 * Parse → CountTokens → Segment → Identify → (Classify ∥ Color)
 *
 * Each stage is pure — returns results, never mutates ctx directly.
 * The pipeline is idempotent: stages skip if their outputs already exist.
 * Parallelism: dimensions are identified in parallel, then classify+color
 * run in parallel per dimension, and within each dimension classify and
 * color run concurrently.
 *
 * Interceptors allow callers to hook into stage boundaries without
 * changing the pipeline logic. Use post-interceptors to push state
 * into a UI store as stages complete.
 */

import type { PipelineState, Stage } from "./model/types";
import type { AIConfig } from "./config";
import { ensureDimensions, ensureDimension, getDimensionNames } from "./model/dimensions";
import { stageLogger } from "./logger";
import type { StageError } from "./errors";

import { parse, restorePreProcessedImport } from "./stages/parse";
import { countTokens } from "./stages/count-tokens";
import { segment } from "./stages/segment";
import { identifyForDimension } from "./stages/identify";
import { classifyForDimension } from "./stages/classify";
import { colorForDimension } from "./stages/color";

const log = stageLogger("pipeline");

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

export interface Interceptor {
  stage: Stage;
  timing: "pre" | "post";
  fn: (ctx: PipelineState) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  interceptors?: Interceptor[];
  dimNames?: string[];
}

// ---------------------------------------------------------------------------
// Stage runner — wraps a stage with logging, timing, interceptors
// ---------------------------------------------------------------------------

async function run<T>(
  name: Stage,
  ctx: PipelineState,
  interceptors: Interceptor[],
  fn: () => Promise<T>,
): Promise<T> {
  log.info(`[${ctx.filename}] Starting ${name}`);

  // Pre-interceptors
  for (const i of interceptors) {
    if (i.stage === name && i.timing === "pre") await i.fn(ctx);
  }

  const start = Date.now();
  const result = await fn();
  ctx.stepTimings![name] = Math.round((Date.now() - start) / 1000);
  log.info(`[${ctx.filename}] Completed ${name} in ${ctx.stepTimings![name]}s`);

  // Post-interceptors (run after result is available but before merge in caller)
  // Note: for post-interceptors to see the merged state, the caller merges first
  // then calls runPost(). See the pipeline body below.

  return result;
}

/** Run post-interceptors for a stage. Called after merge so ctx has the new data. */
async function runPost(name: Stage, ctx: PipelineState, interceptors: Interceptor[]): Promise<void> {
  for (const i of interceptors) {
    if (i.stage === name && i.timing === "post") await i.fn(ctx);
  }
}

/** Merge a stage result into ctx. */
function merge(ctx: PipelineState, result: Partial<PipelineState> & { warnings?: string[]; errors?: StageError[] }): StageError[] {
  const { warnings, errors, ...fields } = result;
  Object.assign(ctx, fields);
  if (warnings) ctx.warnings!.push(...warnings);
  return errors || [];
}

// ---------------------------------------------------------------------------
// The pipeline — imperative, reads top-to-bottom
// ---------------------------------------------------------------------------

/**
 * Run the pipeline. Each stage skips if its work is already done.
 *
 * @param ctx - Pipeline state (mutated in place with results)
 * @param aiConfig - AI configuration (null = skip AI stages)
 * @param options - Interceptors and dimension selection
 * @returns Array of errors encountered during processing
 */
export async function runPipeline(
  ctx: PipelineState,
  aiConfig: AIConfig | null,
  options?: PipelineOptions,
): Promise<StageError[]> {
  const allErrors: StageError[] = [];
  const interceptors = options?.interceptors || [];

  // --- Conversation-level stages ---

  if (!ctx.conversation) {
    merge(ctx, await run("parsing", ctx, interceptors, () => parse(ctx)));
    await runPost("parsing", ctx, interceptors);

    if (ctx.metadata!.parserName === "Context Viewer") {
      Object.assign(ctx, restorePreProcessedImport(ctx.metadata!, ctx.conversation!));
      return allErrors;
    }
  }

  if (!ctx.staticComponents) {
    merge(ctx, await run("counting-tokens", ctx, interceptors, () => countTokens(ctx)));
    await runPost("counting-tokens", ctx, interceptors);
  }

  if (!aiConfig?.apiKey) {
    return allErrors;
  }

  // Segment always runs — it's cheap when there are no large parts
  allErrors.push(...merge(ctx, await run("segmenting", ctx, interceptors, () => segment(ctx, aiConfig))));
  await runPost("segmenting", ctx, interceptors);

  // --- Dimension-level stages (each has its own idempotency) ---

  const dims = ensureDimensions(ctx);
  const activeDimNames = options?.dimNames ?? getDimensionNames(ctx);
  for (const name of activeDimNames) ensureDimension(dims, name);

  // Identify — all dimensions in parallel (skips if discoveredComponents exist)
  await run("identifying-components", ctx, interceptors, () =>
    Promise.all(activeDimNames.map(async (dimName) => {
      const { result, error } = await identifyForDimension(
        ctx.conversation!, dims[dimName]!, aiConfig,
      );
      Object.assign(dims[dimName]!, result);
      if (error) allErrors.push(error);
    })),
  );
  await runPost("identifying-components", ctx, interceptors);

  // Classify + Color — parallel per dimension, both stages parallel within each
  await run("classifying-components", ctx, interceptors, () =>
    Promise.all(activeDimNames.map(async (dimName) => {
      const dim = dims[dimName]!;
      const [classified, colored] = await Promise.all([
        classifyForDimension(ctx.conversation!, dim, aiConfig),
        colorForDimension(dim, aiConfig, ctx.presetColors),
      ]);
      Object.assign(dim, classified.result, colored.result);
      if (classified.error) allErrors.push(classified.error);
      if (colored.error) allErrors.push(colored.error);
    })),
  );

  ctx.dimensions = dims;
  // Post-interceptors for classify see the final dimensions
  await runPost("classifying-components", ctx, interceptors);
  await runPost("coloring", ctx, interceptors);

  return allErrors;
}
