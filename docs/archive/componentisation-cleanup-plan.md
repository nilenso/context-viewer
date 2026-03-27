# Clean up: Reflect identification + classification duality everywhere

## Context

Componentisation is actually two steps: **identification** (discover what components exist) and **classification** (assign each part to a component). The workflow layer already models this with separate files (`workflow/component-identification.ts`, `workflow/component-classification.ts`), but the core logic, types, prompts, and UI still use the merged term "componentisation."

## What needs to change

### 1. Delete dead code from `src/componentisation.ts`
- Remove `componentiseConversation()` (lines 405-491) — never called anywhere

### 2. Split `src/componentisation.ts` into domain files

**`src/component-identification.ts`** (new, at src/ level):
- `identifyComponents()` function

**`src/component-classification.ts`** (new, at src/ level):
- `PartWithContext` interface + `extractPartsWithContext()`
- `mapPartsBatch()` + `mapComponentsToIds()`
- `buildComponentTimeline()` (the logging wrapper around `aggregation.ts`)

**`src/component-coloring.ts`** (new):
- `assignComponentColors()` function (currently in componentisation.ts)

**`src/component-types.ts`** (new):
- `DimensionData` interface (imported by 10+ files)

Then delete `src/componentisation.ts` and update all imports.

### 3. Rename `src/static-componentisation.ts` to `src/static-components.ts`
- Update imports in `workflow/count-tokens.ts`, `workflow/parse.ts`, `stores/conversation-store.ts`

### 4. Rename prompt key `"component-mapping"` -> `"component-classification"`
- `src/prompts.ts`: rename in `PromptKey` union and `prompts` record
- `src/component-classification.ts`: update `getPrompt("component-mapping", ...)` call

### 5. Remove `getComponentisationConfig` indirection
- `getComponentisationConfig` is just `() => getAIConfig("Componentisation")` — adds nothing
- Replace all call sites with direct `getAIConfig()` from `src/ai-config.ts`
- Call sites: `workflow/component-identification.ts`, `workflow/component-classification.ts`, `workflow/pipeline.ts`, `stores/conversation-store.ts`, `App.tsx`

### 6. Update aggregation.ts re-exports
- Files importing `buildComponentTimeline` from `componentisation.ts` should import from `src/component-classification.ts` (logging wrapper) or directly from `aggregation.ts` (pure function)
- Drop the "backward compatibility" re-export block in `componentisation.ts`

### 7. Update UI strings
- `App.tsx:1078`: "componentisation prompt" -> "component identification prompt"
- `App.tsx:1081-1082`: "re-run componentisation" -> "re-run component identification and classification"
- `WorkflowDetailModal.tsx:675`: "run componentisation" -> "run component identification"
- Keep `ConversationList.tsx:227` "Find components" as-is (short composite step label)

### 8. Update logger labels
- New identification file: `createPhaseLogger("finding-components", "Identification")`
- New classification file: `createPhaseLogger("finding-components", "Classification")`
- Phase string stays `"finding-components"` (maps to `ProcessingStep` union)

### What stays as-is
- `ProcessingStep = "finding-components"` — composite UI step, splitting adds no value
- `WorkflowEvent.ComponentPromptChanged` — only identification has a user-facing prompt currently
- `ComponentisationConfig` type alias — removed entirely, callers use `AIConfig` directly

## Implementation order
1. Delete dead code (`componentiseConversation`)
2. Create new files with extracted code
3. Make `componentisation.ts` a temporary re-export barrel
4. Update all imports to point to new files
5. Delete `componentisation.ts`
6. Rename `static-componentisation.ts` -> `static-components.ts`
7. Rename prompt key
8. Remove `getComponentisationConfig` wrapper
9. Update UI strings + logger labels
10. Verify: `tsc --noEmit`

## Critical files
- `src/componentisation.ts` — being decomposed
- `src/prompts.ts` — prompt key rename
- `src/workflow/types.ts` — re-exports DimensionData, defines ProcessingStep
- `src/workflow/component-identification.ts` — update imports
- `src/workflow/component-classification.ts` — update imports
- `src/stores/conversation-store.ts` — update imports
- `src/App.tsx` — UI strings + imports

## Verification
- `npx tsc --noEmit` — type-check passes
- `npm run build` — builds cleanly
- No behavioral changes — all changes are structural/naming
