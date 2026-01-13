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
// OpenAI Responses Format Schema
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
  role: z.enum(["system", "user", "assistant"]).optional(),
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

// ============================================================================
// OpenAI Conversations Format Schema
// ============================================================================

const ResponseInfoSchema = z.object({
  effort: z.string().optional(),
  model: z.string().optional(),
  response_id: z.string().optional(),
  temperature: z.number().optional(),
  // Allow any other fields
});

const ConversationItemContentSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  annotations: z.array(z.unknown()).optional(),
  logprobs: z.array(z.unknown()).optional(),
  // Allow any other fields
});

const ConversationItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().optional(),
  content: z.array(ConversationItemContentSchema).optional(),
  summary: z.array(SummaryItemSchema).optional(),
  role: z.enum(["system", "user", "assistant"]).optional(),
  arguments: z.string().optional(),
  call_id: z.string().optional(),
  name: z.string().optional(),
  output: z.unknown().optional(),
  // Allow any other fields
});

const ConversationDataItemSchema = z.object({
  id: z.string(),
  item: ConversationItemSchema,
  response_info: ResponseInfoSchema.optional(),
  // Allow any other fields
});

export const ConversationsInputSchema = z.object({
  object: z.string(),
  data: z.array(ConversationDataItemSchema),
  first_id: z.string().optional(),
  has_more: z.boolean().optional(),
  last_id: z.string().optional(),
  // Allow any other fields
});

export type ConversationsInput = z.infer<typeof ConversationsInputSchema>;
export type ConversationDataItem = z.infer<typeof ConversationDataItemSchema>;
export type ConversationItem = z.infer<typeof ConversationItemSchema>;

// ============================================================================
// Claude Code Transcripts Format Schema (JSONL)
// ============================================================================

// Content block types for assistant messages
const ClaudeThinkingContentSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
});

const ClaudeTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ClaudeToolUseContentSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

// Content block types for user messages (tool results)
const ClaudeToolResultContentSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.unknown(),
});

// Image content (for user messages)
const ClaudeImageContentSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.string(),
    media_type: z.string(),
    data: z.string(),
  }),
});

// Catch-all for unknown content types (e.g., "server_tool_use", "mcp_tool_use", etc.)
const ClaudeUnknownContentSchema = z.object({
  type: z.string(),
}).passthrough();

// Union of all content types - specific types first, then catch-all
const ClaudeContentSchema = z.union([
  ClaudeThinkingContentSchema,
  ClaudeTextContentSchema,
  ClaudeToolUseContentSchema,
  ClaudeToolResultContentSchema,
  ClaudeImageContentSchema,
  ClaudeUnknownContentSchema,
]);

// Message schema (nested in entry)
const ClaudeMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(ClaudeContentSchema)]),
  model: z.string().optional(),
  id: z.string().optional(),
  type: z.literal("message").optional(),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
  }).passthrough().optional(),
});

// Summary entry schema
const ClaudeSummaryEntrySchema = z.object({
  type: z.literal("summary"),
  summary: z.string(),
  leafUuid: z.string(),
});

// File history snapshot entry schema
const ClaudeFileHistorySnapshotEntrySchema = z.object({
  type: z.literal("file-history-snapshot"),
  messageId: z.string(),
  snapshot: z.unknown(),
  isSnapshotUpdate: z.boolean().optional(),
});

// User/Assistant message entry schema
const ClaudeMessageEntrySchema = z.object({
  type: z.enum(["user", "assistant"]),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  timestamp: z.string(),
  message: ClaudeMessageSchema,
  sessionId: z.string().optional(),
  version: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
  requestId: z.string().optional(),
  thinkingMetadata: z.unknown().optional(),
  toolUseResult: z.unknown().optional(),
});

// Catch-all for unknown entry types (e.g., "context", "init", etc.)
const ClaudeUnknownEntrySchema = z.object({
  type: z.string(),
}).passthrough();

// Union of all entry types - message entries first for priority, then known types, then catch-all
export const ClaudeTranscriptEntrySchema = z.union([
  ClaudeMessageEntrySchema,
  ClaudeSummaryEntrySchema,
  ClaudeFileHistorySnapshotEntrySchema,
  ClaudeUnknownEntrySchema,
]);

// The full transcript is an array of entries (parsed from JSONL)
export const ClaudeTranscriptsInputSchema = z.array(ClaudeTranscriptEntrySchema);

