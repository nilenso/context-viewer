import { ZodError } from "zod";
import type { Parser, ConversationMetadata } from "../model/types";
import {
  ConversationSchema,
  type Conversation,
  type Message,
} from "../model/schema";
import { generateId } from "../id-generator";
import {
  AtifInputSchema,
  type AtifInput,
  type AtifMessage,
  type AtifToolCall,
  type AtifContentPart,
} from "./input-schemas";

interface AtifStepInfo {
  step: number;
  totalSteps?: number;
  label: string;
  displayLabel: string;
}

/**
 * Parser for ATIF agent-run exports as exposed by Docent.
 *
 * The observed shape is a Docent AgentRun object with:
 * - top-level `transcripts` array
 * - top-level `metadata.source_format` like "ATIF-v1.7" or `converted_from: "ATIF"`
 * - transcript messages with `metadata.atif_*` provenance fields
 * - assistant content split into `{ type: "reasoning" }` and `{ type: "text" }` blocks
 * - tool calls shaped as `{ function: "bash_command", arguments: {...} }`
 */
export class AtifParser implements Parser {
  name = "ATIF";

  canParse(data: unknown): boolean {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return false;
    }

    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.transcripts)) return false;

    const hasTranscriptMessages = d.transcripts.some((transcript) => {
      if (typeof transcript !== "object" || transcript === null) return false;
      const t = transcript as Record<string, unknown>;
      return Array.isArray(t.messages);
    });
    if (!hasTranscriptMessages) return false;

    const metadata = this.record(d.metadata);
    const sourceFormat = this.stringValue(metadata?.source_format);
    const convertedFrom = this.stringValue(metadata?.converted_from);
    const atifMetadata = this.record(metadata?.atif);
    const schemaVersion = this.stringValue(atifMetadata?.schema_version);

    if (sourceFormat?.startsWith("ATIF")) return true;
    if (convertedFrom === "ATIF") return true;
    if (schemaVersion?.startsWith("ATIF")) return true;

    // Fallback for partially exported files: ATIF provenance appears on
    // transcript or message metadata even when top-level metadata is missing.
    return d.transcripts.some((transcript) => {
      if (typeof transcript !== "object" || transcript === null) return false;
      const t = transcript as Record<string, unknown>;
      const transcriptMetadata = this.record(t.metadata);
      if (typeof transcriptMetadata?.atif_first_timestamp === "string") return true;

      const messages = Array.isArray(t.messages) ? t.messages : [];
      return messages.some((message) => {
        if (typeof message !== "object" || message === null) return false;
        const m = message as Record<string, unknown>;
        const messageMetadata = this.record(m.metadata);
        return typeof messageMetadata?.atif_step_id === "number";
      });
    });
  }

  extractMetadata(data: unknown): Partial<ConversationMetadata> {
    const parsed = AtifInputSchema.safeParse(data);
    if (!parsed.success) return { provider: "ATIF" };

    const input = parsed.data;
    const metadata = input.metadata;
    const atifAgent = metadata?.atif?.agent;
    const firstTranscript = input.transcripts[0];

    const model =
      atifAgent?.model_name ||
      firstTranscript?.metadata?.default_model_name ||
      metadata?.model;

    const agent =
      atifAgent?.name ||
      firstTranscript?.metadata?.agent_name ||
      metadata?.agent ||
      input.name ||
      undefined;

    return {
      title: input.name || firstTranscript?.name || input.id,
      model,
      agent,
      provider: "ATIF",
    };
  }

  parse(data: unknown): Conversation {
    try {
      const input = AtifInputSchema.parse(data);
      const conversation = this.transformToConversation(input);
      return ConversationSchema.parse(conversation);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `Invalid ATIF format: ${error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  private transformToConversation(input: AtifInput): Conversation {
    const messages: Message[] = [];
    const toolCallNames = new Map<string, string>();
    const toolCallIdsByStep = new Map<number, string[]>();
    const totalSteps = this.totalSteps(input);

    for (const transcript of input.transcripts) {
      for (const message of transcript.messages) {
        const transformed = this.transformMessage(
          message,
          toolCallNames,
          toolCallIdsByStep,
          totalSteps
        );
        if (transformed) messages.push(transformed);
      }
    }

    return { messages };
  }

  private transformMessage(
    message: AtifMessage,
    toolCallNames: Map<string, string>,
    toolCallIdsByStep: Map<number, string[]>,
    totalSteps: number | undefined
  ): Message | null {
    const timestamp = message.metadata?.atif_timestamp;
    const id = this.messageId(message.id);
    const stepInfo = this.stepInfo(message, totalSteps);

    switch (message.role) {
      case "system":
        return {
          id,
          role: "system",
          parts: this.textPartsFromContent(message.content, stepInfo),
          timestamp,
        };

      case "user":
        return {
          id,
          role: "user",
          parts: this.textPartsFromContent(message.content, stepInfo),
          timestamp,
        };

      case "assistant":
        return {
          id,
          role: "assistant",
          parts: this.assistantPartsFromMessage(
            message,
            toolCallNames,
            toolCallIdsByStep,
            stepInfo
          ),
          timestamp,
        };

      case "tool":
        return {
          id,
          role: "tool",
          parts: this.toolResultPartsFromMessage(
            message,
            toolCallNames,
            toolCallIdsByStep,
            stepInfo
          ),
          timestamp,
        };
    }
  }

  private assistantPartsFromMessage(
    message: AtifMessage,
    toolCallNames: Map<string, string>,
    toolCallIdsByStep: Map<number, string[]>,
    stepInfo: AtifStepInfo | undefined
  ): Array<
    | { id: string; type: "text"; text: string }
    | { id: string; type: "reasoning"; text: string }
    | {
        id: string;
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }
  > {
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

    if (typeof message.content === "string") {
      parts.push({
        id: generateId(),
        type: "text",
        text: this.withStepLabel(message.content, stepInfo),
      });
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        const converted = this.assistantPartFromContentBlock(block, stepInfo);
        if (converted) parts.push(converted);
      }
    }

    const stepToolCallIds: string[] = [];
    for (const toolCall of message.tool_calls ?? []) {
      const toolCallId = toolCall.id || `atif-tool-${generateId()}`;
      const { toolName, input } = this.toolCallInfo(toolCall);

      toolCallNames.set(toolCallId, toolName);
      stepToolCallIds.push(toolCallId);
      parts.push({
        id: generateId(),
        type: "tool-call",
        toolCallId,
        toolName,
        input: this.withStepObject(input, stepInfo, "input"),
      });
    }

    const stepId = message.metadata?.atif_step_id;
    if (typeof stepId === "number" && stepToolCallIds.length > 0) {
      toolCallIdsByStep.set(stepId, stepToolCallIds);
    }

    if (parts.length === 0) {
      parts.push({ id: generateId(), type: "text", text: "" });
    }

    return parts;
  }

  private assistantPartFromContentBlock(
    block: AtifContentPart,
    stepInfo: AtifStepInfo | undefined
  ):
    | { id: string; type: "text"; text: string }
    | { id: string; type: "reasoning"; text: string }
    | null {
    if (block.type === "reasoning") {
      const text = this.reasoningText(block);
      if (text === null) return null;
      return {
        id: generateId(),
        type: "reasoning",
        text: this.withStepLabel(text, stepInfo),
      };
    }

    if (block.type === "text") {
      const text = this.stringValue(block.text) ?? "";
      return {
        id: generateId(),
        type: "text",
        text: this.withStepLabel(text, stepInfo),
      };
    }

    return {
      id: generateId(),
      type: "text",
      text: this.withStepLabel(this.safeStringify(block), stepInfo),
    };
  }

  private toolResultPartsFromMessage(
    message: AtifMessage,
    toolCallNames: Map<string, string>,
    toolCallIdsByStep: Map<number, string[]>,
    stepInfo: AtifStepInfo | undefined
  ): Array<{
    id: string;
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError?: boolean;
  }> {
    const output = this.withStepOutput(this.outputFromContent(message.content), stepInfo);
    const toolCallIds = this.resolveToolCallIds(message, toolCallIdsByStep);
    const isError = message.error ? true : undefined;

    if (toolCallIds.length === 0) {
      const fallbackToolName = this.stringValue(message.function) ?? "";
      return [
        {
          id: generateId(),
          type: "tool-result",
          toolCallId: "",
          toolName: fallbackToolName,
          output,
          isError,
        },
      ];
    }

    return toolCallIds.map((toolCallId) => ({
      id: generateId(),
      type: "tool-result" as const,
      toolCallId,
      toolName: toolCallNames.get(toolCallId) || this.stringValue(message.function) || "",
      output,
      isError,
    }));
  }

  private resolveToolCallIds(
    message: AtifMessage,
    toolCallIdsByStep: Map<number, string[]>
  ): string[] {
    if (message.tool_call_id) return [message.tool_call_id];

    const stepId = message.metadata?.atif_step_id;
    if (typeof stepId !== "number") return [];

    const ids = toolCallIdsByStep.get(stepId) ?? [];
    if (ids.length <= 1) return ids;

    const observationIndex = message.metadata?.atif_observation_index;
    if (
      typeof observationIndex === "number" &&
      observationIndex >= 0 &&
      observationIndex < ids.length
    ) {
      return [ids[observationIndex]!];
    }

    return ids;
  }

  private textPartsFromContent(
    content: AtifMessage["content"],
    stepInfo: AtifStepInfo | undefined
  ): Array<{ id: string; type: "text"; text: string }> {
    if (typeof content === "string") {
      return [{ id: generateId(), type: "text", text: this.withStepLabel(content, stepInfo) }];
    }

    if (Array.isArray(content)) {
      const parts = content.map((block) => ({
        id: generateId(),
        type: "text" as const,
        text: this.withStepLabel(this.textFromContentBlock(block), stepInfo),
      }));
      return parts.length > 0
        ? parts
        : [{ id: generateId(), type: "text", text: this.withStepLabel("", stepInfo) }];
    }

    return [{ id: generateId(), type: "text", text: this.withStepLabel("", stepInfo) }];
  }

  private textFromContentBlock(block: AtifContentPart): string {
    if (block.type === "text") return this.stringValue(block.text) ?? "";
    if (block.type === "reasoning") return this.reasoningText(block) ?? "";
    return this.safeStringify(block);
  }

  private outputFromContent(content: AtifMessage["content"]): unknown {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((block) => this.textFromContentBlock(block)).join("\n");
    }
    return "";
  }

  private toolCallInfo(toolCall: AtifToolCall): {
    toolName: string;
    input: unknown;
  } {
    const fn = toolCall.function;

    if (typeof fn === "string") {
      return {
        toolName: fn,
        input: this.parseMaybeJson(toolCall.arguments ?? {}),
      };
    }

    if (typeof fn === "object" && fn !== null) {
      return {
        toolName: fn.name || "",
        input: this.parseMaybeJson(toolCall.arguments ?? fn.arguments ?? {}),
      };
    }

    return {
      toolName: "",
      input: this.parseMaybeJson(toolCall.arguments ?? {}),
    };
  }

  private reasoningText(block: AtifContentPart): string | null {
    if (block.type !== "reasoning") return null;
    if (typeof block.reasoning === "string") return block.reasoning;
    if (block.redacted) return "[redacted reasoning]";

    const summaryText = this.summaryToText(block.summary);
    return summaryText || null;
  }

  private summaryToText(summary: unknown): string {
    if (typeof summary === "string") return summary;
    if (!Array.isArray(summary)) return "";

    return summary
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (typeof record.summary === "string") return record.summary;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  private totalSteps(input: AtifInput): number | undefined {
    const originalStepCount = input.metadata?.atif?.original_step_count;
    if (typeof originalStepCount === "number" && originalStepCount > 0) {
      return originalStepCount;
    }

    let maxStep = 0;
    for (const transcript of input.transcripts) {
      for (const message of transcript.messages) {
        const step = message.metadata?.atif_step_id;
        if (typeof step === "number" && step > maxStep) {
          maxStep = step;
        }
      }
    }

    return maxStep > 0 ? maxStep : undefined;
  }

  private stepInfo(
    message: AtifMessage,
    totalSteps: number | undefined
  ): AtifStepInfo | undefined {
    const step = message.metadata?.atif_step_id;
    if (typeof step !== "number") return undefined;

    const label = totalSteps
      ? `ATIF step ${step} of ${totalSteps}`
      : `ATIF step ${step}`;

    return {
      step,
      totalSteps,
      label,
      displayLabel: `[${label}]`,
    };
  }

  private withStepLabel(text: string, stepInfo: AtifStepInfo | undefined): string {
    if (!stepInfo) return text;
    return text ? `${stepInfo.displayLabel}\n${text}` : stepInfo.displayLabel;
  }

  private withStepObject(
    value: unknown,
    stepInfo: AtifStepInfo | undefined,
    valueKey: "input" | "output"
  ): unknown {
    if (!stepInfo) return value;

    return {
      atif_step: stepInfo.totalSteps
        ? `${stepInfo.step}/${stepInfo.totalSteps}`
        : String(stepInfo.step),
      atif_step_label: stepInfo.label,
      [valueKey]: value,
    };
  }

  private withStepOutput(output: unknown, stepInfo: AtifStepInfo | undefined): unknown {
    if (!stepInfo) return output;
    if (typeof output === "string") return this.withStepLabel(output, stepInfo);
    return this.withStepObject(output, stepInfo, "output");
  }

  private parseMaybeJson(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private messageId(id: string | null | undefined): string {
    return id && id.trim() ? id : generateId();
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
