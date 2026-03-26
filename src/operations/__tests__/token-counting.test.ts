/**
 * Tests for addTokenCounts.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [12] post-compaction-1.jsonl (1 msg, 1 part)  → token_count = 2718
 *   [27] post-compaction-1.jsonl (1 msg, 22 parts after segmentation) → per-part counts
 *
 * tiktoken is deterministic, so these are exact assertions.
 */
import { describe, it, expect } from "vitest";
import { addTokenCounts } from "@/operations/token-counting";
import { loadParsedArtifact } from "@/__tests__/helpers";

describe("addTokenCounts", () => {
  it("matches recording [12]: post-compaction-1 single part = 2718 tokens", async () => {
    const { conversation } = loadParsedArtifact("post-compaction-1.jsonl");
    const result = await addTokenCounts(conversation);

    // Recording [12]: 1 message, 1 text part, token_count = 2718
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]!.parts.length).toBe(1);
    const part = result.messages[0]!.parts[0]!;
    expect(part.type).toBe("text");
    expect(part.token_count).toBe(2718);
  });

  it("matches recording [17]+[20]: segment-1 has 459 parts with correct total", async () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = await addTokenCounts(conversation);

    // Recording: 338 messages
    expect(result.messages.length).toBe(338);

    // Total parts = 459 (from recording [20] mapping)
    const totalParts = result.messages.reduce((s, m) => s + m.parts.length, 0);
    expect(totalParts).toBe(459);

    // Every text/reasoning part should have token_count > 0
    for (const msg of result.messages) {
      for (const part of msg.parts) {
        if (part.type === "text" || part.type === "reasoning") {
          expect(part.token_count).toBeGreaterThan(0);
        }
        if (part.type === "tool-call" || part.type === "tool-result") {
          expect(part.token_count).toBeGreaterThan(0);
        }
      }
    }

    // Recording [20] timeline[0] shows user.text = 50 tokens for first message
    // First message has one text part. Verify its token count.
    const firstPart = result.messages[0]!.parts[0]!;
    expect(firstPart.type).toBe("text");
    expect(firstPart.token_count).toBe(50);
  });

  it("does not add token_count to image parts", async () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = await addTokenCounts(conversation);

    // Recording [17]: partCounts has image: 1
    let imageCount = 0;
    for (const msg of result.messages) {
      for (const part of msg.parts) {
        if (part.type === "image") {
          imageCount++;
          expect(part).not.toHaveProperty("token_count");
        }
      }
    }
    expect(imageCount).toBe(1);
  });

  it("preserves message count and structure", async () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = await addTokenCounts(conversation);

    expect(result.messages.length).toBe(conversation.messages.length);
    for (let i = 0; i < conversation.messages.length; i++) {
      expect(result.messages[i]!.role).toBe(conversation.messages[i]!.role);
      expect(result.messages[i]!.id).toBe(conversation.messages[i]!.id);
      expect(result.messages[i]!.parts.length).toBe(conversation.messages[i]!.parts.length);
    }
  });

  it("is deterministic", async () => {
    const { conversation } = loadParsedArtifact("post-compaction-1.jsonl");
    const r1 = await addTokenCounts(conversation);
    const r2 = await addTokenCounts(conversation);
    expect(r1.messages[0]!.parts[0]!.token_count).toBe(
      r2.messages[0]!.parts[0]!.token_count,
    );
  });
});
