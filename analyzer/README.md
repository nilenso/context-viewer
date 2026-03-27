# context-analyzer

Headless library for analyzing AI conversation transcripts. Parses conversation logs from various agents and API formats, identifies semantic components using AI, and produces structured analytics — ready for visualization or further AI reasoning.

Extracted from [context-viewer](https://github.com/nilenso/context-viewer) as a standalone, UI-free core.

## What it does

Given a conversation transcript (Claude Code session, OpenAI API log, Codex CLI output, etc.), context-analyzer:

1. **Parses** — auto-detects the format and normalizes to a standard message schema
2. **Counts tokens** — using tiktoken (GPT-4o encoding)
3. **Segments** — uses AI to split large text parts into semantic chunks
4. **Identifies components** — uses AI to discover what topics/components exist
5. **Classifies** — maps every message part to a component (batched, parallel)
6. **Colors** — assigns distinct hex colors to components for visualization

The output is per-component token counts, percentages, colors, and the full annotated conversation.

## Supported formats

| Format | File types |
|--------|-----------|
| Claude Code transcripts | `.jsonl` |
| Codex CLI transcripts | `.jsonl` |
| OpenCode transcripts | `.json` |
| OpenAI Responses API | `.json` |
| OpenAI Completions API | `.json` |
| OpenAI Conversations API | `.json` |
| SWE-bench trajectories | `.json`, `.traj` |
| SWE-agent trajectories | `.json` |
| Context Viewer exports | `.json` |
| Plain text / markdown | `.txt`, `.md` |

## Install

```bash
bun add context-analyzer
```

## Quick start

```typescript
import { readFile } from "fs/promises";
import { analyze } from "context-analyzer";

const content = await readFile("session.jsonl", "utf-8");

const result = await analyze(
  { files: { content, filename: "session.jsonl" } },
  { apiKey: process.env.OPENAI_API_KEY! },
);

// result.sessionId — pass back to iterate
// result.states    — full annotated PipelineState[]
// result.analytics — waffle-chart-ready numbers

for (const file of result.analytics) {
  console.log(file.filename, file.totalTokens, "tokens");
  for (const c of file.dimensions.default.components) {
    console.log(`  ${c.component}: ${c.tokens} (${c.percentage.toFixed(1)}%) ${c.color}`);
  }
}
```

## Sessions and iteration

`analyze()` returns a `sessionId`. Pass it back to iterate — change prompts, refine components — without re-running unchanged stages.

```typescript
// First run
const result = await analyze(
  { files: [...] },
  config,
);

// Iterate — change component identification prompt
const result2 = await analyze(
  { sessionId: result.sessionId, prompts: { "component-identification": "Focus on..." } },
  config,
);

// Iterate — provide custom components
const result3 = await analyze(
  {
    sessionId: result.sessionId,
    components: [
      { name: "auth", description: "Authentication, login, sessions" },
      { name: "api", description: "REST endpoints, request handlers" },
    ],
  },
  config,
);
```

The session stores pipeline state in memory. Changed inputs automatically clear affected outputs — the pipeline's idempotency handles the rest.

When done, clean up with `deleteSession(sessionId)`.

## Interceptors

Hook into pipeline stage boundaries for live updates (e.g. pushing state to a UI store):

```typescript
const result = await analyze({
  files: [...],
  interceptors: [
    { stage: "parsing", timing: "post", fn: (ctx) => store.update(ctx) },
    { stage: "classifying-components", timing: "post", fn: (ctx) => store.update(ctx) },
  ],
}, config);
```

Interceptors are called with the `PipelineState` after the stage has merged its results. The `timing` can be `"pre"` (before stage runs) or `"post"` (after results are merged).

## API

### `analyze(options, config)`

The single entry point. Runs the full pipeline on first call, iterates on subsequent calls.

**Options:**
```typescript
{
  sessionId?: string;               // for iteration
  files?: FileInput | FileInput[];  // required on first call
  components?: ComponentDef[];      // { name, description } pairs
  dimensions?: Record<string, { prompt?, components?, colors?, coloringPrompt? }>;
  prompts?: Record<string, string>; // "segmentation", "component-identification", "coloring"
  presetColors?: Record<string, string>;
  segmentationThreshold?: number;   // default: 500
  interceptors?: Interceptor[];
}
```

**Config:**
```typescript
{
  apiKey: string;
  model?: string;              // default: "gpt-4o-mini"
  baseURL?: string;
  apiMode?: "responses" | "chat";
  reasoningEffort?: "none" | "low" | "medium" | "high";
  logLevel?: "silent" | "info" | "debug";
  logger?: (entry: LogEntry) => void;
}
```

**Returns:** `AnalyzeResult`
```typescript
{
  sessionId: string;
  format: string;
  model?: string;
  analytics: FileAnalytics[];     // waffle-chart-ready numbers
  states: PipelineState[];        // full annotated conversations
  errors: StageError[];
  warnings: string[];
}
```

### `summarize(result, config, options?)`

Generate an AI narrative summary (outside the pipeline, on demand).

### `analyzeContext(result, config, options?)`

Generate an AI analysis of context usage patterns (outside the pipeline, on demand).

### `group(result, options?)`

Merge multiple analyzed files into a single virtual conversation.

## Error handling

Errors are returned as data in `result.errors`:

```typescript
interface StageError {
  stage: string;
  category: "upstream" | "parse" | "input" | "internal";
  message: string;
  retryable: boolean;
  file?: string;
}
```

## Custom components

```typescript
const result = await analyze({
  files: [...],
  components: [
    { name: "auth", description: "Authentication, login flows, sessions, RBAC" },
    { name: "database", description: "Migrations, schema definitions, ORM queries" },
  ],
}, config);
```

Descriptions are passed directly to the AI classifier — write them for someone who hasn't seen the code.

## Multi-dimensional analysis

```typescript
const result = await analyze({
  files: [...],
  dimensions: {
    topic: {
      components: [
        { name: "auth", description: "Authentication" },
        { name: "payments", description: "Payment processing" },
      ],
    },
    activity: {
      components: [
        { name: "reading", description: "Reading existing code" },
        { name: "writing", description: "Writing new code" },
      ],
    },
  },
}, config);
```

## Development

```bash
bun install
bun test
bun run build
```

## License

MIT
