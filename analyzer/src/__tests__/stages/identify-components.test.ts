/**
 * Tests for identifyComponents and identifyForDimension.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [26] identifyComponents(segment-1, 338 msgs) → SEG1_COMPONENTS (49 items)
 *   [29] identifyForDimension(default, componentCount=0) → discoveredComponents = SEG1_COMPONENTS
 *   [30] identifyComponents(post-compaction-1, 1 msg post-seg) → 51 components (truncated in log)
 *
 * Ground truth from compaction-everything.json:
 *   [90] identifyForDimension(default, 12 comps, hasCustomComponents=true) → {result: {}} (idempotent)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SEG1_COMPONENTS } from "../recording-fixtures";

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
import { identifyComponents, identifyForDimension } from "../../stages/identify";
import type { DimensionData } from "../../model/types";

const testConfig = {
  apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

const minimalConv = {
  messages: [{ id: "1", role: "user" as const, parts: [{ id: "p1", type: "text" as const, text: "x" }] }],
};

describe("identifyComponents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches recording [26]: parses 49 components from AI for segment-1", async () => {
    // Mock generateText to return what the real AI returned in recording [26]
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(SEG1_COMPONENTS),
    });

    const { components: result } = await identifyComponents(minimalConv, testConfig);

    // Exact match against recording [26]
    expect(result).toEqual(SEG1_COMPONENTS);
    expect(result.length).toBe(49);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("deduplicates components from AI", async () => {
    (generateText as any).mockResolvedValue({
      text: '["multi_dimension_componentisation", "dimension_data_model", "multi_dimension_componentisation"]',
    });
    const { components: result } = await identifyComponents(minimalConv, testConfig);
    expect(result).toEqual(["multi_dimension_componentisation", "dimension_data_model"]);
  });

  it("handles markdown-wrapped JSON", async () => {
    (generateText as any).mockResolvedValue({
      text: '```json\n' + JSON.stringify(SEG1_COMPONENTS.slice(0, 3)) + '\n```',
    });
    const { components: result } = await identifyComponents(minimalConv, testConfig);
    expect(result).toEqual(SEG1_COMPONENTS.slice(0, 3));
  });

  it("returns [] when AI returns no JSON array", async () => {
    (generateText as any).mockResolvedValue({ text: "I cannot identify components." });
    expect((await identifyComponents(minimalConv, testConfig)).components).toEqual([]);
  });

  it("returns [] on API error", async () => {
    (generateText as any).mockRejectedValue(new Error("rate limit"));
    expect((await identifyComponents(minimalConv, testConfig)).components).toEqual([]);
  });
});

describe("identifyForDimension", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls AI and returns discoveredComponents (recording [29] pattern)", async () => {
    (generateText as any).mockResolvedValue({ text: JSON.stringify(SEG1_COMPONENTS) });

    const dim: DimensionData = {
      name: "default", discoveredComponents: [], componentMapping: {},
      componentTimeline: [], componentColors: {},
    };

    const result = await identifyForDimension(minimalConv, dim, testConfig);
    expect(result.result.discoveredComponents).toEqual(SEG1_COMPONENTS);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("uses customComponents without AI call", async () => {
    const custom = SEG1_COMPONENTS.slice(0, 5);
    const dim: DimensionData = {
      name: "default", discoveredComponents: [], componentMapping: {},
      componentTimeline: [], componentColors: {},
      customComponents: custom,
    };

    const result = await identifyForDimension(minimalConv, dim, testConfig);
    expect(result.result.discoveredComponents).toEqual(custom);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("matches recording [90]: idempotent skip when custom === discovered", async () => {
    // Recording [90]: componentCount=12, hasCustomComponents=true → {result: {}}
    const comps = SEG1_COMPONENTS.slice(0, 12);
    const dim: DimensionData = {
      name: "default", discoveredComponents: comps, componentMapping: {},
      componentTimeline: [], componentColors: {},
      customComponents: comps,
    };

    const result = await identifyForDimension(minimalConv, dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("re-runs when customComponents differ from discovered", async () => {
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: ["old_a", "old_b"],
      componentMapping: {}, componentTimeline: [], componentColors: {},
      customComponents: ["new_a", "new_b"],
    };

    const result = await identifyForDimension(minimalConv, dim, testConfig);
    expect(result.result.discoveredComponents).toEqual(["new_a", "new_b"]);
  });

  it("returns error when no config", async () => {
    const dim: DimensionData = {
      name: "default", discoveredComponents: [], componentMapping: {},
      componentTimeline: [], componentColors: {},
    };
    const result = await identifyForDimension(minimalConv, dim, null);
    expect(result.error!.message).toBe("No API key configured");
    expect(result.result).toEqual({});
  });

  it("strips '- ' prefix from customComponents", async () => {
    const dim: DimensionData = {
      name: "default", discoveredComponents: [], componentMapping: {},
      componentTimeline: [], componentColors: {},
      customComponents: ["- multi_dimension_componentisation", "- dimension_data_model", "plain"],
    };
    const result = await identifyForDimension(minimalConv, dim, testConfig);
    expect(result.result.discoveredComponents).toEqual([
      "multi_dimension_componentisation", "dimension_data_model", "plain",
    ]);
  });
});
