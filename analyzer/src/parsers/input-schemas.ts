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

// ============================================================================
// OpenCode Transcripts Format Schema (JSON)
// ============================================================================

// Time object with created/updated/completed timestamps
const OpenCodeTimeSchema = z.object({
  created: z.number(),
  updated: z.number().optional(),
  completed: z.number().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
});

// Token information
const OpenCodeTokensSchema = z.object({
  input: z.number().optional(),
  output: z.number().optional(),
  reasoning: z.number().optional(),
  cache: z.object({
    read: z.number().optional(),
    write: z.number().optional(),
  }).optional(),
});

// Session info at the top level
const OpenCodeSessionInfoSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  version: z.string().optional(),
  projectID: z.string().optional(),
  directory: z.string().optional(),
  title: z.string().optional(),
  time: OpenCodeTimeSchema.optional(),
  summary: z.object({
    additions: z.number().optional(),
    deletions: z.number().optional(),
    files: z.number().optional(),
  }).optional(),
});

// Message info
const OpenCodeMessageInfoSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  time: OpenCodeTimeSchema.optional(),
  parentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  mode: z.string().optional(),
  agent: z.string().optional(),
  path: z.object({
    cwd: z.string().optional(),
    root: z.string().optional(),
  }).optional(),
  cost: z.number().optional(),
  tokens: OpenCodeTokensSchema.optional(),
  finish: z.string().optional(),
  summary: z.object({
    title: z.string().optional(),
    diffs: z.array(z.unknown()).optional(),
  }).optional(),
  model: z.object({
    providerID: z.string().optional(),
    modelID: z.string().optional(),
  }).optional(),
});

// Part types

// Text part
const OpenCodeTextPartSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  type: z.literal("text"),
  text: z.string(),
  time: OpenCodeTimeSchema.optional(),
});

// Reasoning part
const OpenCodeReasoningPartSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  type: z.literal("reasoning"),
  text: z.string().optional(),
  metadata: z.unknown().optional(),
  time: OpenCodeTimeSchema.optional(),
});

// Tool part with state containing input/output
const OpenCodeToolPartSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  type: z.literal("tool"),
  callID: z.string(),
  tool: z.string(),
  state: z.object({
    status: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    title: z.string().optional(),
    metadata: z.unknown().optional(),
    time: OpenCodeTimeSchema.optional(),
  }),
});

// Step start part
const OpenCodeStepStartPartSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  type: z.literal("step-start"),
  snapshot: z.string().optional(),
});

// Step finish part
const OpenCodeStepFinishPartSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  type: z.literal("step-finish"),
  reason: z.string().optional(),
  snapshot: z.string().optional(),
  cost: z.number().optional(),
  tokens: OpenCodeTokensSchema.optional(),
});

// Patch part (git changes)
const OpenCodePatchPartSchema = z.object({
  id: z.string(),
  sessionID: z.string().optional(),
  messageID: z.string().optional(),
  type: z.literal("patch"),
  hash: z.string().optional(),
  files: z.array(z.string()).optional(),
});

// Catch-all for unknown part types
const OpenCodeUnknownPartSchema = z.object({
  id: z.string(),
  type: z.string(),
}).passthrough();

// Union of all part types
const OpenCodePartSchema = z.union([
  OpenCodeTextPartSchema,
  OpenCodeReasoningPartSchema,
  OpenCodeToolPartSchema,
  OpenCodeStepStartPartSchema,
  OpenCodeStepFinishPartSchema,
  OpenCodePatchPartSchema,
  OpenCodeUnknownPartSchema,
]);

// Message schema
const OpenCodeMessageSchema = z.object({
  info: OpenCodeMessageInfoSchema,
  parts: z.array(OpenCodePartSchema),
});

// Full transcript schema
export const OpenCodeTranscriptsInputSchema = z.object({
  info: OpenCodeSessionInfoSchema,
  messages: z.array(OpenCodeMessageSchema),
});

