# Context Viewer — Behavioural Specification

*Derived exclusively from test assertions. Each property below is something the test suite enforces.*

---

## 1. File Formats & Parsing

### File format detection

- JSONL files (`.jsonl`) are parsed into arrays of objects, one per line.
- JSON files (`.json`) are parsed into a single object or array.
- `.traj` files are treated as JSON.
- `.txt` and `.md` files are returned as raw strings.
- When the extension is unknown but the content starts with `{` and contains `\n{`, JSONL parsing is attempted as a fallback.
- Invalid JSON throws an error.
- Supported extensions: `.txt`, `.md`, `.jsonl`, `.json`, `.traj`.
- A file validator rejects unsupported extensions (e.g. `.csv`) and accepts supported ones.

### Parser registry

- Multiple format-specific parsers are registered. The registry tries each in order and uses the first whose `canParse` returns true.
- If no parser matches, an error is thrown (`"No suitable parser found"`).
- Each parser produces a `Conversation` (array of messages with parts) and `ConversationMetadata` (parser name, model, provider).
- Known formats and their parser names:
  - Claude Code transcripts (JSONL with `type: "user"/"assistant"`, `isCompactSummary`, etc.) → `"Claude Code"`
  - Codex CLI transcripts → `"Codex CLI"`
  - OpenAI Completions (`object: "traffic.completion"`) → `"OpenAI Completions"`
  - Plain text strings → `"Plain Text"` (produces a single message)
- Every parsed message has an `id`. Every part within a message has an `id`.
- Messages have a `role` from `{"system", "user", "assistant", "tool"}`.
- Parts have a `type` from `{"text", "reasoning", "tool-call", "tool-result", "image", "file"}`.

### File drop input handling

