/**
 * Tests for generateContextAnalysis, runAnalysis, runEnsureSummaryThenAnalysis,
 * and regenerateAnalysisIfNeeded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EV_PROMPT3_COMPONENTS, EV_PROMPT3_COLORS } from "../recording-fixtures";

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
import {
  generateContextAnalysis,
  runAnalysis,
  runEnsureSummaryThenAnalysis,
} from "../../stages/analyze-context";
import type { PipelineState } from "../../model/types";

const testConfig: AIConfig = {
  apiKey: "test-key", model: "gpt-4o-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

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

describe("generateContextAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns analysis text", async () => {
    (generateText as any).mockResolvedValue({
      text: "The context usage is dominated by comp_a.",
    });

    const result = await generateContextAnalysis(
      conv, timeline, EV_PROMPT3_COMPONENTS.slice(0, 3), "A summary.", testConfig,
    );

    expect(result.analysis).toBe("The context usage is dominated by comp_a.");
    expect(result.error).toBeUndefined();
  });

  it("returns error on failure", async () => {
    (generateText as any).mockRejectedValue(new Error("rate limit"));
    const result = await generateContextAnalysis(conv, timeline, ["a"], "summary", testConfig);
    expect(result.analysis).toBe("");
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("rate limit");
  });
});

describe("runAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates ctx.analysis", async () => {
    (generateText as any).mockResolvedValue({ text: "Analysis result." });

    const ctx = makeCtx();
    await runAnalysis(ctx, testConfig);

    expect(ctx.analysis).toBe("Analysis result.");
  });

  it("skips when no aiSummary", async () => {
    const ctx = makeCtx({ aiSummary: undefined });
    await runAnalysis(ctx, testConfig);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("skips when no components", async () => {
    const ctx = makeCtx({ dimensions: {} });
    await runAnalysis(ctx, testConfig);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("runEnsureSummaryThenAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates summary first if missing, then analysis", async () => {
    let callNum = 0;
    (generateText as any).mockImplementation(async () => {
      callNum++;
      return { text: callNum === 1 ? "Generated summary." : "Generated analysis." };
    });

    const ctx = makeCtx({ aiSummary: undefined });
    await runEnsureSummaryThenAnalysis(ctx, testConfig);

    expect(ctx.aiSummary).toBe("Generated summary.");
    expect(ctx.analysis).toBe("Generated analysis.");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("skips summary if already present", async () => {
    (generateText as any).mockResolvedValue({ text: "Analysis only." });

    const ctx = makeCtx({ aiSummary: "Existing summary." });
    await runEnsureSummaryThenAnalysis(ctx, testConfig);

    expect(ctx.aiSummary).toBe("Existing summary.");
    expect(ctx.analysis).toBe("Analysis only.");
    expect(generateText).toHaveBeenCalledOnce();
  });
});

