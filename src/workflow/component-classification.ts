/**
 * Component classification: map/classify each conversation part to a component.
 *
 * Takes the component list from identification and assigns each part to one.
 * Also builds the component timeline. This is the second half of componentisation.
 */

import type { WorkflowState, Activity } from "./types";
import type { DimensionData, ComponentTimelineSnapshot } from "../componentisation";
import {
  mapComponentsToIds,
  getComponentisationConfig,
  buildComponentTimeline,
} from "../componentisation";
import { getDefaultComponentIdentificationPrompt } from "../prompts";
import { ensureDimensions, getDimensionNames } from "./dimensions";

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export const classifyComponentsActivity: Activity<{
  components: string[];
  mapping: Record<string, string>;
  timeline: ComponentTimelineSnapshot[];
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

        // Add "other" component if there are unmapped parts
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

  const defaultDim = dims["default"];
  return {
    components: defaultDim?.components || [],
    mapping: defaultDim?.componentMapping || {},
    timeline: defaultDim?.componentTimeline || [],
    dimensions: dims,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
};
