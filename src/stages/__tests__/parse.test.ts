/**
 * Tests for the parse stage and restorePreProcessedImport.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [5] parse(post-compaction-1.jsonl) → parserName="Claude Code", 1 message, summary exact
 *   [8] parse(segment-1.jsonl) → parserName="Claude Code", model="claude-opus-4-6", 338 messages
 *
 * restorePreProcessedImport is tested with a Context Viewer export that includes
 * multi-dimension data, custom prompts, aiSummary, and analysis.
 */
import { describe, it, expect } from "vitest";
import { parse, restorePreProcessedImport } from "@/stages/parse";
import { loadArtifact } from "@/__tests__/helpers";
import { EV_PROMPT3_COMPONENTS, EV_PROMPT3_COLORS } from "@/__tests__/recording-fixtures";
import "@/parsers/index";
import type { PipelineState, ConversationMetadata } from "@/model/types";

function makeCtx(filename: string): PipelineState {
  const { file } = loadArtifact(filename);
  return { id: "test-1", filename, file, warnings: [], stepTimings: {} };
}

describe("parse stage", () => {
  it("matches recording [5]: post-compaction-1", async () => {
    const result = await parse(makeCtx("post-compaction-1.jsonl"));

    expect(result.metadata!.parserName).toBe("Claude Code");
    expect(result.metadata!.provider).toBe("Anthropic");

    expect(result.conversation!.messages.length).toBe(1);
    expect(result.conversation!.messages[0]!.role).toBe("user");
    expect(result.conversation!.messages[0]!.parts.length).toBe(1);
    expect(result.conversation!.messages[0]!.parts[0]!.type).toBe("text");

    expect(result.summary).toEqual({
      totalMessages: 1,
      messagesByRole: { user: 1 },
      textOnlyMessageCount: 1,
      structuredContentMessageCount: 0,
      partCounts: { text: 1 },
    });
  });

  it("matches recording [8]: segment-1", async () => {
    const result = await parse(makeCtx("segment-1.jsonl"));

    expect(result.metadata!.parserName).toBe("Claude Code");
    expect(result.metadata!.model).toBe("claude-opus-4-6");
    expect(result.metadata!.provider).toBe("Anthropic");
    expect(result.conversation!.messages.length).toBe(338);

    expect(result.summary).toEqual({
      totalMessages: 338,
      messagesByRole: { user: 5, assistant: 161, tool: 172 },
      textOnlyMessageCount: 6,
      structuredContentMessageCount: 332,
      partCounts: { text: 104, reasoning: 9, "tool-call": 173, "tool-result": 172, image: 1 },
    });
  });
});

describe("restorePreProcessedImport", () => {
  it("restores default dimension from component annotations", () => {
    const conversation = {
      messages: [
        {
          id: "m1", role: "user" as const,
          parts: [
            { id: "p1", type: "text" as const, text: "Hello", component: "greeting" },
            { id: "p2", type: "text" as const, text: "World", component: "content" },
          ],
        },
      ],
    };
    const metadata: ConversationMetadata = {
      parserName: "Context Viewer",
      componentColors: { greeting: "#ff0000", content: "#00ff00" },
      customPrompt: "Custom ID prompt",
      customColoringPrompt: "Use warm colors",
      aiSummary: "A summary.",
      analysis: "An analysis.",
      title: "My Title",
      customSegmentationPrompt: "Seg prompt",
      customSummaryPrompt: "Summary prompt",
      customAnalysisPrompt: "Analysis prompt",
    };

    const result = restorePreProcessedImport(metadata, conversation);

    // Default dimension restored
    expect(result.dimensions!.default).toBeDefined();
    const dim = result.dimensions!.default!;
    expect(dim.discoveredComponents).toEqual(expect.arrayContaining(["greeting", "content"]));
    expect(dim.componentMapping).toEqual({ p1: "greeting", p2: "content" });
    expect(dim.componentColors).toEqual({ greeting: "#ff0000", content: "#00ff00" });
    expect(dim.prompt).toBe("Custom ID prompt");
    expect(dim.customColoringPrompt).toBe("Use warm colors");
    expect(dim.componentTimeline.length).toBe(1);

    // Top-level fields restored
    expect(result.title).toBe("My Title");
    expect(result.aiSummary).toBe("A summary.");
    expect(result.analysis).toBe("An analysis.");
    expect(result.customSegmentationPrompt).toBe("Seg prompt");
    expect(result.customSummaryPrompt).toBe("Summary prompt");
    expect(result.customAnalysisPrompt).toBe("Analysis prompt");

    // Static components also computed
    expect(result.staticComponents).toEqual(["user.text"]);
  });

  it("restores additional dimensions from part.dimensions annotations", () => {
    const conversation = {
      messages: [
        {
          id: "m1", role: "user" as const,
          parts: [
            {
              id: "p1", type: "text" as const, text: "Hello",
              component: "greeting",
              dimensions: { relevance: "high_relevance" },
            },
          ],
        },
      ],
    };
    const metadata: ConversationMetadata = {
      parserName: "Context Viewer",
      componentColors: { greeting: "#ff0000" },
      dimensions: {
        relevance: {
          components: EV_PROMPT3_COMPONENTS.slice(0, 3),
          colors: Object.fromEntries(EV_PROMPT3_COMPONENTS.slice(0, 3).map(c => [c, EV_PROMPT3_COLORS[c]!])),
          prompt: "Relevance prompt",
          coloringPrompt: "Relevance colors",
        },
      },
    };

    const result = restorePreProcessedImport(metadata, conversation);

    // Default dimension
    expect(result.dimensions!.default).toBeDefined();
    expect(result.dimensions!.default!.componentMapping.p1).toBe("greeting");

    // Additional "relevance" dimension
    expect(result.dimensions!.relevance).toBeDefined();
    const relDim = result.dimensions!.relevance!;
    expect(relDim.discoveredComponents).toEqual(EV_PROMPT3_COMPONENTS.slice(0, 3));
    expect(relDim.componentMapping).toEqual({ p1: "high_relevance" });
    expect(relDim.prompt).toBe("Relevance prompt");
    expect(relDim.customColoringPrompt).toBe("Relevance colors");
    expect(relDim.componentTimeline.length).toBe(1);
  });
});
