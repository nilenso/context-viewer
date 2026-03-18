import { create } from "zustand";
import type { WorkflowState, WorkflowCallbacks, WorkflowDataField, WorkflowOptions } from "../workflow/types";
import { WorkflowEvent } from "../workflow/types";
import type { Notify } from "../workflow/runner";
import { processConversationWorkflow, runWorkflows } from "../workflow/pipeline";
import { getComponentisationConfig, buildComponentTimeline } from "../workflow/component-identification";
import { summarizeConversation } from "../workflow/parse";
import { ensureDimensions } from "../workflow/dimensions";
import type { Conversation, Message, SourceInfo } from "../schema";
import type { ConversationComponentData } from "../components/ComponentComparisonView";
import { aggregateComponentTokens } from "../aggregation";
import { staticComponentise } from "../static-componentisation";
import { hasApiKey, setRuntimeApiKey } from "../ai-config";
import { generateId } from "../lib/id-generator";
import { buildSessionExport, downloadExport } from "../lib/export-builder";
import { SessionExportSchema, FileExportSchema } from "../lib/export-schema";
import {
  getDefaultComponentIdentificationPrompt,
  getDefaultColoringPrompt,
} from "../prompts";

interface ConversationStore {
  // ---- State ----
  conversations: WorkflowState[];
  selectedIds: Set<string>;
  fileIdsRef: Map<number, string>;
  pendingSessionImport: {
    oldIdToIndex: Map<string, number>;
    groups: Array<{ id: string; name: string; title?: string; fileIds: string[] }>;
  } | null;
  hasApiKeyState: boolean;

  // ---- Getters (use these in components via selectors) ----
  getConversation: (id: string) => WorkflowState | undefined;
  getPausedCount: () => number;

  // ---- Mutations ----
  updateConversation: (id: string, update: Partial<WorkflowState>) => void;
  addConversations: (states: WorkflowState[]) => void;
  removeConversation: (id: string) => void;
  setConversations: (updater: (prev: WorkflowState[]) => WorkflowState[]) => void;

  // Streaming
  appendSummaryChunk: (id: string, chunk: string) => void;
  appendAnalysisChunk: (id: string, chunk: string) => void;

  // Selection
  toggleSelect: (id: string, isSelected: boolean) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;

  // CRUD
  renameConversation: (id: string, newTitle: string) => void;
  deleteConversation: (id: string, selectedId: string | null, setSelectedId: (id: string | null) => void) => void;

  // ---- Complex Actions ----
  runWorkflowMutation: (
    files: File[],
    presetIds: Map<number, string> | undefined,
    selectedId: string | null,
    setSelectedId: (id: string | null) => void,
    options?: WorkflowOptions,
  ) => Promise<void>;

  handleGroupConversations: (
    idsToGroup: string[] | undefined,
    setSelectedId: (id: string | null) => void,
    groupName?: string,
    existingGroupId?: string,
    groupTitle?: string,
  ) => Promise<void>;

  handleUngroupConversation: (
    id: string,
    selectedId: string | null,
    setSelectedId: (id: string | null) => void,
  ) => void;

  handleUpdateGroupSources: (
    groupId: string,
    newSources: Array<{ id: string; filename: string; title?: string }>,
    selectedId: string | null,
    setSelectedId: (id: string | null) => void,
  ) => void;

  handleReprocessWithRunner: (
    conv: WorkflowState,
    event: WorkflowEvent,
    contextModifier: (ctx: WorkflowState) => void,
    callbacks: WorkflowCallbacks,
  ) => Promise<void>;

  handleApplyPromptsToAll: (sourceId: string) => Promise<void>;

  handleExportPromptsAsPreset: (sourceId: string) => void;

  handleExportSession: () => void;

  handleResumeWorkflowsWithApiKey: () => void;

  setHasApiKeyState: (value: boolean) => void;

  processPendingGroups: (setSelectedId: (id: string | null) => void) => void;