export type ClaudeTranscriptsInput = z.infer<typeof ClaudeTranscriptsInputSchema>;
export type ClaudeTranscriptEntry = z.infer<typeof ClaudeTranscriptEntrySchema>;
export type ClaudeMessageEntry = z.infer<typeof ClaudeMessageEntrySchema>;
export type ClaudeThinkingContent = z.infer<typeof ClaudeThinkingContentSchema>;
export type ClaudeTextContent = z.infer<typeof ClaudeTextContentSchema>;
export type ClaudeToolUseContent = z.infer<typeof ClaudeToolUseContentSchema>;
export type ClaudeToolResultContent = z.infer<typeof ClaudeToolResultContentSchema>;
export type ClaudeImageContent = z.infer<typeof ClaudeImageContentSchema>;
export type ClaudeContent = z.infer<typeof ClaudeContentSchema>;

// ============================================================================
// Codex CLI Transcripts Format Schema (JSONL)
// ============================================================================

// Content types for user messages
const CodexInputTextContentSchema = z.object({
  type: z.literal("input_text"),
  text: z.string(),
});

// Content types for assistant messages
const CodexOutputTextContentSchema = z.object({
  type: z.literal("output_text"),
  text: z.string(),
});

// Union of message content types
const CodexMessageContentSchema = z.union([
  CodexInputTextContentSchema,
  CodexOutputTextContentSchema,
]);

// Message payload (user or assistant message)
const CodexMessagePayloadSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant"]),
  content: z.array(CodexMessageContentSchema),
});

// Reasoning summary item
const CodexReasoningSummarySchema = z.object({
  type: z.literal("summary_text"),
  text: z.string(),
});

// Reasoning payload (agent thinking)
const CodexReasoningPayloadSchema = z.object({
  type: z.literal("reasoning"),
  summary: z.array(CodexReasoningSummarySchema).optional(),
  content: z.unknown().nullable().optional(),
  encrypted_content: z.string().optional(),
});

// Function call payload (tool use)
const CodexFunctionCallPayloadSchema = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string(),
  call_id: z.string(),
});

// Function call output payload (tool result)
const CodexFunctionCallOutputPayloadSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string(),
  output: z.string(),
});

// Union of response_item payload types
const CodexResponseItemPayloadSchema = z.union([
  CodexMessagePayloadSchema,
  CodexReasoningPayloadSchema,
  CodexFunctionCallPayloadSchema,
  CodexFunctionCallOutputPayloadSchema,
]);

// response_item entry
const CodexResponseItemEntrySchema = z.object({
  timestamp: z.string(),
  type: z.literal("response_item"),
  payload: CodexResponseItemPayloadSchema,
});

// session_meta entry
const CodexSessionMetaEntrySchema = z.object({
  timestamp: z.string(),
  type: z.literal("session_meta"),
  payload: z.object({
    id: z.string().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    originator: z.string().optional(),
    cli_version: z.string().optional(),
    instructions: z.string().optional(),
    source: z.string().optional(),
    model_provider: z.string().optional(),
    git: z.object({
      commit_hash: z.string().optional(),
      branch: z.string().optional(),
    }).optional(),
  }).passthrough(),
});

// event_msg entry (various event types)
const CodexEventMsgEntrySchema = z.object({
  timestamp: z.string(),
  type: z.literal("event_msg"),
  payload: z.object({
    type: z.string(),
  }).passthrough(),
});

// turn_context entry
const CodexTurnContextEntrySchema = z.object({
  timestamp: z.string(),
  type: z.literal("turn_context"),
  payload: z.object({
    cwd: z.string().optional(),
    approval_policy: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
  }).passthrough(),
});

// Catch-all for unknown entry types
const CodexUnknownEntrySchema = z.object({
  timestamp: z.string(),
  type: z.string(),
}).passthrough();

// Union of all entry types
export const CodexTranscriptEntrySchema = z.union([
  CodexResponseItemEntrySchema,
  CodexSessionMetaEntrySchema,
  CodexEventMsgEntrySchema,
  CodexTurnContextEntrySchema,
  CodexUnknownEntrySchema,
]);

// The full transcript is an array of entries (parsed from JSONL)
export const CodexTranscriptsInputSchema = z.array(CodexTranscriptEntrySchema);

export type CodexTranscriptsInput = z.infer<typeof CodexTranscriptsInputSchema>;
export type CodexTranscriptEntry = z.infer<typeof CodexTranscriptEntrySchema>;
export type CodexResponseItemEntry = z.infer<typeof CodexResponseItemEntrySchema>;
export type CodexMessagePayload = z.infer<typeof CodexMessagePayloadSchema>;
export type CodexReasoningPayload = z.infer<typeof CodexReasoningPayloadSchema>;
export type CodexFunctionCallPayload = z.infer<typeof CodexFunctionCallPayloadSchema>;
export type CodexFunctionCallOutputPayload = z.infer<typeof CodexFunctionCallOutputPayloadSchema>;
