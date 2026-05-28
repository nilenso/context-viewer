# context-analyzer Agent Guide

Use `analyze2()` to analyze AI conversation transcripts. This is the preferred API for agents: inspect the files first, then provide explicit segmentation instructions, dimensions, component descriptions, and colors.

## Import

```ts
import { analyze2 } from "context-analyzer";
```

## Signature

```ts
const result = await analyze2(options, config);
```

```ts
interface Analyze2Options {
  sessionId?: string;
  files?: FileInput[];
  segmentation?: {
    threshold?: number;
    prompt?: string;
  };
  dimensions?: Array<{
    name: string;
    components: Array<{
      name: string;
      description: string;
    }>;
  }>;
  colors?: Record<string, Record<string, string>>;
}
```

## Canonical usage

```ts
const result = await analyze2(
  {
    files: [
      { content, filename: "session.jsonl" },
    ],

    segmentation: {
      threshold: 500,
      prompt: "Split large message parts into semantically self-contained chunks. Keep code, errors, and the discussion explaining them together.",
    },

    dimensions: [
      {
        name: "engineering_area",
        components: [
          {
            name: "frontend_ui",
            description: "React components, styling, visual layout, interactions, and browser behavior.",
          },
          {
            name: "data_model",
            description: "Schemas, TypeScript types, data transformations, and persistence-related structures.",
          },
          {
            name: "tests",
            description: "Test files, fixtures, assertions, test failures, and test-running discussion.",
          },
        ],
      },
    ],

    colors: {
      engineering_area: {
        frontend_ui: "#2563eb",
        data_model: "#16a34a",
        tests: "#f59e0b",
      },
    },
  },
  {
    apiKey: process.env.OPENAI_API_KEY!,
  },
);
```

## Options

### `files`

```ts
files?: Array<{ content: string; filename: string }>;
```

Required on the first call. Provide the raw file contents and original filename. The filename helps format detection.

On iteration, pass `sessionId`; `files` are ignored when `sessionId` is provided.

### `segmentation`

```ts
segmentation?: {
  threshold?: number;
  prompt?: string;
};
```

Controls the segmentation stage, which splits large message parts into semantic chunks.

- `threshold`: token threshold above which text parts are considered for segmentation. Default is `500`.
- `prompt`: instructions for how to split large parts.

A default segmentation prompt exists, but agents should usually provide a task-specific prompt. Good prompts explain what should stay together, such as related code, errors, commands, and reasoning.

### `dimensions`

```ts
dimensions?: Array<{
  name: string;
  components: Array<{ name: string; description: string }>;
}>;
```

Defines the analysis taxonomies. As an agent, inspect the files first, then choose useful dimensions and components.

The analyzer owns the classification prompt. Do not provide a classification prompt. Instead, provide clear component names and descriptions.

Guidelines:

- Use explicit, stable dimension names like `engineering_area`, `activity_type`, or `context_source`.
- For comparisons across files, use the same dimensions and components for every file.
- Prefer 8–12 components per dimension when possible.
- Component descriptions are important: they are passed to the classifier.
- Write descriptions for someone who has not seen the code or conversation.

Example dimensions:

- `engineering_area`: product/code areas discussed.
- `activity_type`: reading, debugging, implementation, testing, planning.
- `context_source`: user request, tool output, code, errors, documentation, summaries.

### `colors`

```ts
colors?: Record<dimensionName, Record<componentName, hexColor>>;
```

In TypeScript this is represented as:

```ts
colors?: Record<string, Record<string, string>>;
```

Provides stable colors for known dimension components. If you provide dimensions, you should usually provide colors up front.

Rules:

- Top-level keys must match dimension names.
- Nested keys must match component names.
- Values should be hex colors like `"#2563eb"`.
- Use visually distinct colors within each dimension.

Example:

```ts
colors: {
  engineering_area: {
    frontend_ui: "#2563eb",
    backend_api: "#dc2626",
    tests: "#f59e0b",
  },
}
```

### `sessionId`

```ts
sessionId?: string;
```

Use for iteration. The first `analyze2()` call returns `result.sessionId`; pass it back to refine segmentation, dimensions, or colors without re-running unchanged stages.

Example:

```ts
const refined = await analyze2({
  sessionId: result.sessionId,
  dimensions: [
    {
      name: "engineering_area",
      components: refinedComponents,
    },
  ],
  colors: refinedColors,
}, config);
```

## Config

```ts
interface AnalyzerConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  apiMode?: "responses" | "chat";
  reasoningEffort?: "none" | "low" | "medium" | "high";
  logLevel?: "silent" | "info" | "debug";
  logger?: LogSink;
}
```

- `apiKey`: required for AI stages.
- `model`: defaults to `"gpt-5.4-mini"`.
- `baseURL`: use for OpenAI-compatible providers.
- `apiMode`: use `"chat"` for many non-OpenAI providers; default is `"responses"`.
- `logLevel` / `logger`: optional diagnostics.

## Result

```ts
interface AnalyzeResult {
  sessionId: string;
  format: string;
  model?: string;
  analytics: FileAnalytics[];
  states: PipelineState[];
  errors: StageError[];
  warnings: string[];
}
```

Use `analytics` for token breakdowns and charts. Check `errors` and `warnings` before assuming the analysis succeeded.
