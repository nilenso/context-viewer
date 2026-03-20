# Directory Restructure Plan

## Target Structure

```
src/
├── model/                             # Data definitions — the nouns
│   ├── schema.ts                      # Message, Conversation, Part (Zod)
│   ├── types.ts                       # WorkflowState, Group, DimensionData,
│   │                                  #   ConversationMetadata, SourceTypes
│   ├── dimensions.ts                  # Dimension accessors (get, ensure, list, colors)
│   ├── export-schema.ts              # Zod schemas for FileExport, SessionExport
│   └── presets.ts                     # PresetConfig type definitions
│
├── operations/                        # Pure transforms over the model — the verbs
│   ├── aggregation.ts                 # Token aggregation, timeline building, CSV
│   ├── conversation-summary.ts        # Message/role/part-type stats
│   ├── message-filters.ts            # Predicate-based filtering
│   ├── token-counting.ts             # Tiktoken encoding (add counts to parts)
│   ├── static-components.ts          # Deterministic role.partType componentization
│   ├── export-builder.ts             # Build FileExport/SessionExport JSON
│   └── color-math.ts                 # Hex/RGB utils, lighten/darken/blend
│                                      #   (pure math, no Tailwind/React)
│
├── parsers/                           # Pluggable input adapters
│   ├── index.ts                       # Registry (detect + dispatch)
│   ├── parser.ts                      # Parser interface
│   ├── file-formats.ts               # JSON/JSONL/TXT detection
│   ├── file-import.ts                # Detect session export vs file vs raw
│   ├── context-viewer.ts             # Re-import pre-processed exports
│   ├── plain-text.ts
│   ├── conversations.ts              # Generic conversation format
│   ├── claude-transcripts.ts
│   ├── codex-transcripts.ts
│   ├── opencode-transcripts.ts
│   ├── openai-responses.ts
│   ├── openai-completions.ts
│   ├── trajectory.ts
│   └── swe-agent-trajectory.ts
│
├── stages/                            # Processing pipeline stages
│   ├── ai/                            # AI infrastructure (internal to stages)
│   │   ├── config.ts                  # Provider config, model creation
│   │   ├── prompts.ts                 # 6 prompt templates + custom overrides
│   │   ├── strip-large-content.ts     # Content prep before AI calls
│   │   ├── preset-loader.ts          # Fetch preset JSON
│   │   └── logger.ts                  # createPhaseLogger
│   │
│   ├── parse.ts                       # Parse file → Conversation + metadata
│   ├── count-tokens.ts                # Token counting (wraps operations/token-counting)
│   ├── segment.ts                     # Semantic segmentation (AI)
│   ├── identify-components.ts         # Discover component list (AI)
│   ├── classify-components.ts         # Map parts → components (AI)
│   ├── color-components.ts            # Assign hex colors (AI or preset)
│   ├── summarize.ts                   # Conversation summary (AI, streaming)
│   └── analyze.ts                     # Context analysis (AI, streaming)
│
├── pipeline/                          # Orchestration — sequences stages
│   ├── pipeline.ts                    # Step ordering, skip logic, parallelism
│   ├── orchestrate.ts                 # Run/reprocess/resume (StoreAccessor DI)
│   └── notify.ts                      # Lifecycle callbacks
│
├── stores/                            # State management (adapter)
│   ├── conversation-store.ts
│   ├── ui-store.ts
│   ├── url-store.ts
│   └── actions.ts                     # Workflow actions (wires UI intent → pipeline)
│
├── ui/                                # Everything React
│   ├── hooks/
│   │   └── useUrlState.ts
│   ├── lib/
│   │   ├── utils.ts                   # cn() — Tailwind merge
│   │   ├── component-colors.ts        # Tailwind class lookups, badge/waffle styles
│   │   ├── static-component-colors.ts # Tailwind classes for static components
│   │   ├── part-type-config.ts        # Display labels + emoji
│   │   └── url-state.ts              # URL ↔ UI state serialization
│   └── components/
│       ├── App.tsx
│       └── ... (all .tsx component files)
│
├── lib/                               # Truly generic utilities
│   └── id-generator.ts
│
├── workflow-logger.ts                 # (move to stages/ai/ or lib/)
└── main.tsx

## Dependency Rule

model/         → nothing (zod)
operations/    → model/ (+ tiktoken)
parsers/       → model/
stages/        → model/ + operations/ + stages/ai/ (+ AI SDK)
pipeline/      → model/ + stages/
stores/        → model/ + operations/ + pipeline/ + parsers/
ui/            → stores/ + model/ + operations/

## File Mapping (old → new)

### model/
- src/schema.ts → src/model/schema.ts
- src/component-types.ts → src/model/types.ts (merge)
- src/source-types.ts → src/model/types.ts (merge)
- src/workflow/types.ts → src/model/types.ts (merge)
- src/workflow/dimensions.ts → src/model/dimensions.ts
- src/lib/export-schema.ts → src/model/export-schema.ts
- src/lib/preset-loader.ts (PresetConfig type only) → src/model/presets.ts

### operations/
- src/aggregation.ts → src/operations/aggregation.ts
- src/conversation-summary.ts → src/operations/conversation-summary.ts
- src/lib/message-filters.ts → src/operations/message-filters.ts
- src/add-token-counts.ts → src/operations/token-counting.ts
- src/static-components.ts → src/operations/static-components.ts
- src/lib/export-builder.ts → src/operations/export-builder.ts
- src/lib/component-colors.ts (pure math fns only) → src/operations/color-math.ts

### parsers/
- src/parser.ts → src/parsers/parser.ts
- src/parsers/index.ts → src/parsers/index.ts
- src/lib/file-formats.ts → src/parsers/file-formats.ts
- src/lib/file-import.ts → src/parsers/file-import.ts
- src/parsers/*.ts → src/parsers/*.ts (rename to drop -parser suffix)

### stages/
- src/ai-config.ts → src/stages/ai/config.ts
- src/prompts.ts → src/stages/ai/prompts.ts
- src/strip-large-content.ts → src/stages/ai/strip-large-content.ts
- src/lib/preset-loader.ts (load functions) → src/stages/ai/preset-loader.ts
- src/lib/workflow-log-helpers.ts → src/stages/ai/logger.ts
- src/workflow-logger.ts → src/stages/ai/workflow-logger.ts
- src/segmentation.ts + src/workflow/segment.ts → src/stages/segment.ts
- src/component-identification.ts + src/workflow/component-identification.ts → src/stages/identify-components.ts
- src/component-classification.ts + src/workflow/component-classification.ts → src/stages/classify-components.ts
- src/component-coloring.ts + src/workflow/color.ts → src/stages/color-components.ts
- src/ai-summary.ts + src/workflow/summarize.ts → src/stages/summarize.ts
- src/ai-summary.ts (analysis part) + src/workflow/analyze.ts → src/stages/analyze.ts
- src/workflow/parse.ts → src/stages/parse.ts
- src/workflow/count-tokens.ts → src/stages/count-tokens.ts

### pipeline/
- src/workflow/pipeline.ts → src/pipeline/pipeline.ts
- src/workflow/orchestrate.ts → src/pipeline/orchestrate.ts
- src/workflow/notify.ts → src/pipeline/notify.ts
- src/workflow/context.ts → inline into src/pipeline/orchestrate.ts

### stores/
- src/stores/conversation-store.ts → src/stores/conversation-store.ts
- src/stores/ui-store.ts → src/stores/ui-store.ts
- src/stores/url-store.ts → src/stores/url-store.ts
- src/hooks/useWorkflowActions.ts → src/stores/actions.ts

### ui/
- src/hooks/useUrlState.ts → src/ui/hooks/useUrlState.ts
- src/lib/utils.ts → src/ui/lib/utils.ts
- src/lib/component-colors.ts (Tailwind/React parts) → src/ui/lib/component-colors.ts
- src/lib/static-component-colors.ts → src/ui/lib/static-component-colors.ts
- src/lib/part-type-config.ts → src/ui/lib/part-type-config.ts
- src/lib/url-state.ts → src/ui/lib/url-state.ts
- src/components/* → src/ui/components/*
- src/App.tsx → src/ui/components/App.tsx

### lib/
- src/lib/id-generator.ts → src/lib/id-generator.ts
```
