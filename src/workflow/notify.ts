/**
 * Workflow execution utilities.
 *
 * Replaces the WorkflowRunner class with plain functions.
 * The `notify` callback pushes state updates to the Zustand store.
 */

import type { WorkflowState, WorkflowDataField, ProcessingStep } from "./types";
import type { ProcessingPhase } from "../workflow-logger";
import { markStepStart, markStepEnd } from "../workflow-logger";

export type Notify = (id: string, update: Partial<WorkflowState>) => void;

/** Pick specific data fields from ctx to build a partial update */
function pickFields(
  ctx: WorkflowState,
  fields: readonly WorkflowDataField[],
): Partial<WorkflowState> {
  const update: Partial<WorkflowState> = {};
  for (const f of fields) {
    (update as any)[f] = (ctx as any)[f];
  }
  return update;
}

// ---------------------------------------------------------------------------
// Step lifecycle — tell the UI what's happening
// ---------------------------------------------------------------------------

export function startStep(notify: Notify, ctx: WorkflowState, step: ProcessingStep) {
  markStepStart(ctx.id, step as ProcessingPhase);
  notify(ctx.id, { status: "processing", step });
}

export function endStep(ctx: WorkflowState, step: ProcessingStep) {
  markStepEnd(ctx.id, step as ProcessingPhase);
}

export function updateState(
  notify: Notify,
  ctx: WorkflowState,
  only: readonly WorkflowDataField[],
  nextStep?: ProcessingStep,
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
  ctx: WorkflowState,
  only: readonly WorkflowDataField[],
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
  ctx: WorkflowState,
  only: readonly WorkflowDataField[],
  nextStep: ProcessingStep,
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
