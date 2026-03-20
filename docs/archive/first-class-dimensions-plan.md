# Make Dimensions First-Class

## Context

The codebase has a **dual data model** problem. `WorkflowState` maintains both:
- **Legacy top-level fields**: `components`, `componentMapping`, `componentTimeline`, `componentColors`
- **Nested multi-dimensional structure**: `dimensions: Record<string, DimensionData>`

These are kept in sync via manual copying at the end of every workflow step (component-identification, component-classification, color). The relationship **dimension → components → colors** is buried under this sync machinery instead of being obvious in the types and data flow.

The goal: make `dimensions` the single source of truth. A dimension is an independent component set. Each dimension has components, and each component has a color. This hierarchy should be apparent in code.

## Plan

### Step 1: Remove legacy component fields from WorkflowState

**File: `src/workflow/types.ts`**

Remove these top-level fields from `WorkflowState`:
- `components`
- `componentMapping`
- `componentTimeline`
- `componentColors`
- `customPrompt` (moves into dimension)
- `customColoringPrompt` (moves into dimension)
- `customComponents` (moves into dimension)

Keep `dimensions: Record<string, DimensionData>` as the sole owner of component data.

Also remove `targetDimension` — replace with passing dimension name(s) as function arguments.

### Step 2: Enrich DimensionData to be self-contained

**File: `src/componentisation.ts` (where `DimensionData` is defined)**

Current:
```ts
interface DimensionData {
  name: string;
  prompt?: string;
  components: string[];
  componentMapping: Record<string, string>;
  componentTimeline: ComponentTimelineSnapshot[];
  componentColors: Record<string, string>;
  customComponents?: string[];
  customColoringPrompt?: string;
}
```

This is already fairly complete. Ensure it's the canonical type — no parallel fields elsewhere.

### Step 3: Remove sync-back logic from workflow steps

**Files:**
- `src/workflow/component-identification.ts` — remove lines 64-66 that sync `ctx.components` from default dim
- `src/workflow/component-classification.ts` — remove lines 73-79 that sync `ctx.components/componentMapping/componentTimeline`
- `src/workflow/color.ts` — remove lines 39-40 that sync `ctx.componentColors`
- `src/workflow/dimensions.ts` — remove `syncLegacyFieldsFromDimensions` entirely, simplify `ensureDimensions`

Each step just writes to `ctx.dimensions[dimName]` and that's it.

### Step 4: Pass dimension names as arguments instead of `targetDimension`

**Files: `component-identification.ts`, `component-classification.ts`, `color.ts`**

Change signatures from:
```ts
async function runIdentifyComponents(ctx: WorkflowState)
```
To:
```ts
async function runIdentifyComponents(ctx: WorkflowState, dimNames?: string[])
```

If `dimNames` not provided, process all dimensions. This replaces the fragile `ctx.targetDimension` field.

### Step 5: Make the pipeline dimension-aware

**File: `src/workflow/pipeline.ts`**

The pipeline currently treats everything as conversation-level, but there are really two layers:
- **Conversation-level** (shared): parse → count tokens → segment → summarize
- **Dimension-level** (per-dimension): identify → classify → color

