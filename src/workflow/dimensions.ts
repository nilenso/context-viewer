import type { WorkflowState } from "./types";
import type { DimensionData } from "../component-types";

/**
 * Ensure ctx.dimensions exists and has at least a "default" entry.
 */
export function ensureDimensions(ctx: WorkflowState): Record<string, DimensionData> {
  if (!ctx.dimensions) {
    ctx.dimensions = {};
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

// ---------------------------------------------------------------------------
// Accessor helpers — centralizes "which dimension am I looking at?"
// ---------------------------------------------------------------------------

/** Get a specific dimension by name (defaults to "default"). */
export function getDimension(state: WorkflowState, name: string = "default"): DimensionData | undefined {
  return state.dimensions?.[name];
}

/** Get the default dimension. */
export function getDefaultDimension(state: WorkflowState): DimensionData | undefined {
  return state.dimensions?.["default"];
}

/** Union of all component names across all dimensions. */
export function getAllComponents(state: WorkflowState): string[] {
  if (!state.dimensions) return [];
  const all = new Set<string>();
  for (const dim of Object.values(state.dimensions)) {
    for (const c of dim.components) all.add(c);
  }
  return [...all];
}

/** Get color for a component in a given dimension. */
export function getComponentColor(state: WorkflowState, component: string, dimName: string = "default"): string | undefined {
  return state.dimensions?.[dimName]?.componentColors[component];
}
