/**
 * Tests for stripLargeContent.
 *
 * This function is called before every AI stage (identify, classify, segment)
 * to reduce token count. The recordings show it being invoked via
 * identifyComponents [26, 30] and mapComponentsToIds [33, 38].
 */
import { describe, it, expect } from "vitest";
import { stripLargeContent } from "@/stages/ai/strip-large-content";
import { loadParsedArtifact } from "@/__tests__/helpers";

describe("stripLargeContent", () => {
  it("strips images to placeholder", () => {
    const conv = {
      messages: [{
        id: "1", role: "user" as const,
        parts: [{ id: "p1", type: "image" as const, image: "data:image/png;base64,abc123verylong" }],
      }],
    };
    const result = stripLargeContent(conv);
    expect((result.messages[0]!.parts[0] as any).image).toBe("[IMAGE_STRIPPED]");
  });

  it("strips files to placeholder", () => {
    const conv = {
      messages: [{
        id: "1", role: "user" as const,
        parts: [{ id: "p1", type: "file" as const, data: "huge file content...", mimeType: "text/plain" }],
      }],
    };
    const result = stripLargeContent(conv);
    expect((result.messages[0]!.parts[0] as any).data).toBe("[FILE_DATA_STRIPPED]");
  });

  it("truncates tool-result output", () => {
    const longOutput = "x".repeat(500);
    const conv = {
      messages: [{
        id: "1", role: "tool" as const,
        parts: [{ id: "p1", type: "tool-result" as const, toolName: "read", toolCallId: "tc1", output: longOutput }],
      }],
    };
    const result = stripLargeContent(conv);
    const output = (result.messages[0]!.parts[0] as any).output;
    expect(output.length).toBeLessThan(longOutput.length);
    expect(output).toContain("[TRUNCATED");
  });

  it("truncates tool-call input", () => {
    const longInput = { data: "y".repeat(500) };
    const conv = {
      messages: [{
        id: "1", role: "assistant" as const,
        parts: [{ id: "p1", type: "tool-call" as const, toolName: "write", toolCallId: "tc1", input: longInput }],
      }],
    };
    const result = stripLargeContent(conv);
    const input = (result.messages[0]!.parts[0] as any).input;
    expect(typeof input).toBe("string");
    expect(input).toContain("[TRUNCATED");
  });

  it("leaves short text parts unchanged", () => {
    const conv = {
      messages: [{
        id: "1", role: "user" as const,
        parts: [{ id: "p1", type: "text" as const, text: "Hello world" }],
      }],
    };
    const result = stripLargeContent(conv);
    expect((result.messages[0]!.parts[0] as any).text).toBe("Hello world");
  });

  it("handles the real segment-1 conversation (338 messages with image)", () => {
    const { conversation } = loadParsedArtifact("segment-1.jsonl");
    const result = stripLargeContent(conversation);

    // Should have same message count
    expect(result.messages.length).toBe(338);

    // The image part (recording [17]: image: 1) should be stripped
    let strippedImages = 0;
    for (const msg of result.messages) {
      for (const part of msg.parts) {
        if (part.type === "image") {
          expect((part as any).image).toBe("[IMAGE_STRIPPED]");
          strippedImages++;
        }
      }
    }
    expect(strippedImages).toBe(1);
  });
});