  handleFileDrop: (
    files: File[],
    setSelectedId: (id: string | null) => void,
    selectedId: string | null,
    loadedPreset: any,
  ) => Promise<void>;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  selectedIds: new Set(),
  fileIdsRef: new Map(),
  pendingSessionImport: null,
  hasApiKeyState: hasApiKey(),

  getConversation: (id) => get().conversations.find((c) => c.id === id),

  getPausedCount: () =>
    get().conversations.filter((c) => c.status === "paused-for-api-key").length,

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
      conversations: state.conversations.map((conv) => {
        if (conv.id === id) return { ...conv, title };
        if (conv.isGrouped && conv.sourceConversations?.some((s) => s.id === id)) {
          const updatedSourceConversations = conv.sourceConversations.map((s) =>
            s.id === id ? { ...s, title } : s,
          );
          const updatedMessageSourceMap = conv.messageSourceMap
            ? Object.fromEntries(
                Object.entries(conv.messageSourceMap).map(([key, info]) =>
                  info.conversationId === id ? [key, { ...info, title }] : [key, info],
                ),
              )
            : undefined;
          return {
            ...conv,
            sourceConversations: updatedSourceConversations,
            messageSourceMap: updatedMessageSourceMap,
          };
        }
        return conv;
      }),
    }));
  },

  deleteConversation: (id, selectedId, setSelectedId) => {
    const { conversations } = get();
    const isPartOfGroup = conversations.some(
      (conv) => conv.isGrouped && conv.sourceConversations?.some((s) => s.id === id),
    );
    if (isPartOfGroup) {
      console.warn("Cannot delete conversation that is part of a grouped conversation");
      return;
    }

    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      fileIdsRef: new Map([...state.fileIdsRef].filter(([, v]) => v !== id)),
    }));

    if (selectedId === id) setSelectedId(null);
  },

  runWorkflowMutation: async (files, presetIds, selectedId, setSelectedId, options) => {
    const store = get();

    // Create placeholders
    const fileIds = new Map<number, string>();
    const placeholders: WorkflowState[] = files.map((file, index) => {
      const id = presetIds?.get(index) || generateId();
      fileIds.set(index, id);
      return { id, filename: file.name, status: "pending" };
    });

    set((state) => ({
      conversations: [...state.conversations, ...placeholders],
      fileIdsRef: fileIds,
    }));

    if (!selectedId && placeholders[0]) {
      setSelectedId(placeholders[0].id);
    }

    const onFileComplete = (completed: WorkflowState) => {
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === completed.id
            ? {
                ...conv,
                ...completed,
                aiSummary: completed.aiSummary || conv.aiSummary,
                analysis: completed.analysis || conv.analysis,
              }
            : conv,
        ),
      }));
    };

    const onSummaryChunk = (id: string, chunk: string) => get().appendSummaryChunk(id, chunk);
    const onAnalysisChunk = (id: string, chunk: string) => get().appendAnalysisChunk(id, chunk);

    try {
      await runWorkflows(files, fileIds, onFileComplete, onSummaryChunk, onAnalysisChunk, options);
      if (!get().pendingSessionImport) {
        set({ fileIdsRef: new Map() });
      }
    } catch {
      set({ fileIdsRef: new Map() });
    }
  },

  handleGroupConversations: async (idsToGroup, setSelectedId, groupName, existingGroupId, groupTitle) => {
    const store = get();
    const idsSet = idsToGroup ? new Set(idsToGroup) : store.selectedIds;
    if (idsSet.size < 2) return;

    const { conversations } = store;

    const selectedConvs = idsToGroup
      ? idsToGroup
          .map((id) => conversations.find((c) => c.id === id))
          .filter(
            (conv): conv is WorkflowState =>
              conv !== undefined && conv.conversation !== undefined && conv.status === "success",
          )
      : conversations.filter(
          (conv) => idsSet.has(conv.id) && conv.conversation && conv.status === "success",
        );

    if (selectedConvs.length < 2) return;

    const groupId = existingGroupId || generateId();
    const messageSourceMap: Record<string, SourceInfo> = {};
    const allMessages: Message[] = [];

    for (const conv of selectedConvs) {
      if (!conv.conversation) continue;
      for (const msg of conv.conversation.messages) {
        const newMsgId = `${conv.id}-${msg.id}`;
        const newParts = msg.parts.map((part) => {
          const newPartId = `${conv.id}-${part.id}`;
          messageSourceMap[newPartId] = {
            conversationId: conv.id,
            filename: conv.filename,
            title: conv.title,
          };
          return { ...part, id: newPartId };
        });
        messageSourceMap[newMsgId] = {
          conversationId: conv.id,
          filename: conv.filename,
          title: conv.title,
        };
        allMessages.push({ ...msg, id: newMsgId, parts: newParts } as Message);
      }
    }

    const groupedConversation: Conversation = { messages: allMessages };

    const mergedComponentsSet = new Set<string>();
    const mergedComponentMapping: Record<string, string> = {};
    const mergedComponentColors: Record<string, string> = {};
    const mergedStaticComponentsSet = new Set<string>();
    const mergedStaticMapping: Record<string, string> = {};

    for (const conv of selectedConvs) {
      if (conv.components) conv.components.forEach((c) => mergedComponentsSet.add(c));
      if (conv.componentMapping) {
        for (const [partId, component] of Object.entries(conv.componentMapping)) {
          mergedComponentMapping[`${conv.id}-${partId}`] = component;
        }
      }
      if (conv.componentColors) Object.assign(mergedComponentColors, conv.componentColors);
      if (conv.staticComponents) conv.staticComponents.forEach((c) => mergedStaticComponentsSet.add(c));
      if (conv.staticMapping) {
        for (const [partId, component] of Object.entries(conv.staticMapping)) {
          mergedStaticMapping[`${conv.id}-${partId}`] = component;
        }
      }
    }

    const mergedComponents = Array.from(mergedComponentsSet);
    const mergedStaticComponents = Array.from(mergedStaticComponentsSet);
    const mergedComponentTimeline = buildComponentTimeline(groupedConversation, mergedComponentMapping);
    const mergedStaticTimeline = buildComponentTimeline(groupedConversation, mergedStaticMapping);

    const sourceConversations = selectedConvs.map((conv) => ({
      id: conv.id,
      filename: conv.filename,
      title: conv.title,
    }));

    const groupedFilename =
      groupName || `Grouped: ${sourceConversations.map((s) => s.filename).join(", ")}`;

    const placeholder: WorkflowState = {
      id: groupId,
      filename: groupedFilename,
      title: groupTitle,
      status: "pending",
      isGrouped: true,
      sourceConversations,
      messageSourceMap,
      components: mergedComponents,
      componentMapping: mergedComponentMapping,
      componentTimeline: mergedComponentTimeline,
      componentColors: mergedComponentColors,
      staticComponents: mergedStaticComponents,
      staticMapping: mergedStaticMapping,
      staticTimeline: mergedStaticTimeline,
    };

    set((state) => ({
      conversations: [...state.conversations, placeholder],
      ...(idsToGroup ? {} : { selectedIds: new Set<string>() }),
    }));

    if (!idsToGroup) setSelectedId(groupId);

    const notify: Notify = (id, update) => get().updateConversation(id, update);

    const ctx: WorkflowState = {
      id: groupId,
      filename: groupedFilename,
      title: groupTitle,
      conversation: groupedConversation,
      summary: summarizeConversation(groupedConversation),
      isGrouped: true,
      sourceConversations,
      messageSourceMap,
      warnings: [],
      stepTimings: {},
      config: getComponentisationConfig(),
      components: mergedComponents,
      componentMapping: mergedComponentMapping,
      componentTimeline: mergedComponentTimeline,
      componentColors: mergedComponentColors,
      staticComponents: mergedStaticComponents,
      staticMapping: mergedStaticMapping,
      staticTimeline: mergedStaticTimeline,
    };

    await processConversationWorkflow(WorkflowEvent.GroupedConversation, ctx, notify, {
      onSummaryChunk: (id, chunk) => get().appendSummaryChunk(id, chunk),
      onAnalysisChunk: (id, chunk) => get().appendAnalysisChunk(id, chunk),
    });
  },

  handleUngroupConversation: (id, selectedId, setSelectedId) => {
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  },

  handleUpdateGroupSources: (groupId, newSources, selectedId, setSelectedId) => {
    const { conversations } = get();
    const group = conversations.find((c) => c.id === groupId);
    if (!group?.isGrouped || !group.sourceConversations) return;

    if (newSources.length <= 1) {
      get().handleUngroupConversation(groupId, selectedId, setSelectedId);
      return;
    }

    const selectedConvs = newSources
      .map((source) => conversations.find((c) => c.id === source.id))
      .filter(
        (conv): conv is WorkflowState =>
          conv !== undefined && conv.conversation !== undefined && conv.status === "success",
      );

    if (selectedConvs.length < 2) {
      get().handleUngroupConversation(groupId, selectedId, setSelectedId);
      return;
    }

    const messageSourceMap: Record<string, SourceInfo> = {};
    const allMessages: Message[] = [];

    for (const conv of selectedConvs) {
      if (!conv.conversation) continue;
      for (const msg of conv.conversation.messages) {
        const newMsgId = `${conv.id}-${msg.id}`;
        const newParts = msg.parts.map((part) => {
          const newPartId = `${conv.id}-${part.id}`;
          messageSourceMap[newPartId] = {
            conversationId: conv.id,
            filename: conv.filename,
            title: conv.title,
          };
          return { ...part, id: newPartId };
        });
        messageSourceMap[newMsgId] = {
          conversationId: conv.id,
          filename: conv.filename,
          title: conv.title,
        };
        allMessages.push({ ...msg, id: newMsgId, parts: newParts } as Message);
      }
    }

    const groupedConversation: Conversation = { messages: allMessages };

    const mergedComponentsSet = new Set<string>();
    const mergedComponentMapping: Record<string, string> = {};
    const mergedComponentColors: Record<string, string> = {};
    const mergedStaticComponentsSet = new Set<string>();
    const mergedStaticMapping: Record<string, string> = {};

    for (const conv of selectedConvs) {
      if (conv.components) conv.components.forEach((c) => mergedComponentsSet.add(c));
      if (conv.componentMapping) {
        for (const [partId, component] of Object.entries(conv.componentMapping)) {
          mergedComponentMapping[`${conv.id}-${partId}`] = component;
        }
      }
      if (conv.componentColors) Object.assign(mergedComponentColors, conv.componentColors);
      if (conv.staticComponents) conv.staticComponents.forEach((c) => mergedStaticComponentsSet.add(c));
      if (conv.staticMapping) {
        for (const [partId, component] of Object.entries(conv.staticMapping)) {
          mergedStaticMapping[`${conv.id}-${partId}`] = component;
        }
      }
    }

    const mergedComponentTimeline = buildComponentTimeline(groupedConversation, mergedComponentMapping);
    const mergedStaticTimeline = buildComponentTimeline(groupedConversation, mergedStaticMapping);

    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === groupId
          ? {
              ...conv,
              sourceConversations: newSources,
              conversation: groupedConversation,
              summary: summarizeConversation(groupedConversation),
              messageSourceMap,
              components: Array.from(mergedComponentsSet),
              componentMapping: mergedComponentMapping,
              componentTimeline: mergedComponentTimeline,
              componentColors: mergedComponentColors,
              staticComponents: Array.from(mergedStaticComponentsSet),
              staticMapping: mergedStaticMapping,
              staticTimeline: mergedStaticTimeline,
            }
          : conv,
      ),
    }));
  },

  handleReprocessWithRunner: async (conv, event, contextModifier, callbacks) => {
    const notify: Notify = (id, update) => get().updateConversation(id, update);

    const ctx = buildBaseContext(conv);
    contextModifier(ctx);

    await processConversationWorkflow(event, ctx, notify, callbacks);
  },

  handleApplyPromptsToAll: async (sourceId) => {
    const { conversations } = get();
    const source = conversations.find((c) => c.id === sourceId);
    if (!source) return;

    const promptFields = {
      customPrompt: source.customPrompt,
      customSegmentationPrompt: source.customSegmentationPrompt,
      customSummaryPrompt: source.customSummaryPrompt,
      customAnalysisPrompt: source.customAnalysisPrompt,
      customColoringPrompt: source.customColoringPrompt,
      segmentationThreshold: source.segmentationThreshold,
    };

    const targets = conversations.filter(
      (c) => c.id !== sourceId && c.status === "success" && !c.isGrouped && c.conversation,
    );

    if (targets.length === 0) return;

    await Promise.all(
      targets.map(async (conv) => {
        let event: WorkflowEvent | null = null;
        if (
          promptFields.customSegmentationPrompt !== conv.customSegmentationPrompt ||
          promptFields.segmentationThreshold !== conv.segmentationThreshold
        ) {
          event = WorkflowEvent.SegmentationPromptChanged;
        } else if (promptFields.customPrompt !== conv.customPrompt) {
          event = WorkflowEvent.ComponentPromptChanged;
        } else if (promptFields.customColoringPrompt !== conv.customColoringPrompt) {
          event = WorkflowEvent.ColoringPromptChanged;
        }

        get().updateConversation(conv.id, promptFields);

        if (!event) return;

        const notify: Notify = (id, update) => get().updateConversation(id, update);

        const ctx = buildBaseContext(conv);
        ctx.customPrompt = promptFields.customPrompt;
        ctx.customSegmentationPrompt = promptFields.customSegmentationPrompt;
        ctx.customSummaryPrompt = promptFields.customSummaryPrompt;
        ctx.customAnalysisPrompt = promptFields.customAnalysisPrompt;
        ctx.customColoringPrompt = promptFields.customColoringPrompt;
        ctx.segmentationThreshold = promptFields.segmentationThreshold;

        await processConversationWorkflow(event, ctx, notify, {
          onAnalysisChunk: (id, chunk) => get().appendAnalysisChunk(id, chunk),
        });
      }),
    );
  },

  handleExportPromptsAsPreset: (sourceId) => {
    const { conversations } = get();
    const source = conversations.find((c) => c.id === sourceId);
    if (!source) return;

    const defaultName = source.title || source.filename.replace(/\.[^.]+$/, "");
    const name = window.prompt("Preset name:", defaultName);
    if (!name) return;

    const preset: Record<string, unknown> = {
      id: `custom-${Date.now()}`,
      name,
      description: `Exported prompts from "${name}"`,
      components: source.components || [],
      colors: source.componentColors || {},
    };

    if (source.customSegmentationPrompt) preset.segmentationPrompt = source.customSegmentationPrompt;
    if (source.segmentationThreshold != null) preset.segmentationThreshold = source.segmentationThreshold;
    if (source.customPrompt) preset.componentIdentificationPrompt = source.customPrompt;
    if (source.customColoringPrompt) preset.coloringPrompt = source.customColoringPrompt;
    if (source.customSummaryPrompt) preset.summaryPrompt = source.customSummaryPrompt;
    if (source.customAnalysisPrompt) preset.analysisPrompt = source.customAnalysisPrompt;

    if (source.dimensions && Object.keys(source.dimensions).length > 1) {
      const dimPrompts: Record<string, { prompt?: string; coloringPrompt?: string; components: string[] }> = {};
      for (const [dimName, dim] of Object.entries(source.dimensions)) {
        dimPrompts[dimName] = {
          prompt: dim.prompt,
          coloringPrompt: dim.customColoringPrompt,
          components: dim.components,
        };
      }
      preset.dimensions = dimPrompts;
    }

    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-preset.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  handleExportSession: () => {
    const exportData = buildSessionExport(get().conversations);
    downloadExport(exportData);
  },

  handleResumeWorkflowsWithApiKey: () => {
    const { conversations } = get();
    const pausedWorkflows = conversations.filter((c) => c.status === "paused-for-api-key");

    for (const conv of pausedWorkflows) {
      if (!conv.conversation) continue;

      const notify: Notify = (id, update) => get().updateConversation(id, update);

      const ctx: WorkflowState = {
        id: conv.id,
        filename: conv.filename,
        conversation: conv.conversation,
        summary: conv.summary,
        metadata: conv.metadata,
        dimensions: conv.dimensions ? { ...conv.dimensions } : undefined,
        staticComponents: conv.staticComponents,
        staticMapping: conv.staticMapping,
        staticTimeline: conv.staticTimeline,
        config: conv.config || getComponentisationConfig(),
        warnings: conv.warnings || [],
        stepTimings: { ...conv.stepTimings },
      };

      processConversationWorkflow(WorkflowEvent.ResumeFromApiKeyPause, ctx, notify, {
        onSummaryChunk: (id, chunk) => get().appendSummaryChunk(id, chunk),
        onAnalysisChunk: (id, chunk) => get().appendAnalysisChunk(id, chunk),
      });
    }
  },

  setHasApiKeyState: (value) => set({ hasApiKeyState: value }),

  processPendingGroups: (setSelectedId) => {
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

    const createGroups = async () => {
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
          await get().handleGroupConversations(newIds, setSelectedId, group.name, group.id, group.title);
        }
      }

      set({ pendingSessionImport: null, fileIdsRef: new Map() });
    };

    createGroups();
  },

  handleFileDrop: async (files, setSelectedId, selectedId, loadedPreset) => {
    const filesToProcess: File[] = [];
    const oldIdToIndex = new Map<string, number>();
    let sessionGroups: Array<{ id: string; name: string; title?: string; fileIds: string[] }> = [];

    for (const file of files) {
      if (file.name.endsWith(".json")) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);

          const sessionResult = SessionExportSchema.safeParse(data);
          if (sessionResult.success) {
            const startIndex = filesToProcess.length;
            for (let i = 0; i < sessionResult.data.files.length; i++) {
              const fileExport = sessionResult.data.files[i]!;
              oldIdToIndex.set(fileExport.id, startIndex + i);
              const blob = new Blob([JSON.stringify(fileExport)], { type: "application/json" });
              const virtualFile = new File([blob], fileExport.filename + ".json", { type: "application/json" });
              filesToProcess.push(virtualFile);
            }
            sessionGroups = sessionResult.data.groups;
            continue;
          }

          const fileResult = FileExportSchema.safeParse(data);
          if (fileResult.success) {
            filesToProcess.push(file);
            continue;
          }
        } catch {
          // JSON parse error, process normally
        }
      }
      filesToProcess.push(file);
    }

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

      await get().runWorkflowMutation(
        filesToProcess,
        presetIds.size > 0 ? presetIds : undefined,
        selectedId,
        setSelectedId,
        options,
      );
    }
  },
}));

// Helper: Build base context from a conversation
function buildBaseContext(conv: WorkflowState): WorkflowState {
  return {
    id: conv.id,
    filename: conv.filename,
    conversation: conv.conversation,
    summary: conv.summary,
    metadata: conv.metadata,
    aiSummary: conv.aiSummary,
    analysis: conv.analysis,
    components: conv.components,
    componentMapping: conv.componentMapping,
    componentTimeline: conv.componentTimeline,
    componentColors: conv.componentColors,
    dimensions: conv.dimensions ? { ...conv.dimensions } : undefined,
    staticComponents: conv.staticComponents,
    staticMapping: conv.staticMapping,
    staticTimeline: conv.staticTimeline,
    customSummaryPrompt: conv.customSummaryPrompt,
    customSegmentationPrompt: conv.customSegmentationPrompt,
    customAnalysisPrompt: conv.customAnalysisPrompt,
    customColoringPrompt: conv.customColoringPrompt,
    segmentationThreshold: conv.segmentationThreshold,
    customPrompt: conv.customPrompt,
    config: conv.config || getComponentisationConfig(),
    warnings: [],
    stepTimings: { ...conv.stepTimings },
  };
}

// Export for use in App.tsx handlers that need it
export { buildBaseContext };
