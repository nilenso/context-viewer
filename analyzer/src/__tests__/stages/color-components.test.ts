/**
 * Tests for assignComponentColors and colorForDimension.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [35] assignComponentColors(51 components) → PC1_COLORS (exact hex mapping)
 *   [40] assignComponentColors(49 components) → SEG1_COLORS (exact hex mapping)
 *   [34] colorForDimension(default, 51 components, no existing colors) → componentColors = PC1_COLORS
 *
 * Ground truth from compaction-everything.json:
 *   [94] colorForDimension(default, 12 components, existing colors match) → {result: {}} (idempotent)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PC1_COLORS, SEG1_COMPONENTS, SEG1_COLORS } from "../recording-fixtures";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("../../config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../config")>();
  return {
    ...mod,
    createModel: () => ({}),
    getProviderOptions: () => undefined,
  };
});

import { generateText } from "ai";
import { assignComponentColors, colorForDimension } from "../../stages/color";
import type { DimensionData } from "../../model/types";

const testConfig = {
  apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

describe("assignComponentColors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches recording [35]: assigns colors to 51 components", async () => {
    // Mock AI to return what recording [35] captured
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(PC1_COLORS),
    });

    const components = Object.keys(PC1_COLORS);
    const { colors: result } = await assignComponentColors(components, testConfig);

    expect(result).toEqual(PC1_COLORS);
    expect(Object.keys(result).length).toBe(54);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("matches recording [40]: assigns colors to 49 segment-1 components", async () => {
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(SEG1_COLORS),
    });

    const { colors: result } = await assignComponentColors(SEG1_COMPONENTS, testConfig);

    expect(result).toEqual(SEG1_COLORS);
    expect(Object.keys(result).length).toBe(49);
  });

  it("uses preset colors without AI", async () => {
    const presetColors = { A: "#ff0000", B: "#00ff00" };
    const { colors: result } = await assignComponentColors(["A", "B"], testConfig, presetColors);

    expect(result).toEqual(presetColors);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("fills missing preset colors with gray", async () => {
    const { colors: result } = await assignComponentColors(["A", "B"], testConfig, { A: "#ff0000" });
    expect(result).toEqual({ A: "#ff0000", B: "gray" });
  });

  it("returns {} on AI error", async () => {
    (generateText as any).mockRejectedValue(new Error("API error"));
    expect((await assignComponentColors(["A"], testConfig)).colors).toEqual({});
  });

  it("strips '- ' prefix and description suffixes from AI keys", async () => {
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({
        "- planning: The planning phase": "#60a5fa",
        "coding": "#34d399",
      }),
    });
    const { colors: result } = await assignComponentColors(["planning", "coding"], testConfig);
    expect(result).toEqual({ planning: "#60a5fa", coding: "#34d399" });
  });
});

describe("colorForDimension", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips when no discoveredComponents", async () => {
    const dim: DimensionData = {
      name: "default", discoveredComponents: [], componentMapping: {},
      componentTimeline: [], componentColors: {},
    };
    const result = await colorForDimension(dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("matches recording [94]: idempotent skip when colors cover all components", async () => {
    // Recording [94]: components and colors match exactly → {result: {}}
    const components = SEG1_COMPONENTS.slice(0, 5);
    const colors = Object.fromEntries(components.map(c => [c, SEG1_COLORS[c]!]));

    const dim: DimensionData = {
      name: "default", discoveredComponents: components,
      componentMapping: {}, componentTimeline: [],
      componentColors: colors,
    };

    const result = await colorForDimension(dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("matches recording [34] pattern: assigns colors when none exist", async () => {
    (generateText as any).mockResolvedValue({ text: JSON.stringify(SEG1_COLORS) });

    const dim: DimensionData = {
      name: "default", discoveredComponents: SEG1_COMPONENTS,
      componentMapping: {}, componentTimeline: [],
      componentColors: {},
    };

    const result = await colorForDimension(dim, testConfig);
    expect(result.result.componentColors).toEqual(SEG1_COLORS);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("re-assigns when component list changed (new component added)", async () => {
    const newColors = { ...SEG1_COLORS, new_comp: "#ffffff" };
    (generateText as any).mockResolvedValue({ text: JSON.stringify(newColors) });

    const dim: DimensionData = {
      name: "default",
      discoveredComponents: [...SEG1_COMPONENTS, "new_comp"],
      componentMapping: {}, componentTimeline: [],
      componentColors: SEG1_COLORS, // missing new_comp
    };

    const result = await colorForDimension(dim, testConfig);
    expect(result.result.componentColors).toBeDefined();
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("uses preset colors when provided", async () => {
    const presetColors = Object.fromEntries(
      SEG1_COMPONENTS.slice(0, 3).map(c => [c, "#aabbcc"]),
    );

    const dim: DimensionData = {
      name: "default", discoveredComponents: SEG1_COMPONENTS.slice(0, 3),
      componentMapping: {}, componentTimeline: [],
      componentColors: {},
    };

    const result = await colorForDimension(dim, testConfig, presetColors);
    expect(result.result.componentColors).toEqual(presetColors);
    expect(generateText).not.toHaveBeenCalled();
  });
});
