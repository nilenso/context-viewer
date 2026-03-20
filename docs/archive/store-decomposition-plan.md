# Decompose conversation-store.ts

## Context

`conversation-store.ts` is 788 lines acting as state container, workflow orchestrator, grouped-conversation builder, file import handler, and exporter. Six methods take `(selectedId, setSelectedId)` as parameters because selection lives in URL state outside the store. The grouped conversation merge logic (~100 lines) is duplicated between `handleGroupConversations` and `handleUpdateGroupSources`.

**Goal:** Thin store (state + simple mutations only). Domain logic as standalone functions. No `setSelectedId` threading.

## Approach: One store + external functions

Keep a single Zustand store. No split into multiple stores — only App.tsx subscribes, so there's no performance benefit to splitting, and it adds cross-store coordination overhead.

## Steps

### 1. Extract `mergeConversations()` → `src/workflow/merge-conversations.ts`

Pure function: takes `WorkflowState[]`, returns merged conversation + component data + source maps. Deduplicates the ~100-line merge block used by both `handleGroupConversations` and `handleUpdateGroupSources`.

### 2. Extract `buildBaseContext()` → `src/workflow/context.ts`

Trivial move — already exported, used by 8 call sites across store + App.tsx.

### 3. Extract `parseFileDropInput()` → `src/lib/file-import.ts`

Pure async function: takes `File[]`, returns `{ filesToProcess, presetIds, pendingSessionImport }`. Separates JSON detection + virtual file creation from store mutation.

### 4. Extract `exportPromptsAsPreset()` → `src/lib/export-builder.ts`

Move alongside existing `buildSessionExport`/`downloadExport`. Takes a `WorkflowState`, triggers download. Removes `window.prompt()` from the store.

### 5. Extract orchestration → `src/workflow/orchestrate.ts`

Move these out of the store:
- `runWorkflowMutation(accessor, files, presetIds, options)` → returns first placeholder ID
- `groupConversations(accessor, ids, name?, existingId?, title?)` → returns groupId
- `updateGroupSources(accessor, groupId, newSources)` → returns `void | "ungrouped"`
- `applyPromptsToAll(accessor, sourceId)`
- `resumeWorkflowsWithApiKey(accessor)`
- `reprocessWithRunner(accessor, conv, event, contextModifier, callbacks)`

They accept a `StoreAccessor` (subset of store methods: `getState`, `updateConversation`, `addConversations`, `appendSummaryChunk`, `appendAnalysisChunk`, `set`). They return navigation intent instead of accepting `setSelectedId`.

### 6. Slim the store

After extraction, the store is ~170 lines: state fields + simple mutations (updateConversation, addConversations, removeConversation, append*Chunk, renameConversation, selection ops, setters for bookkeeping).

`deleteConversation` drops its `setSelectedId` param — App.tsx already has a useEffect that corrects selection when the selected conversation disappears.

### 7. Update App.tsx wrappers

The existing wrapper functions (lines 773-784) become:
```ts
const handleGroupConversations = async (ids?, ...) => {
  const groupId = await groupConversations(accessor, ids || [...selectedIds], ...);
  if (!ids) clearSelection();
  setSelectedId(groupId);
};
```

Navigation lives in App.tsx where `setSelectedId` is defined. Clean separation.

## Sequencing

Steps 1-4 are independent pure extractions — can each be done and verified separately.
Steps 5-7 are one atomic change (orchestration + store slim + App.tsx rewire).

## Files modified

- `src/stores/conversation-store.ts` — shrinks from 788 → ~170 lines
- `src/workflow/merge-conversations.ts` — new, ~60 lines
- `src/workflow/context.ts` — new, ~30 lines
- `src/workflow/orchestrate.ts` — new, ~250 lines
- `src/lib/file-import.ts` — new, ~50 lines
- `src/lib/export-builder.ts` — add exportPromptsAsPreset, ~50 lines
- `src/App.tsx` — update wrappers, ~+20 lines net

## Verification

- `npx vite build` passes
- `npx vitest run` — all 27 tests pass
- Manual: drop a file, verify it processes. Group two files, verify merge. Edit a prompt, verify reprocess. Export session, reimport.
