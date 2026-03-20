import type { PipelineState, DimensionData } from "./types";

/**
 * Ensure ctx.dimensions exists and has at least a "default" entry.
 */
export function ensureDimensions(ctx: PipelineState): Record<string, DimensionData> {
  if (!ctx.dimensions) {
    ctx.dimensions = {};
  }
  return ctx.dimensions;
}

/**
 * Get dimension names from a PipelineState, defaulting to ["default"].
 */
export function getDimensionNames(ctx: PipelineState): string[] {
  if (!ctx.dimensions || Object.keys(ctx.dimensions).length === 0) {
    return ["default"];
  }
  return Object.keys(ctx.dimensions);
}

/** Create an empty DimensionData for a given name. */
export function createEmptyDimension(name: string): DimensionData {
  return {
    name,
    discoveredComponents: [],
    componentMapping: {},
    componentTimeline: [],
    componentColors: {},
  };
}

/**
 * Ensure a specific dimension exists in the record, creating it if missing.
 * Returns the (possibly new) DimensionData.
 */
export function ensureDimension(
  dims: Record<string, DimensionData>,
  name: string,
): DimensionData {
  if (!dims[name]) {
    dims[name] = createEmptyDimension(name);
  }
  return dims[name];
}

// ---------------------------------------------------------------------------
// Accessor helpers — centralizes "which dimension am I looking at?"
// ---------------------------------------------------------------------------

/** Get a specific dimension by name (defaults to "default"). */
export function getDimension(state: PipelineState, name: string = "default"): DimensionData | undefined {
  return state.dimensions?.[name];
}

/** Get the default dimension. */
export function getDefaultDimension(state: PipelineState): DimensionData | undefined {
  return state.dimensions?.["default"];
}

/**
 * Get the effective component list for a dimension.
 * Returns customComponents if set, otherwise discoveredComponents.
 * This is the single source of truth for "what components does this dimension use?"
 */
export function getEffectiveComponents(dim: DimensionData): string[] {
  if (dim.customComponents && dim.customComponents.length > 0) {
    return dim.customComponents;
  }
  return dim.discoveredComponents;
}

/** Union of all component names across all dimensions. */
export function getAllComponents(state: PipelineState): string[] {
  if (!state.dimensions) return [];
  const all = new Set<string>();
  for (const dim of Object.values(state.dimensions)) {
    for (const c of getEffectiveComponents(dim)) all.add(c);
  }
  return [...all];
}

/** Get color for a component in a given dimension. */
export function getComponentColor(state: PipelineState, component: string, dimName: string = "default"): string | undefined {
  return state.dimensions?.[dimName]?.componentColors[component];
}
