import { z } from "zod";

/**
 * Input schemas for different API response formats
 * These are permissive (allow extra fields) to handle API evolution
 */

// ============================================================================
// OpenAI Completions Format Schema
// ============================================================================

const ToolCallSchema = z.object({
  type: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
  id: z.string(),
});

const CompletionMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  name: z.string().nullable().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
  // Allow any other fields (permissive mode)
});

export const CompletionsInputSchema = z.object({
  object: z.string(),
  messages: z.array(CompletionMessageSchema),
  usage: z
    .object({
      total_tokens: z.number(),
      completion_tokens: z.number(),
      prompt_tokens: z.number(),
    })
    .optional(),
  // Allow any other fields (permissive mode)
});

export type CompletionsInput = z.infer<typeof CompletionsInputSchema>;
export type CompletionMessage = z.infer<typeof CompletionMessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;

// ============================================================================
// Anthropic Responses Format Schema
// ============================================================================

const ContentItemSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  // Allow any other fields
});

const SummaryItemSchema = z.object({
  type: z.string(),
  text: z.string(),
  // Allow any other fields
});

const ResponseDataItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().optional(),
  content: z.array(ContentItemSchema).optional(),
  summary: z.array(SummaryItemSchema).optional(),
  created_by: z.string().optional(),
  role: z.enum(["user", "assistant"]).optional(),
  name: z.string().optional(),
  arguments: z.string().optional(),
  output: z.unknown().optional(),
  // Allow any other fields
});

export const ResponsesInputSchema = z.object({
  object: z.string(),
  data: z.array(ResponseDataItemSchema),
  // Allow any other fields
});

export type ResponsesInput = z.infer<typeof ResponsesInputSchema>;
export type ResponseDataItem = z.infer<typeof ResponseDataItemSchema>;
