# Writing Unit Tests from Session Recordings

## What You Have

1. **The source code** of a conversation analysis tool (this repository)
2. **Session recording JSON files** — captured from real browser sessions,
   containing every core function call with its inputs, outputs, timing,
   and store state changes

Your job: write a comprehensive unit test suite for the core library
using the recordings as ground truth for inputs and expected outputs.

## Project Structure

```
src/
├── model/           Data types (no logic, no tests needed)
├── operations/      Pure functions over model types (no AI, no I/O)
├── parsers/         Format detection + parsing to standard Conversation schema
├── stages/          Pipeline stages (some call AI via Vercel AI SDK)
│   └── ai/          AI config, prompts, content stripping
├── pipeline/        Orchestration — sequences stages, manages lifecycle
├── stores/          Zustand state management
└── ui/              React components (DO NOT TEST — out of scope)
```

Dependency rule (each layer only imports downward):
```
model → nothing
operations → model
parsers → model
stages → model + operations + stages/ai + AI SDK
pipeline → model + stages
stores → model + operations + pipeline + parsers
```

**Read the architecture docs** in `docs/architecture.md` and
`docs/system-overview.md` for full context on the pipeline and data model.

## Test Framework

- **Vitest** (configured in `vitest.config.ts`)
- `@` alias maps to `src/`
- Tests go in `__tests__/` directories next to the code they test
  (e.g. `src/operations/__tests__/conversation-summary.test.ts`)
- Run: `npx vitest run`

## Session Recording Format

Each recording is a JSON file with this structure:

```json
{
  "sessionName": "compaction-single-passthrough",
  "startedAt": "2026-03-26T15:03:41.315Z",
  "endedAt": "2026-03-26T15:03:54.317Z",
  "durationMs": 13002,
  "entryCount": 41,
  "entries": [ ... ]
}
```

Each entry in `entries` represents one function call:

```json
{
  "index": 13,
  "timestamp": "2026-03-26T15:03:43.789Z",
  "startMs": 2473,
  "endMs": 2474,
  "module": "operations/static-components",
  "functionName": "staticComponentise",
  "args": [{ "messageCount": 1 }],
  "durationMs": 0,
  "result": {
    "components": ["user.text"],
    "mapping": { "4": "user.text" },
    "timeline": [{ "messageIndex": 0, "componentTokens": { "user.text": 2718 }, "totalTokens": 2718 }]
  },
  "parentIndex": 11
}
```

### Entry fields

| Field | Meaning |
|-------|---------|
| `module` | Source file path, e.g. `"stages/identify-components"`, `"operations/static-components"` |
| `functionName` | The function that was called |
| `args` | Serialized arguments — **summarized, not raw** (see below) |
| `result` | Serialized return value — **this is the real output** |
| `error` | Error message if the function threw |
| `parentIndex` | Index of the calling function (forms a call tree) |
| `storeDiff` | What changed in the Zustand store during this call (see below) |
| `startMs` / `endMs` | Timing relative to session start |

### How to read `args`

Arguments are logged as **summaries**, not full objects. For example, a
function receiving a `Conversation` object logs `{ "messageCount": 51 }`
rather than all 51 messages. This tells you *what kind of input* the
function received, but you need to reconstruct the actual input from
sample files (see below).

### How to read `result`

Results are the **actual serialized return values**. For pure functions
these are complete and directly usable as expected outputs in assertions.
Long strings (>2000 chars) are truncated with `...[truncated, N chars]`.

### How to read `storeDiff`

Present only on entries that modify the Zustand store (pipeline and action
functions). Shows what changed:

```json
{
  "conversations": {
    "added": [{ "id": "1", "filename": "file.jsonl", "status": "pending", "messageCount": 0, ... }],
    "changed": {
      "1": {
        "status": ["pending", "success"],
        "messageCount": [0, 51],
        "dimensions": [null, { "default": { "discoveredComponents": ["A", "B"], ... } }]
      }
    }
  },
  "groups": {}
}
```

