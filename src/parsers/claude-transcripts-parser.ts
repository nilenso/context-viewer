import { ZodError } from "zod";
import type { Parser } from "../parser";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../schema";
import {
  ClaudeTranscriptsInputSchema,
  type ClaudeTranscriptsInput,
  type ClaudeTranscriptEntry,
  type ClaudeMessageEntry,
  type ClaudeContent,
} from "../input-schemas";

// Simple ID generator
let idCounter = 0;
const generateId = () => `${++idCounter}`;

/**
 * Parser for Claude Code transcript format (JSONL)
 * Example: sample-logs/claude-transcripts/large.jsonl
 *
 * This format is used by Claude Code CLI and contains:
 * - Summary entries for conversation titles
 * - File history snapshots
 * - User messages (including tool results)
 * - Assistant messages (including thinking, text, and tool calls)
 *
 * Assistant responses are streamed and split across multiple entries
 * that share the same message.id but have different uuids.
 */
export class ClaudeTranscriptsParser implements Parser {
  canParse(data: unknown): boolean {
    // Must be an array
    if (!Array.isArray(data)) return false;
    if (data.length === 0) return false;

    // Check if it looks like Claude transcript format
    // Look for entries with the characteristic type field values
    const hasTranscriptEntries = data.some((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        e.type === "user" ||
        e.type === "assistant" ||
        e.type === "summary" ||
        e.type === "file-history-snapshot"
      );
    });

    if (!hasTranscriptEntries) return false;

