# First-Class Groups

## Context

Groups today are a hack: they're constructed by concatenating messages from multiple conversations into a single flat `WorkflowState` with `isGrouped: true` and prefixed message IDs. The grouped "conversation" skips the entire processing pipeline (`handleGroupedConversation` just calls `markComplete`). This means groups can't have their own prompts, can't run the pipeline, have duplicate concatenation logic, and require special-case handling throughout the UI.

**Goal**: Groups become a lightweight metadata container (name + ordered file IDs + prompts). The pipeline runs on member files individually and in parallel when group prompts change.

---

## Data Model

New `Group` interface (separate from `WorkflowState`):

```typescript
interface Group {
  id: string;
  name: string;
  title?: string;
  fileIds: string[];  // ordered member file IDs
  // Group-level prompts (override member file prompts when set)
  customPrompt?: string;
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  customColoringPrompt?: string;
  segmentationThreshold?: number;
}
```

Groups do NOT contain `conversation`, `components`, `componentMapping`, or any pipeline output. Those stay on individual files' `WorkflowState` entries.

---

## Implementation Phases

### Phase 1: Add Group type and store slice

**`src/workflow/types.ts`**
- Add `Group` interface

**`src/stores/conversation-store.ts`**
- Add `groups: Record<string, Group>` to store state
- Add CRUD: `createGroup`, `removeGroup`, `updateGroup`, `getGroupsForFile`

### Phase 2: Group prompt fan-out

**`src/stores/conversation-store.ts`**
- Add `applyGroupPrompts(groupId, event, callbacks)`:
  1. Read group's prompts
  2. For each fileId, update the file's prompt fields
  3. Call `processConversationWorkflow` for each file in parallel via `Promise.all`

**`src/App.tsx`**
- Refactor `handleReprocessComponents`, `handleReprocessSegmentation` to detect group selection and call `applyGroupPrompts` instead of inline fan-out

### Phase 3: Update UI for new Group model

**`src/components/ConversationList.tsx`**
- Groups read from `store.groups` not `conversations.filter(c => c.isGrouped)`
- "Group selected" calls `store.createGroup()` instead of `store.handleGroupConversations()`
- Deletion guard uses `store.getGroupsForFile(id)`

**`src/components/ConversationView.tsx`**
- When group selected: iterate `group.fileIds`, render each file's messages with file-separator headers
- Components/chart/comparison tabs read from member files' WorkflowStates
- Remove `isGrouped` and `messageSourceMap` prop threading

**`src/App.tsx`**
- `selectedConversation` memo handles two cases: group lookup vs conversation lookup
- `sourceConversationComponents` reads from `group.fileIds`

**`src/components/GroupFileOrderEditor.tsx`**
- Receives `Group`, calls `store.updateGroup(id, { fileIds: newOrder })`

### Phase 4: Remove old group-as-WorkflowState machinery

**`src/stores/conversation-store.ts`**
- Delete `handleGroupConversations` (262-397) - the 135-line concatenation function
- Delete `handleUpdateGroupSources` (406-500) - duplicate concatenation
- Delete `handleUngroupConversation` (399-404)
- Simplify `handleApplyPromptsToAll` - remove `!c.isGrouped` filter
- Rewrite `processPendingGroups` to use `createGroup`

**`src/workflow/pipeline.ts`**
- Remove `handleGroupedConversation`, `GROUPED_COMPLETE`, `WorkflowEvent.GroupedConversation` from switch

**`src/workflow/types.ts`**
- Remove from `WorkflowState`: `isGrouped`, `sourceConversations`, `messageSourceMap`
- Remove `WorkflowEvent.GroupedConversation`

**`src/schema.ts`**
- Remove `SourceInfoSchema` / `SourceInfo` type

### Phase 5: Update export/import

**`src/lib/export-schema.ts`**
- Add group-level prompts to `GroupExportSchema`

**`src/lib/export-builder.ts`**
- Read groups from `store.groups` instead of filtering conversations for `isGrouped`

**`src/stores/conversation-store.ts`** (import path)
- Session import calls `createGroup` after member files load
- Keep v1 import compatibility: detect old grouped WorkflowStates and convert to new Group format

### Phase 6: Edge cases

- **File deletion in a group**: Show confirmation, option to remove from groups or cancel. No hard block.
- **Single-member groups**: Allow them (valid named container with prompts). Remove auto-dissolve.
- **Group with no prompts set**: Member files keep their own prompts. Group prompts override only when explicitly set.
- **Prompt override rule (v1)**: Group prompts replace file prompts when fan-out runs.

---

## Critical Files

| File | Changes |
|------|---------|
| `src/workflow/types.ts` | Add `Group` interface; remove `isGrouped`/`sourceConversations`/`messageSourceMap` from WorkflowState |
| `src/stores/conversation-store.ts` | Add groups slice + CRUD + fan-out; delete old concatenation logic |
| `src/App.tsx` | Group-aware selection, refactor fan-out handlers |
| `src/components/ConversationView.tsx` | Render from member files instead of concatenated conversation |
| `src/components/ConversationList.tsx` | Read groups from store, update group creation/deletion |
| `src/components/GroupFileOrderEditor.tsx` | Work with Group type |
| `src/lib/export-builder.ts` | Export groups from store.groups |
| `src/lib/export-schema.ts` | Add prompts to GroupExportSchema |
| `src/schema.ts` | Remove SourceInfo |
| `src/workflow/pipeline.ts` | Remove GroupedConversation event handler |

## Verification

1. Create a group from 2+ files - verify it appears in sidebar, clicking shows member files' messages
2. Edit group prompts (component, segmentation, coloring) - verify pipeline runs on each member file in parallel, each file updates independently
3. Delete a member file - verify confirmation dialog, group updates
4. Export/import session with groups - verify groups restore correctly
5. Import old v1 session with grouped WorkflowStates - verify backward compatibility
6. Reorder files in group - verify view updates
