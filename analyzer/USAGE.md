# context-analyzer — Usage Manual

This document is a reference for AI agents and developers analyzing conversation transcripts.

## One function: `analyze()`

`analyze()` is the single entry point. It creates a session on first call and supports iteration via `sessionId`.

### First run

```typescript
const result = await analyze({
  files: [{ content, filename: "session.jsonl" }],
}, config);
// result.sessionId — save this for iteration
// result.states    — full PipelineState[] with annotated conversations
// result.analytics — per-file, per-component token breakdowns
```

### Iteration

Pass the `sessionId` back with changed options. Only affected stages re-run.

```typescript
const result2 = await analyze({
  sessionId: result.sessionId,
  components: [
    { name: "auth", description: "Authentication, login, sessions" },
    { name: "api", description: "REST endpoints, handlers" },
  ],
}, config);
```

### What triggers re-runs

| Change | Stages that re-run |
|--------|-------------------|
| `prompts.segmentation` | segment → identify → classify → color |
| `segmentationThreshold` | segment → identify → classify → color |
| `components` or `prompts["component-identification"]` | identify → classify → color |
| Component descriptions change | classify → color |
| `prompts.coloring` | color only |
| `presetColors` | color only |

Everything else is skipped via idempotency.

---

## Defining Components

The most important input:

```typescript
{
  components: [
    {
      name: "auth_system",
      description: "Authentication, login flows, sessions, RBAC, and security-related code"
    },
    {
      name: "database_schema",
      description: "Database migrations, schema definitions, model types, and ORM configuration"
    },
  ]
}
```

**The description matters.** It's passed to the AI classifier. Be specific.

**Without components,** the AI discovers them automatically. Useful for exploration but inconsistent across files.

**Rule of thumb:** Discover first, then define custom components for comparison.

---

## Workflow: Compaction Analysis

### Step 1: Discovery

```typescript
const result = await analyze({
  files: [rawFile, compactedFile],
}, config);
// Inspect result.analytics[0].dimensions.default.components
// Inspect result.analytics[1].dimensions.default.components
```

### Step 2: Comparison with shared components

```typescript
const result2 = await analyze({
  sessionId: result.sessionId,
  components: [
    { name: "data_model", description: "Types, interfaces, schema changes..." },
    { name: "error_handling", description: "Bug fixes, debugging sessions..." },
    // 8-12 components
  ],
}, config);

for (const file of result2.analytics) {
  console.log(file.filename, file.totalTokens);
  for (const c of file.dimensions.default.components) {
    console.log(`  ${c.component}: ${c.tokens} tokens (${c.percentage.toFixed(1)}%)`);
  }
}
```

---

## Workflow: Multi-dimensional Analysis

```typescript
const result = await analyze({
  files: [file],
  dimensions: {
    feature: {
      components: [
        { name: "auth", description: "Authentication and authorization" },
        { name: "payments", description: "Payment processing and billing" },
      ],
    },
    activity: {
      components: [
        { name: "reading", description: "Reading and understanding existing code" },
        { name: "writing", description: "Writing or editing code" },
      ],
    },
  },
}, config);
// result.analytics[0].dimensions.feature
// result.analytics[0].dimensions.activity
```

---

## Interceptors (for UI integration)

Hook into stage boundaries for live updates:

```typescript
const result = await analyze({
  files: [...],
  interceptors: [
    { stage: "parsing", timing: "post", fn: (ctx) => store.update(ctx.id, ctx) },
    { stage: "counting-tokens", timing: "post", fn: (ctx) => store.update(ctx.id, ctx) },
    { stage: "classifying-components", timing: "post", fn: (ctx) => store.update(ctx.id, ctx) },
  ],
}, config);
```

Interceptors work on iteration too — the same hooks fire for re-run stages.

---

## Summary and Analysis (optional, on demand)

```typescript
const summary = await summarize(result, config);
const analysis = await analyzeContext(result, config);
```

These are separate from the pipeline. Only call them when you need prose.

---

## Error Handling

```typescript
if (result.errors.length > 0) {
  for (const err of result.errors) {
    console.log(`[${err.stage}] ${err.category}: ${err.message} (retryable: ${err.retryable})`);
  }
}
```

Categories: **upstream** (AI provider, retryable), **parse** (bad AI output, retryable), **input** (caller mistake), **internal** (library bug).

---

## Tips

- **8-12 components** is ideal. Fewer than 5 is too coarse, more than 15 confuses the classifier.
- **Descriptions are for the classifier.** Write them for someone who hasn't seen the code.
- **Discover then refine.** Run once without components, then define custom ones.
- **Same components for comparison.** Auto-discovered names differ between files.
- **`group()` is free.** No AI calls — pure in-memory merge.
- **Check `result.errors`.** Don't assume success.
- **Clean up sessions** with `deleteSession(sessionId)` when done.
