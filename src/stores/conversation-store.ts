import { create } from "zustand";
import type { WorkflowState, WorkflowCallbacks, WorkflowOptions } from "../workflow/types";
import { PipelineStep } from "../workflow/types";
import type { Group } from "../workflow/types";
import { hasApiKey } from "../ai-config";
import { generateId } from "../lib/id-generator";
import { buildSessionExport, downloadExport, exportPromptsAsPreset } from "../lib/export-builder";
import { parseFileDropInput } from "../lib/file-import";
import {
  runWorkflowMutation,
  reprocessWithRunner,
  reprocessTarget,
  applyPromptsToAll,
  resumeWorkflowsWithApiKey,
  type StoreAccessor,
} from "../workflow/orchestrate";

interface ConversationStore {
  // ---- State ----
  conversations: WorkflowState[];
  groups: Record<string, Group>;
  selectedIds: Set<string>;
  fileIdsRef: Map<number, string>;
  pendingSessionImport: {
    oldIdToIndex: Map<string, number>;
    groups: Array<{ id: string; name: string; title?: string; fileIds: string[] }>;
  } | null;
  hasApiKeyState: boolean;

  // ---- Getters ----
  getConversation: (id: string) => WorkflowState | undefined;
  getGroup: (id: string) => Group | undefined;
  getGroupsForFile: (fileId: string) => Group[];
  getPausedCount: () => number;

  // ---- Mutations ----
  updateConversation: (id: string, update: Partial<WorkflowState>) => void;
  addConversations: (states: WorkflowState[]) => void;
  removeConversation: (id: string) => void;
  setConversations: (updater: (prev: WorkflowState[]) => WorkflowState[]) => void;
  appendSummaryChunk: (id: string, chunk: string) => void;
  appendAnalysisChunk: (id: string, chunk: string) => void;

  // Selection
  toggleSelect: (id: string, isSelected: boolean) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;

  // CRUD
  renameConversation: (id: string, newTitle: string) => void;
  deleteConversation: (id: string) => void;

  // Group CRUD
  createGroup: (fileIds: string[], name?: string, id?: string, title?: string) => string;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, update: Partial<Group>) => void;

  // ---- Actions (no navigation — callers handle selection) ----
  runWorkflows: (files: File[], presetIds?: Map<number, string>, options?: WorkflowOptions) => Promise<void>;
  groupConversations: (ids: string[], name?: string, existingId?: string, title?: string) => string;
  handleReprocessWithRunner: (
    conv: WorkflowState,
    startFrom: PipelineStep,
    contextModifier: (ctx: WorkflowState) => void,
    callbacks: WorkflowCallbacks,
    dimNames?: string[],
  ) => Promise<void>;
  handleReprocessTarget: (
    targetId: string,
    startFrom: PipelineStep,
    contextModifier: (ctx: WorkflowState) => void,
    callbacks: WorkflowCallbacks,
    dimNames?: string[],
  ) => Promise<void>;
  handleApplyPromptsToAll: (sourceId: string) => Promise<void>;
  handleExportPromptsAsPreset: (sourceId: string) => void;
  handleExportSession: () => void;
  handleResumeWorkflowsWithApiKey: () => void;
  setHasApiKeyState: (value: boolean) => void;
  processPendingGroups: () => void;
  processFileDrop: (files: File[], loadedPreset: any) => Promise<void>;
}