Currently the composite steps hide this — `runFindComponents` and `runAssignColors` internally loop over dimensions, but the pipeline has no idea. The `targetDimension` hack on `ctx` is how a dimension-scoped event (like editing one dimension's prompt) avoids reprocessing all dimensions.

**Changes:**

1. **Composite steps accept dimension scope:**
```ts
async function runFindComponents(ctx, notify, dimNames?: string[])
async function runComponentsAndColor(ctx, notify, dimNames?: string[])
```
They pass `dimNames` through to identification/classification/color. Default = all dimensions.

2. **Event handlers pass scope explicitly:**
- `handleComponentPromptChanged` — the caller (App.tsx) already knows which dimension changed. Instead of setting `ctx.targetDimension`, it passes the dimension name. The handler calls `runComponentsAndColor(ctx, notify, [changedDim])`.
- `handleColoringPromptChanged` — same pattern, scoped to the changed dimension.
- `handleSegmentationPromptChanged` — segmentation is conversation-level, so it reprocesses all dimensions after re-segmenting. Calls `runComponentsAndColor(ctx, notify)` (no scope = all).
- `handleNewFile` — processes all dimensions (the default).

3. **Field lists simplify:**
Remove `"components"`, `"componentMapping"`, `"componentTimeline"`, `"componentColors"` from all field lists (`NEW_FILE_COMPLETE`, `PRE_PROCESSED_COMPLETE`, `RESUME_COMPLETE`, `GROUPED_COMPLETE`). Only `"dimensions"` remains for component data.

`updateState` in `runComponentsAndColor` becomes:
```ts
updateState(notify, ctx, ["conversation", "dimensions"], "coloring");
```

4. **`completionFieldsForReprocess`** in `analyze.ts` — remove legacy fields, keep `"dimensions"`.

5. **`processConversationWorkflow` gains dimension scope:**
   Pass dimension scope via a new options parameter on `processConversationWorkflow` (e.g. `options?: { dimNames?: string[] }`). This makes the scope visible at the call site rather than buried in ctx mutation.

### Step 6: Simplify the runner / notify mechanism

**File: `src/workflow/runner.ts`**

The `updateState` and `markComplete` functions use `pickFields` to copy named fields from `ctx` into a partial update pushed to the store. With legacy fields gone, these field lists shrink. The mechanism itself stays the same — it's a good pattern — but every call site that listed `"components"`, `"componentMapping"`, etc. just lists `"dimensions"` instead.

The `WorkflowDataField` type in `types.ts` also shrinks (remove the legacy field names from the union).

### Step 7: Update conversation-store.ts

**File: `src/stores/conversation-store.ts`**

- `handleGroupConversations`: Merge dimensions across conversations, not legacy fields. For each dimension name found across source conversations, merge their componentMappings (with prefixed part IDs), union their component lists, merge their colors.
- `handleUpdateGroupSources`: Same dimension-aware merging.
- `handleApplyPromptsToAll`: Copy dimension prompts, not just top-level `customPrompt`.
- `handleExportPromptsAsPreset`: Always export dimensions (not conditionally when >1).
- `buildBaseContext`: Remove legacy field copying; just copy `dimensions`.

### Step 8: Update App.tsx handlers

**File: `src/App.tsx`**

- `handleApplyPrompt`: Write to `dims[dimName].prompt` directly (already does this), remove the `customPrompt` sync for "default".
- `handleApplyColoringPrompt`: Write to dimension's `customColoringPrompt`.
- `handleAddDimension` / `handleRemoveDimension`: Already dimension-aware, just remove legacy field fallbacks.
- All places reading `conv.componentMapping`, `conv.componentColors`, etc. → read from `conv.dimensions?.["default"]` or the active dimension.
- Pass `dimNames` to `processConversationWorkflow` at call sites that are dimension-scoped.

### Step 9: Create accessor helpers

**File: `src/workflow/dimensions.ts`**

Add helpers that UI and workflow code use instead of reaching into fields:
```ts
function getDimension(state: WorkflowState, name?: string): DimensionData | undefined
function getActiveDimension(state: WorkflowState, activeDims?: Set<string>): DimensionData | undefined
function getAllComponents(state: WorkflowState): string[]  // union across dimensions
function getComponentColor(state: WorkflowState, component: string, dimName?: string): string | undefined
```

This centralizes the "which dimension am I looking at?" logic instead of scattering it across components.

### Step 10: Update UI components that consume component data

**Key files to update** (these read `componentMapping`, `componentColors`, etc.):
- `src/components/ConversationView.tsx` — use dimension accessors
- `src/components/MessagePartView.tsx` — already has dimension badge rendering, simplify
- `src/components/ComponentComparisonView.tsx` — update `ConversationComponentData` interface
- `src/aggregation.ts` — `aggregateComponentTokens` needs to accept dimension name

### Step 11: Update analyze.ts and summarize.ts

**File: `src/workflow/analyze.ts`**

Currently manually aggregates components from all dimensions. With dimensions as first-class, this becomes:
```ts
const allComponents = getAllComponents(ctx);
```

## Critical files to modify
1. `src/workflow/types.ts` — remove legacy fields
2. `src/componentisation.ts` — DimensionData is canonical (already mostly fine)
3. `src/workflow/dimensions.ts` — add accessors, remove sync helpers
4. `src/workflow/component-identification.ts` — remove sync-back
5. `src/workflow/component-classification.ts` — remove sync-back
6. `src/workflow/color.ts` — remove sync-back
7. `src/workflow/pipeline.ts` — dimension-aware composite steps, simplified field lists
8. `src/workflow/runner.ts` — shrink WorkflowDataField, field lists
9. `src/workflow/analyze.ts` — use dimension helpers
10. `src/stores/conversation-store.ts` — dimension-aware grouping/merging
11. `src/App.tsx` — use dimension accessors, pass dimNames to pipeline
12. `src/components/ConversationView.tsx` — use dimension accessors
13. `src/components/MessagePartView.tsx` — simplify
14. `src/components/ComponentComparisonView.tsx` — update interface

## Verification
- Run `pnpm build` — no type errors
- Load a conversation file, verify components identified and colored
- Add a second dimension, verify independent component set + colors
- Group two conversations, verify merged dimensions appear
- Edit component prompt for a single dimension, verify only that dimension reprocesses
- Export preset, verify dimensions are included
