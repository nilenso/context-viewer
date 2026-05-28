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
import { parserRegistry } from "../../parsers/parser";
import { parseFileContent } from "../../parsers/file-formats";
import "../../parsers/index";
import { loadArtifact } from "../helpers";

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

  it("detects ATIF agent-run exports and links tool observations", () => {
    const { text } = loadArtifact("atif-agent-run.json");
    const data = parseFileContent(text, "atif-agent-run.json");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);

    expect(metadata.parserName).toBe("ATIF");
    expect(metadata.provider).toBe("ATIF");
    expect(metadata.agent).toBe("terminus-2");
    expect(metadata.model).toBe("openrouter/qwen/qwen3.6-max-preview");
    expect(metadata.title).toBe("terminus-2");

    expect(conversation.messages.length).toBe(3);
    expect(conversation.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);

    const user = conversation.messages[0]!;
    expect(user.parts[0]!.type).toBe("text");
    if (user.parts[0]!.type === "text") {
      expect(user.parts[0]!.text).toBe("[ATIF step 1 of 2]\nSolve the task.");
    }

    const assistant = conversation.messages[1]!;
    expect(assistant.parts.map((p) => p.type)).toEqual([
      "reasoning",
      "text",
      "tool-call",
    ]);
    expect(assistant.parts[0]!.type).toBe("reasoning");
    if (assistant.parts[0]!.type === "reasoning") {
      expect(assistant.parts[0]!.text).toBe(
        "[ATIF step 2 of 2]\nI should inspect the files.",
      );
    }

    const toolCall = assistant.parts[2]!;
    expect(toolCall.type).toBe("tool-call");
    if (toolCall.type === "tool-call") {
      expect(toolCall.toolCallId).toBe("call_0_1");
      expect(toolCall.toolName).toBe("bash_command");
      expect(toolCall.input).toEqual({
        atif_step: "2/2",
        atif_step_label: "ATIF step 2 of 2",
        input: { keystrokes: "ls", duration: 1.0 },
      });
    }

    const tool = conversation.messages[2]!;
    expect(tool.role).toBe("tool");
    expect(tool.parts[0]!.type).toBe("tool-result");
    if (tool.parts[0]!.type === "tool-result") {
      // The source ATIF export has tool_call_id: null; the parser links by atif_step_id.
      expect(tool.parts[0]!.toolCallId).toBe("call_0_1");
      expect(tool.parts[0]!.toolName).toBe("bash_command");
      expect(tool.parts[0]!.output).toBe("[ATIF step 2 of 2]\nfile.txt\n");
    }
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
