import { create } from "zustand";
import type { PipelineState, Stage, Interceptor } from "context-analyzer";
import { analyze, deleteSession } from "context-analyzer";
import type { Group } from "context-analyzer";
import { generateId } from "@/lib/id-generator";
import { parseFileDropInput } from "@/lib/file-import";
import { getAnalyzerConfig } from "@/lib/ai-config";
import { markStepStart, markStepEnd } from "@/lib/pipeline-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended PipelineState with viewer-specific lifecycle fields */
export interface ViewerConversationState extends PipelineState {
  status?: "pending" | "processing" | "success" | "failed" | "paused-for-api-key";
  step?: string;
  error?: string;
  pausedAtStep?: string;
  sessionId?: string;
}

interface PipelineOptions {
  customComponents?: string[];
  presetColors?: Record<string, string>;
  customPrompt?: string;
  customSegmentationPrompt?: string;
}

interface ConversationStore {
  // ---- State ----
  conversations: ViewerConversationState[];
  groups: Record<string, Group>;

  // ---- Getters ----
  getConversation: (id: string) => ViewerConversationState | undefined;
  getGroup: (id: string) => Group | undefined;
  getGroupsForFile: (fileId: string) => Group[];
  getPausedCount: () => number;

  // ---- Mutations ----
  updateConversation: (id: string, update: Partial<ViewerConversationState>) => void;
  addConversations: (states: ViewerConversationState[]) => void;
  removeConversation: (id: string) => void;
  setConversations: (updater: (prev: ViewerConversationState[]) => ViewerConversationState[]) => void;
  appendSummaryChunk: (id: string, chunk: string) => void;
  appendAnalysisChunk: (id: string, chunk: string) => void;

  // CRUD
  renameConversation: (id: string, newTitle: string) => void;
  deleteConversation: (id: string) => void;

  // Group CRUD
  createGroup: (fileIds: string[], name?: string, id?: string, title?: string) => string;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, update: Partial<Group>) => void;

  // ---- Actions ----
  processFileDrop: (files: File[], loadedPreset: any) => Promise<void>;
  groupConversations: (ids: string[], name?: string, existingId?: string, title?: string) => string;
}

// ---------------------------------------------------------------------------
// Interceptor factory — pushes analyzer state into the Zustand store
// ---------------------------------------------------------------------------

function buildInterceptors(
  updateFn: (id: string, update: Partial<ViewerConversationState>) => void,
): Interceptor[] {
  const stages: Stage[] = [
    "parsing", "counting-tokens", "segmenting",
    "identifying-components", "classifying-components", "coloring",
  ];

  const interceptors: Interceptor[] = [];

  for (const stage of stages) {
    interceptors.push({
      stage,
      timing: "pre",
      fn: (ctx) => {
        markStepStart(ctx.id, stage);
        updateFn(ctx.id, { status: "processing", step: stage });
      },
    });
    interceptors.push({
      stage,
      timing: "post",
      fn: (ctx) => {
        markStepEnd(ctx.id, stage);
        // Push the full state into the store after each stage
        updateFn(ctx.id, {
          ...ctx,
          status: "processing",
        });
      },
    });
  }

  return interceptors;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useConversationStore = create<ConversationStore>((set, get) => {
  return {
    conversations: [],
    groups: {},

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
      // Clean up analyzer session if it exists
      const conv = get().getConversation(id);
      if (conv?.sessionId) {
        deleteSession(conv.sessionId);
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

    processFileDrop: async (files, loadedPreset) => {
      const { filesToProcess, oldIdToIndex, sessionGroups } = await parseFileDropInput(files);
      if (filesToProcess.length === 0) return;

      // Create placeholders
      const fileInputs: Array<{ content: string; filename: string; placeholderId: string }> = [];
      const placeholders: ViewerConversationState[] = [];

      for (const file of filesToProcess) {
        const id = generateId();
        placeholders.push({ id, filename: file.name, status: "pending", warnings: [], stepTimings: {} });
        const content = await file.text();
        fileInputs.push({ content, filename: file.name, placeholderId: id });
      }

      set((state) => ({ conversations: [...state.conversations, ...placeholders] }));

      const config = getAnalyzerConfig();
      const updateFn = (id: string, update: Partial<ViewerConversationState>) =>
        get().updateConversation(id, update);

      const interceptors = buildInterceptors(updateFn);

      // Build options
      const options: any = { interceptors };
      if (loadedPreset) {
        options.components = loadedPreset.components?.map((c: string) => ({ name: c, description: c }));
        options.presetColors = loadedPreset.colors;
        if (loadedPreset.componentIdentificationPrompt) {
          options.prompts = { "component-identification": loadedPreset.componentIdentificationPrompt };
        }
        if (loadedPreset.segmentationPrompt) {
          if (!options.prompts) options.prompts = {};
          options.prompts.segmentation = loadedPreset.segmentationPrompt;
        }
      }

      try {
        const result = await analyze(
          {
            ...options,
            files: fileInputs.map((f) => ({ content: f.content, filename: f.filename })),
          },
          config,
        );

        // Map analyzer states back to our placeholders and mark complete
        for (let i = 0; i < result.states.length; i++) {
          const state = result.states[i]!;
          const placeholder = placeholders[i]!;
          updateFn(placeholder.id, {
            ...state,
            id: placeholder.id, // keep our ID
            sessionId: result.sessionId,
            status: "success",
            step: undefined,
          });
        }

        // Handle session import groups
        if (sessionGroups.length > 0) {
          for (const group of sessionGroups) {
            const newIds: string[] = [];
            for (const oldId of group.fileIds) {
              const fileIndex = oldIdToIndex.get(oldId);
              if (fileIndex !== undefined && placeholders[fileIndex]) {
                newIds.push(placeholders[fileIndex]!.id);
              }
            }
            if (newIds.length >= 2) {
              get().createGroup(newIds, group.name, group.id, group.title);
            }
          }
        }
      } catch (error) {
        for (const p of placeholders) {
          updateFn(p.id, {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
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
  };
});
