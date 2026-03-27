# Separation Report — analyzer / viewer extraction

Date: 2026-03-27

## Overview

The original monolithic `src/` was split into two top-level packages:

- **`analyzer/`** — headless library for analyzing AI conversation transcripts. Zero UI dependencies, zero browser APIs, no `import.meta.env`. npm-publishable.
- **`viewer/`** — React UI that imports `context-analyzer` as a library dependency.

The original `src/` is left untouched and can be removed once the new structure is validated in production.

## Structure

```
context-viewer/
├── analyzer/                    # Headless library — 41 source files, 19 test files
│   ├── src/
│   │   ├── index.ts            # Public API: analyze() with sessions + interceptors
│   │   ├── pipeline.ts         # Stage chain with interceptor hooks (pre/post)
│   │   ├── session.ts          # In-memory session store for iteration
│   │   ├── config.ts           # AIConfig — caller-provided, no env vars
│   │   ├── errors.ts           # StageError with 4 categories
│   │   ├── logger.ts           # silent/info/debug + custom sink
│   │   ├── model/              # schema, types, dimensions, export-schema
│   │   ├── parsers/            # 10 format parsers + registry
│   │   ├── stages/             # 8 stages + prompts + strip-large-content
│   │   └── operations/         # aggregation, token-counting, static-components,
│   │                             color-math, export-builder, conversation-summary
│   └── __tests__/              # 166 tests (159 pass, 7 skipped — need external fixtures)
│
├── viewer/                      # React UI — depends on context-analyzer
│   ├── src/
│   │   ├── main.tsx
│   │   ├── stores/             # conversation-store, ui-store, url-store, actions
│   │   ├── ui/                 # 35 React components + 14 shadcn primitives
│   │   └── lib/                # 10 viewer-local modules
│   ├── public/                 # presets, logo
│   └── __tests__/              # 7 tests
│
└── src/                         # Original codebase (untouched)
```

## Analyzer public API

### Single entry point: `analyze()`

```typescript
// First run — creates session
const result = await analyze({ files: [...], components: [...] }, config);

// Iteration — pass sessionId + what changed
const result2 = await analyze({ sessionId: result.sessionId, components: [...] }, config);
```

- **Sessions**: `analyze()` returns a `sessionId`. Passing it back on subsequent calls enables iteration — the session layer diffs inputs, clears affected outputs, and the pipeline's idempotency skips unchanged stages.
- **Interceptors**: `{ stage, timing: "pre"|"post", fn: (ctx) => void }` — hook into stage boundaries for live UI updates or logging.
- **Returns**: `sessionId`, `states: PipelineState[]` (full annotated conversations), `analytics: FileAnalytics[]` (waffle-chart-ready numbers), `errors: StageError[]`.

### Companion functions (outside the pipeline)

- `summarize(result, config, options?)` — AI narrative summary
- `analyzeContext(result, config, options?)` — AI context analysis with recommendations
- `group(result, options?)` — merge files into virtual conversation (pure, no AI)
- `deleteSession(sessionId)` — clean up session memory

### Pure operations (exported for viewer rendering)

- `aggregateComponentTokens`, `computeTupleTokens`, `buildComponentTimeline`
- `getMessageTokenCount`, `getPartTokenCount`
- `createEmptyDimension`, `getDefaultDimension`, `getAllComponents`
- `buildSessionExport`, `buildFileExport`
- Color math: `hexToRgb`, `rgbToHex`, `lightenColor`, `darkenColor`, `blendColors`, etc.
- Prompt defaults: `getDefaultComponentIdentificationPrompt`, etc.
- Constants: `DEFAULT_SEGMENTATION_THRESHOLD`, `TUPLE_SEPARATOR`, `SUPPORTED_EXTENSIONS`
- Schemas: `SessionExportSchema`, `FileExportSchema` (Zod, for file drop detection)

## Viewer dependency on analyzer

### Integration points

The **stores layer** is the only place that calls `analyze()`, `summarize()`, `analyzeContext()`. UI components never call analyzer functions that trigger AI. They only import:

- **Types** (14): `PipelineState`, `DimensionData`, `Conversation`, `Message`, `Stage`, `Interceptor`, `Group`, `ConversationMetadata`, `ConversationSummary`, `ComponentTimelineSnapshot`, `OriginInfo`, part types (`TextPart`, `ReasoningPart`, etc.)
- **Pure operations** (for rendering): aggregation functions, dimension helpers, color math
- **Constants**: thresholds, separators, extension lists

### Runtime function calls from viewer (by category)

| Category | Functions |
|----------|-----------|
| Primary API | `analyze`, `deleteSession` |
| Summary/Analysis | `summarize`, `analyzeContext` |
| Aggregation (rendering) | `aggregateComponentTokens`, `computeTupleTokens`, `buildComponentTimeline`, `getMessageTokenCount`, `getPartTokenCount` |
| Dimension helpers | `createEmptyDimension`, `getDefaultDimension`, `getAllComponents` |
| Export | `buildSessionExport`, `SessionExportSchema`, `FileExportSchema` |
| Prompt defaults | 5 `getDefault*Prompt` functions |
| Constants | `DEFAULT_SEGMENTATION_THRESHOLD`, `TUPLE_SEPARATOR`, `SUPPORTED_EXTENSIONS`, `SUPPORTED_EXTENSIONS_TEXT` |

