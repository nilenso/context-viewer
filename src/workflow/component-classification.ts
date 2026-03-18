/**
 * Component classification: map/classify each conversation part to a component.
 *
 * Takes the component list from identification and assigns each part to one.
 * Also builds the component timeline.
 */

import type { WorkflowState } from "./types";
import {
  mapComponentsToIds,
  getComponentisationConfig,
  buildComponentTimeline,
} from "../componentisation";
import { getDefaultComponentIdentificationPrompt } from "../prompts";
import { timed } from "./runner";
import { ensureDimensions, getDimensionNames } from "./dimensions";

export async function runClassifyComponents(ctx: WorkflowState): Promise<{ timing: number }> {
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = ctx.targetDimension
      ? [ctx.targetDimension]
      : getDimensionNames(ctx).length > 0
        ? getDimensionNames(ctx)
        : ["default"];

    const config = getComponentisationConfig();
    const errors: string[] = [];

    await Promise.all(
      dimNames.map(async (dimName) => {
        const dimData = dims[dimName];
        if (!dimData || !config || !dimData.components?.length) return;

        const prompt = dimData.prompt ?? ctx.customPrompt;
        const componentDescriptions = prompt || getDefaultComponentIdentificationPrompt();

        try {
          const mapping = await mapComponentsToIds(
            ctx.conversation!,
            dimData.components,
            config,
            componentDescriptions,
            ctx.id,
          );

          const totalParts = ctx.conversation!.messages.reduce(
            (sum, msg) => sum + msg.parts.length, 0,
          );
          const mappedParts = Object.keys(mapping).length;
          const finalComponents =
            mappedParts < totalParts && !dimData.components.includes("other")
              ? [...dimData.components, "other"]
              : dimData.components;

          const timeline = buildComponentTimeline(ctx.conversation!, mapping);

          dims[dimName] = {
            ...dimData,
            components: finalComponents,
            componentMapping: mapping,
            componentTimeline: timeline,
          };
        } catch (e: any) {
          errors.push(`[${dimName}] Classification failed: ${e.message}`);
        }
      }),
    );

    return { dimensions: dims, errors };
  });

  ctx.dimensions = result.dimensions;
  const defaultDim = result.dimensions["default"];
  if (defaultDim) {
    ctx.components = defaultDim.components;
    ctx.componentMapping = defaultDim.componentMapping;
    ctx.componentTimeline = defaultDim.componentTimeline;
  }
  if (result.errors.length > 0) ctx.warnings!.push(result.errors.join("; "));

  return { timing };
}
