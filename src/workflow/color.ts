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

        // Idempotent: if componentColors already covers exactly the current components, skip
        const existingColorKeys = Object.keys(dimData.componentColors || {}).sort();
        const currentComponents = [...dimData.components].sort();
        if (existingColorKeys.length > 0 && JSON.stringify(existingColorKeys) === JSON.stringify(currentComponents)) {
          return;
        }

        const colors = await assignComponentColors(
          dimData.components,
          ctx.config,
          ctx.id,
          ctx.presetColors,
          dimData.customColoringPrompt,
        );
        // Mutate in place — color and classify run in parallel on the same dimData,
        // so replacing the object would race with runClassifyComponents.
        dimData.componentColors = colors;
      }),
    );

    return { dimensions: dims };
  });
  endStep(ctx, "coloring");

  ctx.dimensions = result.dimensions;
  ctx.stepTimings!.coloring = timing;
}
