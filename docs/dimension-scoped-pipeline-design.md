# Dimension-scoped pipeline design

> See [architecture.md](./architecture.md) for the full directory structure
> and pipeline overview.

## Two layers

The pipeline has two layers:

1. **Conversation-level** (shared across all dimensions): Parse → CountTokens → Segment
2. **Dimension-level** (independent per dimension): Identify → (Classify + Color in parallel)

Classify and Color both depend only on the component list from Identify — not on each other — so they run in parallel.

## Dimensions are self-contained

`DimensionData` owns everything about a dimension: prompt, custom components, component list, mapping, timeline, colors, coloring prompt. No top-level duplicates on `WorkflowState`.

Top-level prompt fields that remain on `WorkflowState` are only for conversation-level concerns: `customSegmentationPrompt`, `segmentationThreshold`, `customSummaryPrompt`, `customAnalysisPrompt`.

## When something changes, only the affected scope runs

| What changed                       | Scope              | What reruns                                              |
| ---------------------------------- | ------------------ | -------------------------------------------------------- |
| Segmentation prompt                | Conversation       | Segment → all dimensions (Identify → Classify + Color)   |
| Identification prompt for dim X    | Dimension X only   | Identify → Classify + Color for X                        |
| Coloring prompt for dim X          | Dimension X only   | Color for X                                              |
| "Apply prompts to all"             | Per-conv, per-dim  | Copies dimension prompts to targets, reruns from earliest changed step per dimension |

## Mechanism

`runPipelineFrom` and the step runners (Identify, Classify, Color) accept an optional `dimNames?: string[]` parameter. When provided, only those dimensions are processed. When omitted, all dimensions run (new files, post-segmentation).

## "Apply prompts to all"

Reads prompts, components, and colors from the source conversation's dimensions (not top-level fields). Copies them into matching dimensions on each target conversation. Diffs to find the earliest changed step per dimension and reprocesses only what changed.

## File responsibilities

**pipeline.ts** — the step chain and nothing else:
- `runDimensionSteps(startFrom, ctx, notify, dimNames?)` — Segment → Identify → (Classify + Color)
- `processNewFile(ctx, notify, callbacks)` — Parse → CountTokens → Static → runDimensionSteps
- `resumeFromPause(ctx, notify, callbacks)` — runDimensionSteps from Segment
- Field-list constants for selective write-back

**orchestrate.ts** — who runs what, on which files/dimensions, and where results go:
- `reprocessWithRunner` / `reprocessTarget` — single file or group fan-out
- `applyPromptsToAll` — cross-conversation with per-dimension diffing
- `runWorkflows` — batch processing (moved from pipeline.ts)
- `generateSummaryOnDemand` / `generateAnalysisOnDemand` / `rerunSummary` — on-demand AI actions (moved from pipeline.ts)
- `resumeWorkflowsWithApiKey` — resume paused workflows
- All try/catch + markComplete/markFailed wrapping lives here

**notify.ts** (renamed from runner.ts) — progress/state helpers:
- `Notify` type, `startStep`, `endStep`, `updateState`, `markComplete`, `markFailed`, `markPausedForApiKey`, `timed`

**App.tsx** — calls only store actions, never pipeline functions directly.
