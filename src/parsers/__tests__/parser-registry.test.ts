/**
 * Tests for ParserRegistry.
 *
 * Ground truth from compaction-single-passthrough.json:
 *   [5] parse(post-compaction-1.jsonl) → metadata.parserName = "Claude Code", provider = "Anthropic"
 *       conversation: 1 message, role=user, 1 text part
 *   [8] parse(segment-1.jsonl) → metadata.parserName = "Claude Code", model = "claude-opus-4-6"
 *       conversation: 338 messages
 */
import { describe, it, expect } from "vitest";
import { parserRegistry } from "@/parsers/parser";
import { parseFileContent } from "@/parsers/file-formats";
import "@/parsers/index";
import { loadArtifact } from "@/__tests__/helpers";

describe("parserRegistry", () => {
  it("matches recording [5]: post-compaction-1 detected as Claude Code", () => {
    const { text } = loadArtifact("post-compaction-1.jsonl");
    const data = parseFileContent(text, "post-compaction-1.jsonl");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);

    expect(metadata.parserName).toBe("Claude Code");
    expect(metadata.provider).toBe("Anthropic");

    expect(conversation.messages.length).toBe(1);
    expect(conversation.messages[0]!.role).toBe("user");
    expect(conversation.messages[0]!.parts.length).toBe(1);
    expect(conversation.messages[0]!.parts[0]!.type).toBe("text");
  });

  it("matches recording [8]: segment-1 detected as Claude Code with model", () => {
    const { text } = loadArtifact("segment-1.jsonl");
    const data = parseFileContent(text, "segment-1.jsonl");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);

    expect(metadata.parserName).toBe("Claude Code");
    expect(metadata.model).toBe("claude-opus-4-6");
    expect(metadata.provider).toBe("Anthropic");

    expect(conversation.messages.length).toBe(338);
  });

  it("detects Codex CLI format", () => {
    const { text } = loadArtifact("codex-sample.jsonl");
    const data = parseFileContent(text, "codex-sample.jsonl");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);

    expect(metadata.parserName).toBe("Codex CLI");
    expect(conversation.messages.length).toBeGreaterThan(0);
  });

  it("detects OpenAI Completions format", () => {
    const { text } = loadArtifact("completions-ask_github_gc.json");
    const data = parseFileContent(text, "completions-ask_github_gc.json");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);

    expect(metadata.parserName).toBe("OpenAI Completions");
    expect(conversation.messages.length).toBeGreaterThan(0);
  });

  it("parses plain text via .txt extension", () => {
    const data = parseFileContent("Hello world", "test.txt");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);
    expect(metadata.parserName).toBe("Plain Text");
    expect(conversation.messages.length).toBe(1);
  });

  it("throws on unrecognized data", () => {
    expect(() => parserRegistry.parseWithMetadata(42)).toThrow("No suitable parser found");
  });

  it("all messages have IDs and parts have IDs", () => {
    const { text } = loadArtifact("segment-1.jsonl");
    const data = parseFileContent(text, "segment-1.jsonl");
    const { conversation } = parserRegistry.parseWithMetadata(data);

    for (const msg of conversation.messages) {
      expect(msg.id).toBeTruthy();
      for (const part of msg.parts) {
        expect(part.id).toBeTruthy();
      }
    }
  });
});
