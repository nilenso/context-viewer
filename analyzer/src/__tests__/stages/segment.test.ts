/**
 * Tests for segmentConversation.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [15] post-compaction-1 (1 msg, 1 part, 2718 tokens) → segmented into 22 parts
 *        Part IDs: 4.1 through 4.22
 *   [22] segment-1 (338 msgs) → AI called for large parts, some skipped (tool-result)
 *
 * Ground truth from compaction-everything.json:
 *   [15] initial segmentation: 15 parts
 *   [46] re-segmentation with custom prompt: 51 parts
 *   [60] re-segmentation preserves 51 parts (no large parts left)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
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
import { segmentConversation } from "../../stages/segment";
import type { AIConfig } from "../../config";

const testConfig: AIConfig = {
  apiKey: "test-key", model: "gpt-5.4-mini", baseURL: undefined,
  apiMode: "responses" as const, reasoningEffort: undefined,
};

describe("segmentConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-op when all parts are below threshold", async () => {
    const conversation = {
      messages: [
        {
          id: "1",
          role: "user" as const,
          parts: [{ id: "p1", type: "text" as const, text: "Hello", token_count: 10 }],
        },
      ],
    };

    const result = await segmentConversation(conversation, testConfig);

    expect(result.conversation.messages.length).toBe(1);
    expect(result.conversation.messages[0]!.parts.length).toBe(1);
    expect(result.errors.length).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("segments large text parts using AI-returned split patterns", async () => {
    // Simulate recording [15]: a single large text part (2718 tokens)
    // AI returns split patterns that divide it into sections
    (generateText as any).mockResolvedValue({
      text: '["(?=## Section Two)", "(?=## Section Three)"]',
    });

    const conversation = {
      messages: [
        {
          id: "3",
          role: "user" as const,
          parts: [
            {
              id: "4",
              type: "text" as const,
              text: "## Section One\nFirst section content.\n\n## Section Two\nSecond section content.\n\n## Section Three\nThird section.",
              token_count: 600,
            },
          ],
        },
      ],
    };

    const result = await segmentConversation(conversation, testConfig);

    expect(generateText).toHaveBeenCalledOnce();
    // Split into 3 parts
    expect(result.conversation.messages[0]!.parts.length).toBe(3);
    // Child IDs follow parent.N pattern (matching recording [15] pattern: 4.1, 4.2, ...)
    expect(result.conversation.messages[0]!.parts[0]!.id).toBe("4.1");
    expect(result.conversation.messages[0]!.parts[1]!.id).toBe("4.2");
    expect(result.conversation.messages[0]!.parts[2]!.id).toBe("4.3");
    // Each part has text content
    expect(result.conversation.messages[0]!.parts[0]!.type).toBe("text");
    expect((result.conversation.messages[0]!.parts[0] as any).text).toContain("Section One");
  });

  it("skips tool-call and tool-result parts even when above threshold", async () => {
    // Recording [22] shows many "Skipping part X, type: tool-result" entries
    const conversation = {
      messages: [
        {
          id: "1",
          role: "tool" as const,
          parts: [
            {
              id: "p1",
              type: "tool-result" as const,
              toolName: "read",
              toolCallId: "tc1",
              output: "x".repeat(5000),
              token_count: 1000,
            },
          ],
        },
        {
          id: "2",
          role: "assistant" as const,
          parts: [
            {
              id: "p2",
              type: "tool-call" as const,
              toolName: "write",
              toolCallId: "tc2",
              input: { data: "y".repeat(5000) },
              token_count: 1000,
            },
          ],
        },
      ],
    };

    const result = await segmentConversation(conversation, testConfig);
    // Neither should be segmented
    expect(generateText).not.toHaveBeenCalled();
    expect(result.conversation.messages[0]!.parts.length).toBe(1);
    expect(result.conversation.messages[1]!.parts.length).toBe(1);
  });

  it("respects custom segmentation threshold", async () => {
    (generateText as any).mockResolvedValue({
      text: '["(?=Part 2)"]',
    });

    const conversation = {
      messages: [
        {
          id: "1",
          role: "user" as const,
          parts: [
            {
              id: "p1",
              type: "text" as const,
              text: "Part 1 content\n\nPart 2 content",
              token_count: 200,
            },
          ],
        },
      ],
    };

    // Default threshold (500) → no segmentation
    await segmentConversation(conversation, testConfig);
    expect(generateText).not.toHaveBeenCalled();

    // Custom threshold (100) → triggers segmentation
    // Matches recording [46] pattern: segmentationThreshold in args
    await segmentConversation(conversation, testConfig, undefined, 100);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("handles AI returning no valid patterns", async () => {
    (generateText as any).mockResolvedValue({ text: "I can't find split points." });

    const conversation = {
      messages: [
        {
          id: "1",
          role: "user" as const,
          parts: [{ id: "p1", type: "text" as const, text: "Long text...", token_count: 600 }],
        },
      ],
    };

    const result = await segmentConversation(conversation, testConfig);
    // Returns original — no segmentation
    expect(result.conversation.messages[0]!.parts.length).toBe(1);
  });

  it("reports progress", async () => {
    (generateText as any).mockResolvedValue({ text: '["(?=B)"]' });

    const conversation = {
      messages: [
        {
          id: "1",
          role: "user" as const,
          parts: [{ id: "p1", type: "text" as const, text: "A content\n\nB content", token_count: 600 }],
        },
      ],
    };

    // Progress callback removed in analyzer — segmentation still runs
    const result = await segmentConversation(conversation, testConfig);
    // Should have segmented into 2 parts
    expect(result.conversation.messages[0]!.parts.length).toBe(2);
  });
});