Each changed field shows `[oldValue, newValue]`. Conversations are
compacted — `messageCount` instead of full messages, `mappingCount`
instead of full mapping, but `discoveredComponents` and `componentColors`
are included in full (they're small).

### Call tree

`parentIndex` forms a tree. A typical file-drop session looks like:

```
processFileDrop
  └─ runPipelineMutation
       └─ runPipeline                    (one per file, parallel)
            ├─ parsing
            │    └─ parse
            │         ├─ parseFileContent
            │         └─ summarizeConversation
            ├─ counting-tokens
            │    ├─ addTokenCounts
            │    └─ staticComponentise
            ├─ segmenting
            │    └─ segmentConversation          ← AI
            ├─ identifying-components
            │    └─ identifyForDimension
            │         └─ identifyComponents      ← AI
            └─ classifying-components
                 ├─ classifyForDimension
                 │    └─ mapComponentsToIds       ← AI
                 └─ colorForDimension
                      └─ assignComponentColors    ← AI
```

## How To Write Tests

### General approach

1. Read the session log to find all unique functions
2. For each function, look at its entries to understand inputs and outputs
3. Read the actual source code to understand the function signature and behavior
4. Write tests: use sample files for inputs, use recording results for assertions
5. Mock AI calls, test everything else for real

### Pure functions — test directly, no mocks

Functions in `operations/` and `parsers/` are pure. Load a sample file,
run the function, assert against the recording's `result`.

```typescript
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { summarizeConversation } from "@/operations/conversation-summary";
import { staticComponentise } from "@/operations/static-components";
import { parserRegistry } from "@/parsers/parser";
import "@/parsers/index"; // registers all parsers
import { parseFileContent } from "@/parsers/file-formats";

function loadConversation(relativePath: string) {
  const filepath = path.resolve(__dirname, "../../../../sample-logs", relativePath);
  const text = fs.readFileSync(filepath, "utf-8");
  const data = parseFileContent(text, path.basename(filepath));
  const { conversation, metadata } = parserRegistry.parseWithMetadata(data);
  return { conversation, metadata };
}

describe("summarizeConversation", () => {
  it("counts messages by role for a claude transcript", () => {
    const { conversation } = loadConversation("claude-transcripts/large.jsonl");
    const result = summarizeConversation(conversation);

    // From recording: totalMessages was 51, with user/assistant/tool roles
    expect(result.totalMessages).toBe(51);
    expect(result.messagesByRole).toHaveProperty("user");
    expect(result.messagesByRole).toHaveProperty("assistant");
    expect(Object.keys(result.partCounts).length).toBeGreaterThan(0);
  });
});

describe("staticComponentise", () => {
  it("builds components from role.partType", () => {
    const { conversation } = loadConversation("claude-transcripts/large.jsonl");
    const result = staticComponentise(conversation);

    // From recording: components like "user.text", "assistant.text", etc.
    expect(result.components.length).toBeGreaterThan(0);
    expect(result.components).toContain("user.text");
    expect(result.components).toContain("assistant.text");

    // Every part should have a mapping entry
    const totalParts = conversation.messages.reduce(
      (sum, m) => sum + m.parts.length, 0
    );
    expect(Object.keys(result.mapping).length).toBe(totalParts);

    // Timeline should have one entry per message
    expect(result.timeline.length).toBe(conversation.messages.length);
  });
});
```

### Token counting — test for real (uses WASM tiktoken)

`addTokenCounts` uses tiktoken. It's deterministic — no mocking needed.

```typescript
import { addTokenCounts } from "@/operations/token-counting";

describe("addTokenCounts", () => {
  it("adds token_count to every text part", async () => {
    const { conversation } = loadConversation("claude-transcripts/large.jsonl");
    const result = await addTokenCounts(conversation);

    for (const message of result.messages) {
      for (const part of message.parts) {
        if (part.type === "text" || part.type === "reasoning") {
          expect(part).toHaveProperty("token_count");
          expect(part.token_count).toBeGreaterThan(0);
        }
      }
    }
  });
});
```

### Parsers — test format detection and parsing

```typescript
import { parseFileContent } from "@/parsers/file-formats";
import { parserRegistry } from "@/parsers/parser";
import "@/parsers/index";

describe("parseFileContent", () => {
  it("parses JSONL files", () => {
    const text = fs.readFileSync(
      path.resolve(__dirname, "../../../../sample-logs/claude-transcripts/large.jsonl"),
      "utf-8"
    );
    const data = parseFileContent(text, "large.jsonl");
    // JSONL → array of objects
    expect(Array.isArray(data)).toBe(true);
  });

  it("parses JSON files", () => {
    const text = fs.readFileSync(
      path.resolve(__dirname, "../../../../sample-logs/responses/swing_stories.json"),
      "utf-8"
    );
    const data = parseFileContent(text, "swing_stories.json");
    expect(typeof data).toBe("object");
  });
});

describe("parserRegistry", () => {
  it("detects claude transcript format", () => {
    const text = fs.readFileSync(samplePath, "utf-8");
    const data = parseFileContent(text, "large.jsonl");
    const { conversation, metadata } = parserRegistry.parseWithMetadata(data);

    // From recording: parserName was "Claude Code"
    expect(metadata.parserName).toBe("Claude Code");
    expect(conversation.messages.length).toBeGreaterThan(0);
  });
});
```

### AI-calling functions — mock the AI SDK

Functions that call AI use `generateText` or `streamText` from the `"ai"`
package. Mock these. Use the recording's `result` to know what the mock
should produce.

**Key insight**: look at the recording for an AI-calling function (e.g.
`identifyComponents`). Its `result` field shows what the function
returned. Work backward to figure out what the AI SDK mock should return
to produce that result.

For `identifyComponents`: it parses a JSON array from `generateText`'s
`result.text`. So mock `generateText` to return
`{ text: JSON.stringify(recordedResult) }`.

For `mapComponentsToIds`: same pattern — returns a merged mapping from
batched `generateText` calls that each return JSON objects.

For `assignComponentColors`: returns a color mapping parsed from
`generateText`'s response.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AI SDK — must be before importing stages
vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

// Mock the config to always return a valid config
vi.mock("@/stages/ai/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/stages/ai/config")>();
  return {
    ...mod,
    hasApiKey: () => true,
    getAIConfig: () => ({
      provider: "openai",
      model: "gpt-5.4-mini",
      apiKey: "test-key",
    }),
    createModel: () => ({}),
    getProviderOptions: () => ({}),
  };
});

