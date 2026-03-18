import type { WorkflowState, WorkflowDataField, ProcessingStep, Activity } from "./types";
import type { ProcessingPhase } from "../workflow-logger";
import { markStepStart, markStepEnd } from "../workflow-logger";

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

/**
 * WorkflowRunner: Manages state updates and timing for workflow execution.
 */
export class WorkflowRunner {
  constructor(
    private setState: (id: string, update: Partial<WorkflowState>) => void,
  ) {}

  async runActivity<T>(
    ctx: Readonly<WorkflowState>,
    activity: Activity<T>,
    step?: ProcessingStep,
  ): Promise<{ result: T; timing: number }> {
    const start = Date.now();
    const result = await activity(ctx);
    const timing = Math.round((Date.now() - start) / 1000);

    if (step) {
      markStepEnd(ctx.id, step as ProcessingPhase);
    }

    return { result, timing };
  }

  startStep(ctx: WorkflowState, step: ProcessingStep) {
    markStepStart(ctx.id, step as ProcessingPhase);
    this.setState(ctx.id, { status: "processing", step });
  }

  updateState(
    ctx: WorkflowState,
    only: readonly WorkflowDataField[],
    nextStep?: ProcessingStep,
  ) {
    this.setState(ctx.id, {
      ...pickFields(ctx, only),
      warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: "success",
      step: nextStep,
    });
  }

  markComplete(ctx: WorkflowState, only: readonly WorkflowDataField[]) {
    this.setState(ctx.id, {
      ...pickFields(ctx, only),
      warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: "success",
      step: undefined,
    });
  }

  markFailed(id: string, error: string) {
    this.setState(id, { status: "failed", step: undefined, error });
  }

  markPausedForApiKey(
    ctx: WorkflowState,
    only: readonly WorkflowDataField[],
    nextStep: ProcessingStep,
  ) {
    this.setState(ctx.id, {
      ...pickFields(ctx, only),
      warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: "paused-for-api-key",
      step: undefined,
      pausedAtStep: nextStep,
    });
  }
}
