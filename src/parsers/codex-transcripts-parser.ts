import { ZodError } from "zod";
import type { Parser, ConversationMetadata } from "@/model/types";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "@/model/schema";
import {
  CodexTranscriptsInputSchema,
  type CodexTranscriptsInput,
  type CodexTranscriptEntry,
  type CodexMessagePayload,
  type CodexReasoningPayload,
  type CodexFunctionCallPayload,
  type CodexFunctionCallOutputPayload,
} from "./input-schemas";

import { generateId } from "@/lib/id-generator";

/**
 * Parser for Codex CLI transcript format (JSONL)
 *
 * This format is used by OpenAI's Codex CLI and contains:
 * - session_meta entries for session information
 * - response_item entries containing messages, reasoning, function calls, and outputs
 * - event_msg entries for various events (token counts, user messages, etc.)
 * - turn_context entries for context metadata
 *
 * Key differences from Claude Code format:
 * - Uses "response_item" wrapper with nested "payload"
 * - User content uses "input_text" type, assistant uses "output_text"
 * - Reasoning has "summary" array with "summary_text" items
 * - Function calls use "function_call" and "function_call_output" types
 */
export class CodexTranscriptsParser implements Parser {
  name = "Codex CLI";

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    if (!Array.isArray(data)) return {};

    let model: string | undefined;
    let provider: string | undefined;

    for (const entry of data) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;

      // Check session_meta for provider
      if (e.type === "session_meta" && e.payload) {
        const payload = e.payload as Record<string, unknown>;
        if (payload.model_provider && typeof payload.model_provider === "string") {
          provider = payload.model_provider;
        }
      }

      // Check turn_context for model
      if (e.type === "turn_context" && e.payload) {
        const payload = e.payload as Record<string, unknown>;
        if (payload.model && typeof payload.model === "string") {
          model = payload.model;
        }
      }

      // If we found both, we can stop
      if (model && provider) break;
    }

    return {
      model,
      provider: provider || "OpenAI",
    };
  }
  canParse(data: unknown): boolean {
    // Must be an array
    if (!Array.isArray(data)) return false;
    if (data.length === 0) return false;

    // Check if it looks like Codex transcript format
    // Look for entries with the characteristic structure
    const hasCodexEntries = data.some((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        e.type === "session_meta" ||
        e.type === "response_item" ||
        e.type === "event_msg" ||
        e.type === "turn_context"
      );
    });

    if (!hasCodexEntries) return false;

    // Check for characteristic response_item entries with payload
    const hasResponseItems = data.some((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      if (e.type !== "response_item") return false;
      if (typeof e.payload !== "object" || e.payload === null) return false;
      const payload = e.payload as Record<string, unknown>;
      return (
        payload.type === "message" ||
        payload.type === "reasoning" ||
        payload.type === "function_call" ||
        payload.type === "function_call_output"
      );
    });

    return hasResponseItems;
  }

  parse(data: unknown): Conversation {
    try {
      const input = CodexTranscriptsInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid codex transcripts format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: CodexTranscriptsInput): Conversation {
    // Filter to only response_item entries
    const responseItems = input.filter(
      (entry): entry is CodexTranscriptEntry & { type: "response_item" } =>
        entry.type === "response_item"
    );

    // Transform entries into messages
    const messages = this.transformResponseItems(responseItems);

    return { messages };
  }

  /**
   * Transform response_item entries into standard messages
   * Groups reasoning, function calls, and text into coherent messages
   */
  private transformResponseItems(
    entries: Array<CodexTranscriptEntry & { type: "response_item" }>
  ): Message[] {
    const messages: Message[] = [];
    let currentAssistantParts: Array<
      | { id: string; type: "text"; text: string }
      | { id: string; type: "reasoning"; text: string }
      | { id: string; type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = [];
    let currentAssistantTimestamp: string | undefined;
    let pendingToolCalls: Map<string, { toolName: string; input: unknown }> = new Map();

    const flushAssistantMessage = () => {
      if (currentAssistantParts.length > 0) {
        messages.push({
          id: generateId(),
          role: "assistant",
          parts: currentAssistantParts,
          timestamp: currentAssistantTimestamp,
        });
        currentAssistantParts = [];
        currentAssistantTimestamp = undefined;
      }
    };

    for (const entry of entries) {
      const payload = entry.payload as Record<string, unknown>;
      const timestamp = entry.timestamp;

      switch (payload.type) {
        case "message": {
          const messagePayload = payload as CodexMessagePayload;
          if (messagePayload.role === "user") {
            // Flush any pending assistant message
            flushAssistantMessage();

            // Transform user message
            const userMessage = this.transformUserMessage(messagePayload, timestamp);
            messages.push(userMessage);
          } else {
            // Assistant message - track timestamp of first entry
            if (!currentAssistantTimestamp) {
              currentAssistantTimestamp = timestamp;
            }
            // Add text parts
            for (const content of messagePayload.content) {
              if (content.type === "output_text") {
                currentAssistantParts.push({
                  id: generateId(),
                  type: "text",
                  text: content.text,
                });
              }
            }
          }
          break;
        }

        case "reasoning": {
          const reasoningPayload = payload as CodexReasoningPayload;
          // Track timestamp of first entry
          if (!currentAssistantTimestamp) {
            currentAssistantTimestamp = timestamp;
          }
          // Extract reasoning text from summary
          if (reasoningPayload.summary) {
            for (const item of reasoningPayload.summary) {
              if (item.type === "summary_text" && item.text) {
                currentAssistantParts.push({
                  id: generateId(),
                  type: "reasoning",
                  text: item.text,
                });
              }
            }
          }
          break;
        }

        case "function_call": {
          const callPayload = payload as CodexFunctionCallPayload;
          // Track timestamp of first entry
          if (!currentAssistantTimestamp) {
            currentAssistantTimestamp = timestamp;
          }
          // Parse arguments as JSON if possible
          let input: unknown;
          try {
            input = JSON.parse(callPayload.arguments);
          } catch {
            input = callPayload.arguments;
          }

          // Store for later matching with output
          pendingToolCalls.set(callPayload.call_id, {
            toolName: callPayload.name,
            input,
          });

          currentAssistantParts.push({
            id: generateId(),
            type: "tool-call",
            toolCallId: callPayload.call_id,
            toolName: callPayload.name,
            input,
          });
          break;
        }

        case "function_call_output": {
          const outputPayload = payload as CodexFunctionCallOutputPayload;
          // Flush assistant message before tool result
          flushAssistantMessage();

          // Get tool name from pending calls
          const toolInfo = pendingToolCalls.get(outputPayload.call_id);
          const toolName = toolInfo?.toolName || "";

          messages.push({
            id: generateId(),
            role: "tool",
            parts: [{
              id: generateId(),
              type: "tool-result",
              toolCallId: outputPayload.call_id,
              toolName,
              output: outputPayload.output,
            }],
            timestamp,
          });
          break;
        }
      }
    }

    // Flush any remaining assistant message
    flushAssistantMessage();

    return messages;
  }

  private transformUserMessage(payload: CodexMessagePayload, timestamp?: string): Message {
    const parts: Array<{ id: string; type: "text"; text: string }> = [];

    for (const content of payload.content) {
      if (content.type === "input_text") {
        parts.push({
          id: generateId(),
          type: "text",
          text: content.text,
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
}
