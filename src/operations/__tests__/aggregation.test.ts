/**
 * Tests for aggregation pure functions.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [20] staticComponentise(segment-1) → timeline with exact token values
 *   [13] staticComponentise(post-compaction-1) → componentTokens {"user.text": 2718}
 *
 * These functions are exercised indirectly by staticComponentise and
 * buildComponentTimeline (in classify-components), but here we test
 * the remaining exports directly: aggregateComponentTokens, computeTupleTokens,
 * computePercentages, generateComponentCSV.
 */
import { describe, it, expect } from "vitest";
import {
  getPartTokenCount,
  getMessageTokenCount,
  aggregateComponentTokens,
  buildComponentTimeline,
  computeTupleTokens,
  computePercentages,
  generateComponentCSV,
  TUPLE_SEPARATOR,
} from "@/operations/aggregation";
import { addTokenCounts } from "@/operations/token-counting";
import { loadParsedArtifact } from "@/__tests__/helpers";
import {
  PC1_MAP_COMPONENTS_RESULT,
  EV_PROMPT3_COMPONENTS,
} from "@/__tests__/recording-fixtures";

// A small conversation with known token counts
const conv = {
  messages: [
    {
      id: "1", role: "user" as const,
      parts: [{ id: "p1", type: "text" as const, text: "Hello", token_count: 10 }],
    },
    {
      id: "2", role: "assistant" as const,
      parts: [
        { id: "p2", type: "text" as const, text: "Hi", token_count: 20 },
        { id: "p3", type: "tool-call" as const, toolName: "run", toolCallId: "tc1", input: {}, token_count: 15 },
      ],
    },
    {
      id: "3", role: "tool" as const,
      parts: [{ id: "p4", type: "tool-result" as const, toolName: "run", toolCallId: "tc1", output: "ok", token_count: 5 }],
    },
  ],
};

const mapping = { p1: "planning", p2: "planning", p3: "implementation", p4: "implementation" };

describe("getPartTokenCount", () => {
  it("returns token_count when present", () => {
    expect(getPartTokenCount({ token_count: 42 })).toBe(42);
  });

  it("returns 0 when absent", () => {
    expect(getPartTokenCount({})).toBe(0);
    expect(getPartTokenCount({ token_count: undefined })).toBe(0);
  });
});

describe("getMessageTokenCount", () => {
  it("sums parts", () => {
    expect(getMessageTokenCount(conv.messages[1]!)).toBe(35); // 20 + 15
  });
});

describe("aggregateComponentTokens", () => {
  it("aggregates by component", () => {
    const result = aggregateComponentTokens(conv, mapping);
    expect(result.componentTokens).toEqual({ planning: 30, implementation: 20 });
    expect(result.totalTokens).toBe(50);
  });

  it("respects maxMessageIndex", () => {
    const result = aggregateComponentTokens(conv, mapping, { maxMessageIndex: 0 });
    expect(result.componentTokens).toEqual({ planning: 10 });
    expect(result.totalTokens).toBe(10);
  });

  it("labels unmapped parts as 'other' by default", () => {
    const partial = { p1: "planning" }; // only p1 mapped
    const result = aggregateComponentTokens(conv, partial);
    expect(result.componentTokens.other).toBe(40); // p2+p3+p4
  });

  it("skips unmapped parts when unmappedLabel is null", () => {
    const partial = { p1: "planning" };
    const result = aggregateComponentTokens(conv, partial, { unmappedLabel: null });
    expect(result.componentTokens).toEqual({ planning: 10 });
    expect(result.totalTokens).toBe(10);
  });
});

describe("buildComponentTimeline", () => {
  it("produces cumulative snapshots matching recording [20] pattern", async () => {
    // Use the real segment-1 file with real token counts
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const counted = await addTokenCounts(conversation);

    // Build static mapping (every part → role.type)
    const staticMapping: Record<string, string> = {};
    for (const msg of counted.messages) {
      for (const part of msg.parts) {
        staticMapping[part.id] = `${msg.role}.${part.type}`;
      }
    }

    const timeline = buildComponentTimeline(counted, staticMapping, { unmappedLabel: null });

    expect(timeline.length).toBe(338);

    // Recording [20] timeline[0]: user.text = 50
    expect(timeline[0]!.componentTokens["user.text"]).toBe(50);
    expect(timeline[0]!.totalTokens).toBe(50);

    // Recording [20] timeline[49]: exact values
    expect(timeline[49]!.componentTokens).toEqual({
      "user.text": 482,
      "assistant.reasoning": 320,
      "assistant.text": 293,
      "assistant.tool-call": 2667,
      "tool.tool-result": 53332,
    });
    expect(timeline[49]!.totalTokens).toBe(57094);

    // Monotonically non-decreasing
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.totalTokens).toBeGreaterThanOrEqual(timeline[i - 1]!.totalTokens);
    }
  });
});

describe("computeTupleTokens", () => {
  it("computes single-dimension tuples", () => {
    const dims = { default: { componentMapping: mapping } };
    const { tupleTokens, total } = computeTupleTokens(conv, dims);

    expect(tupleTokens["default:planning"]).toBe(30);
    expect(tupleTokens["default:implementation"]).toBe(20);
    expect(total).toBe(50);
  });

  it("computes multi-dimension tuples with separator", () => {
    const dims = {
      arch: { componentMapping: { p1: "frontend", p2: "frontend", p3: "backend", p4: "backend" } },
      role: { componentMapping: { p1: "user_input", p2: "response", p3: "tool_use", p4: "tool_out" } },
    };
    const { tupleTokens, total } = computeTupleTokens(conv, dims);

    expect(tupleTokens[`arch:frontend${TUPLE_SEPARATOR}role:user_input`]).toBe(10);
    expect(tupleTokens[`arch:frontend${TUPLE_SEPARATOR}role:response`]).toBe(20);
    expect(total).toBe(50);
  });

  it("respects maxMessageIndex", () => {
    const dims = { default: { componentMapping: mapping } };
    const { total } = computeTupleTokens(conv, dims, undefined, { maxMessageIndex: 0 });
    expect(total).toBe(10);
  });
});

describe("computePercentages", () => {
  it("computes percentages from component tokens", () => {
    const result = computePercentages({ planning: 30, implementation: 20 });
    const planning = result.find(r => r.component === "planning")!;
    expect(planning.tokens).toBe(30);
    expect(planning.percentage).toBe(60);

    const impl = result.find(r => r.component === "implementation")!;
    expect(impl.percentage).toBe(40);
  });

  it("handles zero total", () => {
    const result = computePercentages({}, 0);
    expect(result).toEqual([]);
  });
});

describe("generateComponentCSV", () => {
  it("generates CSV with header and rows", () => {
    const timeline = [
      { messageIndex: 0, componentTokens: { A: 10, B: 5 }, totalTokens: 15 },
      { messageIndex: 1, componentTokens: { A: 20, B: 10 }, totalTokens: 30 },
    ];
    const csv = generateComponentCSV(timeline, ["A", "B"]);

    const lines = csv.split("\n");
    expect(lines[0]).toBe("Message,Total Tokens,A,B");
    expect(lines[1]).toContain("Msg 1");
    expect(lines[1]).toContain("15");
    expect(lines[1]).toContain("10 (66.7%)");
    expect(lines.length).toBe(3); // header + 2 rows
  });
});
