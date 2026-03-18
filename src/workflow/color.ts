/**
 * Color assignment: assign colors to identified components.
 */

import type { WorkflowState } from "./types";
import { type Notify, startStep, endStep, timed } from "./notify";
import { assignComponentColors } from "../component-coloring";
import { ensureDimensions, getDimensionNames } from "./dimensions";

export async function runAssignColors(ctx: WorkflowState, notify: Notify, onlyDims?: string[]) {
  startStep(notify, ctx, "coloring");
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = onlyDims ?? getDimensionNames(ctx);

    await Promise.all(
      dimNames.map(async (dimName) => {
        const dimData = dims[dimName];
        if (!dimData || !ctx.config || !dimData.components?.length) return;

        const colors = await assignComponentColors(
          dimData.components,
          ctx.config,
          ctx.id,
          ctx.presetColors,
          dimData.customColoringPrompt,
        );
        dims[dimName] = { ...dimData, componentColors: colors };
      }),
    );

    return { dimensions: dims };
  });
  endStep(ctx, "coloring");

  ctx.dimensions = result.dimensions;
  ctx.stepTimings!.coloring = timing;
}