export type OpenCodeTranscriptsInput = z.infer<typeof OpenCodeTranscriptsInputSchema>;
export type OpenCodeSessionInfo = z.infer<typeof OpenCodeSessionInfoSchema>;
export type OpenCodeMessage = z.infer<typeof OpenCodeMessageSchema>;
export type OpenCodeMessageInfo = z.infer<typeof OpenCodeMessageInfoSchema>;
export type OpenCodePart = z.infer<typeof OpenCodePartSchema>;
export type OpenCodeTextPart = z.infer<typeof OpenCodeTextPartSchema>;
export type OpenCodeReasoningPart = z.infer<typeof OpenCodeReasoningPartSchema>;
export type OpenCodeToolPart = z.infer<typeof OpenCodeToolPartSchema>;
export type OpenCodeStepStartPart = z.infer<typeof OpenCodeStepStartPartSchema>;
export type OpenCodeStepFinishPart = z.infer<typeof OpenCodeStepFinishPartSchema>;
export type OpenCodePatchPart = z.infer<typeof OpenCodePatchPartSchema>;

// ============================================================================
// ATIF / Docent Agent Run Format Schema (JSON)
// ============================================================================

// ATIF content parts as stored in Docent agent-run exports. Assistant content
// is usually an array of reasoning/text blocks; user and tool content is often
// a plain string.
const AtifReasoningContentSchema = z.object({
  type: z.literal("reasoning"),
  reasoning: z.string().optional().nullable(),
  summary: z.unknown().optional().nullable(),
  signature: z.unknown().optional().nullable(),
  redacted: z.boolean().optional(),
}).passthrough();

const AtifTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string().optional().nullable(),
  refusal: z.unknown().optional().nullable(),
}).passthrough();

const AtifUnknownContentSchema = z.object({
  type: z.string(),
}).passthrough();

const AtifContentPartSchema = z.union([
  AtifReasoningContentSchema,
  AtifTextContentSchema,
  AtifUnknownContentSchema,
]);

// Tool calls in these exports are not the OpenAI shape. `function` is commonly
// a string such as "bash_command", and `arguments` is already parsed.
const AtifToolCallSchema = z.object({
  id: z.string().optional().nullable(),
  function: z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      arguments: z.unknown().optional(),
    }).passthrough(),
  ]).optional().nullable(),
  arguments: z.unknown().optional(),
  type: z.string().optional().nullable(),
  parse_error: z.unknown().optional().nullable(),
  view: z.unknown().optional().nullable(),
}).passthrough();

const AtifMetricsSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  cost_usd: z.number().optional(),
}).passthrough();

const AtifMessageMetadataSchema = z.object({
  atif_step_id: z.number().optional(),
  atif_source: z.string().optional(),
  atif_timestamp: z.string().optional(),
  atif_metrics: AtifMetricsSchema.optional(),
  atif_observation_index: z.number().optional(),
}).passthrough();

const AtifMessageSchema = z.object({
  id: z.string().optional().nullable(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(AtifContentPartSchema), z.null()]).optional(),
  metadata: AtifMessageMetadataSchema.optional(),
  model: z.string().optional(),
  tool_calls: z.array(AtifToolCallSchema).optional().nullable(),
  tool_call_id: z.string().optional().nullable(),
  function: z.string().optional().nullable(),
  error: z.unknown().optional().nullable(),
}).passthrough();

const AtifTranscriptMetadataSchema = z.object({
  agent_name: z.string().optional(),
  agent_version: z.string().optional(),
  atif_first_timestamp: z.string().optional(),
  default_model_name: z.string().optional(),
}).passthrough();

const AtifTranscriptSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  transcript_group_id: z.string().optional().nullable(),
  created_at: z.string().optional(),
  messages: z.array(AtifMessageSchema),
  metadata: AtifTranscriptMetadataSchema.optional(),
}).passthrough();

const AtifRunMetadataSchema = z.object({
  source_format: z.string().optional(),
  converted_from: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  benchmark: z.string().optional(),
  atif: z.object({
    schema_version: z.string().optional(),
    session_id: z.string().optional(),
    original_step_count: z.number().optional(),
    agent: z.object({
      name: z.string().optional(),
      version: z.string().optional(),
      model_name: z.string().optional(),
    }).passthrough().optional(),
    final_metrics: z.unknown().optional(),
  }).passthrough().optional(),
}).passthrough();

