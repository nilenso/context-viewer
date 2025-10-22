import { ZodError } from "zod";
import type { Parser } from "../parser";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../schema";
import {
  CompletionsInputSchema,
  type CompletionsInput,
  type CompletionMessage,
} from "../input-schemas";

// Simple ID generator
let idCounter = 0;
const generateId = () => `id-${++idCounter}`;

/**
 * Parser for OpenAI-style completions format
 * Example: sample-logs/completions/1.json
 *
 * Maps to Vercel AI SDK message structure:
 * 1. Validate input with CompletionsInputSchema
 * 2. Transform messages to standard format with typed parts
 * 3. Validate output with ConversationSchema
 */
export class CompletionsParser implements Parser {
  canParse(data: unknown): boolean {
    const result = CompletionsInputSchema.safeParse(data);
    if (!result.success) return false;
    return result.data.object === "traffic.completion";
  }

  parse(data: unknown): Conversation {
    try {
      const input = CompletionsInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid completions format: ${error.issues
            .map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`
            )
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: CompletionsInput): Conversation {
    return {
      messages: input.messages.map((msg) => this.transformMessage(msg)),
    };
  }

  private transformMessage(msg: CompletionMessage): Message {
    switch (msg.role) {
      case "system":
        return {
          id: generateId(),
          role: "system",
          content: [
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
          content: [
            {
              id: generateId(),
              type: "text",
              text: msg.content ?? "",
            },
          ],
        };

      case "assistant": {
        // Assistant can have text content and/or tool calls
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

        // Add text content if present and non-empty
        if (msg.content !== null && msg.content !== undefined && msg.content !== "") {
          parts.push({
            id: generateId(),
            type: "text",
            text: msg.content,
          });
        }

        // Add tool calls if present
        if (msg.tool_calls) {
          for (const toolCall of msg.tool_calls) {
            parts.push({
              id: generateId(),
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments),
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
          content: parts,
        };
      }

      case "tool":
        return {
          id: generateId(),
          role: "tool",
          content: [
            {
              id: generateId(),
              type: "tool-result",
              toolCallId: msg.tool_call_id || "",
              toolName: "", // Not available in this format
              output: msg.content ?? "",
            },
          ],
        };

      default:
        // Should never happen due to enum validation
        throw new Error(`Unknown role: ${msg.role}`);
    }
  }
}
