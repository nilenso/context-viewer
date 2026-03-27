# Architecture

Context Viewer analyzes AI conversation logs — breaking them into semantic
components, counting tokens, and visualizing how context is distributed.
Everything runs in the browser; data stays local unless explicitly sent to
an AI API.

## Directory structure

```
src/
├── model/           Data definitions — the nouns
├── operations/      Pure transforms over the model — the verbs
├── parsers/         Pluggable input format adapters
├── stages/          Processing pipeline stages
│   └── ai/          AI infrastructure (config, prompts, logging)
├── pipeline/        Orchestration — sequences stages, manages lifecycle
├── stores/          Zustand state management
├── ui/              React components, hooks, and UI utilities
│   ├── App.tsx      Application shell (root composition)
│   ├── components/  React components + shadcn primitives
│   ├── hooks/       React hooks
│   └── lib/         UI utilities (Tailwind helpers, color lookups, etc.)
├── lib/             Generic utilities (id-generator)
└── main.tsx         Entry point
```

### Dependency rule

Each layer only imports from layers below it. No upward or circular
dependencies.

```
model/         → nothing (zod only)
operations/    → model/
parsers/       → model/
stages/        → model/ + operations/ + stages/ai/ + AI SDK
pipeline/      → model/ + stages/
stores/        → model/ + operations/ + pipeline/ + parsers/
ui/            → stores/ + model/ + operations/
```

## Layers

### model/

The data definitions everything else is built on. No logic, no side
effects, no I/O.

| File | Contents |
|------|----------|
| `schema.ts` | `Message`, `Conversation`, `Part` — Zod-validated types for the standard conversation format |
| `types.ts` | `PipelineState`, `Group`, `DimensionData`, `Stage`, `StageGroup`, `PipelineStep`, `ConversationMetadata`, `ConversationSummary`, `ComponentTimelineSnapshot`, and other core domain types |
| `dimensions.ts` | Dimension accessor helpers: `ensureDimensions`, `getDimension`, `getEffectiveComponents`, `getAllComponents` |
| `export-schema.ts` | Zod schemas for the JSON export format (`FileExport`, `SessionExport`) |
| `presets.ts` | `PresetConfig`, `PresetSummary` type definitions |

**Key types:**

- **`PipelineState`** — the central type. Represents a conversation file
  being processed: its identity, lifecycle status, parsed data, dimensions,
  static components, prompts, and timing info.
- **`Group`** — lightweight metadata referencing member files by ID. Groups
  don't concatenate conversations; the UI reconstructs a virtual view.
- **`DimensionData`** — one categorization scheme with `discoveredComponents`
  (AI-found), `customComponents` (user-provided), mapping, timeline, and
  colors. Use `getEffectiveComponents()` to get the active list.
- **`Stage`** — granular execution units (`"parsing"`, `"identifying-components"`,
  etc.). Maps 1:1 to files in `stages/`.
- **`StageGroup`** — coarser UI checkpoints. `"finding-components"` groups
  identify + classify + color.
- **`PipelineStep`** — ordered enum for pipeline resumption points
  (`Parse=0` through `Color=5`).

### operations/

Pure functions over model types. No AI calls, no I/O, no state. Given data
in, return data out.

| File | What it does |
|------|-------------|
| `aggregation.ts` | Token aggregation by component, timeline building, tuple computation for multi-dimension analysis, CSV generation |
| `conversation-summary.ts` | Computes message/role/part-type stats from a `Conversation` |
| `token-counting.ts` | Adds `token_count` to every message part using tiktoken (GPT-4 encoding) |
| `static-components.ts` | Deterministic componentization by `role.partType` (no AI needed) |
| `message-filters.ts` | Predicate-based filtering of messages/parts by role and type |
| `export-builder.ts` | Builds `FileExport` and `SessionExport` JSON structures (pure data — no download I/O) |
| `color-math.ts` | Hex/RGB conversion, lighten/darken/blend — pure math, no Tailwind |

### parsers/

Each parser converts one external conversation format into the standard
`Conversation` schema. Adding a new format = one new file + register it.

| File | Format |
|------|--------|
| `claude-transcripts-parser.ts` | Claude API transcripts |
| `codex-transcripts-parser.ts` | Codex CLI transcripts |
| `opencode-transcripts-parser.ts` | OpenCode agent transcripts |
| `completions-parser.ts` | OpenAI Completions API |
| `responses-parser.ts` | OpenAI Responses API |
| `conversations-parser.ts` | Generic conversation JSON |
| `trajectory-parser.ts` | Agent trajectory format |
| `swe-agent-trajectory-parser.ts` | SWE-Agent trajectories |
| `plain-text-parser.ts` | Raw text / markdown |
| `context-viewer-parser.ts` | Re-import pre-processed Context Viewer exports |

Supporting files: `parser.ts` (registry), `file-formats.ts` (format
detection), `file-import.ts` (drop input handling), `input-schemas.ts`
(Zod schemas for input formats).

### stages/

Each file is one processing stage — the algorithm and its pipeline
integration in one place. Stages that use AI depend on `stages/ai/`.

