/**
 * Pipeline execution utilities.
 *
 * Plain functions for step lifecycle and state notification.
 * The `notify` callback pushes state updates to the Zustand store.
 */

import type { PipelineState, PipelineDataField, StageGroup, Stage } from "@/model/types";
import { markStepStart, markStepEnd } from "./logging";

export type Notify = (id: string, update: Partial<PipelineState>) => void;

/** Pick specific data fields from ctx to build a partial update */
function pickFields(
  ctx: PipelineState,
  fields: readonly PipelineDataField[],
): Partial<PipelineState> {
  const update: Partial<PipelineState> = {};
  for (const f of fields) {
    (update as any)[f] = (ctx as any)[f];
  }
  return update;
}

// ---------------------------------------------------------------------------
// Step lifecycle — tell the UI what's happening
// ---------------------------------------------------------------------------

export function startStep(notify: Notify, ctx: PipelineState, step: StageGroup) {
  markStepStart(ctx.id, step as Stage);
  notify(ctx.id, { status: "processing", step });
}

export function endStep(ctx: PipelineState, step: StageGroup) {
  markStepEnd(ctx.id, step as Stage);
}

export function updateState(
  notify: Notify,
  ctx: PipelineState,
  only: readonly PipelineDataField[],
  nextStep?: StageGroup,
) {
  notify(ctx.id, {
    ...pickFields(ctx, only),
    warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
    stepTimings: ctx.stepTimings,
    status: "success",
    step: nextStep,
  });
}

export function markComplete(
  notify: Notify,
  ctx: PipelineState,
  only: readonly PipelineDataField[],
) {
  notify(ctx.id, {
    ...pickFields(ctx, only),
    warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
    stepTimings: ctx.stepTimings,
    status: "success",
    step: undefined,
  });
}

export function markFailed(notify: Notify, id: string, error: string) {
  notify(id, { status: "failed", step: undefined, error });
}

export function markPausedForApiKey(
  notify: Notify,
  ctx: PipelineState,
  only: readonly PipelineDataField[],
  nextStep: StageGroup,
) {
  notify(ctx.id, {
    ...pickFields(ctx, only),
    warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
    stepTimings: ctx.stepTimings,
    status: "paused-for-api-key",
    step: undefined,
    pausedAtStep: nextStep,
  });
}

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

/** Time an async operation, return result + seconds elapsed */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; timing: number }> {
  const start = Date.now();
  const result = await fn();
  const timing = Math.round((Date.now() - start) / 1000);
  return { result, timing };
}
