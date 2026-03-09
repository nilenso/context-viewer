# Context Viewer - Workflow Documentation

## Overview

Context Viewer processes conversation logs through a multi-stage pipeline that transforms raw input into visual insights about token usage and context composition. The workflow is designed for:

- **Parallelism**: Independent steps run concurrently
- **Incremental UI updates**: Results display as they become available
- **Resilience**: Failures in optional steps don't block the pipeline
- **Customization**: Prompts can be edited and steps re-run

The workflow is orchestrated by `App.tsx` using a `WorkflowRunner` class that manages state transitions and timing.

---

## Workflow Stages

```
┌─────────────┐
│  File Drop  │
└──────┬──────┘
       ▼
┌─────────────┐
│  1. Parse   │ ─── Detect format, extract messages
└──────┬──────┘
       ▼
┌─────────────┐
│ 2. Tokens   │ ─── Count tokens per part (tiktoken)
└──────┬──────┘
       ▼
┌─────────────┐
│ 3. Static   │ ─── Instant role.type breakdown
└──────┬──────┘
       │
       ├────────────────┐
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│ 4. Segment  │  │ 5. Summary  │  (parallel)
└──────┬──────┘  └──────┬──────┘
       │                │
       ▼                │
┌─────────────┐         │
│ 6. Identify │         │
│  Components │         │
└──────┬──────┘         │
       ▼                │
┌─────────────┐         │
│  7. Map     │         │
│  Components │         │
└──────┬──────┘         │
       ▼                │
┌─────────────┐         │
│  8. Colors  │         │
└──────┬──────┘         │
       │◄───────────────┘
       ▼
┌─────────────┐
│ 9. Analysis │ ─── Optional, user-triggered
└─────────────┘
```

---

## Stage Details

### Stage 1: Parsing

**Purpose**: Transform raw file content into a unified `Conversation` structure.

**Input**: File object (JSON, JSONL, or TXT)

**Process**:
1. Read file as text
2. Detect format (JSONL by extension or content pattern)
3. Parse JSON/JSONL/plain text
4. Try each registered parser via `parserRegistry.parseWithMetadata()`
5. First parser where `canParse()` returns true handles it
6. Extract metadata (format name, model, agent if available)

**Output**:
- `Conversation` object with `messages[]` array
- `ConversationMetadata` (parser name, model, agent)
- `ConversationSummary` (message counts, role distribution)

**Parser Registry Order**:
1. ResponsesParser
2. CompletionsParser
3. ConversationsParser
4. ClaudeTranscriptsParser
5. CodexTranscriptsParser
6. OpenCodeTranscriptsParser
7. PlainTextParser (catch-all)

**Schema**: Each message has `id`, `role`, `parts[]`, and optional `timestamp`. Parts are discriminated by `type`: text, reasoning, tool-call, tool-result, image, file.

---

### Stage 2: Token Counting

**Purpose**: Calculate accurate token counts for each message part.

**Input**: Parsed `Conversation`

**Process**:
1. Initialize tiktoken encoder (reuse singleton to prevent UI freeze)
2. For each message part:
   - **text/reasoning**: Encode `text` field, count tokens
   - **tool-call**: Stringify `{toolName, input}`, count tokens
   - **tool-result**: Stringify `{toolName, output}`, count tokens
   - **image/file**: Skip (no token count)
3. Attach `token_count` to each part

**Output**: Same `Conversation` with `token_count` on each part

**Performance Note**: The tiktoken WASM encoder is initialized once and reused. Creating new instances per call caused UI freezes on large files.

---

### Stage 3: Static Componentization

**Purpose**: Provide instant, deterministic component breakdown without AI calls.

**Input**: Token-counted `Conversation`

**Process**:
1. For each message part, create component key: `{role}.{partType}`
   - Examples: `system.text`, `user.image`, `assistant.tool-call`, `tool.tool-result`
2. Build mapping: `{partId: component}`
3. Build timeline: For each message index, calculate cumulative tokens per component

**Output**:
- `staticComponents[]`: Unique component names
- `staticMapping`: Part ID → component name
- `staticTimeline[]`: Snapshots of component tokens at each message

**Note**: This runs immediately after token counting, before any AI calls.

---

### Stage 4: Segmentation

**Purpose**: Break large text parts into smaller semantic chunks for better component mapping.

**Input**: Token-counted `Conversation`, optional custom prompt

**Process**:
1. Identify large parts (>500 tokens, text or reasoning type only)
2. For each large part (in parallel):
   a. Send text to AI with segmentation prompt
   b. AI returns JSON array of regex patterns (positive lookaheads)
   c. Combine patterns into single regex
   d. Split text using the combined regex
   e. Create child parts with IDs like `{parentId}.1`, `{parentId}.2`
3. Replace original parts with segments in conversation
4. Re-run token counting on segmented conversation

**Prompt** (customizable):
```
Given the following text, tell me where all you would apply a break.
The purpose is semantic chunking suitable for categorization.
Only give me the top level sections.
Return ONLY a valid JSON array of regexes with positive lookahead.
```

**Output**: Segmented `Conversation` with more, smaller parts

**Skipped For**: Tool results (structured output, not prose)

---

### Stage 5: AI Summary Generation

