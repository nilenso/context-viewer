/**
 * Color assignment: assign colors to identified components.
 */

import type { WorkflowState } from "./types";
import { type Notify, startStep, endStep, timed } from "./runner";
import { assignComponentColors } from "../componentisation";
import { ensureDimensions, getDimensionNames } from "./dimensions";

export async function runAssignColors(ctx: WorkflowState, notify: Notify) {
  startStep(notify, ctx, "coloring");
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = ctx.targetDimension
      ? [ctx.targetDimension]
      : getDimensionNames(ctx);

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
    return { colors: defaultDim?.componentColors || {}, dimensions: dims };
  });
  endStep(ctx, "coloring");

  ctx.componentColors = result.colors;
  ctx.dimensions = result.dimensions;
  ctx.stepTimings!.coloring = timing;
}
