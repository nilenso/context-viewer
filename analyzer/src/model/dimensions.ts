import type { PipelineState, DimensionData } from "./types";

export function ensureDimensions(ctx: PipelineState): Record<string, DimensionData> {
  if (!ctx.dimensions) {
    ctx.dimensions = {};
  }
  return ctx.dimensions;
}

export function getDimensionNames(ctx: PipelineState): string[] {
  if (!ctx.dimensions || Object.keys(ctx.dimensions).length === 0) {
    return ["default"];
  }
  return Object.keys(ctx.dimensions);
}

export function createEmptyDimension(name: string): DimensionData {
  return {
    name,
    discoveredComponents: [],
    componentMapping: {},
    componentTimeline: [],
    componentColors: {},
  };
}

export function ensureDimension(
  dims: Record<string, DimensionData>,
  name: string,
): DimensionData {
  if (!dims[name]) {
    dims[name] = createEmptyDimension(name);
  }
  return dims[name];
}

export function getDimension(state: PipelineState, name: string = "default"): DimensionData | undefined {
  return state.dimensions?.[name];
}

export function getDefaultDimension(state: PipelineState): DimensionData | undefined {
  return state.dimensions?.["default"];
}

export function getEffectiveComponents(dim: DimensionData): string[] {
  if (dim.customComponents && dim.customComponents.length > 0) {
    return dim.customComponents;
  }
  return dim.discoveredComponents;
}

export function getAllComponents(state: PipelineState): string[] {
  if (!state.dimensions) return [];
  const all = new Set<string>();
  for (const dim of Object.values(state.dimensions)) {
    for (const c of getEffectiveComponents(dim)) all.add(c);
  }
  return [...all];
}

export function getComponentColor(state: PipelineState, component: string, dimName: string = "default"): string | undefined {
  return state.dimensions?.[dimName]?.componentColors[component];
}