export const useConversationStore = create<ConversationStore>((set, get) => {
  const accessor: StoreAccessor = {
    getState: () => get(),
    updateConversation: (id, update) => get().updateConversation(id, update),
    appendSummaryChunk: (id, chunk) => get().appendSummaryChunk(id, chunk),
    appendAnalysisChunk: (id, chunk) => get().appendAnalysisChunk(id, chunk),
    set,
  };

  return {
    conversations: [],
    groups: {},
    selectedIds: new Set(),
    fileIdsRef: new Map(),
    pendingSessionImport: null,
    hasApiKeyState: hasApiKey(),

    // ---- Getters ----
    getConversation: (id) => get().conversations.find((c) => c.id === id),
    getGroup: (id) => get().groups[id],
    getGroupsForFile: (fileId) =>
      Object.values(get().groups).filter((g) => g.fileIds.includes(fileId)),
    getPausedCount: () =>
      get().conversations.filter((c) => c.status === "paused-for-api-key").length,

    // ---- Mutations ----
    updateConversation: (id, update) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, ...update } : c,
        ),
      })),

    addConversations: (states) =>
      set((state) => ({ conversations: [...state.conversations, ...states] })),

    removeConversation: (id) =>
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        fileIdsRef: new Map([...state.fileIdsRef].filter(([, v]) => v !== id)),
      })),

    setConversations: (updater) =>
      set((state) => ({ conversations: updater(state.conversations) })),

    appendSummaryChunk: (id, chunk) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, aiSummary: (c.aiSummary || "") + chunk } : c,
        ),
      })),

    appendAnalysisChunk: (id, chunk) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, analysis: (c.analysis || "") + chunk } : c,
        ),
      })),

    toggleSelect: (id, isSelected) =>
      set((state) => {
        const next = new Set(state.selectedIds);
        if (isSelected) next.add(id);
        else next.delete(id);
        return { selectedIds: next };
      }),

    clearSelection: () => set({ selectedIds: new Set() }),
    selectAll: (ids) => set({ selectedIds: new Set(ids) }),

    renameConversation: (id, newTitle) => {
      const title = newTitle || undefined;
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === id ? { ...conv, title } : conv,
        ),
      }));
      const group = get().groups[id];
      if (group) {
        set((state) => ({
          groups: { ...state.groups, [id]: { ...group, title } },
        }));
      }
    },

    deleteConversation: (id) => {
      const groupsForFile = get().getGroupsForFile(id);
      if (groupsForFile.length > 0) {
        console.warn("Cannot delete conversation that is part of a group");
        return;
      }
      get().removeConversation(id);
    },

    // ---- Group CRUD ----
    createGroup: (fileIds, name, id, title) => {
      const groupId = id || generateId();
      const groupName = name || `Grouped: ${fileIds.length} files`;
      const group: Group = { id: groupId, name: groupName, title, fileIds };
      set((state) => ({ groups: { ...state.groups, [groupId]: group } }));
      return groupId;
    },

    removeGroup: (id) => {
      set((state) => {
        const { [id]: _, ...rest } = state.groups;
        return { groups: rest };
      });
    },

    updateGroup: (id, update) => {
      set((state) => {
        const existing = state.groups[id];
        if (!existing) return state;
        return { groups: { ...state.groups, [id]: { ...existing, ...update } } };
      });
    },

    // ---- Actions ----

    runWorkflows: async (files, presetIds, options) => {
      await runWorkflowMutation(accessor, files, presetIds, options);
    },

    groupConversations: (ids, name, existingId, title) => {
      const store = get();
      const validIds = ids.filter((id) => {
        const conv = store.conversations.find((c) => c.id === id);
        return conv?.conversation && conv.status === "success";
      });
      if (validIds.length < 2) return "";

      const groupName = name || `Grouped: ${validIds.map((id) => {
        const c = store.conversations.find((conv) => conv.id === id);
        return c?.filename || id;
      }).join(", ")}`;

      return get().createGroup(validIds, groupName, existingId, title);
    },

    handleReprocessWithRunner: async (conv, startFrom, contextModifier, callbacks, dimNames?) => {
      await reprocessWithRunner(accessor, conv, startFrom, contextModifier, callbacks, dimNames);
    },

    handleReprocessTarget: async (targetId, startFrom, contextModifier, callbacks, dimNames?) => {
      await reprocessTarget(accessor, targetId, startFrom, contextModifier, callbacks, dimNames);
    },

    handleApplyPromptsToAll: (sourceId) => applyPromptsToAll(accessor, sourceId),

    handleExportPromptsAsPreset: (sourceId) => {
      const source = get().conversations.find((c) => c.id === sourceId);
      if (source) exportPromptsAsPreset(source);
    },

    handleExportSession: () => {
      const { conversations, groups } = get();
      downloadExport(buildSessionExport(conversations, groups));
    },

    handleResumeWorkflowsWithApiKey: () => resumeWorkflowsWithApiKey(accessor),

    setHasApiKeyState: (value) => set({ hasApiKeyState: value }),

    processPendingGroups: () => {
      const { pendingSessionImport, conversations, fileIdsRef } = get();
      if (!pendingSessionImport || pendingSessionImport.groups.length === 0) return;

      const { oldIdToIndex, groups } = pendingSessionImport;

      const allFilesReady = Array.from(oldIdToIndex.values()).every((index) => {
        const id = fileIdsRef.get(index);
        if (!id) return false;
        const conv = conversations.find((c) => c.id === id);
        return conv?.status === "success" && conv.conversation;
      });

      if (!allFilesReady) return;

      for (const group of groups) {
        const newIds: string[] = [];
        for (const oldId of group.fileIds) {
          const fileIndex = oldIdToIndex.get(oldId);
          if (fileIndex !== undefined) {
            const newId = fileIdsRef.get(fileIndex);
            if (newId) newIds.push(newId);
          }
        }
        if (newIds.length >= 2) {
          get().createGroup(newIds, group.name, group.id, group.title);
        }
      }

      set({ pendingSessionImport: null, fileIdsRef: new Map() });
    },

    processFileDrop: async (files, loadedPreset) => {
      const { filesToProcess, oldIdToIndex, sessionGroups } = await parseFileDropInput(files);

      if (sessionGroups.length > 0) {
        set({ pendingSessionImport: { oldIdToIndex, groups: sessionGroups } });
      } else {
        set({ pendingSessionImport: null });
      }

      if (filesToProcess.length > 0) {
        const presetIds = new Map<number, string>();
        for (const [oldId, index] of oldIdToIndex) {
          presetIds.set(index, oldId);
        }

        const options: WorkflowOptions | undefined = loadedPreset
          ? {
              customComponents: loadedPreset.components,
              presetColors: loadedPreset.colors,
              customPrompt: loadedPreset.componentIdentificationPrompt,
              customSegmentationPrompt: loadedPreset.segmentationPrompt,
            }
          : undefined;

        await get().runWorkflows(
          filesToProcess,
          presetIds.size > 0 ? presetIds : undefined,
          options,
        );
      }
    },
  };
});

// Re-export buildBaseContext for App.tsx
export { buildBaseContext } from "../workflow/context";
