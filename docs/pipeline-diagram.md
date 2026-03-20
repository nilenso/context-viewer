# Pipeline Architecture

## Entry Points → Flows

There are **6 entry points** into the pipeline, each triggering a different subset of stages:

```
ENTRY POINTS                          WHAT RUNS
─────────────────────────────────────────────────────────────────────────

1. Drop files (runPipelineMutation)    → processNewFile → full pipeline
2. API key provided (resumePipelines)  → resumeFromPause → dimension steps only
3. Prompt changed (reprocessTarget)    → runDimensionSteps from any step
4. Apply to all (applyPromptsToAll)    → runDimensionSteps from Segment, all files
5. Generate summary (on-demand)        → runSummary only
6. Generate analysis (on-demand)       → runEnsureSummaryThenAnalysis
```

## Main Pipeline (processNewFile)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                        FILE DROPPED                                │
  └──────────────────────────┬──────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     PARSE       │  file → Conversation + Summary + Metadata
                    │   (parse.ts)    │  uses parser registry, file format detection
                    └────────┬────────┘
                             │
                             ▼
                   ┌──────────────────┐
                   │ Pre-processed?   │  metadata.parserName === "Context Viewer"
                   └──┬───────────┬───┘
                  yes │           │ no
                      ▼           ▼
            ┌──────────────┐  ┌──────────────────┐
            │ RESTORE ALL  │  │  COUNT TOKENS     │  add token_count to each part
            │ from export  │  │ (count-tokens.ts) │
            │              │  └────────┬──────────┘
            │ dimensions,  │           │
            │ colors,      │           ▼
            │ mappings,    │  ┌──────────────────┐
            │ summary,     │  │ STATIC COMPONENTS│  deterministic (no AI)
            │ analysis     │  │ (count-tokens.ts)│  role-based component detection
            │              │  └────────┬──────────┘
            │   ┌──────┐   │           │
            │   │ DONE │   │           ▼
            │   └──────┘   │  ┌──────────────────┐
            └──────────────┘  │  HAS API KEY?    │
                              └──┬───────────┬───┘
                             yes │           │ no
                                 │           ▼
                                 │  ┌────────────────────┐
                                 │  │ PAUSED FOR API KEY │  status="paused-for-api-key"
                                 │  │ pausedAtStep=      │  waiting for user to enter key
                                 │  │   "segmenting"     │
                                 │  └────────────────────┘
                                 │           │
                                 │      (later, on API key entry)
                                 │           │
                                 ▼           ▼
                    ┌────────────────────────────────────┐
                    │      DIMENSION STEPS               │
                    │      (see below)                   │
                    └────────────────────────────────────┘
                                 │
                                 ▼
                            ┌──────┐
                            │ DONE │  status="success"
                            └──────┘
```

## Dimension Steps (runDimensionSteps)

This is the core AI pipeline. It runs **per-dimension** — each dimension
gets its own prompt, components, mapping, colors, and timeline.

A "dimension" is an independent axis of analysis (e.g., "topic", "intent").
Most conversations have just one: `"default"`.

```
  startFrom ──────────────────────────────────────────────────────────────
       │
       │  (if startFrom <= Segment)
       ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                         SEGMENT                                     │
  │                       (segment.ts)                                  │
  │                                                                     │
  │  For each message part with token_count > threshold (default 500):  │
  │    ┌──────────────────────────────────────────────────────────────┐  │
  │    │  AI generates regex split-patterns  ──►  split text         │  │
  │    │  (parallel across all large parts)                          │  │
  │    └──────────────────────────────────────────────────────────────┘  │
  │  Then re-count tokens on the segmented conversation                 │
  │                                                                     │
  │  Scope: CONVERSATION-LEVEL (not per-dimension)                      │
  └──────────────────────────┬───────────────────────────────────────────┘
                             │
       │  (if startFrom <= Classify)
       ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                        IDENTIFY                                     │
  │                  (identify-components.ts)                            │
  │                                                                     │
  │  ┌─ FOR EACH DIMENSION (parallel) ─────────────────────────────┐    │
  │  │                                                              │    │
  │  │  if customComponents provided → use those (skip AI)         │    │
  │  │  else → AI identifies component names from conversation     │    │
  │  │                                                              │    │
  │  │  Output: dim.discoveredComponents = ["auth", "db", ...]     │    │
  │  └──────────────────────────────────────────────────────────────┘    │
  └──────────────────────────┬───────────────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │              CLASSIFY + COLOR (parallel)                            │
  │                                                                     │
  │  ┌─────────────────────────────┐  ┌──────────────────────────────┐  │
  │  │       CLASSIFY              │  │         COLOR                │  │
  │  │  (classify-components.ts)   │  │  (color-components.ts)       │  │
  │  │                             │  │                              │  │
  │  │  ┌─ PER DIM (parallel) ──┐ │  │  ┌─ PER DIM (parallel) ──┐  │  │
  │  │  │                       │ │  │  │                        │  │  │
  │  │  │ AI maps each part ID  │ │  │  │ preset colors → use   │  │  │
  │  │  │ to a component name   │ │  │  │ else AI assigns       │  │  │
  │  │  │ (batches of 20,       │ │  │  │ colors to components  │  │  │
  │  │  │  parallel batches)    │ │  │  │                        │  │  │
  │  │  │                       │ │  │  │ Has idempotency:       │  │  │
  │  │  │ Then builds timeline  │ │  │  │ skip if colors match   │  │  │
  │  │  │                       │ │  │  │ current components     │  │  │
  │  │  │ Has idempotency:      │ │  │  └────────────────────────┘  │  │
  │  │  │ skip if mapping       │ │  │                              │  │
  │  │  │ already valid         │ │  │  Both mutate dimData         │  │
  │  │  └───────────────────────┘ │  │  in-place to avoid races    │  │
  │  └─────────────────────────────┘  └──────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────────────┘
