/**
 * Tests for model/dimensions helper functions.
 *
 * Ground truth: the pipeline uses these functions extensively —
 * ensureDimensions, getDimensionNames, getEffectiveComponents,
 * getAllComponents are called in every recording.
 */
import { describe, it, expect } from "vitest";
import {
  ensureDimensions,
  getDimensionNames,
  createEmptyDimension,
  ensureDimension,
  getDimension,
  getDefaultDimension,
  getEffectiveComponents,
  getAllComponents,
  getComponentColor,
} from "@/model/dimensions";
import { EV_PROMPT3_COMPONENTS, EV_PROMPT3_COLORS } from "@/__tests__/recording-fixtures";
import type { PipelineState, DimensionData } from "@/model/types";

function makeState(dims?: Record<string, DimensionData>): PipelineState {
  return { id: "1", filename: "test.jsonl", dimensions: dims, warnings: [], stepTimings: {} };
}

describe("ensureDimensions", () => {
  it("creates empty dimensions object when missing", () => {
    const ctx = makeState(undefined);
    const dims = ensureDimensions(ctx);
    expect(dims).toEqual({});
    expect(ctx.dimensions).toBe(dims);
  });

  it("returns existing dimensions", () => {
    const existing = { default: createEmptyDimension("default") };
    const ctx = makeState(existing);
    expect(ensureDimensions(ctx)).toBe(existing);
  });
});

describe("getDimensionNames", () => {
  it("returns ['default'] when no dimensions", () => {
    expect(getDimensionNames(makeState(undefined))).toEqual(["default"]);
    expect(getDimensionNames(makeState({}))).toEqual(["default"]);
  });

  it("returns actual dimension names", () => {
    const ctx = makeState({
      default: createEmptyDimension("default"),
      relevance: createEmptyDimension("relevance"),
    });
    expect(getDimensionNames(ctx)).toEqual(["default", "relevance"]);
  });
});

describe("createEmptyDimension", () => {
  it("creates a properly initialized dimension", () => {
    const dim = createEmptyDimension("test");
    expect(dim).toEqual({
      name: "test",
      discoveredComponents: [],
      componentMapping: {},
      componentTimeline: [],
      componentColors: {},
    });
  });
});

describe("ensureDimension", () => {
  it("creates a missing dimension", () => {
    const dims: Record<string, DimensionData> = {};
    const dim = ensureDimension(dims, "new");
    expect(dim.name).toBe("new");
    expect(dims.new).toBe(dim);
  });

  it("returns existing dimension", () => {
    const existing = createEmptyDimension("existing");
    existing.discoveredComponents = EV_PROMPT3_COMPONENTS;
    const dims = { existing };
    expect(ensureDimension(dims, "existing")).toBe(existing);
  });
});

describe("getDimension / getDefaultDimension", () => {
  it("returns the named dimension", () => {
    const dim = createEmptyDimension("default");
    dim.componentColors = EV_PROMPT3_COLORS;
    const ctx = makeState({ default: dim });
    expect(getDimension(ctx, "default")).toBe(dim);
    expect(getDefaultDimension(ctx)).toBe(dim);
  });

  it("returns undefined for missing dimension", () => {
    expect(getDimension(makeState({}), "nonexistent")).toBeUndefined();
    expect(getDefaultDimension(makeState({}))).toBeUndefined();
  });
});

describe("getEffectiveComponents", () => {
  it("returns discoveredComponents when no customComponents", () => {
    const dim: DimensionData = {
      ...createEmptyDimension("default"),
      discoveredComponents: EV_PROMPT3_COMPONENTS,
    };
    expect(getEffectiveComponents(dim)).toEqual(EV_PROMPT3_COMPONENTS);
  });

  it("returns customComponents when set (recording [90] pattern)", () => {
    const dim: DimensionData = {
      ...createEmptyDimension("default"),
      discoveredComponents: ["old_a", "old_b"],
      customComponents: EV_PROMPT3_COMPONENTS,
    };
    expect(getEffectiveComponents(dim)).toEqual(EV_PROMPT3_COMPONENTS);
  });

  it("returns discoveredComponents when customComponents is empty", () => {
    const dim: DimensionData = {
      ...createEmptyDimension("default"),
      discoveredComponents: EV_PROMPT3_COMPONENTS,
      customComponents: [],
    };
    expect(getEffectiveComponents(dim)).toEqual(EV_PROMPT3_COMPONENTS);
  });
});

describe("getAllComponents", () => {
  it("unions components from all dimensions", () => {
    const ctx = makeState({
      default: { ...createEmptyDimension("default"), discoveredComponents: ["A", "B"] },
      extra: { ...createEmptyDimension("extra"), discoveredComponents: ["B", "C"] },
    });
    const all = getAllComponents(ctx);
    expect(all).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(all.length).toBe(3);
  });

  it("returns empty for no dimensions", () => {
    expect(getAllComponents(makeState(undefined))).toEqual([]);
  });
});

describe("getComponentColor", () => {
  it("returns color from recording data", () => {
    const dim: DimensionData = {
      ...createEmptyDimension("default"),
      componentColors: EV_PROMPT3_COLORS,
    };
    const ctx = makeState({ default: dim });
    expect(getComponentColor(ctx, EV_PROMPT3_COMPONENTS[0]!)).toBe(
      EV_PROMPT3_COLORS[EV_PROMPT3_COMPONENTS[0]!],
    );
  });

  it("returns undefined for missing component", () => {
    const ctx = makeState({ default: createEmptyDimension("default") });
    expect(getComponentColor(ctx, "nonexistent")).toBeUndefined();
  });
});