## Model overlap

No type duplication. The viewer defines types that extend or complement analyzer types:

| Viewer type | Relationship to analyzer |
|-------------|------------------------|
| `ViewerConversationState` | `extends PipelineState` — adds `status`, `step`, `error`, `pausedAtStep`, `sessionId` |
| `StageGroup` | Viewer-only — groups pipeline stages for UI progress display |
| `PresetConfig`, `PresetSummary` | Viewer-only — presets use browser `fetch()` to load from `public/` |
| `LogLevel`, `LogEntry`, `ConversationLogs` | Viewer's own logging for UI display (independent of analyzer's logger) |
| `AIApiMode`, `ReasoningEffort` | Re-exported from analyzer (no duplication) |

## Viewer-local modules

| File | Purpose | Why not in analyzer |
|------|---------|---------------------|
| `ai-config.ts` | Runtime API key management, `import.meta.env` | Browser env vars, mutable runtime state |
| `file-import.ts` | Session export detection on file drop | Uses `File`/`Blob` browser APIs |
| `file-validator.ts` | Dropzone file type validation | Uses `File` browser API |
| `message-filters.ts` | UI message type filtering | Adapts UI filter state into analyzer's `partFilter` interface |
| `pipeline-logging.ts` | Stage timing display in WorkflowDetailModal | Viewer-specific log subscriber system |
| `preset-loader.ts` | Load presets from `public/` via fetch | Browser `fetch()` + `import.meta.env.BASE_URL` |
| `reprocessing.ts` | Helpers for building reprocess options | ⚠️ Marked for review — may move to analyzer |
| `stage-groups.ts` | `StageGroup` type | UI display concern |
| `id-generator.ts` | Simple counter for viewer-generated IDs | Viewer needs its own ID sequence |

### Note on `reprocessing.ts`

This module builds `AnalyzeOptions` objects for iteration scenarios (change segmentation prompt → build options with new prompt). The knowledge of "which input change triggers which stage re-run" lives in the analyzer's `session.ts` (`applyIterationInputs`). The viewer's `reprocessing.ts` is just convenience helpers for constructing the options objects — it doesn't encode re-run logic itself.

## Note on `message-filters.ts`

`partPassesMessageTypeFilter` is a pure function that takes `Set<string>` + `partType` + `messageRole` and returns a boolean. It adapts the viewer's UI filter state (checkboxes for which message types to show) into a predicate. The analyzer's `aggregateComponentTokens` already accepts a `partFilter` option — the viewer's filter function is the implementation for that hook. Correctly placed in viewer.

## Tests

### Analyzer: 19 files, 166 tests

All original stage, operation, model, and parser tests were ported with minimal changes:
- Import paths: `@/` → relative
- Config mocks: old `getAIConfig`/`hasApiKey` mocks → new `createModel`/`getProviderOptions` mocks
- Stage signatures: config now passed as parameter instead of read from module state
- `streamText` → `generateText`: summary and analysis tests adapted for non-streaming API
- Ground truth data, assertions, and recording references preserved

New tests:
- **Session + interceptor tests** (13): session creation, iteration, input diffing, interceptor ordering
- **Export-import round-trip tests** (17, 7 skipped): `buildFileExport` → `ContextViewerParser` round-trips, multi-dimension exports, schema validation

### Viewer: 1 file, 7 tests

- `message-filters.test.ts` — tests for the viewer-local filter predicate

### Tests not ported (obsolete)

| Test | Why obsolete |
|------|-------------|
| `batch.test.ts` | Tested `runPipelines`/`runPipelineMutation` — replaced by `analyze()` with sessions |
| `notify.test.ts` | Tested `Notify` callback pattern — replaced by interceptors |
| `reprocessing.test.ts` | Tested `reprocessTarget`/`applyPromptsToAll` — replaced by session iteration |
| `conversation-store.test.ts` | Deeply coupled to old store/pipeline integration — needs fresh tests for the new `analyze()`-based store |

## Key design decisions

1. **One entry point**: `analyze()` handles both first-run and iteration via sessions. No separate `runPipeline` in the public API (it's exported but positioned as advanced/internal).

2. **Sessions are opt-in**: Callers that don't pass a `sessionId` get stateless behavior. The session just holds `PipelineState[]` in memory between calls.

3. **Interceptors are orthogonal to sessions**: Interceptors hook into stage boundaries for side effects (UI store updates). Sessions handle iteration state. Both are optional, both work independently.

4. **Errors as data**: Every result includes `errors: StageError[]` with categories (`upstream`/`parse`/`input`/`internal`) and `retryable` flag. The pipeline completes partially when possible.

5. **No streaming**: Summary and analysis use `generateText` (not `streamText`). The analyzer returns final strings. If the viewer needs streaming in the future, it would be added as a separate concern.

6. **Config is caller-provided**: The analyzer never reads `import.meta.env`. The viewer's `ai-config.ts` reads env vars and builds the config object to pass to the analyzer.