| Stage file | What it does | Uses AI? |
|-----------|-------------|----------|
| `parse.ts` | Parse file → `Conversation` + metadata. Also handles restoring pre-processed exports. | No |
| `count-tokens.ts` | Add token counts + run static componentization | No |
| `segment.ts` | Split large text parts into semantic chunks | Yes |
| `identify-components.ts` | Discover the component list for each dimension | Yes |
| `classify-components.ts` | Map every part → component, build timeline | Yes |
| `color-components.ts` | Assign hex colors to components (AI or preset) | Yes |
| `summarize.ts` | Generate streaming conversation summary | Yes |
| `analyze.ts` | Generate streaming context analysis from components + summary | Yes |

**stages/ai/** — infrastructure shared by AI-powered stages:

| File | What it does |
|------|-------------|
| `config.ts` | AI provider configuration, model creation (`getAIConfig`, `createModel`) |
| `prompts.ts` | 6 prompt templates with custom override support |
| `strip-large-content.ts` | Remove images/files, truncate tool outputs before AI calls |
| `preset-loader.ts` | Load preset JSON from server (note: this does HTTP I/O) |

### pipeline/

Orchestration: how stages get sequenced, how errors are handled, how
results get written back to the store.

| File | What it does |
|------|-------------|
| `pipeline.ts` | Step ordering and execution. Conversation-level: Parse → CountTokens → Segment. Dimension-level: Identify → (Classify + Color in parallel). Handles pre-processed imports, API key pauses, and resume. |
| `orchestrate.ts` | Higher-level operations: reprocess from a given step, apply prompts to all files, generate summary/analysis on demand, batch processing. Uses `StoreAccessor` for dependency injection. |
| `notify.ts` | Lifecycle callbacks (`startStep`, `endStep`, `markComplete`, `markFailed`) that push state updates to the store. |
| `logging.ts` | Per-conversation structured logging with pub/sub for UI display. |
| `stage-logger.ts` | Factory for loggers bound to a specific stage. |

### stores/

Zustand state management. The adapter between the non-UI pipeline world
and the React UI.

| File | What it does |
|------|-------------|
| `conversation-store.ts` | Core app state: `conversations` (PipelineState[]), `groups`, file CRUD, pipeline execution. Thin adapter around `pipeline/orchestrate`. |
| `ui-store.ts` | Transient UI state: dialog open/close, editing prompts, loaded preset, active dimensions. |
| `url-store.ts` | URL ↔ UI state sync: selected conversation, active tab, sidebar state, message filters. |
| `actions.ts` | Glue functions that wire UI intent → pipeline execution. Reads from stores, calls orchestrate functions, handles errors. |

### ui/

Everything React. Components, hooks, and UI-specific utilities.

- **`App.tsx`** — root composition: layout, dropzone, routing, store subscriptions
- **`components/`** — all React components (conversation list, message view, charts, dialogs, etc.) + shadcn primitives in `ui/`
- **`hooks/useUrlState.ts`** — sync component state to URL
- **`lib/`** — `utils.ts` (Tailwind merge), `component-colors.ts` (Tailwind class lookups), `static-component-colors.ts`, `part-type-config.ts` (labels/emoji), `url-state.ts` (URL serialization), `url-fetch.ts`, `export-download.ts` (browser download I/O)

## Processing pipeline

When a file is dropped, it flows through these stages:

```
File dropped
  │
  ├─ Parse ──────────────── stages/parse.ts
  │   └─ Detect format, parse → Conversation + metadata
  │
  ├─ Count Tokens ───────── stages/count-tokens.ts
  │   └─ tiktoken encoding + static componentization
  │
  ├─ [no API key? pause here, resume later]
  │
  ├─ Segment ────────────── stages/segment.ts          (AI)
  │   └─ Split large parts into semantic chunks
  │
  ├─ Per dimension:
  │   ├─ Identify ───────── stages/identify-components.ts (AI)
  │   │   └─ Discover component list
  │   │
  │   ├─ Classify ───────── stages/classify-components.ts (AI)  ─┐
  │   │   └─ Map parts → components, build timeline              │ parallel
  │   │                                                          │
  │   └─ Color ──────────── stages/color-components.ts    (AI)  ─┘
  │       └─ Assign hex colors
  │
  └─ Done (summary + analysis are on-demand, not in the main pipeline)
```

**Re-entry:** The pipeline can restart from any `PipelineStep`. Changing a
prompt restarts from Identify; changing segmentation restarts from Segment.
Each stage is idempotent — it skips if its inputs match its outputs.

**Pre-processed imports:** Context Viewer export files skip the entire
pipeline. The parser restores all dimensions, components, colors, and
summaries from the export metadata.

## Multi-dimensional analysis

A single conversation can be analyzed along multiple dimensions
simultaneously. Each dimension has its own:

- Identification prompt
- `discoveredComponents` list (AI-found) or `customComponents` (user-provided)
- Part-to-component mapping
- Timeline
- Colors and coloring prompt

Use `getEffectiveComponents(dim)` from `model/dimensions.ts` to get the
active component list (custom overrides discovered).

## Groups

A `Group` is a lightweight container referencing member files by ID. It
doesn't concatenate conversations — the UI reconstructs a virtual merged
view. Groups can have their own summary and analysis prompts.
