import { ZodError } from "zod";
import type { Parser, ConversationMetadata } from "@/model/types";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "@/model/schema";
import {
  SweAgentTrajectoryInputSchema,
  type SweAgentTrajectoryInput,
  type SweAgentHistoryMessage,
} from "./input-schemas";

// Simple ID generator
let idCounter = 0;
const generateId = () => `swe-agent-traj-${++idCounter}`;

/**
 * Parser for SWE-Agent trajectory format (JSON)
 *
 * This format is produced by SWE-agent (used in SWE-bench Pro evaluations) and contains:
 * - `history`: array of conversation messages (system, user, assistant, tool)
 * - `trajectory`: array of action/observation step pairs (we use `history` instead)
 * - `info`: metadata including model_stats, exit_status, submission diff
 * - `environment`: instance ID string
 * - `replay_config`: JSON string with agent/environment config
 *
 * Key differences from the existing TrajectoryParser:
 * - Uses `history` array with `tool_calls` (stringified args) and `tool_call_ids`
 * - Messages have `agent`, `message_type`, `thought`, `action` fields
 * - No `trajectory_id` — uses `environment` as instance identifier
 */
export class SweAgentTrajectoryParser implements Parser {
  name = "SWE-Agent Trajectory";

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    if (typeof data !== "object" || data === null) return {};
    const d = data as Record<string, unknown>;

    const title =
      typeof d.environment === "string" ? d.environment : undefined;

    // Try to extract model from replay_config
    let model: string | undefined;
    if (typeof d.replay_config === "string") {
      try {
        const config = JSON.parse(d.replay_config);
        model = config?.agent?.model?.model_name;
      } catch {
        // ignore
      }
    }

    return {
      title,
      model,
      provider: "SWE-Agent",
    };
  }

  canParse(data: unknown): boolean {
    if (typeof data !== "object" || data === null || Array.isArray(data))
      return false;
    const d = data as Record<string, unknown>;

    // Must have history array and environment string
    if (!Array.isArray(d.history)) return false;
    if (typeof d.environment !== "string") return false;

    // Must have info with swe_agent_version (distinguishes from other formats)
    if (typeof d.info !== "object" || d.info === null) return false;
    const info = d.info as Record<string, unknown>;
    if (typeof info.swe_agent_version !== "string") return false;

    // Check that history entries have expected structure
    const hasValidEntries = (d.history as unknown[]).some((entry) => {
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
      const input = SweAgentTrajectoryInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid SWE-Agent trajectory format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(
    input: SweAgentTrajectoryInput
  ): Conversation {
    const messages = this.transformMessages(input.history);
    return { messages };
  }

  private transformMessages(history: SweAgentHistoryMessage[]): Message[] {
    const messages: Message[] = [];
    // Map tool_call id -> tool name for linking results
    const toolCallNames = new Map<string, string>();

    for (const entry of history) {
      switch (entry.role) {
        case "system": {
          if (entry.content) {
            messages.push({
              id: generateId(),
              role: "system",
              parts: [
                { id: generateId(), type: "text", text: entry.content },
              ],
            });
          }
          break;
        }

        case "user": {
          if (entry.content) {
            messages.push({
              id: generateId(),
              role: "user",
              parts: [
                { id: generateId(), type: "text", text: entry.content },
              ],
            });
          }
          break;
        }

        case "assistant": {
          const parts: Array<
            | { id: string; type: "text"; text: string }
            | { id: string; type: "reasoning"; text: string }
            | {
                id: string;
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                input: unknown;
              }
          > = [];

          // Use thought as reasoning if present and non-empty
          if (entry.thought) {
            parts.push({
              id: generateId(),
              type: "reasoning",
              text: entry.thought,
            });
          }

          // Add text content (if different from thought, to avoid duplication)
          if (entry.content && entry.content !== entry.thought) {
            parts.push({
              id: generateId(),
              type: "text",
              text: entry.content,
            });
          }

          // Process tool calls
          if (entry.tool_calls) {
            for (const tc of entry.tool_calls) {
              const toolName = tc.function.name;
              const toolCallId = tc.id;

              // Parse stringified arguments
              let args: unknown;
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = tc.function.arguments;
              }

              toolCallNames.set(toolCallId, toolName);
              parts.push({
                id: generateId(),
                type: "tool-call",
                toolCallId,
                toolName,
                input: args,
              });
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
          // tool_call_ids is an array; process each
          const toolCallIds = entry.tool_call_ids || [];
          if (toolCallIds.length > 0) {
            const resultParts = toolCallIds.map((toolCallId) => ({
              id: generateId(),
              type: "tool-result" as const,
              toolCallId,
              toolName: toolCallNames.get(toolCallId) || "",
              output: entry.content || "",
            }));

            messages.push({
              id: generateId(),
              role: "tool",
              parts: resultParts,
            });
          } else if (entry.content) {
            // Fallback: tool message without tool_call_ids
            messages.push({
              id: generateId(),
              role: "tool",
              parts: [
                {
                  id: generateId(),
                  type: "tool-result",
                  toolCallId: "",
                  toolName: "",
                  output: entry.content,
                },
              ],
            });
          }
          break;
        }
      }
    }

    return messages;
  }
}