```

## On-Demand AI Steps (not part of main pipeline)

These are triggered separately by user action, not during file processing:

```
  ┌───────────────────────────────────────────────────┐
  │                    SUMMARIZE                       │
  │                  (summarize.ts)                    │
  │                                                    │
  │  Streaming AI summary of the conversation.         │
  │  Strips large content before sending to AI.        │
  │  Can target a file OR a group.                     │
  └───────────────────────────────────────────────────┘

  ┌───────────────────────────────────────────────────┐
  │                    ANALYZE                         │
  │                   (analyze.ts)                     │
  │                                                    │
  │  Requires: aiSummary + components                  │
  │  If no summary → runs Summarize first              │
  │                                                    │
  │  Multi-dim: uses tuple token computation           │
  │  Single-dim: uses component timeline CSV           │
  │  Can target a file OR a group.                     │
  └───────────────────────────────────────────────────┘
```

## Reprocess Flows (prompt/component changes)

```
  User changes a prompt or component list
       │
       ▼
  reprocessTarget(targetId, startFrom, contextModifier)
       │
       ├── target is a GROUP?
       │     │
       │     ▼
       │   fan out to all member files (parallel)
       │     │
       │     └──► reprocessWithRunner per file
       │
       └── target is a FILE?
             │
             └──► reprocessWithRunner
                    │
                    ▼
              runDimensionSteps(startFrom, ctx, notify, dimNames?)
                    │
                    ▼
              regenerateAnalysisIfNeeded (if analysis existed before)
```

## State Machine (ConversationStatus)

```
                              ┌──────────┐
                              │ pending  │  placeholder created
                              └────┬─────┘
                                   │  pipeline starts
                                   ▼
                            ┌────────────┐
                    ┌───────│ processing │◄──────────────────────┐
                    │       └──────┬─────┘                       │
                    │              │                              │
                    │    ┌─────────┼──────────┐                  │
                    │    ▼         ▼          ▼                  │
                    │ ┌───────┐ ┌──────┐ ┌─────────────────┐    │
                    │ │success│ │failed│ │paused-for-api-key│    │
                    │ └───┬───┘ └──────┘ └────────┬────────┘    │
                    │     │                        │              │
                    │     │  reprocess             │ API key      │
                    │     └────────────────────────►│ provided     │
                    │                              └──────────────┘
                    │
                    └── step updates during processing:
                        "parsing" → "counting-tokens" → "segmenting"
                        → "finding-components" → (done)
```

## Dimension Data Shape

Each dimension is an independent analysis axis. Most files have just `"default"`.
Multi-dimension support allows e.g. analyzing by "topic" AND "intent" simultaneously.

```
  PipelineState.dimensions = {
    "default": {
      name: "default",
      prompt: "...",                          // custom identification prompt
      customComponents: ["auth", "db"],       // user-supplied (overrides AI)
      discoveredComponents: ["auth", "db"],   // AI-identified or = customComponents
      componentMapping: {                     // partId → componentName
        "msg-0-part-0": "auth",
        "msg-1-part-0": "db",
        ...
      },
      componentTimeline: [                    // cumulative token snapshots
        { messageIndex: 0, componentTokens: { auth: 150 }, totalTokens: 150 },
        { messageIndex: 1, componentTokens: { auth: 150, db: 200 }, totalTokens: 350 },
        ...
      ],
      componentColors: { "auth": "blue", "db": "green" },
      customColoringPrompt: "...",
    },
    "intent": { ... },   // another dimension
  }
```

## Parallelism Map

```
  Level 1:  Multiple files processed in parallel (runPipelines)
  Level 2:  Within a file, Classify ∥ Color
  Level 3:  Within Classify, all dimensions in parallel
  Level 4:  Within Classify per-dim, batches of 20 parts in parallel
  Level 5:  Within Segment, all large parts in parallel

  On reprocess of a group: all member files in parallel
```

## AI Call Count (worst case, single file, N dimensions)

```
  Segment:   1 call per large part (could be many)
  Identify:  N calls (1 per dimension, unless customComponents)
  Classify:  N × ceil(parts/20) calls
  Color:     N calls (unless preset colors)
  Summarize: 1 call (on-demand)
  Analyze:   1 call (on-demand, may trigger Summarize first)
```
