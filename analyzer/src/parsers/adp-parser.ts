import { ZodError } from "zod";
import { generateId } from "../id-generator";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../model/schema";
import type { ConversationMetadata, Parser } from "../model/types";
import {
  AdpInputSchema,
  type AdpContent,
  type AdpInput,
  type AdpTrajectoryInput,
} from "./input-schemas";

export class AdpParser implements Parser {
  name = "Agent Data Protocol";

  canParse(data: unknown): boolean {
    const trajectories = Array.isArray(data) ? data : [data];
    if (trajectories.length === 0) return false;

    return trajectories.every((trajectory) => {
      if (typeof trajectory !== "object" || trajectory === null || Array.isArray(trajectory)) {
        return false;
      }
      const value = trajectory as Record<string, unknown>;
      const classes = new Set([
        "text_observation",
        "web_observation",
        "api_action",
        "code_action",
        "message_action",
      ]);
      return (
        (typeof value.id === "string" || typeof value.id === "number") &&
        Array.isArray(value.content) &&
        value.content.every(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            classes.has(String((item as Record<string, unknown>).class_))
        )
      );
    });
  }

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    const parsed = AdpInputSchema.safeParse(data);
    if (!parsed.success) return { provider: "ADP" };

    const trajectories = this.trajectories(parsed.data);
    const first = trajectories[0]!;
    const details = first.details;

    return {
      title:
        trajectories.length === 1
          ? String(first.id)
          : `${String(first.id)} + ${trajectories.length - 1} more`,
      model: this.stringValue(details.model_name) ?? this.stringValue(details.model),
      agent: this.stringValue(details.agent_name) ?? this.stringValue(details.agent),
      provider: "ADP",
    };
  }

  parse(data: unknown): Conversation {
    try {
      const input = AdpInputSchema.parse(data);
      const messages = this.trajectories(input).flatMap((trajectory) =>
        this.transformTrajectory(trajectory)
      );
      return ConversationSchema.parse({ messages });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid ADP format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private trajectories(input: AdpInput): AdpTrajectoryInput[] {
    return Array.isArray(input) ? input : [input];
  }

  private transformTrajectory(trajectory: AdpTrajectoryInput): Message[] {
    const messages: Message[] = [];
    let latestToolCall: { id: string; name: string } | undefined;

    for (const item of trajectory.content) {
      if (item.class_ === "text_observation") {
        if (item.source === "environment" || latestToolCall) {
          messages.push(this.toolResult(item.content, item.name ?? undefined, latestToolCall));
          latestToolCall = undefined;
        } else {
          messages.push({
            id: generateId(),
            role: "user",
            parts: [{ id: generateId(), type: "text", text: item.content }],
          });
        }
        continue;
      }

      if (item.class_ === "web_observation") {
        const { class_: _, ...output } = item;
        messages.push(this.toolResult(output, "browser", latestToolCall));
        latestToolCall = undefined;
        continue;
      }

      if (item.class_ === "message_action") {
        const parts: Extract<Message, { role: "assistant" }>["parts"] = [];
        if (item.description) {
          parts.push({ id: generateId(), type: "reasoning", text: item.description });
        }
        parts.push({ id: generateId(), type: "text", text: item.content });
        messages.push({ id: generateId(), role: "assistant", parts });
        latestToolCall = undefined;
        continue;
      }

      const toolCallId = generateId();
      const toolName =
        item.class_ === "api_action"
          ? item.function
          : `execute_${item.language || "code"}`;
      const input =
        item.class_ === "api_action"
          ? item.kwargs
          : { language: item.language, code: item.content };
      const parts: Extract<Message, { role: "assistant" }>["parts"] = [];
      if (item.description) {
        parts.push({ id: generateId(), type: "reasoning", text: item.description });
      }
      parts.push({
        id: generateId(),
        type: "tool-call",
        toolCallId,
        toolName,
        input,
      });
      messages.push({ id: generateId(), role: "assistant", parts });
      latestToolCall = { id: toolCallId, name: toolName };
    }

    return messages;
  }

  private toolResult(
    output: unknown,
    explicitName: string | undefined,
    latestToolCall: { id: string; name: string } | undefined
  ): Extract<Message, { role: "tool" }> {
    return {
      id: generateId(),
      role: "tool",
      parts: [
        {
          id: generateId(),
          type: "tool-result",
          toolCallId: latestToolCall?.id ?? "",
          toolName: latestToolCall?.name ?? explicitName ?? "",
          output,
        },
      ],
    };
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}
