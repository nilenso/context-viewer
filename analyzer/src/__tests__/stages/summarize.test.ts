/**
 * Tests for generateConversationSummary and runSummary pipeline wrapper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
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
import type { AIConfig } from "../../config";
import { generateConversationSummary, runSummary } from "../../stages/summarize";
import type { PipelineState } from "../../model/types";

const testConfig: AIConfig = {
  apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

const conv = {
  messages: [
    { id: "1", role: "user" as const, parts: [{ id: "p1", type: "text" as const, text: "Explain X" }], timestamp: "2026-03-01T10:00:00Z" },
    { id: "2", role: "assistant" as const, parts: [{ id: "p2", type: "text" as const, text: "X is..." }], timestamp: "2026-03-01T10:05:00Z" },
  ],
};

describe("generateConversationSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns concatenated summary", async () => {
    (generateText as any).mockResolvedValue({
      text: "This conversation discusses X.",
    });

    const result = await generateConversationSummary(conv, testConfig);

    expect(result.summary).toBe("This conversation discusses X.");
    expect(result.error).toBeUndefined();
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("works with custom prompt", async () => {
    (generateText as any).mockResolvedValue({ text: "Summary." });
    const result = await generateConversationSummary(conv, testConfig, "Custom prompt");
    expect(result.summary).toBe("Summary.");
  });

  it("returns error on AI failure", async () => {
    (generateText as any).mockRejectedValue(new Error("Stream died"));
    const result = await generateConversationSummary(conv, testConfig);
    expect(result.summary).toBe("");
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("Stream died");
  });
});

describe("runSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates ctx.aiSummary", async () => {
    (generateText as any).mockResolvedValue({ text: "The summary." });

    const ctx: PipelineState = {
      id: "test-1", filename: "test.jsonl",
      conversation: conv,
      metadata: { parserName: "Claude Code" },
      warnings: [], stepTimings: {},
    };

    await runSummary(ctx, testConfig);

    expect(ctx.aiSummary).toBe("The summary.");
  });

  it("pushes error to warnings on failure", async () => {
    (generateText as any).mockRejectedValue(new Error("API down"));

    const ctx: PipelineState = {
      id: "test-1", filename: "test.jsonl",
      conversation: conv,
      warnings: [], stepTimings: {},
    };

    await runSummary(ctx, testConfig);

    expect(ctx.aiSummary).toBe("");
    expect(ctx.warnings!.length).toBe(1);
    expect(ctx.warnings![0]).toContain("API down");
  });
});
