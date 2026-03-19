/**
 * Component identification: discover the list of logical components per dimension.
 *
 * Uses AI to discover components, or accepts a custom component list.
 * Classification (mapping parts to components) is in component-classification.ts.
 */

import type { WorkflowState } from "./types";
import type { DimensionData } from "../component-types";
import { timed } from "./notify";
import { identifyComponents } from "../component-identification";
import { getAIConfig } from "../ai-config";
import { ensureDimensions, getDimensionNames } from "./dimensions";

export async function runIdentifyComponents(ctx: WorkflowState, onlyDims?: string[]): Promise<{ timing: number }> {
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = onlyDims ?? getDimensionNames(ctx);

    const config = getAIConfig("Componentisation");
    const errors: string[] = [];

    await Promise.all(
      dimNames.map(async (dimName) => {
        const dimData = dims[dimName];
        const prompt = dimData?.prompt;
        const customComponents = dimData?.customComponents;

        let components: string[];

        if (customComponents && customComponents.length > 0) {
          const cleaned = customComponents.map((c) => c.replace(/^-\s*/, ""));
          // Idempotent: if components already match customComponents, skip
          if (dimData?.components?.length && JSON.stringify(cleaned) === JSON.stringify(dimData.components)) {
            return;
          }
          components = cleaned;
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
  if (result.errors.length > 0) ctx.warnings!.push(result.errors.join("; "));

  return { timing };
}

export { buildComponentTimeline } from "../component-classification";
