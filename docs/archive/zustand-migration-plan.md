# Zustand Migration Plan

Migrate state management from scattered useState in ~3000-line App.tsx
to Zustand stores.

## Store Structure: 2 stores

**1. `src/stores/conversation-store.ts`** — the main store (replaces
`conversations` + `selectedIds` + all handlers)

**2. `src/stores/ui-store.ts`** — dialog/editing state (all the
`isXDialogOpen`, `editingX`, `activeDimensions`, `reprocessingId`,
presets, import state)

URL state stays in `useUrlState` — no change.

## Phase 1: Install Zustand, create conversation store skeleton

- `npm install zustand`
- Create `src/stores/conversation-store.ts` with:
  - **State**: `conversations: WorkflowState[]`, `selectedIds: Set<string>`
  - **Derived getters**: `getConversation(id)`,
    `getSelectedConversation(selectedId)`, `getPausedCount()`,
    `getSourceConversationComponents(selectedId)`,
    `getSourceWorkflowStates(selectedId)`
  - **Atomic mutations**: `updateConversation(id, partial)`,
    `addConversations(states[])`, `removeConversation(id)`
  - **Streaming**: `appendSummaryChunk(id, chunk)`,
    `appendAnalysisChunk(id, chunk)`
  - **Selection**: `toggleSelect(id)`, `clearSelection()`, `selectAll()`
  - **CRUD**: `renameConversation(id, title)`,
    `deleteConversation(id)`

This gives WorkflowRunner a single
`store.getState().updateConversation(id, partial)` call instead of a
`setConversations` callback.

## Phase 2: Move workflow handlers into store actions

- **`applyPromptsToAll(sourceId)`** — reads source conversation's
  prompts, applies to all others, triggers reprocessing
- **`groupConversations(ids)`** — the 200-line concatenation logic,
  extracted as a store action
- **`updateGroupSources(groupId, newIds)`** — rebuild group with new
  order
- **Reprocess factory** — `reprocessConversation(id, event,
  contextModifier)` replaces `createReprocessHandler`

## Phase 3: Adapt WorkflowRunner

- Instead of `new WorkflowRunner((id, update) =>
  setConversations(...))`, the runner takes the store directly or uses
  `store.getState().updateConversation`
- `processConversationWorkflow` stays as a pure-ish function (activities
  + runner) — it doesn't move into the store, but gets called from store
  actions

## Phase 4: Create UI store, extract dialog state

- Move all 15+ dialog/editing useState calls into
  `src/stores/ui-store.ts`
- Group into slices: `promptEditor`, `presets`, `importState`,
  `dimensions`
- App.tsx shrinks from ~3000 lines to mostly JSX + layout

## Phase 5: Wire up App.tsx

- Replace all `useState` + `setConversations` with
  `useConversationStore()`
- Replace dialog state with `useUIStore()`
- Remove all `useMemo` that compute derived conversation data (now
  they're store selectors)
- Remove `useCallback` for `setSelectedId` (now a store action)
- Keep `useEffect`s for URL import and preset loading, but they call
  store actions

## File layout after migration

```
src/
├── stores/
│   ├── conversation-store.ts   (~600 lines: state + mutations + workflow dispatch)
│   └── ui-store.ts             (~150 lines: dialogs, editing, presets, dimensions)
├── workflow/
│   ├── runner.ts               (WorkflowRunner class, extracted from App.tsx)
│   ├── activities.ts           (parse, countTokens, segment, etc — already pure)
│   ├── pipeline.ts             (processConversationWorkflow)
│   └── dimensions.ts           (sync/ensure/getDimensionNames helpers)
├── App.tsx                     (~800-1000 lines: layout + JSX + effects)
└── ... (everything else unchanged)
```

## What stays unchanged

- `useUrlState` hook
- All parsers
- `schema.ts`, `aggregation.ts`, `componentisation.ts`,
  `segmentation.ts`
- All components in `src/components/`
- `src/lib/` utilities

## Migration order rationale

Phase 1-2 first because the conversation store is the high-leverage fix
— it centralizes the 40+ `setConversations` callsites. Phase 3 adapts
the runner. Phase 4 is cosmetic cleanup. Phase 5 is the final wiring.

Each phase produces a working app — we can stop after any phase and
ship.
