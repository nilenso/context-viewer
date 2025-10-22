import { z } from "zod";

/**
 * Message schema based on Vercel AI SDK structure
 * Supports 4 message types with typed content parts
 */

// ============================================================================
// Message Parts (Content Types)
// ============================================================================

// Common parts
export const TextPartSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  text: z.string(),
  token_count: z.number().optional(),
});

export const FilePartSchema = z.object({
  id: z.string(),
  type: z.literal("file"),
  data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
});

// User message parts
export const ImagePartSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  image: z.string(),
  mediaType: z.string().optional(),
});

// Assistant message parts
export const ReasoningPartSchema = z.object({
  id: z.string(),
  type: z.literal("reasoning"),
  text: z.string(),
  token_count: z.number().optional(),
});

export const ToolCallPartSchema = z.object({
  id: z.string(),
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  token_count: z.number().optional(),
});

// Tool message parts
export const ToolResultPartSchema = z.object({
  id: z.string(),
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.unknown(),
  isError: z.boolean().optional(),
  token_count: z.number().optional(),
});

// ============================================================================
// Message Types
// ============================================================================

export const SystemMessageSchema = z.object({
  id: z.string(),
  role: z.literal("system"),
  parts: z.array(TextPartSchema).nonempty(),
});

export const UserMessageSchema = z.object({
  id: z.string(),
  role: z.literal("user"),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        TextPartSchema,
        ImagePartSchema,
        FilePartSchema,
      ])
    )
    .nonempty(),
});

export const AssistantMessageSchema = z.object({
  id: z.string(),
  role: z.literal("assistant"),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        TextPartSchema,
        FilePartSchema,
        ReasoningPartSchema,
        ToolCallPartSchema,
      ])
    )
    .nonempty(),
});

export const ToolMessageSchema = z.object({
  id: z.string(),
  role: z.literal("tool"),
  parts: z.array(ToolResultPartSchema),
});

// Discriminated union of all message types
export const MessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export const ConversationSchema = z.object({
  messages: z.array(MessageSchema),
});

// ============================================================================
// Type Exports
// ============================================================================

export type TextPart = z.infer<typeof TextPartSchema>;
export type FilePart = z.infer<typeof FilePartSchema>;
export type ImagePart = z.infer<typeof ImagePartSchema>;
export type ReasoningPart = z.infer<typeof ReasoningPartSchema>;
export type ToolCallPart = z.infer<typeof ToolCallPartSchema>;
export type ToolResultPart = z.infer<typeof ToolResultPartSchema>;

export type SystemMessage = z.infer<typeof SystemMessageSchema>;
export type UserMessage = z.infer<typeof UserMessageSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type ToolMessage = z.infer<typeof ToolMessageSchema>;

export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
