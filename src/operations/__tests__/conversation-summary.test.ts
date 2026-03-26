/**
 * Tests for summarizeConversation.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [10] post-compaction-1.jsonl (1 msg)  → exact result
 *   [17] segment-1.jsonl        (338 msgs) → exact result
 */
import { describe, it, expect } from "vitest";
import { summarizeConversation } from "@/operations/conversation-summary";
import { loadParsedArtifact } from "@/__tests__/helpers";

describe("summarizeConversation", () => {
  it("matches recording [10]: post-compaction-1 (1 message)", () => {
    const { conversation } = loadParsedArtifact("post-compaction-1.jsonl");
    const result = summarizeConversation(conversation);

    // Exact match against recording entry [10]
    expect(result).toEqual({
      totalMessages: 1,
      messagesByRole: { user: 1 },
      textOnlyMessageCount: 1,
      structuredContentMessageCount: 0,
      partCounts: { text: 1 },
    });
  });

  it("matches recording [17]: segment-1 (338 messages)", () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = summarizeConversation(conversation);

    // Exact match against recording entry [17]
    expect(result).toEqual({
      totalMessages: 338,
      messagesByRole: { user: 5, assistant: 161, tool: 172 },
      textOnlyMessageCount: 6,
      structuredContentMessageCount: 332,
      partCounts: { text: 104, reasoning: 9, "tool-call": 173, "tool-result": 172, image: 1 },
    });
  });

  it("invariant: role counts sum to totalMessages", () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = summarizeConversation(conversation);
    const roleSum = Object.values(result.messagesByRole).reduce((a, b) => a + b, 0);
    expect(roleSum).toBe(result.totalMessages);
  });

  it("invariant: textOnly + structured = totalMessages", () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = summarizeConversation(conversation);
    expect(result.textOnlyMessageCount + result.structuredContentMessageCount).toBe(
      result.totalMessages,
    );
  });
});
