/**
 * Color assignment workflow step: assign colors to identified components.
 */

import type { WorkflowState, Activity } from "./types";
import type { DimensionData } from "../componentisation";
import { WorkflowRunner } from "./runner";
import { assignComponentColors } from "../componentisation";
import { ensureDimensions, getDimensionNames } from "./dimensions";

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const assignColorsActivity: Activity<{
  colors: Record<string, string>;
  dimensions: Record<string, DimensionData>;
}> = async (ctx) => {
  const dims = ensureDimensions(ctx as any);
  const dimNames = ctx.targetDimension
    ? [ctx.targetDimension]
    : getDimensionNames(ctx as any);

  await Promise.all(
    dimNames.map(async (dimName) => {
      const dimData = dims[dimName];
      if (!dimData || !ctx.config || !dimData.components?.length) return;

      const colors = await assignComponentColors(
        dimData.components,
        ctx.config,
        ctx.id,
        ctx.presetColors,
        dimData.customColoringPrompt ?? ctx.customColoringPrompt,
      );
      dims[dimName] = { ...dimData, componentColors: colors };
    }),
  );

  const defaultDim = dims["default"];
  return {
    colors: defaultDim?.componentColors || {},
    dimensions: dims,
  };
};

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

export async function runAssignColors(ctx: WorkflowState, runner: WorkflowRunner) {
  runner.startStep(ctx, "coloring");
  const { result, timing } = await runner.runActivity(ctx, assignColorsActivity, "coloring");
  ctx.componentColors = result.colors;
  ctx.dimensions = result.dimensions;
  ctx.stepTimings!.coloring = timing;
}
