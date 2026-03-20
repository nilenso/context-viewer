# Simplify Pipeline: "Run From Step N" + On-Demand Summary/Analysis

## Context

The current pipeline uses a 9-event dispatcher (`WorkflowEvent` enum) where each event has its own handler function, composite orchestrators, and manually curated field lists. This creates unnecessary complexity for what is fundamentally a linear pipeline. The user wants:

1. **One primary pipeline**: segment → count → per-dimension (identify → classify → color)
2. **Re-run from any point**: changing a prompt just re-runs from that step onwards
3. **Summary/analysis on-demand only**: not part of the primary pipeline

## Approach

Replace `WorkflowEvent` with a `PipelineStep` enum representing an ordered sequence. The core function becomes `runPipelineFrom(startStep, ctx, notify)` — it runs every step from `startStep` through the end.

Summary and analysis become standalone on-demand functions, completely separate from the pipeline.

## What Gets Removed

| Before | After |
|---|---|
| `WorkflowEvent` enum (9 values) | `PipelineStep` enum (6 values) |
| 8 handler functions in pipeline.ts | 1 `runPipelineFrom` + 3 small entrypoints |
| 3 composite orchestrators | Gone (absorbed into linear pipeline) |
| 5 manually curated `WorkflowDataField[]` arrays | Auto-computed from pipeline definition |

## Changes

### 1. `src/workflow/types.ts`

- Add `PipelineStep` enum:
  ```ts
  enum PipelineStep {
    Parse = 0, CountTokens = 1, Segment = 2,
    Identify = 3, Classify = 4, Color = 5,
  }
  ```
- Remove `WorkflowEvent` enum

### 2. `src/workflow/pipeline.ts` — Core rewrite

Define the pipeline as a data structure:
```ts
const PIPELINE = [
  { step: PipelineStep.Parse, uiStep: "parsing", run: runParse, fields: [...] },
  { step: PipelineStep.CountTokens, uiStep: "counting-tokens", run: ..., fields: [...] },
  { step: PipelineStep.Segment, uiStep: "segmenting", run: runSegment, fields: [...] },
  { step: PipelineStep.Identify, uiStep: "finding-components", run: ..., fields: [...] },
  { step: PipelineStep.Classify, uiStep: "finding-components", run: ..., fields: [...] },
  { step: PipelineStep.Color, uiStep: "coloring", run: runAssignColors, fields: [...] },
];
```

Main function:
```ts
async function runPipelineFrom(startFrom: PipelineStep, ctx, notify, callbacks?): Promise<void>
```
- Iterates `PIPELINE`, skipping steps before `startFrom`
- Gates on API key at `Segment` step
- After completion, if analysis existed before and `callbacks` provided, regenerates it
- Computes fields automatically via `collectFieldsFrom(startFrom)`

Entrypoints:
- `processNewFile(ctx, notify)` — parse, check pre-processed import, then `runPipelineFrom(CountTokens, ...)`
- `completeGroupedConversation(ctx, notify)` — just `markComplete` with grouped fields (no AI)
- `resumeFromPause(ctx, notify)` — `runPipelineFrom(ctx.pausedAtStep, ...)`

Prompt change mapping (the key simplification):
- Segmentation prompt changed → `runPipelineFrom(PipelineStep.Segment, ctx, notify, callbacks)`
- Component prompt changed → `runPipelineFrom(PipelineStep.Identify, ctx, notify, callbacks)`
- Coloring prompt changed → `runPipelineFrom(PipelineStep.Color, ctx, notify)`

### 3. On-demand summary/analysis (in pipeline.ts or new on-demand.ts)

These are NOT pipeline steps. They are standalone functions:
- `generateSummaryOnDemand(ctx, notify, callbacks)`
- `generateAnalysisOnDemand(ctx, notify, callbacks)` — generates summary first if missing
- `rerunSummary(ctx, notify, callbacks)` — for summary prompt changes; also regenerates analysis if it existed

### 4. `src/stores/conversation-store.ts`

- `handleReprocessWithRunner` takes `PipelineStep` instead of `WorkflowEvent`
- `runWorkflowMutation` calls `processNewFile` instead of `processConversationWorkflow(NewFile, ...)`
- `handleResumeWorkflowsWithApiKey` calls `resumeFromPause`
- `handleGroupConversations` calls `completeGroupedConversation`
- Summary/analysis actions call the on-demand functions directly

### 5. `src/App.tsx`

- Replace all `WorkflowEvent.*` references with `PipelineStep.*` or on-demand function calls
- `handleReprocessComponents` → uses `PipelineStep.Identify`
- `handleReprocessSegmentation` → uses `PipelineStep.Segment`
- `handleApplyColoringPrompt` → uses `PipelineStep.Color`
- `handleGenerateSummary` / `handleGenerateAnalysis` → call on-demand functions

### 6. `src/workflow/analyze.ts`

- Remove `completionFieldsForReprocess` (fields now auto-computed)
- Keep `runAnalysis`, `runEnsureSummaryThenAnalysis`, `regenerateAnalysisIfNeeded`

### 7. Cleanup

- Remove `WorkflowEvent` from types.ts
- Remove composite orchestrators from pipeline.ts
- Remove manually curated field list constants (except `GROUPED_COMPLETE` and `PRE_PROCESSED_COMPLETE` which are special cases)

## Files to modify

1. `src/workflow/types.ts` — add PipelineStep, remove WorkflowEvent
2. `src/workflow/pipeline.ts` — core rewrite
3. `src/stores/conversation-store.ts` — update callers
4. `src/App.tsx` — update callers
5. `src/workflow/analyze.ts` — remove completionFieldsForReprocess

## Edge Cases

- **Identify + Classify share "finding-components" UI step**: Pipeline entries both use `uiStep: "finding-components"`. `startStep` fires at Identify, `endStep` at Classify end.
- **`pausedAtStep` mapping**: Currently stores a `ProcessingStep` string. Need a mapping from `ProcessingStep` → `PipelineStep` for resume.
- **GroupedConversation**: Not a pipeline run — stays as standalone `completeGroupedConversation`.
- **Pre-processed import**: Early return in `processNewFile` after parse, before pipeline.

## Verification

1. `npm run build` — no type errors
2. Drop a new file → full pipeline runs (parse → count → segment → identify → classify → color)
3. Edit component prompt → re-runs from identify onwards
4. Edit segmentation prompt → re-runs from segment onwards
5. Edit coloring prompt → re-runs color only
6. Click generate summary → runs on demand, not part of pipeline
7. Click generate analysis → generates summary if missing, then analysis
8. Add API key after pause → resumes from paused step
9. Group conversations → completes without AI steps
10. Import a pre-processed session → restores without re-running pipeline