- Regular files (non-JSON, or JSON that doesn't match export schemas) pass through unchanged.
- Session export JSON files (version `"1.0"`, with `files[]` and `groups[]`) are expanded into individual virtual files, with an `oldIdToIndex` mapping and `sessionGroups` array extracted.
- Single file export JSON files are passed through for processing.
- Invalid JSON in `.json` files is handled gracefully — the file passes through as-is.

---

## 2. Parse Stage

- Takes a `PipelineState` with a `file`, reads its text content, detects format, and parses it.
- Returns `conversation`, `summary`, and `metadata`.
- The summary is computed immediately from the parsed conversation (see §3).
- For a 1-message Claude Code transcript: parser name is `"Claude Code"`, provider is `"Anthropic"`, 1 message with role `"user"` and 1 text part.
- For a 338-message Claude Code transcript: parser name is `"Claude Code"`, model is `"claude-opus-4-6"`, provider is `"Anthropic"`.

### Pre-processed import restoration

When the parser detects a Context Viewer export (`parserName: "Context Viewer"`), the pipeline skips all AI stages and restores state directly:

- Default dimension is restored from `component` annotations on parts: each part's `component` field becomes its mapping entry. The component list is the unique set of mapped values.
- Component colors, prompt, and coloring prompt are restored from metadata.
- Top-level fields restored: `title`, `aiSummary`, `analysis`, `customSegmentationPrompt`, `customSummaryPrompt`, `customAnalysisPrompt`.
- Static components (role.type) are still computed from the conversation.
- Additional dimensions (beyond default) are restored from `part.dimensions` annotations — a record mapping dimension name to component name per part.
- Each restored dimension gets its own component list, mapping, timeline, prompt, and coloring prompt from the export metadata.

---

## 3. Conversation Summary

A pure function that computes statistics from a parsed conversation:

- `totalMessages`: count of all messages.
- `messagesByRole`: count per role (e.g. `{user: 5, assistant: 161, tool: 172}`).
- `textOnlyMessageCount`: messages with exactly 1 part of type `"text"`.
- `structuredContentMessageCount`: all other messages (multi-part, or single non-text part).
- `partCounts`: count per part type (e.g. `{text: 104, reasoning: 9, "tool-call": 173, "tool-result": 172, image: 1}`).

**Invariants:**
- Sum of `messagesByRole` values equals `totalMessages`.
- `textOnlyMessageCount + structuredContentMessageCount` equals `totalMessages`.

---

## 4. Token Counting

- Uses tiktoken (GPT-4 encoding) to count tokens in every message part.
- Adds a `token_count` field to each part.
- Text and reasoning parts: token count of the text content.
- Tool-call parts: token count of `toolName + JSON.stringify(input)`.
- Tool-result parts: token count of `toolName + JSON.stringify(output)`.
- Image and file parts: no `token_count` added (skipped).
- Deterministic: same input always produces the same token counts.
- Preserves message structure: count, roles, IDs, part counts all unchanged.
- Specific known values: a 12425-char compacted summary text = 2718 tokens. A `<local-command-caveat>` tag prefix = 50 tokens.

---

## 5. Static Componentisation

A deterministic, non-AI component assignment based on `role.partType`:

- Component name format: `"role.type"` (e.g. `"user.text"`, `"assistant.tool-call"`, `"tool.tool-result"`).
- Components are sorted by role order (`system` → `user` → `assistant` → `tool`), then alphabetically by type.
- Mapping covers every part — one entry per part ID, value is its `role.type`.
- Timeline has one entry per message, with cumulative token counts per component.
- Timeline is monotonically non-decreasing in `totalTokens`.

Specific known values for a 338-message transcript:
- Components: `["user.image", "user.text", "assistant.reasoning", "assistant.text", "assistant.tool-call", "tool.tool-result"]`
- 459 parts total.
- Timeline[0]: `{user.text: 50, totalTokens: 50}`.
- Timeline[49]: `{user.text: 482, assistant.reasoning: 320, assistant.text: 293, assistant.tool-call: 2667, tool.tool-result: 53332, totalTokens: 57094}`.

---

## 6. Segmentation Stage

Splits large text parts into smaller semantic chunks using AI.

### Behaviour
- Parts below the token threshold (default 500) are not segmented. No AI call is made.
- Parts above the threshold are sent to AI, which returns an array of regex lookahead patterns.
- The patterns are used with `String.split()` to divide the text.
- Only `text` and `reasoning` parts are eligible. Tool-call and tool-result parts are always skipped, even if above threshold.
- Child part IDs follow the pattern `parentId.N` (e.g. `"4.1"`, `"4.2"`, ..., `"4.22"`).
- Each child part preserves the parent's type.
- A custom threshold can be provided (e.g. 100 instead of 500).
- Progress is reported via callback: `(processed, total)` where `processed === total` at completion.

### Edge cases
- If AI returns no valid JSON array, the original part is kept unchanged.
- If splitting produces only 1 segment, no segmentation occurs.
- After segmentation, token counts are recalculated on the new parts.

### Known values
- A 2718-token compacted summary splits into 22 parts using 21 regex patterns targeting section headings (`"(?=Summary:)"`, `"(?=1\\. Primary Request...)"`, file path bullets, etc.).

---

## 7. Component Identification Stage

Discovers the semantic component list for a conversation using AI.

### `identifyComponents`
- Sends the conversation (with large content stripped) to AI.
- Parses a JSON array from the AI response (handles markdown code block wrapping).
- Deduplicates the result.
- Returns `[]` on invalid response or API error (never throws).
- Known result: 49 components for a 338-message coding session, 12 components for a focused prompt.

### `identifyForDimension`
- Orchestrates identification for a single dimension.
- When `customComponents` are provided: uses them directly, no AI call.
- Leading `"- "` prefix is stripped from custom components.
- **Idempotency:** if `customComponents` exactly match `discoveredComponents`, returns `{result: {}}` — no work done.
- When no custom components and no config: returns error `"No API key configured"`.
- Returns partial `DimensionData` to merge, never mutates the input.

---

## 8. Component Classification Stage

Maps every message part to a component using AI.

### `mapComponentsToIds`
- Processes parts in batches of 20, all batches in parallel.
- Each batch sends parts with context (role, type, content) to AI along with the component list.
- AI returns a JSON object mapping part IDs to component names.
- Batch results are merged into a single mapping.
- Returns `{}` on invalid AI response.
- Known result: 22-part conversation → 22-entry mapping. 67-part conversation → 67-entry mapping.

### `buildComponentTimeline`
- Builds cumulative token distribution snapshots, one per message.
- Each snapshot shows tokens per component up to and including that message.
- Component token sums equal `totalTokens` in each snapshot.
- Cumulative: later snapshots include all earlier tokens.

### `classifyForDimension`
- Orchestrates classification for a single dimension.
- **Skip condition 1:** no `discoveredComponents` → returns `{result: {}}`.
- **Skip condition 2 (idempotency):** existing mapping covers all part IDs, all mapping keys are valid part IDs, and all mapping values are in the current component set → returns `{result: {}}`.
- When not all parts are mapped and `"other"` is not in the component list, `"other"` is appended to `discoveredComponents`.
- Triggers reclassification when existing mapping values reference components not in the current list (stale mapping).
- Returns `componentMapping`, `componentTimeline`, and possibly updated `discoveredComponents`.

---

## 9. Color Assignment Stage

Assigns hex colors to components.

### `assignComponentColors`
- When preset colors are provided: uses them directly, fills missing components with `"gray"`. No AI call.
- When no presets: calls AI, which returns a JSON object mapping component names to hex colors.
- Cleans AI response keys: strips leading `"- "` and description suffixes after `": "`.
- Returns `{}` on API error.
- Known result: 49 components → 49 hex colors. 12 components → 12 hex colors (e.g. `"#f97316"`, `"#60a5fa"`).

### `colorForDimension`
- Orchestrates color assignment for a single dimension.
- **Skip condition:** no `discoveredComponents` → returns `{result: {}}`.
- **Idempotency:** if existing `componentColors` keys exactly match `discoveredComponents` (sorted) → returns `{result: {}}`.
- Re-assigns when component list changes (e.g. new component added).
- Preset colors bypass AI entirely.

---

## 10. Content Stripping (Pre-AI)

Before sending conversations to AI stages, large content is stripped to reduce tokens:

- Image parts: `image` field replaced with `"[IMAGE_STRIPPED]"`.
- File parts: `data` field replaced with `"[FILE_DATA_STRIPPED]"`.
- Tool-result parts: `output` truncated to 200 chars with `"[TRUNCATED, N chars stripped]"` suffix.
- Tool-call parts: `input` serialized and truncated similarly.
- Short text parts are left unchanged.
- Message count is preserved.

---

## 11. Summary Generation Stage

Generates a streaming AI summary of the conversation.

- Streams text chunks via callback, concatenates them into the full summary.
- Returns `{summary, error?}`.
- Works without a callback (summary is still collected).
- On stream failure: returns empty summary with error message.
- `runSummary` wrapper: populates `ctx.aiSummary`, records timing in `ctx.stepTimings.summarizing`, pushes errors to `ctx.warnings`.

---

## 12. Analysis Generation Stage

Generates a streaming AI analysis of context usage patterns.

- Takes the conversation, component timeline, component list, and AI summary.
- Streams text chunks, returns `{analysis, error?}`.
- `runAnalysis` wrapper: skips (returns empty) when `aiSummary` is missing or no components exist. Populates `ctx.analysis` and `ctx.stepTimings.analyzing`.
- `runEnsureSummaryThenAnalysis`: generates summary first if missing, then analysis. Skips summary if already present.
- `regenerateAnalysisIfNeeded`: only regenerates if analysis was previously generated (checks `ctx.analysis` or `ctx.stepTimings.analyzing`). Returns `false` and does nothing if no prior analysis exists.

---

## 13. Pipeline

The full processing pipeline: Parse → Count Tokens → Segment → Identify → Classify ∥ Color.

### Stage ordering
1. **Parse** → conversation, summary, metadata.
2. **Count tokens** → token counts on all parts, static components.
3. **Segment** → split large parts (always runs, cheap when no large parts).
4. **Identify** → discover component list per dimension (parallel across dimensions).
5. **Classify + Color** → map parts to components and assign colors (parallel within each dimension).

### Full pipeline properties
- Produces `conversation`, `summary`, `metadata`, `staticComponents`, `dimensions.default` with components/mapping/colors.
- Final status is `"success"`.
- Updates are emitted via `notify` callback with stage progression: `parsing` → `counting-tokens` → `segmenting` → `finding-components`.

### Context Viewer export skip
- When `parserName` is `"Context Viewer"`, the pipeline stops after parsing — no AI calls.
- All dimension data, colors, summaries, and prompts are restored from the export.

### API key pause
- When no API key is available, the pipeline pauses after token counting with status `"paused-for-api-key"`.
- `resumePipelinesWithApiKey` iterates all paused conversations and restarts their pipelines.
- Only conversations with status `"paused-for-api-key"` and an existing `conversation` are resumed.

---

## 14. Reprocessing

### `reprocessTarget`
- Re-runs the pipeline for a conversation after a `contextModifier` callback mutates its state.
- Typical pattern: clear `discoveredComponents`/`componentMapping`/`componentColors` to force re-identification.
- Can target specific dimensions via `dimNames` parameter.
- After pipeline completes, regenerates analysis if it previously existed.

### `applyPromptsToAll`
- Copies prompts, components, and colors from a source conversation to all other successful conversations.
- Copied fields: `customSegmentationPrompt`, `customSummaryPrompt`, `customAnalysisPrompt`, `segmentationThreshold`, and per-dimension: `prompt`, `customColoringPrompt`, `customComponents`, `discoveredComponents`, `componentColors`.
- Then runs the pipeline on each target.
- On targets, identification is idempotent (custom components already match), so only classification and coloring run.
- Does nothing when no targets exist.

### Reprocessing workflows observed
1. **Segmentation change:** re-segment → re-identify → re-classify → re-color. Part count changes (e.g. 15 → 67).
2. **Prompt edit:** clear discovered components → re-identify with custom prompt → re-classify → re-color. Different prompts produce different component lists (e.g. 18 vs 12 components).
3. **Apply to all:** copies final state to other conversations. Identification skips (idempotent), classification runs, coloring may skip (idempotent if colors already match).

---

## 15. Batch Processing

### `runPipelines`
- Processes multiple files in parallel via `Promise.all`.
- Each file gets a `PipelineState` context with its own `id` and `filename`.
- Calls `onFileComplete` after each file finishes.
- Returns `PipelineBatchResult` with all completed states.
- `file` and `config` fields are stripped from the returned states.
- Empty warnings arrays are set to `undefined`.
- Preset options (custom components, preset colors, custom prompts) are passed through to each pipeline.

### `runPipelineMutation`
- Creates placeholder entries in the store with status `"pending"` before processing begins.
- Uses preset IDs if provided, otherwise generates new ones.
- After all pipelines complete, clears `fileIdsRef` (unless a session import is pending).

---

## 16. Pipeline Notifications

- `markFailed(notify, id, error)`: emits `{status: "failed", step: undefined, error}`.
- `markPausedForApiKey(notify, ctx, fields, nextStep)`: emits `{status: "paused-for-api-key", step: undefined, pausedAtStep}` with picked data fields.
- `markComplete(notify, ctx, fields)`: emits `{status: "success", step: undefined}` with picked data fields.
- `updateState(notify, ctx, fields, nextStep)`: emits `{status: "success", step: nextStep}` with picked fields.
- Warnings are included only when the array is non-empty; otherwise `undefined`.
- `timed(fn)`: times an async function, returns `{result, timing}` where timing is in seconds.

---

## 17. Dimensions Model

A conversation can be analysed along multiple dimensions simultaneously.

- `ensureDimensions(ctx)`: creates `ctx.dimensions = {}` if missing, returns it.
- `getDimensionNames(ctx)`: returns dimension keys, defaulting to `["default"]` when empty or missing.
- `createEmptyDimension(name)`: returns `{name, discoveredComponents: [], componentMapping: {}, componentTimeline: [], componentColors: {}}`.
- `ensureDimension(dims, name)`: creates the dimension if missing, returns it. Does not overwrite existing.
- `getEffectiveComponents(dim)`: returns `customComponents` if non-empty, otherwise `discoveredComponents`. This is the single source of truth for active components.
- `getAllComponents(state)`: union of effective components across all dimensions.
- `getComponentColor(state, component, dimName)`: looks up a color from a specific dimension's color map.
- `getDimension` / `getDefaultDimension`: accessors by name, return `undefined` if missing.

---

## 18. Aggregation

Pure functions for token statistics across components.

- `getPartTokenCount(part)`: returns `token_count` or 0.
- `getMessageTokenCount(message)`: sums token counts of all parts.
- `aggregateComponentTokens(conversation, mapping, options)`: iterates parts, accumulates tokens per component from the mapping. Unmapped parts go to `"other"` by default, or are skipped when `unmappedLabel: null`. Respects `maxMessageIndex` and `partFilter`.
- `buildComponentTimeline`: one cumulative snapshot per message. Earlier message tokens carry forward. Monotonically non-decreasing `totalTokens`.
- `computeTupleTokens`: for multi-dimension analysis, creates compound keys like `"default:comp1 · relevance:comp2"` (separator: `" · "`). Respects `maxMessageIndex`, `filteredPartIds`, `partFilter`.
- `computePercentages`: converts token counts to `{component, tokens, percentage}` array.
- `generateComponentCSV`: header row `"Message,Total Tokens,Comp1,Comp2,..."`, data rows with token counts and percentages like `"10 (66.7%)"`.

---

## 19. Color Math

Pure hex/RGB utilities used for visualization:

- `isHexColor(value)`: true if starts with `"#"`.
- `hexToRgb(hex)`: parses `#rrggbb` to `{r, g, b}`. Invalid input returns gray fallback `{156, 163, 175}`.
- `rgbToHex(r, g, b)`: converts back, clamping to 0–255.
- Roundtrip: `rgbToHex(hexToRgb(hex))` returns the original hex for valid colors.
- `lightenColor(hex, 0)` → same color. `lightenColor(hex, 1)` → `"#ffffff"`.
- `darkenColor(hex, 0)` → same color. `darkenColor(hex, 1)` → `"#000000"`.
- `blendColors([])` → gray. `blendColors([x])` → `x`. `blendColors([a, a])` → `a`.
- Blending averages RGB components: `blend(#60a5fa, #34d399)` → `#4abcca`.
- All named color maps (`colorNameToHex`, `colorNameToWaffleHex`, etc.) contain valid hex values.

---

## 20. Message Filters

- `partPassesMessageTypeFilter(filters, partType, role)`: returns `true` when filters is `undefined` or contains `"all"`. Otherwise checks for `"role:type"` key.
- `hasActiveMessageTypeFilters(filters)`: `false` for `undefined`, empty set, or set containing `"all"`. `true` for specific filters like `"user:text"`.

---

## 21. Conversation Store

Zustand store managing application state.

### Conversation CRUD
- Add, retrieve by ID (returns `undefined` for missing), update partial fields, remove by ID.
- Rename: empty string clears the title (sets to `undefined`).
- Delete: blocked if the conversation belongs to any group. Allowed otherwise.

### Streaming mutations
- `appendSummaryChunk(id, chunk)`: concatenates to `aiSummary`.
- `appendAnalysisChunk(id, chunk)`: concatenates to `analysis`.

### Groups
- `groupConversations(ids, name?)`: creates a group from 2+ valid (status `"success"`, has conversation) conversations. Returns empty string if fewer than 2 qualify.
- Non-success or missing conversations are filtered out.
- Auto-generated name: `"Grouped: file1.jsonl, file2.jsonl"`.
- Groups can be removed, updated (name, title, file IDs), and queried by member file ID.
- A file can belong to multiple groups.

### Pending session import
- `processPendingGroups`: when a session export is imported, group creation is deferred until all member files finish processing. Old IDs are remapped to new IDs via `oldIdToIndex` + `fileIdsRef`. Groups with fewer than 2 mapped members are skipped. The pending import is cleared after processing.
- Does nothing when no pending import exists or when files aren't ready (not all `status: "success"`).

### Paused conversations
- `getPausedCount()`: counts conversations with status `"paused-for-api-key"`.

---

## 22. Export/Import

*(Covered by pre-existing `export-import.test.ts` — 17 tests for building and parsing file/session exports.)*
