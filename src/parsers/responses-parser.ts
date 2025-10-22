import { ZodError } from "zod";
import type { Parser } from "../parser";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../schema";
import {
  ResponsesInputSchema,
  type ResponsesInput,
  type ResponseDataItem,
} from "../input-schemas";

/**
 * Parser for OpenAI Responses API format
 * Example: sample-logs/responses/1.json
 *
 * Maps to Vercel AI SDK message structure:
 * 1. Validate input with ResponsesInputSchema
 * 2. Transform data items to standard format with typed parts
 * 3. Validate output with ConversationSchema
 */
export class ResponsesParser implements Parser {
  canParse(data: unknown): boolean {
    const result = ResponsesInputSchema.safeParse(data);
    if (!result.success) return false;
    return result.data.object === "list";
  }

  parse(data: unknown): Conversation {
    try {
      const input = ResponsesInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid responses format: ${error.issues
            .map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`
            )
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: ResponsesInput): Conversation {
    return {
      messages: input.data.map((item) => this.transformDataItem(item)),
    };
  }

  private transformDataItem(item: ResponseDataItem): Message {
    // Handle different item types
    switch (item.type) {
      case "message": {
        const role = item.role || "assistant";
        const textParts = this.extractTextParts(item.content);

        if (role === "system") {
          return {
            role: "system",
            content: textParts,
          };
        }

        if (role === "user") {
          return {
            role: "user",
            content: textParts,
          };
        }

        // Assistant message
        return {
          role: "assistant",
          content: textParts,
        };
      }

      case "reasoning": {
        // Reasoning becomes an assistant message with reasoning part
        const reasoningText =
          item.summary?.map((s) => s.text).join("\n") || "";

        return {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: reasoningText,
            },
          ],
        };
      }

      case "function_call": {
        // Function call becomes an assistant message with tool-call part
        return {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: item.id,
              toolName: item.name || "",
              input: item.arguments ? JSON.parse(item.arguments) : {},
            },
          ],
        };
      }

      case "function_call_output": {
        // Function call output becomes a tool message with tool-result part
        return {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: item.id,
              toolName: "", // Not available in this format
              output: item.output,
            },
          ],
        };
      }

      default: {
        // Default to assistant message with text content
        return {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "",
            },
          ],
        };
      }
    }
  }

  private extractTextParts(
    content: ResponseDataItem["content"]
  ): Array<{ type: "text"; text: string }> {
    if (!content || content.length === 0) {
      return [
        {
          type: "text",
          text: "",
        },
      ];
    }

    const textContent = content
      .filter((c) => c.type === "input_text" || c.type === "output_text")
      .map((c) => c.text || "")
      .join("\n");

    return [
      {
        type: "text",
        text: textContent,
      },
    ];
  }
}
