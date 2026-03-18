/**
 * Component identification: discover the list of logical components in a conversation.
 *
 * Per-dimension: uses AI to discover components, or accepts a custom component list.
 * This is the first half of componentisation — classification (mapping parts to
 * components) happens in component-classification.ts.
 */

import type { WorkflowState, Activity } from "./types";
import type { DimensionData } from "../componentisation";
import { identifyComponents, getComponentisationConfig } from "../componentisation";
import { ensureDimensions, getDimensionNames } from "./dimensions";

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const identifyComponentsActivity: Activity<{
  dimensions: Record<string, DimensionData>;
  error?: string;
}> = async (ctx) => {
  const dims = ensureDimensions(ctx as any);
  const dimNames = ctx.targetDimension
    ? [ctx.targetDimension]
    : getDimensionNames(ctx as any).length > 0
      ? getDimensionNames(ctx as any)
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
          components = await identifyComponents(
            ctx.conversation!,
            config,
            prompt,
            ctx.id,
          );
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

  return {
    dimensions: dims,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
};

// Re-exports used by other modules
export { getComponentisationConfig } from "../componentisation";
export { buildComponentTimeline } from "../componentisation";
