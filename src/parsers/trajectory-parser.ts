import { ZodError } from "zod";
import type { Parser, ConversationMetadata } from "@/model/types";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "@/model/schema";
import {
  TrajectoryInputSchema,
  type TrajectoryInput,
  type TrajectoryMessage,
  type TrajectoryToolCall,
} from "./input-schemas";

// Simple ID generator
let idCounter = 0;
const generateId = () => `trajectory-${++idCounter}`;

/**
 * Parser for SWE-bench trajectory format (JSON)
 *
 * This format is used by SWE-bench agent evaluation trajectories and contains:
 * - Top-level metadata: trajectory_id, instance_id, repo, exit_status, resolved, model_patch
 * - A `trajectory` array of messages with roles: system, user, assistant, tool
 * - Assistant messages may include `tool_calls` with function name and arguments (already parsed objects)
 * - Tool result messages have role "tool" with `tool_call_id` linking back to the call
 * - Special "think" tool for agent reasoning
 */
export class TrajectoryParser implements Parser {
  name = "SWE-bench Trajectory";

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    if (typeof data !== "object" || data === null) return {};
    const d = data as Record<string, unknown>;

    // Extract useful metadata from top-level fields
    const parts: string[] = [];
    if (d.instance_id && typeof d.instance_id === "string") {
      parts.push(d.instance_id);
    }

    return {
      title: parts.length > 0 ? parts.join(" - ") : undefined,
      provider: "SWE-bench",
    };
  }

  canParse(data: unknown): boolean {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    const d = data as Record<string, unknown>;

    // Must have trajectory array and trajectory_id
    if (!d.trajectory_id || typeof d.trajectory_id !== "string") return false;
    if (!Array.isArray(d.trajectory)) return false;

    // Check that trajectory entries look right
    const hasValidEntries = (d.trajectory as unknown[]).some((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        typeof e.role === "string" &&
        ["system", "user", "assistant", "tool"].includes(e.role)
      );
    });

    return hasValidEntries;
  }

  parse(data: unknown): Conversation {
    try {
      const input = TrajectoryInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid trajectory format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: TrajectoryInput): Conversation {
    const messages = this.transformMessages(input.trajectory);
    return { messages };
  }

  private transformMessages(trajectory: TrajectoryMessage[]): Message[] {
    const messages: Message[] = [];
    // Map tool_call id -> tool name for linking results
    const toolCallNames = new Map<string, string>();

    for (const entry of trajectory) {
      switch (entry.role) {
        case "system": {
          if (entry.content) {
            messages.push({
              id: generateId(),
              role: "system",
              parts: [{ id: generateId(), type: "text", text: entry.content }],
            });
          }
          break;
        }

        case "user": {
          if (entry.content) {
            messages.push({
              id: generateId(),
              role: "user",
              parts: [{ id: generateId(), type: "text", text: entry.content }],
            });
          }
          break;
        }

        case "assistant": {
          const parts: Array<
            | { id: string; type: "text"; text: string }
            | { id: string; type: "reasoning"; text: string }
            | { id: string; type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
          > = [];

          // Add text content if present
          if (entry.content) {
            parts.push({
              id: generateId(),
              type: "text",
              text: entry.content,
            });
          }

          // Process tool calls
          if (entry.tool_calls) {
            for (const tc of entry.tool_calls) {
              // The "think" tool is treated as reasoning
              if (tc.function.name === "think") {
                const thought = this.extractThought(tc.function.arguments);
                if (thought) {
                  parts.push({
                    id: generateId(),
                    type: "reasoning",
                    text: thought,
                  });
                }
              } else {
                // Regular tool call
                toolCallNames.set(tc.id, tc.function.name);
                parts.push({
                  id: generateId(),
                  type: "tool-call",
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  input: tc.function.arguments,
                });
              }
            }
          }

          // Only add if there are parts
          if (parts.length > 0) {
            messages.push({
              id: generateId(),
              role: "assistant",
              parts,
            });
          }
          break;
        }

        case "tool": {
          // Skip "think" tool results (they're just "Your thought has been logged.")
          if (entry.name === "think") break;

          const toolCallId = entry.tool_call_id || "";
          const toolName = (toolCallId ? toolCallNames.get(toolCallId) : undefined) || entry.name || "";

          messages.push({
            id: generateId(),
            role: "tool",
            parts: [{
              id: generateId(),
              type: "tool-result",
              toolCallId,
              toolName,
              output: entry.content || "",
            }],
          });
          break;
        }
      }
    }

    return messages;
  }

  private extractThought(args: unknown): string | null {
    if (typeof args === "object" && args !== null) {
      const a = args as Record<string, unknown>;
      if (typeof a.thought === "string") return a.thought;
    }
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        if (typeof parsed.thought === "string") return parsed.thought;
      } catch {
        return args;
      }
    }
    return null;
  }
}
