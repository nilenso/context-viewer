/**
 * Tests for generateConversationSummary and runSummary pipeline wrapper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { streamText } from "ai";
import { generateConversationSummary, runSummary } from "@/stages/summarize";
import type { PipelineState } from "@/model/types";

const conv = {
  messages: [
    { id: "1", role: "user" as const, parts: [{ id: "p1", type: "text" as const, text: "Explain X" }], timestamp: "2026-03-01T10:00:00Z" },
    { id: "2", role: "assistant" as const, parts: [{ id: "p2", type: "text" as const, text: "X is..." }], timestamp: "2026-03-01T10:05:00Z" },
  ],
};

describe("generateConversationSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("streams chunks and returns concatenated summary", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () {
        yield "This conversation ";
        yield "discusses X.";
      })(),
    });

    const chunks: string[] = [];
    const result = await generateConversationSummary(conv, (c) => chunks.push(c));

    expect(result.summary).toBe("This conversation discusses X.");
    expect(result.error).toBeUndefined();
    expect(chunks).toEqual(["This conversation ", "discusses X."]);
    expect(streamText).toHaveBeenCalledOnce();
  });

  it("works without onChunk callback", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () { yield "Summary."; })(),
    });
    const result = await generateConversationSummary(conv);
    expect(result.summary).toBe("Summary.");
  });

  it("returns error on stream failure", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () { throw new Error("Stream died"); })(),
    });
    const result = await generateConversationSummary(conv);
    expect(result.summary).toBe("");
    expect(result.error).toContain("Stream died");
  });
});

describe("runSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates ctx.aiSummary and stepTimings", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () { yield "The summary."; })(),
    });

    const ctx: PipelineState = {
      id: "test-1", filename: "test.jsonl",
      conversation: conv,
      metadata: { parserName: "Claude Code" },
      warnings: [], stepTimings: {},
    };

    const chunks: string[] = [];
    await runSummary(ctx, vi.fn(), {
      onSummaryChunk: (_id, chunk) => chunks.push(chunk),
    });

    expect(ctx.aiSummary).toBe("The summary.");
    expect(ctx.stepTimings!.summarizing).toBeDefined();
    expect(chunks).toEqual(["The summary."]);
  });

  it("pushes error to warnings on failure", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () { throw new Error("API down"); })(),
    });

    const ctx: PipelineState = {
      id: "test-1", filename: "test.jsonl",
      conversation: conv,
      warnings: [], stepTimings: {},
    };

    await runSummary(ctx, vi.fn(), {});

    expect(ctx.aiSummary).toBe("");
    expect(ctx.warnings!.length).toBe(1);
    expect(ctx.warnings![0]).toContain("API down");
  });
});
