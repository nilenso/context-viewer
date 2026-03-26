/**
 * Tests for runPipelines, runPipelineMutation, and resumePipelinesWithApiKey.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [2] runPipelineMutation(2 files) → storeDiff.conversations.added: 2 items
 *       conv 1: status=success, messageCount=1, totalParts=22, parserName="Claude Code"
 *       conv 2: status=success, messageCount=338, totalParts=460, parserName="Claude Code"
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
import {
  runPipelines,
  runPipelineMutation,
  resumePipelinesWithApiKey,
  type StoreAccessor,
} from "@/pipeline/pipeline";
import type { PipelineState } from "@/model/types";
import "@/parsers/index";

// A mock that returns sensible defaults for any AI call
function setupGenericAIMock() {
  (generateText as any).mockImplementation(async (opts: any) => {
    const prompt: string = opts?.prompt || "";

    // Segmentation: return patterns if prompt is about splitting
    if (prompt.length < 50000) {
      // Identify: return a small component list
      if (prompt.includes('"role"') && prompt.includes('"parts"') && !prompt.includes("partId")) {
        return { text: JSON.stringify(["comp_a", "comp_b", "comp_c"]) };
      }
    }

    // Classify: extract partIds and map them
    const partIdMatches = prompt.match(/"partId"\s*:\s*"([^"]+)"/g);
    if (partIdMatches) {
      const mapping: Record<string, string> = {};
      for (const match of partIdMatches) {
        const id = match.match(/"partId"\s*:\s*"([^"]+)"/)?.[1];
        if (id) mapping[id] = "comp_a";
      }
      if (Object.keys(mapping).length > 0) return { text: JSON.stringify(mapping) };
    }

    // Color
    return { text: JSON.stringify({ comp_a: "#ff0000", comp_b: "#00ff00", comp_c: "#0000ff" }) };
  });
}

describe("runPipelines", () => {
  beforeEach(() => vi.clearAllMocks());

  it("processes multiple files in parallel and returns results (recording [2] pattern)", async () => {
    setupGenericAIMock();

    const f1 = loadArtifact("post-compaction-1.jsonl").file;

    const fileIds = new Map<number, string>();
    fileIds.set(0, "1");

    const completions: PipelineState[] = [];
    const result = await runPipelines(
      [f1],
      fileIds,
      (conv) => completions.push(conv),
      () => {},
      () => {},
    );

    // Recording [2]: produces PipelineState with status=success
    expect(result.pipelineStates.length).toBe(1);
    const state = result.pipelineStates[0]!;
    expect(state.id).toBe("1");
    expect(state.filename).toBe("post-compaction-1.jsonl");
    expect(state.conversation).toBeDefined();

    // Recording [2]: messageCount=1, parserName="Claude Code"
    expect(state.conversation!.messages.length).toBe(1);
    expect(state.metadata!.parserName).toBe("Claude Code");

    // Recording [2]: summary matches
    expect(state.summary!.totalMessages).toBe(1);

    // Recording [2]: staticComponents = ["user.text"]
    expect(state.staticComponents).toEqual(["user.text"]);

    // Recording [2]: dimensions populated
    expect(state.dimensions).toBeDefined();
    expect(state.dimensions!.default).toBeDefined();

    // file and config are stripped from result
    expect(state.file).toBeUndefined();
    expect(state.config).toBeUndefined();

    // onFileComplete was called during processing
    expect(completions.length).toBeGreaterThan(0);
  });

  it("passes preset options through to pipeline", async () => {
    setupGenericAIMock();

    const f1 = loadArtifact("post-compaction-1.jsonl").file;
    const fileIds = new Map([[0, "1"]]);

    const result = await runPipelines(
      [f1], fileIds, () => {}, () => {}, () => {},
      {
        customComponents: ["X", "Y"],
        presetColors: { X: "#aaa", Y: "#bbb" },
        customPrompt: "Use these components",
      },
    );

    const state = result.pipelineStates[0]!;
    expect(state.dimensions!.default).toBeDefined();
    // customComponents should have been used (identify skips AI when customComponents set)
    expect(state.dimensions!.default!.discoveredComponents).toEqual(["X", "Y"]);
  });
});

describe("runPipelineMutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates placeholders then populates them (recording [2] pattern)", async () => {
    setupGenericAIMock();

    const f1 = loadArtifact("post-compaction-1.jsonl").file;

    let storeState: any = { conversations: [], groups: {}, pendingSessionImport: null };
    const store: StoreAccessor = {
      getState: () => storeState,
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn((updater) => {
        if (typeof updater === "function") {
          storeState = { ...storeState, ...updater(storeState) };
        } else {
          storeState = { ...storeState, ...updater };
        }
      }),
    };

    await runPipelineMutation(store, [f1], undefined);

    // Recording [2]: store.set was called to create placeholders
    const setCalls = (store.set as any).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);

    // First set call creates placeholders with status "pending"
    const firstSetArg = setCalls[0]![0];
    if (typeof firstSetArg === "function") {
      const result = firstSetArg({ conversations: [], fileIdsRef: new Map() });
      expect(result.conversations.length).toBe(1);
      expect(result.conversations[0].status).toBe("pending");
      expect(result.conversations[0].filename).toBe("post-compaction-1.jsonl");
    }

    // After processing completes, fileIdsRef is cleared
    // (last set call should clear it)
    const lastSetArg = setCalls[setCalls.length - 1]![0];
    if (typeof lastSetArg === "object" && "fileIdsRef" in lastSetArg) {
      expect(lastSetArg.fileIdsRef.size).toBe(0);
    }
  });

  it("uses presetIds when provided", async () => {
    setupGenericAIMock();

    const f1 = loadArtifact("post-compaction-1.jsonl").file;
    const presetIds = new Map([[0, "preset-id-1"]]);

    let storeState: any = { conversations: [], groups: {}, pendingSessionImport: null };
    const store: StoreAccessor = {
      getState: () => storeState,
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn((updater) => {
        if (typeof updater === "function") {
          storeState = { ...storeState, ...updater(storeState) };
        } else {
          storeState = { ...storeState, ...updater };
        }
      }),
    };

    await runPipelineMutation(store, [f1], presetIds);

    // The placeholder should use the preset ID
    const firstSetArg = (store.set as any).mock.calls[0]![0];
    if (typeof firstSetArg === "function") {
      const result = firstSetArg({ conversations: [], fileIdsRef: new Map() });
      expect(result.conversations[0].id).toBe("preset-id-1");
    }
  });
});

describe("resumePipelinesWithApiKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes paused conversations", async () => {
    setupGenericAIMock();

    const pausedConv: PipelineState = {
      id: "paused-1", filename: "test.jsonl",
      status: "paused-for-api-key",
      conversation: {
        messages: [{ id: "1", role: "user" as const,
          parts: [{ id: "p1", type: "text" as const, text: "Hello", token_count: 5 }],
        }],
      },
      metadata: { parserName: "Claude Code" },
      staticComponents: ["user.text"],
      staticMapping: { p1: "user.text" },
      staticTimeline: [{ messageIndex: 0, componentTokens: { "user.text": 5 }, totalTokens: 5 }],
      warnings: [], stepTimings: {},
    };

    const store: StoreAccessor = {
      getState: () => ({ conversations: [pausedConv], groups: {}, pendingSessionImport: null }),
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn(),
    };

    resumePipelinesWithApiKey(store);

    // Should trigger pipeline for the paused conversation
    // (async — updateConversation will be called as pipeline progresses)
    // Wait for the async pipeline to complete
    await new Promise(r => setTimeout(r, 100));
    expect(store.updateConversation).toHaveBeenCalled();
  });

  it("skips non-paused conversations", () => {
    const store: StoreAccessor = {
      getState: () => ({
        conversations: [
          { id: "1", filename: "a.jsonl", status: "success", conversation: { messages: [] } } as PipelineState,
          { id: "2", filename: "b.jsonl", status: "failed" } as PipelineState,
        ],
        groups: {},
        pendingSessionImport: null,
      }),
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn(),
    };

    resumePipelinesWithApiKey(store);
    // No paused conversations → no pipeline runs → no updates
    expect(store.updateConversation).not.toHaveBeenCalled();
  });
});
