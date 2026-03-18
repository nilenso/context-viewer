import type { WorkflowState } from "./types";
import type { DimensionData } from "../componentisation";

/**
 * Sync legacy single-dimension fields from the "default" dimension in ctx.dimensions.
 */
export function syncLegacyFieldsFromDimensions(ctx: WorkflowState): void {
  if (!ctx.dimensions) return;
  const dimKeys = Object.keys(ctx.dimensions);
  const primaryDim = ctx.dimensions["default"] || (dimKeys.length > 0 ? ctx.dimensions[dimKeys[0]!] : null);
  if (primaryDim) {
    ctx.components = primaryDim.components;
    ctx.componentMapping = primaryDim.componentMapping;
    ctx.componentTimeline = primaryDim.componentTimeline;
    ctx.componentColors = primaryDim.componentColors;
  }
}

/**
 * Ensure ctx.dimensions exists and has at least a "default" entry.
 */
export function ensureDimensions(ctx: WorkflowState): Record<string, DimensionData> {
  if (!ctx.dimensions) {
    ctx.dimensions = {};
  }
  if (Object.keys(ctx.dimensions).length === 0 && ctx.components) {
    ctx.dimensions["default"] = {
      name: "default",
      prompt: ctx.customPrompt,
      components: ctx.components || [],
      componentMapping: ctx.componentMapping || {},
      componentTimeline: ctx.componentTimeline || [],
      componentColors: ctx.componentColors || {},
    };
  }
  return ctx.dimensions;
}

/**
 * Get dimension names from a WorkflowState, defaulting to ["default"].
 */
export function getDimensionNames(ctx: WorkflowState): string[] {
  if (!ctx.dimensions || Object.keys(ctx.dimensions).length === 0) {
    return ["default"];
  }
  return Object.keys(ctx.dimensions);
}