import { generateText } from "ai";
import { identifyComponents } from "@/stages/identify-components";
import { mapComponentsToIds } from "@/stages/classify-components";
import { assignComponentColors } from "@/stages/color-components";

describe("identifyComponents", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("parses component list from AI response", async () => {
    // From recording: identifyComponents returned this array
    const expectedComponents = ["EXPLORE", "IMPLEMENT", "VERIFY", "PLAN"];

    (generateText as any).mockResolvedValue({
      text: JSON.stringify(expectedComponents),
    });

    const { conversation } = loadConversation("claude-transcripts/large.jsonl");
    const config = { provider: "openai", model: "gpt-5.4-mini", apiKey: "k" };

    const result = await identifyComponents(conversation, config);
    expect(result).toEqual(expectedComponents);
    expect(generateText).toHaveBeenCalledOnce();
  });
});

describe("mapComponentsToIds", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("maps parts to components in batches", async () => {
    // From recording: mapComponentsToIds returned a mapping like { "part-1": "EXPLORE", ... }
    // It calls generateText once per batch of 20 parts.
    // Mock each call to return a subset of the mapping.
    const fullMapping = { "1": "EXPLORE", "2": "IMPLEMENT", "3": "VERIFY" };

    (generateText as any).mockResolvedValue({
      text: JSON.stringify(fullMapping),
    });

    const { conversation } = loadConversation("claude-transcripts/large.jsonl");
    const tokenized = await addTokenCounts(conversation);
    const config = { provider: "openai", model: "gpt-5.4-mini", apiKey: "k" };

    const result = await mapComponentsToIds(
      tokenized, ["EXPLORE", "IMPLEMENT", "VERIFY"], config
    );

    expect(typeof result).toBe("object");
    // Every value should be one of the components
    for (const comp of Object.values(result)) {
      expect(["EXPLORE", "IMPLEMENT", "VERIFY", "other"]).toContain(comp);
    }
  });
});