export const AtifInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  transcripts: z.array(AtifTranscriptSchema),
  transcript_groups: z.array(z.unknown()).optional(),
  metadata: AtifRunMetadataSchema.optional(),
}).passthrough();

export type AtifInput = z.infer<typeof AtifInputSchema>;
export type AtifTranscript = z.infer<typeof AtifTranscriptSchema>;
export type AtifMessage = z.infer<typeof AtifMessageSchema>;
export type AtifContentPart = z.infer<typeof AtifContentPartSchema>;
export type AtifToolCall = z.infer<typeof AtifToolCallSchema>;

// ============================================================================
// SWE-bench Trajectory Format Schema (JSON)
// ============================================================================

// Tool call in trajectory messages (OpenAI function calling format with parsed arguments)
const TrajectoryToolCallSchema = z.object({
  function: z.object({
    name: z.string(),
    arguments: z.unknown(), // Already parsed object (not stringified JSON)
  }),
  id: z.string(),
  type: z.literal("function"),
});

// Individual message in the trajectory array
const TrajectoryMessageSchema = z.object({
  content: z.string().nullable(),
  name: z.string().nullable().optional(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  tool_call_id: z.string().nullable().optional(),
  tool_calls: z.array(TrajectoryToolCallSchema).nullable().optional(),
});

// Full trajectory file schema
export const TrajectoryInputSchema = z.object({
  trajectory_id: z.string(),
  instance_id: z.string(),
  repo: z.string().optional(),
  exit_status: z.string().optional(),
  resolved: z.number().optional(),
  gen_tests_correct: z.unknown().optional(),
  pred_passes_gen_tests: z.unknown().optional(),
  model_patch: z.string().optional(),
  trajectory: z.array(TrajectoryMessageSchema),
});

export type TrajectoryInput = z.infer<typeof TrajectoryInputSchema>;
export type TrajectoryMessage = z.infer<typeof TrajectoryMessageSchema>;
export type TrajectoryToolCall = z.infer<typeof TrajectoryToolCallSchema>;

// ============================================================================
// SWE-Agent Trajectory Format Schema (JSON)
// ============================================================================

// Tool call in SWE-Agent history messages (stringified arguments)
const SweAgentToolCallSchema = z.object({
  index: z.number().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(), // Stringified JSON (unlike TrajectoryToolCall)
  }),
  id: z.string(),
  type: z.literal("function"),
});

// Individual message in the history array
const SweAgentHistoryMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable().optional(),
  agent: z.string().optional(),
  message_type: z.string().optional(),
  // Assistant-specific fields
  thought: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  tool_calls: z.array(SweAgentToolCallSchema).nullable().optional(),
  // Tool-specific fields (array of IDs, not single ID)
  tool_call_ids: z.array(z.string()).nullable().optional(),
});

// Model stats in info
const SweAgentModelStatsSchema = z.object({
  instance_cost: z.number().optional(),
  tokens_sent: z.number().optional(),
  tokens_received: z.number().optional(),
  api_calls: z.number().optional(),
});

// Info block
const SweAgentInfoSchema = z.object({
  swe_agent_hash: z.string().optional(),
  swe_agent_version: z.string(),
  swe_rex_version: z.string().optional(),
  swe_rex_hash: z.string().optional(),
  submission: z.string().nullable().optional(),
  exit_status: z.string().optional(),
  edited_files30: z.string().optional(),
  edited_files50: z.string().optional(),
  edited_files70: z.string().optional(),
  model_stats: SweAgentModelStatsSchema.optional(),
});

// Full SWE-Agent trajectory file schema
export const SweAgentTrajectoryInputSchema = z.object({
  trajectory: z.array(z.unknown()), // We use history instead
  history: z.array(SweAgentHistoryMessageSchema),
  info: SweAgentInfoSchema,
  replay_config: z.string().optional(),
  environment: z.string(),
});

export type SweAgentTrajectoryInput = z.infer<typeof SweAgentTrajectoryInputSchema>;
export type SweAgentHistoryMessage = z.infer<typeof SweAgentHistoryMessageSchema>;
export type SweAgentToolCall = z.infer<typeof SweAgentToolCallSchema>;
