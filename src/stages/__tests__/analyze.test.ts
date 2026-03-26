/**
 * Tests for generateContextAnalysis, runAnalysis, runEnsureSummaryThenAnalysis,
 * and regenerateAnalysisIfNeeded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EV_PROMPT3_COMPONENTS, EV_PROMPT3_COLORS } from "@/__tests__/recording-fixtures";

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
import {
  generateContextAnalysis,
  runAnalysis,
  runEnsureSummaryThenAnalysis,
  regenerateAnalysisIfNeeded,
} from "@/stages/analyze";
import type { PipelineState } from "@/model/types";

const conv = {
  messages: [
    { id: "1", role: "user" as const, parts: [{ id: "p1", type: "text" as const, text: "Hi", token_count: 5 }] },
  ],
};

const timeline = [{ messageIndex: 0, componentTokens: { comp_a: 5 }, totalTokens: 5 }];

function makeCtx(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    id: "test-1", filename: "test.jsonl",
    conversation: conv,
    aiSummary: "A conversation summary.",
    dimensions: {
      default: {
        name: "default",
        discoveredComponents: EV_PROMPT3_COMPONENTS,
        componentMapping: { p1: EV_PROMPT3_COMPONENTS[0]! },
        componentTimeline: timeline,
        componentColors: EV_PROMPT3_COLORS,
      },
    },
    warnings: [], stepTimings: {},
    ...overrides,
  };
}

function mockStream(text: string) {
  (streamText as any).mockReturnValue({
    textStream: (async function* () { yield text; })(),
  });
}

describe("generateContextAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("streams analysis chunks and returns full text", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () {
        yield "The context usage ";
        yield "is dominated by comp_a.";
      })(),
    });

    const chunks: string[] = [];
    const result = await generateContextAnalysis(
      conv, timeline, EV_PROMPT3_COMPONENTS.slice(0, 3), "A summary.",
      (c) => chunks.push(c),
    );

    expect(result.analysis).toBe("The context usage is dominated by comp_a.");
    expect(result.error).toBeUndefined();
    expect(chunks).toEqual(["The context usage ", "is dominated by comp_a."]);
  });

  it("returns error on failure", async () => {
    (streamText as any).mockReturnValue({
      textStream: (async function* () { throw new Error("rate limit"); })(),
    });
    const result = await generateContextAnalysis(conv, timeline, ["a"], "summary");
    expect(result.analysis).toBe("");
    expect(result.error).toContain("rate limit");
  });
});

describe("runAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates ctx.analysis and stepTimings", async () => {
    mockStream("Analysis result.");

    const ctx = makeCtx();
    const chunks: string[] = [];
    await runAnalysis(ctx, vi.fn(), {
      onAnalysisChunk: (_id, chunk) => chunks.push(chunk),
    });

    expect(ctx.analysis).toBe("Analysis result.");
    expect(ctx.stepTimings!.analyzing).toBeDefined();
    expect(chunks).toEqual(["Analysis result."]);
  });

  it("skips when no aiSummary", async () => {
    const ctx = makeCtx({ aiSummary: undefined });
    await runAnalysis(ctx, vi.fn(), {});
    expect(ctx.analysis).toBe("");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("skips when no components", async () => {
    const ctx = makeCtx({ dimensions: {} });
    await runAnalysis(ctx, vi.fn(), {});
    expect(ctx.analysis).toBe("");
    expect(streamText).not.toHaveBeenCalled();
  });
});

describe("runEnsureSummaryThenAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates summary first if missing, then analysis", async () => {
    let callNum = 0;
    (streamText as any).mockImplementation(() => {
      callNum++;
      return {
        textStream: (async function* () {
          yield callNum === 1 ? "Generated summary." : "Generated analysis.";
        })(),
      };
    });

    const ctx = makeCtx({ aiSummary: undefined });
    await runEnsureSummaryThenAnalysis(ctx, vi.fn(), {});

    expect(ctx.aiSummary).toBe("Generated summary.");
    expect(ctx.analysis).toBe("Generated analysis.");
    expect(streamText).toHaveBeenCalledTimes(2);
  });

  it("skips summary if already present", async () => {
    mockStream("Analysis only.");

    const ctx = makeCtx({ aiSummary: "Existing summary." });
    await runEnsureSummaryThenAnalysis(ctx, vi.fn(), {});

    expect(ctx.aiSummary).toBe("Existing summary.");
    expect(ctx.analysis).toBe("Analysis only.");
    expect(streamText).toHaveBeenCalledOnce();
  });
});

describe("regenerateAnalysisIfNeeded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns false and does nothing when no prior analysis", async () => {
    const ctx = makeCtx({ analysis: undefined, stepTimings: {} });
    const result = await regenerateAnalysisIfNeeded(ctx, vi.fn(), {});
    expect(result).toBe(false);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("regenerates when analysis was previously generated", async () => {
    mockStream("New analysis.");

    const ctx = makeCtx({ analysis: "Old analysis.", stepTimings: { analyzing: 1 } });
    const result = await regenerateAnalysisIfNeeded(ctx, vi.fn(), {});

    expect(result).toBe(true);
    expect(ctx.analysis).toBe("New analysis.");
  });

  it("regenerates when stepTimings.analyzing exists even if analysis is empty", async () => {
    mockStream("Regenerated.");

    const ctx = makeCtx({ analysis: "", stepTimings: { analyzing: 0 } });
    const result = await regenerateAnalysisIfNeeded(ctx, vi.fn(), {});

    expect(result).toBe(true);
    expect(ctx.analysis).toBe("Regenerated.");
  });
});
