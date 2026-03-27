import { ZodError } from "zod";
import type { Parser, ConversationMetadata } from "../model/types";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../model/schema";
import {
  OpenCodeTranscriptsInputSchema,
  type OpenCodeTranscriptsInput,
  type OpenCodeMessage,
  type OpenCodePart,
  type OpenCodeTextPart,
  type OpenCodeReasoningPart,
  type OpenCodeToolPart,
} from "./input-schemas";

import { generateId } from "../id-generator";

/**
 * Parser for OpenCode transcript format (JSON)
 *
 * This format is used by OpenCode and contains:
 * - info: session metadata
 * - messages: array of user and assistant messages
 *
 * Each message has:
 * - info: metadata (id, role, time, tokens, etc.)
 * - parts: array of text, tool, step-start, step-finish, patch parts
 *
 * Key differences from Claude Code format:
 * - Single JSON object (not JSONL)
 * - Tool parts contain both input and output in state object
 * - Has step-start/step-finish/patch parts for tracking git state
 */
export class OpenCodeTranscriptsParser implements Parser {
  name = "OpenCode";

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return {};
    }

    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.messages)) return {};

    let model: string | undefined;
    let provider: string | undefined;
    let agent: string | undefined;

    // Find the first message with model/agent info
    for (const msg of d.messages) {
      if (typeof msg !== "object" || msg === null) continue;
      const m = msg as Record<string, unknown>;
      if (typeof m.info !== "object" || m.info === null) continue;

      const info = m.info as Record<string, unknown>;

      // Extract agent from any message (usually present on all)
      if (!agent && typeof info.agent === "string") {
        agent = info.agent;
      }

      // Extract model info from assistant messages
      if (info.role === "assistant" && !model) {
        const modelID = info.modelID as string | undefined;
        const providerID = info.providerID as string | undefined;

        // Also check nested model object
        if (typeof info.model === "object" && info.model !== null) {
          const modelObj = info.model as Record<string, unknown>;
          model = modelID || (modelObj.modelID as string | undefined);
          provider = providerID || (modelObj.providerID as string | undefined);
        } else if (modelID || providerID) {
          model = modelID;
          provider = providerID;
        }
      }

      // Stop if we found everything
      if (model && agent) break;
    }

    return { model, provider, agent };
  }
  canParse(data: unknown): boolean {
    // Must be an object with info and messages
    if (typeof data !== "object" || data === null) return false;
    if (Array.isArray(data)) return false;

    const d = data as Record<string, unknown>;

    // Must have info with id
    if (typeof d.info !== "object" || d.info === null) return false;
    const info = d.info as Record<string, unknown>;
    if (typeof info.id !== "string") return false;

    // Must have messages array
    if (!Array.isArray(d.messages)) return false;

    // Check if messages have the OpenCode structure
    const hasOpenCodeMessages = d.messages.some((msg) => {
      if (typeof msg !== "object" || msg === null) return false;
      const m = msg as Record<string, unknown>;
      return (
        typeof m.info === "object" &&
        m.info !== null &&
        Array.isArray(m.parts)
      );
    });

    return hasOpenCodeMessages;
  }

  parse(data: unknown): Conversation {
    try {
      const input = OpenCodeTranscriptsInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid opencode transcripts format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: OpenCodeTranscriptsInput): Conversation {
    const messages: Message[] = [];

    for (const msg of input.messages) {
      const transformed = this.transformMessage(msg);
      messages.push(...transformed);
    }

    return { messages };
  }

  /**
   * Transform an OpenCode message into one or more standard messages.
   * Tool parts need to be split into tool-call (assistant) and tool-result (tool) messages.
   */
  private transformMessage(msg: OpenCodeMessage): Message[] {
    const role = msg.info.role;
    const timestamp = msg.info.time?.created
      ? new Date(msg.info.time.created).toISOString()
      : undefined;

    if (role === "user") {
      return [this.transformUserMessage(msg, timestamp)];
    } else {
      return this.transformAssistantMessage(msg, timestamp);
    }
  }

  private transformUserMessage(msg: OpenCodeMessage, timestamp?: string): Message {
    const parts: Array<{ id: string; type: "text"; text: string }> = [];

    for (const part of msg.parts) {
      if (part.type === "text") {
        const textPart = part as OpenCodeTextPart;
        parts.push({
          id: generateId(),
          type: "text",
          text: textPart.text,
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

  /**
   * Transform an assistant message. Tool parts are special - they contain both
   * the tool call and the tool result. We output:
   * 1. An assistant message with text and tool-call parts
   * 2. A tool message with tool-result parts
   */
  private transformAssistantMessage(msg: OpenCodeMessage, timestamp?: string): Message[] {
    const messages: Message[] = [];
    const assistantParts: Array<
      | { id: string; type: "text"; text: string }
      | { id: string; type: "reasoning"; text: string }
      | { id: string; type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = [];
    const toolResultParts: Array<{
      id: string;
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }> = [];

    for (const part of msg.parts) {
      switch (part.type) {
        case "text": {
          const textPart = part as OpenCodeTextPart;
          assistantParts.push({
            id: generateId(),
            type: "text",
            text: textPart.text,
          });
          break;
        }

        case "reasoning": {
          const reasoningPart = part as OpenCodeReasoningPart;
          // Only add if there's actual text content
          if (reasoningPart.text) {
            assistantParts.push({
              id: generateId(),
              type: "reasoning",
              text: reasoningPart.text,
            });
          }
          break;
        }

        case "tool": {
          const toolPart = part as OpenCodeToolPart;
          // Add tool call to assistant parts
          assistantParts.push({
            id: generateId(),
            type: "tool-call",
            toolCallId: toolPart.callID,
            toolName: toolPart.tool,
            input: toolPart.state.input,
          });
          // Add tool result to separate list (only if output exists)
          if (toolPart.state.output !== undefined) {
            toolResultParts.push({
              id: generateId(),
              type: "tool-result",
              toolCallId: toolPart.callID,
              toolName: toolPart.tool,
              output: toolPart.state.output,
            });
          }
          break;
        }

        // Skip step-start, step-finish, patch - they're metadata, not content
        case "step-start":
        case "step-finish":
        case "patch":
          break;
      }
    }

    // Create assistant message if we have parts
    if (assistantParts.length > 0) {
      messages.push({
        id: generateId(),
        role: "assistant",
        parts: assistantParts,
        timestamp,
      });
    }

    // Create tool result message if we have results
    if (toolResultParts.length > 0) {
      messages.push({
        id: generateId(),
        role: "tool",
        parts: toolResultParts,
        timestamp,
      });
    }

    // If no parts at all, create an empty assistant message
    if (messages.length === 0) {
      messages.push({
        id: generateId(),
        role: "assistant",
        parts: [{
          id: generateId(),
          type: "text",
          text: "",
        }],
        timestamp,
      });
    }

    return messages;
  }
}
