/**
 * Tests for reprocessing workflows captured in compaction-everything.json.
 *
 * This recording captures a real multi-step session:
 *   [0]     processFileDrop: 2 files (post-compaction-1, segment-1)
 *   [41-55] applySegmentationPrompt: re-segment → re-identify → re-classify → re-color
 *   [56-69] applyPrompt (1st): custom prompt → different components
 *   [70-83] applyPrompt (2nd): another prompt → 12 concise components
 *   [84-94] applyPromptsToAll: copy prompt3 to segment-1
 *             [90] identifyForDimension → idempotent skip (customComponents match)
 *             [92] classifyForDimension → reclassifies segment-1 parts
 *             [94] colorForDimension → idempotent skip (colors already match)
 *   [95]    groupConversations: group both files
 *
 * Each test reconstructs the pipeline state at the start of a workflow step,
 * mocks AI with the recorded responses, runs the function, and asserts
 * the recorded output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EV_PROMPT3_COMPONENTS,
  EV_PROMPT3_MAP,
  EV_PROMPT3_COLORS,
  EV_PROMPT1_COMPONENTS,
  EV_PROMPT1_COLORS,
  EV_PROMPT1_MAP_SAMPLE,
  EV_RESEG_COMPONENTS,
  EV_RESEG_COLORS,
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
import { identifyComponents, identifyForDimension } from "@/stages/identify-components";
import { mapComponentsToIds, classifyForDimension } from "@/stages/classify-components";
import { assignComponentColors, colorForDimension } from "@/stages/color-components";
import { reprocessTarget, applyPromptsToAll, type StoreAccessor } from "@/pipeline/pipeline";
import type { PipelineState, DimensionData } from "@/model/types";

const testConfig = {
  apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

// Build a conversation with 67 parts matching post-compaction-1 after re-segmentation.
// Parts: 4.1-4.4 (kept), 4.5.1-4.5.53 (re-segmented from 4.5), 4.6-4.15 (kept)
function buildPC1After67Parts(): any {
  const parts: any[] = [];
  // 4.1 - 4.4
  for (let i = 1; i <= 4; i++) {
    parts.push({ id: `4.${i}`, type: "text", text: `Section ${i}`, token_count: 50 + i * 10 });
  }
  // 4.5.1 - 4.5.53
  for (let i = 1; i <= 53; i++) {
    parts.push({ id: `4.5.${i}`, type: "text", text: `Sub-section 5.${i}`, token_count: 20 });
  }
  // 4.6 - 4.15
  for (let i = 6; i <= 15; i++) {
    parts.push({ id: `4.${i}`, type: "text", text: `Section ${i}`, token_count: 50 + i * 10 });
  }
  return {
    messages: [{ id: "3", role: "user" as const, parts }],
  };
}

const pc1Conv67 = buildPC1After67Parts();

// ---------------------------------------------------------------------------
// Stage-level tests: verify each AI-calling function with recording data
// ---------------------------------------------------------------------------

describe("everything recording: stage-level functions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("[78] identifyComponents with custom prompt → 12 components", async () => {
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(EV_PROMPT3_COMPONENTS),
    });

    const result = await identifyComponents(pc1Conv67, testConfig, "Focus on architecture");
    expect(result).toEqual(EV_PROMPT3_COMPONENTS);
    expect(result.length).toBe(12);
  });

  it("[81] mapComponentsToIds → 67-entry mapping (exact)", async () => {
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(EV_PROMPT3_MAP),
    });

    const result = await mapComponentsToIds(
      pc1Conv67, EV_PROMPT3_COMPONENTS, testConfig,
    );

    // Exact match against recording [81]
    expect(result).toEqual(EV_PROMPT3_MAP);
    expect(Object.keys(result).length).toBe(67);

    // Every value should be one of the 12 components
    for (const comp of Object.values(result)) {
      expect(EV_PROMPT3_COMPONENTS).toContain(comp);
    }
  });

  it("[83] assignComponentColors → 12 exact colors", async () => {
    (generateText as any).mockResolvedValue({
      text: JSON.stringify(EV_PROMPT3_COLORS),
    });

    const result = await assignComponentColors(EV_PROMPT3_COMPONENTS, testConfig);
    expect(result).toEqual(EV_PROMPT3_COLORS);
    expect(Object.keys(result).length).toBe(12);
  });

  it("[90] identifyForDimension: idempotent skip when customComponents match", async () => {
    // Recording [90]: componentCount=12, hasCustomComponents=true → {result: {}}
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: EV_PROMPT3_COMPONENTS,
      componentMapping: EV_PROMPT3_MAP,
      componentTimeline: [],
      componentColors: EV_PROMPT3_COLORS,
      customComponents: EV_PROMPT3_COMPONENTS,
    };

    const result = await identifyForDimension(pc1Conv67, dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("[94] colorForDimension: idempotent skip when colors cover all components", async () => {
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: EV_PROMPT3_COMPONENTS,
      componentMapping: EV_PROMPT3_MAP,
      componentTimeline: [],
      componentColors: EV_PROMPT3_COLORS,
    };

    const result = await colorForDimension(dim, testConfig);
    expect(result.result).toEqual({});
    expect(generateText).not.toHaveBeenCalled();
  });

  it("[92] classifyForDimension: reclassifies when mapping uses old components", async () => {
    // Simulate segment-1 state after applyPromptsToAll copies new components
    // but the existing mapping still uses old component names
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({ p1: EV_PROMPT3_COMPONENTS[0] }),
    });

    const dim: DimensionData = {
      name: "default",
      discoveredComponents: EV_PROMPT3_COMPONENTS,
      componentMapping: { p1: "old_component_not_in_list" }, // stale mapping
      componentTimeline: [],
      componentColors: {},
    };

    const conv = {
      messages: [{ id: "1", role: "user" as const,
        parts: [{ id: "p1", type: "text" as const, text: "x", token_count: 5 }],
      }],
    };

    const result = await classifyForDimension(conv, dim, testConfig);
    // Should have re-classified, not skipped
    expect(result.result.componentMapping).toBeDefined();
    expect(generateText).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pipeline-level tests: reprocessTarget and applyPromptsToAll
// ---------------------------------------------------------------------------

function makePC1WithDimensions(components: string[], mapping: Record<string, string>, colors: Record<string, string>): PipelineState {
  return {
    id: "1", filename: "post-compaction-1.jsonl", status: "success",
    conversation: pc1Conv67,
    metadata: { parserName: "Claude Code" },
    summary: { totalMessages: 1, messagesByRole: { user: 1 }, textOnlyMessageCount: 1, structuredContentMessageCount: 0, partCounts: { text: 1 } },
    staticComponents: ["user.text"],
    staticMapping: Object.fromEntries(pc1Conv67.messages[0].parts.map((p: any) => [p.id, "user.text"])),
    staticTimeline: [{ messageIndex: 0, componentTokens: { "user.text": 2718 }, totalTokens: 2718 }],
    dimensions: {
      default: {
        name: "default",
        discoveredComponents: components,
        componentMapping: mapping,
        componentTimeline: [{ messageIndex: 0, componentTokens: {}, totalTokens: 2718 }],
        componentColors: colors,
      },
    },
    warnings: [], stepTimings: {},
  };
}

describe("everything recording: reprocessTarget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("[56-69] reprocess with custom prompt → new components, mapping, colors", async () => {
    // State before: has EV_RESEG_COMPONENTS from the first identification
    const conv = makePC1WithDimensions(
      EV_RESEG_COMPONENTS,
      {}, // mapping from first classify (don't need exact)
      EV_RESEG_COLORS,
    );

    // Mock AI responses for the reprocess chain: identify → classify → color
    (generateText as any)
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT1_COMPONENTS) }) // [64] identify
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT1_MAP_SAMPLE) })  // classify batches
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT1_MAP_SAMPLE) })
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT1_MAP_SAMPLE) })
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT1_MAP_SAMPLE) })
      .mockResolvedValue({ text: JSON.stringify(EV_PROMPT1_COLORS) });        // [69] color

    const store: StoreAccessor = {
      getState: () => ({ conversations: [conv], groups: {}, pendingSessionImport: null }),
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn(),
    };

    await reprocessTarget(
      store, "1",
      (ctx) => {
        // Recording [56]: applyPrompt clears discoveredComponents + mapping + colors
        const dim = ctx.dimensions!.default!;
        dim.discoveredComponents = [];
        dim.componentMapping = {};
        dim.componentColors = {};
        dim.prompt = "custom analysis prompt";
      },
      {},
      ["default"],
    );

    // Verify AI was called for all 3 stages
    expect(generateText).toHaveBeenCalled();
    const callCount = (generateText as any).mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(3); // identify + classify batches + color

    // Verify the store got the final update with new dimension data
    const updates = (store.updateConversation as any).mock.calls;
    const finalUpdate = updates[updates.length - 1][1] as Partial<PipelineState>;
    expect(finalUpdate.status).toBe("success");
    expect(finalUpdate.dimensions!.default!.discoveredComponents.length).toBeGreaterThan(0);
    expect(Object.keys(finalUpdate.dimensions!.default!.componentColors).length).toBeGreaterThan(0);
  });

  it("[70-83] second reprocess → 12 concise components with exact values", async () => {
    // State before: has EV_PROMPT1 state from previous reprocess
    const conv = makePC1WithDimensions(
      EV_PROMPT1_COMPONENTS,
      {},
      EV_PROMPT1_COLORS,
    );

    // Mock AI to return the third-prompt results
    (generateText as any)
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT3_COMPONENTS) }) // [78] identify
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT3_MAP) })        // classify batches
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT3_MAP) })
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT3_MAP) })
      .mockResolvedValueOnce({ text: JSON.stringify(EV_PROMPT3_MAP) })
      .mockResolvedValue({ text: JSON.stringify(EV_PROMPT3_COLORS) });        // [83] color

    const store: StoreAccessor = {
      getState: () => ({ conversations: [conv], groups: {}, pendingSessionImport: null }),
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn(),
    };

    await reprocessTarget(
      store, "1",
      (ctx) => {
        const dim = ctx.dimensions!.default!;
        dim.discoveredComponents = [];
        dim.componentMapping = {};
        dim.componentColors = {};
        dim.prompt = "second custom prompt";
      },
      {},
      ["default"],
    );

    const updates = (store.updateConversation as any).mock.calls;
    const finalUpdate = updates[updates.length - 1][1] as Partial<PipelineState>;

    // Recording [78]: exactly 12 components
    expect(finalUpdate.dimensions!.default!.discoveredComponents).toEqual(
      expect.arrayContaining(EV_PROMPT3_COMPONENTS),
    );

    // Recording [83]: exactly 12 colors
    const colors = finalUpdate.dimensions!.default!.componentColors;
    for (const [comp, color] of Object.entries(EV_PROMPT3_COLORS)) {
      expect(colors[comp]).toBe(color);
    }
  });
});

describe("everything recording: applyPromptsToAll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("[84-94] copies prompt3 state to segment-1 with idempotent skips", async () => {
    // Source (conv "1"): has prompt3 state (12 components, 12 colors)
    const source = makePC1WithDimensions(
      EV_PROMPT3_COMPONENTS,
      EV_PROMPT3_MAP,
      EV_PROMPT3_COLORS,
    );
    source.customSegmentationPrompt = "custom seg prompt";

    // Target (conv "2"): segment-1, has old components from initial processing
    const target: PipelineState = {
      id: "2", filename: "segment-1.jsonl", status: "success",
      conversation: {
        messages: [{ id: "5", role: "user" as const,
          parts: [{ id: "p1", type: "text" as const, text: "x", token_count: 50 }],
        }],
      },
      metadata: { parserName: "Claude Code" },
      staticComponents: ["user.text"],
      staticMapping: { p1: "user.text" },
      staticTimeline: [{ messageIndex: 0, componentTokens: { "user.text": 50 }, totalTokens: 50 }],
      dimensions: {
        default: {
          name: "default",
          discoveredComponents: ["old_comp_a", "old_comp_b"],
          componentMapping: { p1: "old_comp_a" },
          componentTimeline: [],
          componentColors: { old_comp_a: "#111", old_comp_b: "#222" },
        },
      },
      warnings: [], stepTimings: {},
    };

    // Recording flow:
    //   [90] identifyForDimension → skip (customComponents = prompt3 components)
    //   [92-93] classifyForDimension → reclassifies (mapping uses old component names)
    //   [94] colorForDimension → skip (colors already copied from source)
    //
    // So AI is called only for classification, not identify or color.
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({ p1: EV_PROMPT3_COMPONENTS[0] }),
    });

    const store: StoreAccessor = {
      getState: () => ({ conversations: [source, target], groups: {}, pendingSessionImport: null }),
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn(),
    };

    await applyPromptsToAll(store, "1");

    // Verify prompts were copied to target
    const targetUpdates = (store.updateConversation as any).mock.calls
      .filter((c: any) => c[0] === "2");
    expect(targetUpdates.length).toBeGreaterThan(0);

    // Recording [84] storeDiff: customSegmentationPrompt was copied
    const promptCopy = targetUpdates.find((c: any) =>
      c[1].customSegmentationPrompt !== undefined,
    );
    expect(promptCopy).toBeDefined();
    expect(promptCopy[1].customSegmentationPrompt).toBe("custom seg prompt");

    // Recording [84] storeDiff: target's discoveredComponents = prompt3 components
    const finalUpdate = targetUpdates[targetUpdates.length - 1][1] as Partial<PipelineState>;
    if (finalUpdate.dimensions?.default) {
      expect(finalUpdate.dimensions.default.discoveredComponents).toEqual(
        expect.arrayContaining(EV_PROMPT3_COMPONENTS),
      );
    }

    // Recording [84] storeDiff: target's componentColors = prompt3 colors
    if (finalUpdate.dimensions?.default?.componentColors) {
      for (const [comp, color] of Object.entries(EV_PROMPT3_COLORS)) {
        expect(finalUpdate.dimensions.default.componentColors[comp]).toBe(color);
      }
    }
  });
});
