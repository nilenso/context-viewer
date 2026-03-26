/**
 * Tests for runPipeline.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [5]  parse → parserName="Claude Code", 1 message
 *   [10] summary → exact ConversationSummary
 *   [13] staticComponentise → ["user.text"], token_count=2718
 *   [15] segmentConversation → 22 parts (4.1-4.22 in recording)
 *   [30] identifyComponents → 54 components (PC1_COLORS keys)
 *   [33] mapComponentsToIds → 22-entry mapping
 *   [35] assignComponentColors → PC1_COLORS
 *
 * The segmentation mock uses PC1_SEGMENTATION_PATTERNS — the 21 regex
 * lookaheads that produce exactly 22 parts from the real file content.
 * The classify mock builds a mapping dynamically using the actual part
 * IDs produced by segmentation (which differ from the recording's "4.X"
 * because the ID counter starts fresh in tests).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PC1_SEGMENTATION_PATTERNS,
  PC1_COLORS,
  SEG1_COMPONENTS,
  SEG1_COLORS,
} from "@/__tests__/recording-fixtures";
import { loadArtifact } from "@/__tests__/helpers";

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
import { runPipeline, type StoreAccessor } from "@/pipeline/pipeline";
import type { PipelineState } from "@/model/types";
import "@/parsers/index";

describe("runPipeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs full pipeline for post-compaction-1: parse → count → segment(22) → identify → classify → color", async () => {
    const { file } = loadArtifact("post-compaction-1.jsonl");

    const components = Object.keys(PC1_COLORS);

    // The classify mock needs to return a mapping keyed by whatever part IDs
    // segmentation produces. Since IDs are generated fresh (not "4.X" from the
    // recording), we build the mapping dynamically when classify is called.
    let classifyCallCount = 0;
    (generateText as any).mockImplementation(async (opts: any) => {
      const prompt: string = opts?.prompt || "";

      // Call 1: segmentation — return the real patterns from the recording
      // The prompt will contain the text of the large part
      if (prompt.includes("split") || prompt.includes("segment") || prompt.includes("break") || classifyCallCount === 0 && !prompt.includes("component")) {
        // First call is always segmentation for this file
        if (classifyCallCount === 0) {
          classifyCallCount++;
          return { text: JSON.stringify(PC1_SEGMENTATION_PATTERNS) };
        }
      }

      // Identify call: prompt asks to identify components in the conversation
      if (prompt.includes("identify") || prompt.includes("component") && !prompt.includes("partId")) {
        // Check if this looks like an identification prompt (has conversation JSON)
        if (prompt.includes('"role"') && prompt.includes('"parts"')) {
          return { text: JSON.stringify(components) };
        }
      }

      // Classify call: prompt contains parts with partId fields
      // Build mapping dynamically from the parts in the prompt
      if (prompt.includes("partId") || prompt.includes('"role"')) {
        try {
          // Extract part IDs from the prompt JSON
          const partIdMatches = prompt.match(/"partId"\s*:\s*"([^"]+)"/g);
          if (partIdMatches) {
            const mapping: Record<string, string> = {};
            for (const match of partIdMatches) {
              const id = match.match(/"partId"\s*:\s*"([^"]+)"/)?.[1];
              if (id) {
                // Assign components round-robin to simulate classification
                const compIdx = Object.keys(mapping).length % components.length;
                mapping[id] = components[compIdx]!;
              }
            }
            if (Object.keys(mapping).length > 0) {
              return { text: JSON.stringify(mapping) };
            }
          }
        } catch {}
      }

      // Color call: prompt asks to assign colors
      return { text: JSON.stringify(PC1_COLORS) };
    });

    const updates: Partial<PipelineState>[] = [];
    const notify = (id: string, update: Partial<PipelineState>) => updates.push(update);

    const ctx: PipelineState = {
      id: "test-1", filename: "post-compaction-1.jsonl", file,
      warnings: [], stepTimings: {},
    };

    await runPipeline(ctx, notify);

    // --- Parse assertions (recording [5]) ---
    expect(ctx.conversation).toBeDefined();
    expect(ctx.conversation!.messages.length).toBe(1);
    expect(ctx.metadata!.parserName).toBe("Claude Code");

    // --- Summary assertion (recording [10]) ---
    expect(ctx.summary).toEqual({
      totalMessages: 1, messagesByRole: { user: 1 },
      textOnlyMessageCount: 1, structuredContentMessageCount: 0,
      partCounts: { text: 1 },
    });

    // --- Static components assertion (recording [13]) ---
    expect(ctx.staticComponents).toEqual(["user.text"]);

    // --- Segmentation assertion (recording [15]) ---
    // After segmentation, the single message should have 22 parts
    expect(ctx.conversation!.messages[0]!.parts.length).toBe(22);
    // Part IDs should follow the parent.N pattern
    const partIds = ctx.conversation!.messages[0]!.parts.map((p: any) => p.id);
    const parentId = partIds[0]!.split(".")[0]; // whatever the counter assigned
    for (let i = 0; i < 22; i++) {
      expect(partIds[i]).toBe(`${parentId}.${i + 1}`);
    }

    // --- Dimension assertions (recordings [30], [33], [35]) ---
    expect(ctx.dimensions).toBeDefined();
    expect(ctx.dimensions!.default).toBeDefined();
    const dim = ctx.dimensions!.default!;

    // Identified components should be the PC1_COLORS keys
    expect(dim.discoveredComponents).toEqual(components);

    // Mapping should cover all 22 parts
    expect(Object.keys(dim.componentMapping).length).toBe(22);
    // Every mapping key should be a real part ID
    for (const partId of Object.keys(dim.componentMapping)) {
      expect(partIds).toContain(partId);
    }
    // Every mapping value should be one of the identified components
    for (const comp of Object.values(dim.componentMapping)) {
      expect(components).toContain(comp);
    }

    // Colors should match recording [35]
    expect(dim.componentColors).toEqual(PC1_COLORS);

    // Timeline should have 1 entry (1 message)
    expect(dim.componentTimeline.length).toBe(1);
    expect(dim.componentTimeline[0]!.totalTokens).toBeGreaterThan(0);

    // --- Stage ordering ---
    const steps = updates.map(u => u.step).filter(Boolean);
    expect(steps[0]).toBe("parsing");
    expect(steps).toContain("counting-tokens");
    expect(steps).toContain("segmenting");
    expect(steps).toContain("finding-components");

    // Final status
    const lastUpdate = updates[updates.length - 1]!;
    expect(lastUpdate.status).toBe("success");
  });

  it("skips pipeline for Context Viewer export files", async () => {
    const exportData = {
      id: "cv-1", filename: "test.jsonl",
      conversation: {
        messages: [{
          id: "m1", role: "user",
          parts: [{ id: "p1", type: "text", text: "Hello", component: "greeting" }],
        }],
      },
      colors: { greeting: "#ff0000" },
      summary: "A conversation.", analysis: null,
      metadata: { parserName: "Context Viewer" },
    };

    const file = new File([JSON.stringify(exportData)], "export.json");
    const ctx: PipelineState = {
      id: "test-2", filename: "export.json", file,
      warnings: [], stepTimings: {},
    };

    await runPipeline(ctx, vi.fn());

    expect(generateText).not.toHaveBeenCalled();
    expect(ctx.dimensions!.default!.componentColors).toEqual({ greeting: "#ff0000" });
    expect(ctx.dimensions!.default!.discoveredComponents).toContain("greeting");
  });

  it("does nothing when no targets for applyPromptsToAll", async () => {
    const { applyPromptsToAll } = await import("@/pipeline/pipeline");
    const source: PipelineState = {
      id: "1", filename: "s.jsonl", status: "success",
      conversation: { messages: [] }, dimensions: {},
      warnings: [], stepTimings: {},
    };

    const store: StoreAccessor = {
      getState: () => ({ conversations: [source], groups: {}, pendingSessionImport: null }),
      updateConversation: vi.fn(), updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(), appendAnalysisChunk: vi.fn(), set: vi.fn(),
    };

    await applyPromptsToAll(store, "1");
    expect(generateText).not.toHaveBeenCalled();
  });
});