**Purpose**: Generate a human-readable summary of the conversation.

**Input**: Stripped `Conversation`, metadata, stats

**Process**:
1. Strip large content (images, files, truncate tool results to 200 chars)
2. Build prompt with conversation JSON, metadata, and stats
3. Stream response from AI
4. Emit chunks to UI as they arrive

**Prompt** (customizable):
```
Analyze this conversation and provide a concise summary covering:
1. Goal: What is the main objective?
2. Turns: How many meaningful exchanges? What was the flow?
3. Result: What was accomplished?
```

**Output**: Markdown summary string

**Runs In Parallel With**: Segmentation (fire-and-forget, results merge later)

---

### Stage 6: Component Identification

**Purpose**: Identify logical/semantic components in the conversation.

**Input**: Segmented `Conversation`, optional custom prompt, optional custom components

**Process**:
1. Strip large content from conversation
2. If custom components provided, use those (skip AI call)
3. Otherwise, send conversation to AI with identification prompt
4. AI returns JSON array of component names
5. Normalize names (strip leading "- " if present)

**Prompt** (customizable): Describes component taxonomy with categories like identity, personality, environment, tools, workflow, code_style, project_context.

**Output Format**: `["identity", "personality.guidelines", "tools.file.read", ...]`

**Output**: `components[]` array of identified component names

---

### Stage 7: Component Mapping

**Purpose**: Assign each message part to one of the identified components.

**Input**: `Conversation`, `components[]`

**Process**:
1. Extract all parts with context (role, type, content preview)
2. Split into batches of 20 parts
3. For each batch (in parallel):
   a. Send parts and components list to AI
   b. AI returns `{partId: componentName}` mapping
4. Merge all batch results into single mapping
5. Build component timeline (cumulative tokens per component at each message)
6. Add "other" component if unmapped parts exist

**Prompt**:
```
Given this conversation and the list of components, give me a mapping
of message part ids to a component from the list.
Return a simple JSON object {id: component}
```

**Output**:
- `componentMapping`: Part ID → component name
- `componentTimeline[]`: Snapshots for time-travel visualization

**Batching Rationale**: Large conversations exceed context windows. 20-part batches balance coverage with API limits.

---

### Stage 8: Color Assignment

**Purpose**: Assign consistent colors to components for visualization.

**Input**: `components[]`

**Process**: Currently uses hardcoded mapping:
- identity → gray
- personality.* → purple
- environment.* → slate
- code_style.* → indigo
- search.* → blue
- workflow.* → emerald
- project_context.* → orange
- tools.* → gray
- Unmapped → gray

**Output**: `componentColors`: Component name → color name

**Note**: AI-based coloring code exists but is disabled. The hardcoded mapping ensures consistent colors across sessions.

---

### Stage 9: Context Analysis (Optional)

**Purpose**: Provide actionable insights for context optimization.

**Input**: `aiSummary`, `componentTimeline`, `components[]`, `Conversation`

**Trigger**: User clicks "Generate Analysis" link (not automatic)

**Process**:
1. Generate CSV of component distribution over time
2. Build prompt with summary and CSV data
3. Stream analysis response from AI
4. Switch UI to Analysis tab

**Prompt** (customizable):
```
Analyze the data and provide insights covering:
1. Context Growth Patterns
2. Redundancy & Efficiency
3. Context Relevance
4. Recommendations
```

**Output**: Markdown analysis with optimization recommendations

---

## Workflow Events

The workflow supports different entry points via `WorkflowEvent`:

| Event | Entry Point | Skips |
|-------|-------------|-------|
| `NewFile` | Stage 1 | Nothing |
| `SegmentationPromptChanged` | Stage 4 | Parse, Tokens |
| `ComponentPromptChanged` | Stage 6 | Parse, Tokens, Segment |
| `SummaryPromptChanged` | Stage 5 | Everything except Summary |
| `GroupedConversation` | After Stage 3 | Segment, Identify, Map, Color |
| `GenerateAnalysis` | Stage 9 | Everything except Analysis |

---

## Grouped Conversation Workflow

When grouping multiple conversations:

1. Concatenate all messages with prefixed IDs: `{convId}-{msgId}`
2. Merge component mappings with prefixed keys
3. Merge component colors (union)
4. Rebuild timelines from merged data
5. Skip segmentation and componentization (already done per-file)
6. Generate new summary for combined conversation
7. Analysis is optional (user-triggered)

---

## State Management

The `WorkflowState` interface tracks:

- **Identity**: `id`, `filename`
- **Lifecycle**: `status` (pending/processing/success/failed), `step`, `error`
- **Execution**: `file`, `config`, custom prompts
- **Data**: `conversation`, `summary`, `metadata`, `aiSummary`, `analysis`
- **Components**: AI-based (`components`, `componentMapping`, `componentTimeline`, `componentColors`)
- **Static**: `staticComponents`, `staticMapping`, `staticTimeline`
- **Tracking**: `warnings[]`, `stepTimings`

The `WorkflowRunner` class provides:
- `runActivity()`: Execute with timing
- `startStep()`: Update UI with current step
- `updateState()`: Intermediate state update
- `markComplete()`: Final success state
- `markFailed()`: Error state
