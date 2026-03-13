import { ZodError } from "zod";
import type { Parser, ConversationMetadata } from "../parser";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../schema";
import {
  OpenHandsInputSchema,
  type OpenHandsInput,
  type OpenHandsMessage,
} from "../input-schemas";

// Simple ID generator
let idCounter = 0;
const generateId = () => `${++idCounter}`;

/**
 * Parser for OpenHands trajectory format (chat completions with trajectory_metadata)
 *
 * This format comes from the sola-st/llm-agents-study dataset and contains:
 * - object: "chat.completion" identifier
 * - trajectory_metadata with agent, instance, outcome, and iteration count
 * - Standard OpenAI chat messages with system, user, assistant (with tool_calls), and tool roles
 */
export class OpenHandsTranscriptsParser implements Parser {
  name = "OpenHands";

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    if (typeof data !== "object" || data === null) return {};
    const d = data as Record<string, unknown>;

    const metadata: Partial<ConversationMetadata> = {
      agent: "OpenHands",
    };

    // Extract from trajectory_metadata
    if (typeof d.trajectory_metadata === "object" && d.trajectory_metadata !== null) {
      const tm = d.trajectory_metadata as Record<string, unknown>;
      if (typeof tm.instance === "string") {
        metadata.title = tm.instance;
      }
    }

    return metadata;
  }

  canParse(data: unknown): boolean {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    const d = data as Record<string, unknown>;

    // Must have object === "chat.completion"
    if (d.object !== "chat.completion") return false;

    // Must have trajectory_metadata object
    if (typeof d.trajectory_metadata !== "object" || d.trajectory_metadata === null) return false;

    // Must have messages array
    if (!Array.isArray(d.messages)) return false;

    return true;
  }

  parse(data: unknown): Conversation {
    try {
      const input = OpenHandsInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid OpenHands format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: OpenHandsInput): Conversation {
    // Build tool_call_id -> tool_name map for linking results back to calls
    const toolCallMap = new Map<string, string>();
    for (const msg of input.messages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallMap.set(tc.id, tc.function.name);
        }
      }
    }

    const messages: Message[] = [];
    for (const msg of input.messages) {
      messages.push(this.transformMessage(msg, toolCallMap));
    }
    return { messages };
  }

  private transformMessage(
    msg: OpenHandsMessage,
    toolCallMap: Map<string, string>
  ): Message {
    switch (msg.role) {
      case "system":
        return {
          id: generateId(),
          role: "system",
          parts: [
            {
              id: generateId(),
              type: "text",
              text: msg.content ?? "",
            },
          ],
        };

      case "user":
        return {
          id: generateId(),
          role: "user",
          parts: [
            {
              id: generateId(),
              type: "text",
              text: msg.content ?? "",
            },
          ],
        };

      case "assistant": {
        const parts: Array<
          | { id: string; type: "text"; text: string }
          | {
              id: string;
              type: "tool-call";
              toolCallId: string;
              toolName: string;
              input: unknown;
            }
        > = [];

        if (msg.content !== null && msg.content !== undefined && msg.content !== "") {
          parts.push({
            id: generateId(),
            type: "text",
            text: msg.content,
          });
        }

        if (msg.tool_calls) {
          for (const toolCall of msg.tool_calls) {
            let input: unknown;
            try {
              input = JSON.parse(toolCall.function.arguments);
            } catch {
              input = toolCall.function.arguments;
            }

            parts.push({
              id: generateId(),
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              input,
            });
          }
        }

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
        };
      }

      case "tool": {
        const toolCallId = msg.tool_call_id ?? "";
        const toolName = msg.name ?? toolCallMap.get(toolCallId) ?? "";

        return {
          id: generateId(),
          role: "tool",
          parts: [
            {
              id: generateId(),
              type: "tool-result",
              toolCallId,
              toolName,
              output: msg.content ?? "",
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown role: ${msg.role}`);
    }
  }
}
