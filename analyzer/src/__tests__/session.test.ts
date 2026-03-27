/**
 * Tests for session management and iterative analysis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("../config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../config")>();
  return {
    ...mod,
    createModel: () => ({}),
    getProviderOptions: () => undefined,
  };
});

import { generateText } from "ai";
import { analyze, deleteSession } from "../index";
import type { AnalyzerConfig } from "../config";
import type { PipelineState, Stage } from "../model/types";
import "../parsers/index";

const config: AnalyzerConfig = { apiKey: "test-key", model: "gpt-4o-mini" };
const noAiConfig: AnalyzerConfig = { apiKey: "" };

// Minimal JSONL content that parses as a Claude Code transcript
const minimalContent = JSON.stringify({
  type: "user",
  uuid: "u1",
  parentUuid: null,
  timestamp: "2026-01-01T00:00:00Z",
  message: { role: "user", content: "Hello world" },
});

function mockFullPipeline(components: string[], colors: Record<string, string>) {
  (generateText as any).mockImplementation(async (opts: any) => {
    const prompt: string = opts?.prompt || "";

    // Segmentation — prompt contains "apply a break" or "split"
    if (prompt.includes("apply a break") || prompt.includes("semantic chunking")) {
      return { text: "[]" };
    }
    // Classification — prompt contains "give me a mapping" / "{id: component}"
    if (prompt.includes("{id: component}") || prompt.includes("give me a mapping")) {
      const ids = [...prompt.matchAll(/"partId"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      const mapping: Record<string, string> = {};
      ids.forEach((id, i) => { mapping[id!] = components[i % components.length]!; });
      return { text: JSON.stringify(mapping) };
    }
    // Identification — prompt contains "just give me a list in a json array"
    if (prompt.includes("just give me a list in a json array")) {
      return { text: JSON.stringify(components) };
    }
    // Coloring — prompt contains "assign a distinct hex color"
    if (prompt.includes("hex color")) {
      return { text: JSON.stringify(colors) };
    }
    // Fallback
    return { text: "[]" };
  });
}

describe("session — first run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a session and returns sessionId", async () => {
    mockFullPipeline(["greeting"], { greeting: "#ff0000" });

    const result = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, config);

    expect(result.sessionId).toBeDefined();
    expect(result.sessionId).toMatch(/^session-/);
    expect(result.states.length).toBe(1);
    expect(result.states[0]!.conversation).toBeDefined();
    expect(result.analytics.length).toBe(1);
  });

  it("works without API key — parse + token count only", async () => {
    const result = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, noAiConfig);

    expect(result.sessionId).toBeDefined();
    expect(result.states[0]!.conversation).toBeDefined();
    expect(result.states[0]!.staticComponents).toBeDefined();
    // No dimensions (no AI)
    expect(result.states[0]!.dimensions).toBeUndefined();
  });

  it("throws when no files and no sessionId", async () => {
    await expect(analyze({}, config)).rejects.toThrow("Either files or sessionId");
  });
});

describe("session — iteration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses session state on second call", async () => {
    mockFullPipeline(["greeting"], { greeting: "#ff0000" });

    const result1 = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, config);

    const callsBefore = (generateText as any).mock.calls.length;

    // Second call with same session — no changes, everything idempotent
    const result2 = await analyze({
      sessionId: result1.sessionId,
    }, config);

    // Should be the same session
    expect(result2.sessionId).toBe(result1.sessionId);
    // States are the same objects (same session)
    expect(result2.states[0]).toBe(result1.states[0]);
    // No new AI calls — everything was idempotent
    const callsAfter = (generateText as any).mock.calls.length;
    // Segmentation always runs but is a no-op (no large parts), so 1 call max
    expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);
  });

  it("re-runs identification when component prompt changes", async () => {
    mockFullPipeline(["comp_a"], { comp_a: "#ff0000" });

    const result1 = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, config);

    expect(result1.states[0]!.dimensions?.default?.discoveredComponents).toContain("comp_a");

    // Change the identification prompt — should re-identify
    mockFullPipeline(["comp_b", "comp_c"], { comp_b: "#00ff00", comp_c: "#0000ff" });

    const result2 = await analyze({
      sessionId: result1.sessionId,
      prompts: { "component-identification": "New prompt: find different things" },
    }, config);

    expect(result2.states[0]!.dimensions?.default?.discoveredComponents).toContain("comp_b");
  });

  it("re-runs coloring when coloring prompt changes", async () => {
    mockFullPipeline(["comp_a"], { comp_a: "#ff0000" });

    const result1 = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, config);

    expect(result1.states[0]!.dimensions?.default?.componentColors.comp_a).toBe("#ff0000");

    // Change coloring prompt
    (generateText as any).mockResolvedValue({ text: JSON.stringify({ comp_a: "#00ff00" }) });

    const result2 = await analyze({
      sessionId: result1.sessionId,
      prompts: { coloring: "Use green colors" },
    }, config);

    // Colors should have changed (the mock returns green now)
    expect(result2.states[0]!.dimensions?.default?.componentColors.comp_a).toBe("#00ff00");
  });

  it("throws on unknown session ID", async () => {
    await expect(analyze({ sessionId: "nonexistent" }, config)).rejects.toThrow("Session not found");
  });
});

describe("session — interceptors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls post-interceptors after each stage", async () => {
    mockFullPipeline(["comp_a"], { comp_a: "#ff0000" });

    const stagesSeen: string[] = [];

    const result = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
      interceptors: [
        { stage: "parsing" as Stage, timing: "post", fn: (ctx) => { stagesSeen.push("parsing"); } },
        { stage: "counting-tokens" as Stage, timing: "post", fn: (ctx) => { stagesSeen.push("counting-tokens"); } },
        { stage: "segmenting" as Stage, timing: "post", fn: (ctx) => { stagesSeen.push("segmenting"); } },
        { stage: "identifying-components" as Stage, timing: "post", fn: (ctx) => { stagesSeen.push("identifying-components"); } },
        { stage: "classifying-components" as Stage, timing: "post", fn: (ctx) => { stagesSeen.push("classifying-components"); } },
      ],
    }, config);

    expect(stagesSeen).toContain("parsing");
    expect(stagesSeen).toContain("counting-tokens");
    expect(stagesSeen).toContain("segmenting");
    expect(stagesSeen).toContain("identifying-components");
    expect(stagesSeen).toContain("classifying-components");
  });

  it("post-interceptor sees merged state", async () => {
    mockFullPipeline(["comp_a"], { comp_a: "#ff0000" });

    let conversationAfterParse: any = null;

    await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
      interceptors: [
        {
          stage: "parsing" as Stage,
          timing: "post",
          fn: (ctx) => { conversationAfterParse = ctx.conversation; },
        },
      ],
    }, config);

    expect(conversationAfterParse).toBeDefined();
    expect(conversationAfterParse.messages.length).toBeGreaterThan(0);
  });

  it("pre-interceptor runs before the stage", async () => {
    mockFullPipeline(["comp_a"], { comp_a: "#ff0000" });

    let hadConversationBeforeParse = false;

    await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
      interceptors: [
        {
          stage: "parsing" as Stage,
          timing: "pre",
          fn: (ctx) => { hadConversationBeforeParse = !!ctx.conversation; },
        },
      ],
    }, config);

    expect(hadConversationBeforeParse).toBe(false);
  });
});

describe("session — deleteSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a session", async () => {
    mockFullPipeline(["a"], { a: "#ff0000" });
    const result = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, config);

    expect(deleteSession(result.sessionId)).toBe(true);
    await expect(analyze({ sessionId: result.sessionId }, config)).rejects.toThrow("Session not found");
  });

  it("returns false for unknown session", () => {
    expect(deleteSession("nonexistent")).toBe(false);
  });
});

describe("session — applyIterationInputs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears segmentation downstream when threshold changes", async () => {
    mockFullPipeline(["comp_a"], { comp_a: "#ff0000" });

    const result1 = await analyze({
      files: { content: minimalContent, filename: "test.jsonl" },
    }, config);

    const dimBefore = result1.states[0]!.dimensions?.default;
    expect(dimBefore?.discoveredComponents.length).toBeGreaterThan(0);

    // Change threshold — should clear all dimension outputs
    mockFullPipeline(["comp_b"], { comp_b: "#00ff00" });

    const result2 = await analyze({
      sessionId: result1.sessionId,
      segmentationThreshold: 100,
    }, config);

    // New components should have been discovered
    expect(result2.states[0]!.dimensions?.default?.discoveredComponents).toContain("comp_b");
  });
});