    // Check for characteristic fields of message entries
    const hasMessageFields = data.some((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        (e.type === "user" || e.type === "assistant") &&
        "uuid" in e &&
        "message" in e
      );
    });

    return hasMessageFields;
  }

  parse(data: unknown): Conversation {
    try {
      const input = ClaudeTranscriptsInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid claude transcripts format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: ClaudeTranscriptsInput): Conversation {
    // Filter to only message entries
    const messageEntries = input.filter(
      (entry): entry is ClaudeMessageEntry =>
        entry.type === "user" || entry.type === "assistant"
    );

    // Group assistant entries by message.id to merge streaming chunks
    const mergedEntries = this.mergeAssistantEntries(messageEntries);

    // Transform to standard messages
    const messages = mergedEntries.map((entry) => this.transformEntry(entry));

    return { messages };
  }

  /**
   * Merge assistant entries that share the same message.id
   * These represent streaming chunks of the same response
   */
  private mergeAssistantEntries(
    entries: ClaudeMessageEntry[]
  ): ClaudeMessageEntry[] {
    const result: ClaudeMessageEntry[] = [];
    const assistantMessageGroups = new Map<string, ClaudeMessageEntry[]>();
    const processedMessageIds = new Set<string>();

    for (const entry of entries) {
      if (entry.type === "user") {
        // User entries are not merged
        result.push(entry);
      } else {
        // Group assistant entries by message.id
        const messageId = entry.message.id;
        if (messageId) {
          if (!assistantMessageGroups.has(messageId)) {
            assistantMessageGroups.set(messageId, []);
          }
          assistantMessageGroups.get(messageId)!.push(entry);
        } else {
          // No message id, treat as standalone
          result.push(entry);
        }
      }
    }

    // Now process entries in order, inserting merged assistant messages at the right position
    const finalResult: ClaudeMessageEntry[] = [];

    for (const entry of entries) {
      if (entry.type === "user") {
        finalResult.push(entry);
      } else {
        const messageId = entry.message.id;
        if (messageId && !processedMessageIds.has(messageId)) {
          processedMessageIds.add(messageId);
          const group = assistantMessageGroups.get(messageId)!;
          const merged = this.mergeAssistantGroup(group);
          finalResult.push(merged);
        }
        // Skip if already processed
      }
    }

    return finalResult;
  }

  /**
   * Merge a group of assistant entries into a single entry
   */
  private mergeAssistantGroup(entries: ClaudeMessageEntry[]): ClaudeMessageEntry {
    if (entries.length === 0) {
      throw new Error("Cannot merge empty entries array");
    }
    if (entries.length === 1) return entries[0]!;

    // Take the first entry as base and merge content from all
    const first = entries[0]!;
    const allContent: ClaudeContent[] = [];

    for (const entry of entries) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        allContent.push(...content);
      } else if (typeof content === "string" && content) {
        allContent.push({ type: "text", text: content });
      }
    }

    // Create a new entry with merged content
    const merged: ClaudeMessageEntry = {
      type: first.type,
      uuid: first.uuid,
      parentUuid: first.parentUuid,
      timestamp: first.timestamp,
      message: {
        role: first.message.role,
        content: allContent,
        model: first.message.model,
        id: first.message.id,
        type: first.message.type,
        usage: first.message.usage,
      },
      sessionId: first.sessionId,
      version: first.version,
      cwd: first.cwd,
      gitBranch: first.gitBranch,
      isSidechain: first.isSidechain,
      userType: first.userType,
      requestId: first.requestId,
      thinkingMetadata: first.thinkingMetadata,
      toolUseResult: first.toolUseResult,
    };

    return merged;
  }

  private transformEntry(entry: ClaudeMessageEntry): Message {
    const content = entry.message.content;
    const timestamp = entry.timestamp;

    if (entry.type === "user") {
      return this.transformUserEntry(content, timestamp);
    } else {
      return this.transformAssistantEntry(content, timestamp);
    }
  }

  private transformUserEntry(
    content: string | ClaudeContent[],
    timestamp?: string
  ): Message {
    // Check if this is a tool result
    if (Array.isArray(content)) {
      const toolResults = content.filter(
        (c): c is { type: "tool_result"; tool_use_id: string; content: unknown } =>
          c.type === "tool_result"
      );

      if (toolResults.length > 0) {
        // This is a tool result message
        return {
          id: generateId(),
          role: "tool",
          parts: toolResults.map((tr) => ({
            id: generateId(),
            type: "tool-result" as const,
            toolCallId: tr.tool_use_id,
            toolName: "", // Not available in this format
            output: tr.content,
          })),
          timestamp,
        };
      }

      // Regular user message with content array (extract text and images)
      const parts: Array<
        | { id: string; type: "text"; text: string }
        | { id: string; type: "image"; image: string; mediaType?: string }
      > = [];

      for (const block of content) {
        if (block.type === "text") {
          parts.push({
            id: generateId(),
            type: "text",
            text: block.text,
          });
        } else if (block.type === "image") {
          // Handle image content
          parts.push({
            id: generateId(),
            type: "image",
            image: block.source.data,
            mediaType: block.source.media_type,
          });
        }
      }

      // Ensure at least one part
      if (parts.length === 0) {
        parts.push({
          id: generateId(),
          type: "text",
          text: "",
        });
      }

      return {
        id: generateId(),
        role: "user",
        parts,
        timestamp,
      };
    }

    // Simple string content
    return {
      id: generateId(),
      role: "user",
      parts: [
        {
          id: generateId(),
          type: "text",
          text: content || "",
        },
      ],
      timestamp,
    };
  }

  private transformAssistantEntry(
    content: string | ClaudeContent[],
    timestamp?: string
  ): Message {
    if (typeof content === "string") {
      return {
        id: generateId(),
        role: "assistant",
        parts: [
          {
            id: generateId(),
            type: "text",
            text: content,
          },
        ],
        timestamp,
      };
    }

    const parts: Array<
      | { id: string; type: "text"; text: string }
      | { id: string; type: "reasoning"; text: string }
      | { id: string; type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = [];

    for (const block of content) {
      switch (block.type) {
        case "thinking":
          parts.push({
            id: generateId(),
            type: "reasoning",
            text: block.thinking,
          });
          break;

        case "text":
          parts.push({
            id: generateId(),
            type: "text",
            text: block.text,
          });
          break;

        case "tool_use":
          parts.push({
            id: generateId(),
            type: "tool-call",
            toolCallId: block.id,
            toolName: block.name,
            input: block.input,
          });
          break;

        // tool_result shouldn't appear in assistant messages, but skip if it does
      }
    }

    // Ensure at least one part
    if (parts.length === 0) {
      parts.push({
        id: generateId(),
        type: "text",
        text: "",
      });
    }

    return {
      id: generateId(),
      role: "assistant",
      parts,
      timestamp,
    };
  }
}
