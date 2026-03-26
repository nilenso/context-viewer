/**
 * Tests for mapComponentsToIds, classifyForDimension, buildComponentTimeline.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [33] mapComponentsToIds(post-compaction-1, 22 parts) → PC1_MAP_COMPONENTS_RESULT (exact)
 *   [32] classifyForDimension(default, 51 components) → mapping + timeline + added "other"
 *   [38] mapComponentsToIds(segment-1, 338 msgs) → 460 entries (first 10 in SEG1_MAP_FIRST_ENTRIES)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PC1_MAP_COMPONENTS_RESULT,
  SEG1_COMPONENTS,
  SEG1_MAP_FIRST_ENTRIES,
} from "@/__tests__/recording-fixtures";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@/stages/ai/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/stages/ai/config")>();
  return {
    ...mod,
    hasApiKey: () => true,
    getAIConfig: () => ({
      apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
      apiMode: "responses" as const, reasoningEffort: undefined,
    }),
    createModel: () => ({}),
    getProviderOptions: () => undefined,
  };
});

import { generateText } from "ai";
import {
  mapComponentsToIds,
  classifyForDimension,
  buildComponentTimeline,
} from "@/stages/classify-components";
import type { DimensionData } from "@/model/types";

const testConfig = {
  apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

// A 22-part conversation matching post-compaction-1 after segmentation
// Part IDs match recording [33] keys: 4.1 through 4.22
const pc1Conversation = {
  messages: [
    {
      id: "3",
      role: "user" as const,
      parts: Array.from({ length: 22 }, (_, i) => ({
        id: `4.${i + 1}`,
        type: "text" as const,
        text: `Section ${i + 1} content`,
        token_count: 50 + i * 10,
      })),
    },
  ],
};

describe("mapComponentsToIds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches recording [33]: maps 22 parts to components", async () => {
    // Mock AI to return exactly what recording [33] captured
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(PC1_MAP_COMPONENTS_RESULT),
    });

    const components = [...new Set(Object.values(PC1_MAP_COMPONENTS_RESULT))];
    const result = await mapComponentsToIds(pc1Conversation, components, testConfig);

    // Exact match against recording [33]
    expect(result).toEqual(PC1_MAP_COMPONENTS_RESULT);
    expect(Object.keys(result).length).toBe(22);
    // 22 parts < batch size 20... actually 22 > 20, so 2 batches
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("merges multiple batch results", async () => {
    // 25 parts → 2 batches (20 + 5)
    const largeParts = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`, type: "text" as const, text: `Part ${i}`, token_count: 5,
    }));
    const conv = { messages: [{ id: "1", role: "user" as const, parts: largeParts }] };

    const batch1 = Object.fromEntries(largeParts.slice(0, 20).map(p => [p.id, "comp_a"]));
    const batch2 = Object.fromEntries(largeParts.slice(20).map(p => [p.id, "comp_b"]));

    (generateText as any)
      .mockResolvedValueOnce({ text: JSON.stringify(batch1) })
      .mockResolvedValueOnce({ text: JSON.stringify(batch2) });

    const result = await mapComponentsToIds(conv, ["comp_a", "comp_b"], testConfig);
    expect(Object.keys(result).length).toBe(25);
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("returns {} on invalid AI response", async () => {
    (generateText as any).mockResolvedValue({ text: "No valid JSON here" });
    const result = await mapComponentsToIds(pc1Conversation, ["a"], testConfig);
    expect(result).toEqual({});
  });
});

describe("buildComponentTimeline", () => {
  it("builds cumulative timeline from recording [33] mapping", () => {
    const timeline = buildComponentTimeline(pc1Conversation, PC1_MAP_COMPONENTS_RESULT);

    // 1 message → 1 timeline entry
    expect(timeline.length).toBe(1);
    expect(timeline[0]!.messageIndex).toBe(0);

    // All 22 parts should contribute tokens
    const totalFromParts = pc1Conversation.messages[0]!.parts.reduce(
      (sum, p) => sum + p.token_count, 0,
    );
    expect(timeline[0]!.totalTokens).toBe(totalFromParts);

    // Component token sums should equal total
    const componentSum = Object.values(timeline[0]!.componentTokens).reduce(
      (sum, v) => sum + v, 0,
    );
    expect(componentSum).toBe(totalFromParts);
  });

  it("produces cumulative totals across messages", () => {
    const conv = {
      messages: [
        { id: "1", role: "user" as const, parts: [{ id: "p1", type: "text" as const, text: "a", token_count: 10 }] },
        { id: "2", role: "assistant" as const, parts: [{ id: "p2", type: "text" as const, text: "b", token_count: 20 }] },
      ],
    };
    const mapping = { p1: "comp_a", p2: "comp_b" };
    const timeline = buildComponentTimeline(conv, mapping);

    expect(timeline.length).toBe(2);
    expect(timeline[0]!.totalTokens).toBe(10);
    expect(timeline[1]!.totalTokens).toBe(30);
    expect(timeline[1]!.componentTokens).toEqual({ comp_a: 10, comp_b: 20 });
  });
});

describe("classifyForDimension", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips when no discoveredComponents", async () => {
    const dim: DimensionData = {
      name: "default", discoveredComponents: [], componentMapping: {},
      componentTimeline: [], componentColors: {},
    };
    const result = await classifyForDimension(pc1Conversation, dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("skips when mapping already covers all parts (idempotent)", async () => {
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: [...new Set(Object.values(PC1_MAP_COMPONENTS_RESULT))],
      componentMapping: PC1_MAP_COMPONENTS_RESULT,
      componentTimeline: [], componentColors: {},
    };
    const result = await classifyForDimension(pc1Conversation, dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("classifies and adds 'other' when not all parts mapped", async () => {
    // AI only maps some parts
    const partialMapping = { "4.1": SEG1_COMPONENTS[0]! };
    (generateText as any).mockResolvedValue({ text: JSON.stringify(partialMapping) });

    const dim: DimensionData = {
      name: "default",
      discoveredComponents: [SEG1_COMPONENTS[0]!],
      componentMapping: {}, componentTimeline: [], componentColors: {},
    };

    const result = await classifyForDimension(pc1Conversation, dim, testConfig);

    // Should add "other" since not all 22 parts are mapped
    expect(result.result.discoveredComponents).toContain("other");
    expect(result.result.componentMapping).toBeDefined();
    expect(result.result.componentTimeline).toBeDefined();
    expect(result.result.componentTimeline!.length).toBe(1); // 1 message
  });

  it("classifies with full mapping (recording [33] pattern)", async () => {
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(PC1_MAP_COMPONENTS_RESULT),
    });

    const components = [...new Set(Object.values(PC1_MAP_COMPONENTS_RESULT))];
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: components,
      componentMapping: {}, componentTimeline: [], componentColors: {},
    };

    const result = await classifyForDimension(pc1Conversation, dim, testConfig);

    expect(result.result.componentMapping).toEqual(PC1_MAP_COMPONENTS_RESULT);
    expect(result.result.componentTimeline!.length).toBe(1);
    // All 22 parts mapped → no "other" needed
    expect(result.result.discoveredComponents).toEqual(components);
  });
});
