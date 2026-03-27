# Pipeline Architecture

## The Pipeline Definition

The pipeline is defined declaratively in `src/pipeline/pipeline.ts`:

```typescript
const PIPELINE: StageDescriptor[] = [
  { name: "parsing",                scope: "conversation", emits: ["conversation", "summary", "metadata"] },
  { name: "counting-tokens",        scope: "conversation", emits: ["conversation", "staticComponents", ...] },
  { name: "segmenting",             scope: "conversation", emits: ["conversation", "customSegmentationPrompt"] },
  { name: "identifying-components", scope: "dimension",    emits: ["dimensions"] },
  { name: "classifying-components", scope: "dimension",    emits: ["dimensions"], parallel: "coloring" },
  { name: "coloring",               scope: "dimension",    emits: ["dimensions"], parallel: "classifying-components" },
];
```

Each stage is **pure** — it takes data, returns a partial result. The runner merges results into state.
Stages never import from `pipeline/`. Logging, timing, and store updates are handled by the runner.

## Execution Flow

```
  FILE DROPPED
       │
       ▼
  ┌──────────┐
  │  Parse   │  scope: conversation    → returns { conversation, summary, metadata }
  └────┬─────┘
       │
       ├── Pre-processed import? ──yes──► restore all fields, done
       │
       ▼
  ┌──────────────┐
  │ Count Tokens │  scope: conversation  → returns { conversation, staticComponents, ... }
  └────┬─────────┘
       │
       ├── No API key? ──► paused-for-api-key (resume later)
       │
       ▼
  ┌──────────┐
  │ Segment  │  scope: conversation    → returns { conversation, warnings? }
  └────┬─────┘
       │
       ▼  (for each dimension, in parallel)
  ┌──────────┐
  │ Identify │  scope: dimension       → returns { discoveredComponents }
  └────┬─────┘
       │
       ├─────────────────────────┐
       ▼                         ▼     (parallel, per dimension)
  ┌──────────┐            ┌──────────┐
  │ Classify │            │  Color   │
  │          │            │          │
  │ returns: │            │ returns: │
  │ mapping  │            │ colors   │
  │ timeline │            │          │
  │ components│           │          │
  └────┬─────┘            └────┬─────┘
       │                       │
       └───────┬───────────────┘
               │  merged after both complete (no race)
               ▼
            ┌──────┐
            │ DONE │  status = "success"
            └──────┘
```

## Entry Points

```
ENTRY POINT                            WHAT RUNS
──────────────────────────────────────────────────────────────────────

1. Drop files (runPipelineMutation)    processNewFile → full pipeline
2. API key provided                    resumeFromPause → segmenting onward
3. Prompt changed (reprocessTarget)    runDimensionSteps from any stage
4. Apply to all (applyPromptsToAll)    runDimensionSteps from Segment, all files
5. Generate summary (on-demand)        runSummary only (outside pipeline)
6. Generate analysis (on-demand)       runEnsureSummaryThenAnalysis (outside pipeline)
```

## Stage Purity

Stages return results — they don't mutate state or call pipeline functions:

```
Conversation-scoped:  (ctx: PipelineState) → Partial<PipelineState>
Dimension-scoped:     (conversation, dimData, config, id?) → { result: Partial<DimensionData>, error? }
```

The runner handles:
- Merging results into ctx/dimData
- Logging (markStepStart/markStepEnd)
- Timing (stepTimings)
- Store notifications (notify)
- Dimension iteration (for scope: "dimension" stages)
- Parallel execution (for stages with `parallel` field)

## Dimensions

Each dimension is an independent analysis axis. Most files just have `"default"`.

```
ctx.dimensions = {
  "default": {
    discoveredComponents: ["auth", "db", ...],     ← identify
    componentMapping: { partId → componentName },  ← classify
    componentTimeline: [{ messageIndex, ... }],     ← classify
    componentColors: { componentName → color },     ← color
    prompt?: "...",
    customComponents?: [...],
    customColoringPrompt?: "...",
  },
  "intent": { ... },   // optional second dimension
}
```

## On-Demand Stages (outside pipeline)

Summary and Analysis are not in the PIPELINE array. They run independently:

```
Summarize:  streaming AI summary (on user request)
Analyze:    streaming AI analysis (requires summary + components, on user request)
```

These still use the old pattern (startStep/endStep/timed from pipeline/notify).