describe("assignComponentColors", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("assigns colors via AI", async () => {
    const components = ["EXPLORE", "IMPLEMENT", "VERIFY"];
    const expectedColors = { EXPLORE: "blue", IMPLEMENT: "green", VERIFY: "orange" };

    (generateText as any).mockResolvedValue({
      text: JSON.stringify(expectedColors),
    });

    const config = { provider: "openai", model: "gpt-5.4-mini", apiKey: "k" };
    const result = await assignComponentColors(components, config);

    expect(Object.keys(result)).toEqual(components);
  });

  it("uses preset colors when provided", async () => {
    const components = ["EXPLORE", "IMPLEMENT"];
    const presetColors = { EXPLORE: "#ff0000", IMPLEMENT: "#00ff00" };

    const config = { provider: "openai", model: "gpt-5.4-mini", apiKey: "k" };
    const result = await assignComponentColors(
      components, config, undefined, presetColors
    );

    expect(result).toEqual(presetColors);
    expect(generateText).not.toHaveBeenCalled(); // no AI needed
  });
});
```

### Streaming functions (summary, analysis)

```typescript
import { generateConversationSummary } from "@/stages/summarize";
import { streamText } from "ai";

describe("generateConversationSummary", () => {
  it("streams a summary", async () => {
    const summaryText = "This conversation covers..."; // from recording

    (streamText as any).mockReturnValue({
      textStream: (async function* () {
        yield summaryText;
      })(),
    });

    const { conversation } = loadConversation("claude-transcripts/large.jsonl");
    const chunks: string[] = [];
    const result = await generateConversationSummary(
      conversation,
      (chunk) => chunks.push(chunk),
    );

    expect(result.summary).toBe(summaryText);
    expect(result.error).toBeUndefined();
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

### Dimension-level orchestrators — test idempotency

`identifyForDimension`, `classifyForDimension`, `colorForDimension` have
idempotency logic. Test that they skip work when outputs already exist.
Read the source code to understand the skip conditions.

```typescript
import { identifyForDimension } from "@/stages/identify-components";
import { classifyForDimension } from "@/stages/classify-components";
import type { DimensionData } from "@/model/types";

describe("identifyForDimension", () => {
  it("uses customComponents directly without AI", async () => {
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: [],
      componentMapping: {},
      componentTimeline: [],
      componentColors: {},
      customComponents: ["A", "B", "C"],
    };

    const config = { provider: "openai", model: "m", apiKey: "k" };
    const result = await identifyForDimension(conversation, dim, config);

    expect(result.result.discoveredComponents).toEqual(["A", "B", "C"]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("is idempotent when customComponents match discoveredComponents", async () => {
    const dim: DimensionData = {
      name: "default",
      discoveredComponents: ["A", "B"],
      componentMapping: {},
      componentTimeline: [],
      componentColors: {},
      customComponents: ["A", "B"],
    };

    const result = await identifyForDimension(conversation, dim, null);
    expect(result.result).toEqual({}); // no-op
  });
});

describe("classifyForDimension", () => {
  it("skips when mapping already covers all parts", async () => {
    // Build a conversation + mapping where every part is already classified
    // (from recording: check storeDiff showing mappingCount matched totalParts)
    // ...
  });
});
```

### Pipeline — test full flow with mocked AI

```typescript
import { runPipeline } from "@/pipeline/pipeline";
import type { PipelineState } from "@/model/types";

describe("runPipeline", () => {
  it("runs all stages and populates ctx", async () => {
    // Set up AI mocks with data from recording
    (generateText as any)
      .mockResolvedValueOnce({ text: '[]' })            // segmentation (no large parts)
      .mockResolvedValueOnce({ text: '["A","B","C"]' }) // identify
      .mockResolvedValueOnce({ text: '{"1":"A"}' })     // classify batch
      .mockResolvedValueOnce({ text: '{"A":"blue","B":"green","C":"red"}' }); // color

    const updates: Partial<PipelineState>[] = [];
    const notify = (_id: string, update: Partial<PipelineState>) => {
      updates.push(update);
    };

    const fileContent = fs.readFileSync(samplePath, "utf-8");
    const ctx: PipelineState = {
      id: "test-1",
      filename: "test.jsonl",
      file: new File([fileContent], "test.jsonl"),
      conversation: undefined,
      warnings: [],
      stepTimings: {},
    };

    await runPipeline(ctx, notify);

    // From recording storeDiff: status went from pending to success
    expect(ctx.conversation).toBeDefined();
    expect(ctx.dimensions?.default?.discoveredComponents).toEqual(["A", "B", "C"]);
    expect(ctx.dimensions?.default?.componentColors).toBeDefined();

    // Verify pipeline notified progress
    const statuses = updates.map(u => u.step).filter(Boolean);
    expect(statuses[0]).toBe("parsing");
  });
});
```

### Reprocessing — test `reprocessTarget` with context modifiers

In recordings, you'll see chains like:
```
applyPrompt → reprocessTarget → runPipeline → (stages...)
applySegmentationPrompt → reprocessSegmentation → reprocessTarget → runPipeline → (stages...)
```

The `reprocessTarget` function takes a `contextModifier` callback that
mutates the pipeline context before re-running. In recordings, you can
see what changed by comparing the `storeDiff` — e.g. a `reprocessTarget`
entry with `dimNames: ["default"]` shows only the default dimension was
re-run.

```typescript
import { reprocessTarget, type StoreAccessor } from "@/pipeline/pipeline";

describe("reprocessTarget", () => {
  it("reprocesses only specified dimensions", async () => {
    // Build a StoreAccessor mock with a conversation that already has results
    const conv: PipelineState = {
      id: "test-1",
      filename: "test.jsonl",
      conversation: loadedConversation,
      dimensions: {
        default: {
          name: "default",
          discoveredComponents: ["A", "B"],
          componentMapping: existingMapping,
          componentTimeline: existingTimeline,
          componentColors: { A: "blue", B: "green" },
        },
      },
      warnings: [],
      stepTimings: {},
    };

    const store: StoreAccessor = {
      getState: () => ({ conversations: [conv], groups: {}, pendingSessionImport: null }),
      updateConversation: vi.fn(),
      updateGroup: vi.fn(),
      appendSummaryChunk: vi.fn(),
      appendAnalysisChunk: vi.fn(),
      set: vi.fn(),
    };

    // Clear discoveredComponents to force re-identification
    await reprocessTarget(
      store, "test-1",
      (ctx) => {
        const dim = ctx.dimensions!.default!;
        dim.discoveredComponents = [];
        dim.prompt = "new custom prompt";
      },
      {},
      ["default"],
    );

    // Verify updateConversation was called with new dimension data
    expect(store.updateConversation).toHaveBeenCalled();
  });
});
```

### `applyPromptsToAll` — cross-conversation prompt copying

In recordings, this shows as:
```
applyPromptsToAll(sourceId: "1") → runPipeline (for each target conversation)
```

The `storeDiff` shows other conversations' dimensions updated to match
the source. Test that prompts, components, and colors are copied and
only the necessary stages re-run.

```typescript
import { applyPromptsToAll } from "@/pipeline/pipeline";

describe("applyPromptsToAll", () => {
  it("copies prompts from source to all other successful conversations", async () => {
    const source = buildConvWithDimensions("source-1", { prompt: "custom", components: ["X", "Y"] });
    const target = buildConvWithDimensions("target-1", { prompt: "default", components: ["A", "B"] });

    const store: StoreAccessor = {
      getState: () => ({
        conversations: [
          { ...source, status: "success" },
          { ...target, status: "success" },
        ],
        groups: {},
        pendingSessionImport: null,
      }),
      updateConversation: vi.fn(),
      // ...
    };

    await applyPromptsToAll(store, "source-1");

    // From recording: target's dimensions should be updated
    // and a runPipeline should have been called for the target
    expect(store.updateConversation).toHaveBeenCalled();
  });
});
```

### Group operations — test `groupConversations`

In recordings, the `groupConversations` entry shows:
- `args`: `[{}]` (uses selected IDs from UI store, or explicit IDs)
- `storeDiff.groups.added`: the new group with its ID, name, and fileIds

This is an action in `stores/actions.ts` that calls
`useConversationStore.getState().groupConversations(...)`.
Test the store method directly:

```typescript
import { useConversationStore } from "@/stores/conversation-store";

describe("groupConversations", () => {
  beforeEach(() => {
    // Reset store
    useConversationStore.setState({
      conversations: [
        { id: "1", filename: "a.jsonl", status: "success", conversation: { messages: [] } },
        { id: "2", filename: "b.jsonl", status: "success", conversation: { messages: [] } },
      ],
      groups: {},
    });
  });

  it("creates a group from two conversations", () => {
    const store = useConversationStore.getState();
    const groupId = store.groupConversations(["1", "2"], "Test Group");

    expect(groupId).toBeTruthy();
    const group = store.getGroup(groupId);
    expect(group).toBeDefined();
    expect(group!.fileIds).toEqual(["1", "2"]);
    expect(group!.name).toBe("Test Group");
  });

  it("rejects groups with fewer than 2 valid conversations", () => {
    const store = useConversationStore.getState();
    const groupId = store.groupConversations(["1"], "Solo");
    expect(groupId).toBe("");
  });
});
```

### Segmentation — testing varying behavior

In recordings, `segmentConversation` shows two behaviors:
- **Long runs (seconds)**: conversation has large parts above the token
  threshold, AI is called to find split points
- **Fast runs (< 50ms)**: no parts exceed threshold, returns immediately

Test both paths:

```typescript
describe("segmentConversation", () => {
  it("returns original conversation when no parts exceed threshold", async () => {
    // Small conversation — all parts under 500 tokens
    const { conversation } = loadConversation("...");
    const result = await segmentConversation(conversation);

    // From recording: fast return, same message count
    expect(result.conversation.messages.length).toBe(conversation.messages.length);
    expect(result.error).toBeUndefined();
  });

  it("segments large parts into chunks", async () => {
    // Conversation with a large part (>500 tokens)
    // Mock generateText to return split point regexes
    (generateText as any).mockResolvedValue({
      text: '["(?=## Section 1)", "(?=## Section 2)"]',
    });

    const { conversation } = loadConversation("...");
    const result = await segmentConversation(conversation);

    // From recording: message count may increase (parts split into sub-parts)
    expect(result.conversation.messages.length).toBeGreaterThanOrEqual(
      conversation.messages.length
    );
  });
});
```

## Reading the Session Log — Step by Step

When given a session recording file:

1. **Parse the JSON.** List all unique `module`/`functionName` pairs.
   These are the functions to test.

2. **Build the call tree** from `parentIndex`. This shows you the
   execution flow and which functions call which.

3. **Identify the session type** from the top-level entries (those with
   no `parentIndex`). Common patterns:
   - **File drop**: `processFileDrop` → `runPipelineMutation` → parallel `runPipeline`s
   - **Prompt edit + reprocess**: `applyPrompt` → `reprocessTarget` → `runPipeline`
   - **Segmentation change**: `applySegmentationPrompt` → `reprocessSegmentation` → `reprocessTarget` → `runPipeline`
   - **Apply to all**: `applyPromptsToAll` → `runPipeline` (for each target)
   - **Group creation**: `groupConversations` (store mutation only, no pipeline)
   - **Summary/analysis**: `generateSummary` / `generateAnalysis` → `generateSummaryForTarget` / `generateAnalysisForTarget`

4. **For each function**, find all entries with that `functionName`:
   - Look at `args` to understand what kind of inputs it receives
   - Look at `result` to know the expected output — **use these as
     assertion values in tests**
   - Look at `storeDiff` to know what side effects to verify
   - Check if it has children that are AI calls (the function itself
     may be pure but orchestrate AI calls)
   - **Compare multiple entries** of the same function: one may show a
     full run (AI called, result populated) while another shows
     idempotency (result is `{}`, no AI called). Test both paths.

5. **Find the sample input files** used in the session. The `parsing`
   entries show `filename` in their args. Match these to files in
   `sample-logs/` or elsewhere in the repo.

6. **Write one test file per module.** Within each file, write at least
   one test per function. If the recording has multiple entries for the
   same function with different inputs (e.g. two files processed in
   parallel, or the same file reprocessed with a different prompt),
   write multiple test cases covering each variation.

## What to test, what to mock

| Layer | Mock AI? | Mock anything else? | What to assert |
|-------|----------|---------------------|----------------|
| `operations/` | No AI calls | Nothing | Return values match recording |
| `parsers/` | No AI calls | Nothing | Correct format detection, parsed structure |
| `stages/` (AI) | Yes: `vi.mock("ai")` | Mock `@/stages/ai/config` | Return values, that AI was called correctly |
| `stages/` (orchestrators) | Yes | Nothing else | Idempotency, delegation, error handling |
| `pipeline/` | Yes | Nothing else | Stage ordering, state transitions, ctx population |
| `pipeline/` (reprocess) | Yes | Nothing else | Selective re-run, dimension targeting, context modification |
| `stores/` (conv store) | N/A | Nothing | Group CRUD, conversation CRUD, state shape |
| `actions/` | Yes | Mock UI stores (`useUIStore`, `useUrlStore`) | Correct delegation to pipeline, store mutations |

**Note on actions**: Functions in `stores/actions.ts` glue the UI to the
pipeline. They read from `useUIStore` (dialog state, editing prompts) and
`useConversationStore`, then call pipeline functions. If you test them,
you need to mock the UI stores. Alternatively, skip action tests and test
the pipeline functions they delegate to — the recording shows both levels.

## Important Notes

- **DO NOT test `src/ui/`** — only model, operations, parsers, stages, pipeline.
- **DO NOT mock pure functions.** Only mock `generateText`/`streamText`
  from `"ai"` and the AI config from `"@/stages/ai/config"`.
- **Sample input files** are in `sample-logs/`. Use them to construct real
  `Conversation` objects. Do not try to reconstruct conversations from the
  truncated data in recording entries.
- **Multiple recordings** = multiple test scenarios. Each recording
  captures a different user workflow (e.g. single file drop, multi-file,
  prompt editing, reprocessing). Use entries from different recordings as
  different test cases for the same function.
- **`addTokenCounts`** uses tiktoken WASM — works in vitest without mocking.
- **`hasApiKey()` / `getAIConfig()`** gate AI stages. Mock them in tests
  that need AI stages to run (see the `vi.mock("@/stages/ai/config")`
  pattern above).
