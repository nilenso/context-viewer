/**
 * Component identification: discover the list of logical components per dimension.
 *
 * Uses AI to discover components, or accepts a custom component list.
 * Classification (mapping parts to components) is in component-classification.ts.
 */

import type { WorkflowState } from "./types";
import type { DimensionData } from "../componentisation";
import { timed } from "./runner";
import { identifyComponents, getComponentisationConfig } from "../componentisation";
import { ensureDimensions, getDimensionNames } from "./dimensions";

export async function runIdentifyComponents(ctx: WorkflowState): Promise<{ timing: number }> {
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
        const prompt = dimData?.prompt ?? ctx.customPrompt;
        const customComponents = dimData?.customComponents ?? ctx.customComponents;

        let components: string[];

        if (customComponents && customComponents.length > 0) {
          components = customComponents.map((c) => c.replace(/^-\s*/, ""));
        } else if (config) {
          try {
            components = await identifyComponents(ctx.conversation!, config, prompt, ctx.id);
          } catch (e: any) {
            errors.push(`[${dimName}] ${e.message}`);
            components = [];
          }
        } else {
          errors.push(`[${dimName}] No API key configured`);
          components = [];
        }

        dims[dimName] = {
          ...(dims[dimName] || { name: dimName }),
          name: dimName,
          prompt,
          components,
          componentMapping: dims[dimName]?.componentMapping || {},
          componentTimeline: dims[dimName]?.componentTimeline || [],
          componentColors: dims[dimName]?.componentColors || {},
          customComponents,
        };
      }),
    );

    return { dimensions: dims, errors };
  });

  ctx.dimensions = result.dimensions;
  const defaultDim = result.dimensions["default"];
  if (defaultDim) ctx.components = defaultDim.components;
  if (result.errors.length > 0) ctx.warnings!.push(result.errors.join("; "));

  return { timing };
}

export { getComponentisationConfig } from "../componentisation";
export { buildComponentTimeline } from "../componentisation";
