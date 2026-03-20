/**
 * usePipelineActions — consolidates the complex multi-step handler functions
 * that were previously scattered across App.tsx (~400 lines).
 *
 * These are operations that combine conversation-store mutations,
 * UI-store updates, pipeline calls, and/or navigation.
 *
 * Components import these functions directly instead of receiving callbacks via props.
 */
import { useConversationStore } from "@/stores/conversation-store";
import { useUIStore } from "@/stores/ui-store";
import { useUrlStore } from "@/stores/url-store";
import type { PipelineState } from "@/model/types";
import { PipelineStep } from "@/model/types";
import { ensureDimensions, createEmptyDimension } from "@/model/dimensions";
import { buildSessionExport } from "@/operations/export-builder";
import { downloadExport, exportPromptsAsPreset } from "@/ui/lib/export-download";
import {
  reprocessTarget,
  applyPromptsToAll,
  generateAnalysisForTarget,
  generateSummaryForTarget,
  rerunSummaryForTarget,
  resumePipelinesWithApiKey,
  type StoreAccessor,
} from "@/pipeline/orchestrate";
import {
  getDefaultComponentIdentificationPrompt,
  getDefaultSegmentationPrompt,
  getDefaultSummaryPrompt,
  getDefaultAnalysisPrompt,
  getDefaultColoringPrompt,
} from "@/stages/ai/prompts";
import { DEFAULT_SEGMENTATION_THRESHOLD } from "@/stages/segment";

// ---- Store accessor for orchestration ----

function getAccessor(): StoreAccessor {
  const store = useConversationStore;
  return {
    getState: () => store.getState(),
    updateConversation: (id, update) => store.getState().updateConversation(id, update),
    updateGroup: (id, update) => store.getState().updateGroup(id, update),
    appendSummaryChunk: (id, chunk) => store.getState().appendSummaryChunk(id, chunk),
    appendAnalysisChunk: (id, chunk) => store.getState().appendAnalysisChunk(id, chunk),
    set: store.setState,
  };
}

// ---- Helpers (no hooks, pure store access) ----

function navigateToId(id: string | null) {
  if (id === null) {
    const basePath = import.meta.env.BASE_URL || "/";
    window.history.replaceState({}, "", basePath);
    useUrlStore.getState()._syncFromUrl();
  } else {
    const isGroup = !!useConversationStore.getState().groups[id];
    useUrlStore.getState().navigateToConversation(id, isGroup);
  }
}

function getOnAnalysisChunk() {
  return (id: string, chunk: string) =>
    useConversationStore.getState().appendAnalysisChunk(id, chunk);
}

// ---- Reprocessing actions ----

export async function reprocessComponents(
  selectedConversation: PipelineState,
  selectedGroupFileIds: string[] | undefined,
  options: { customPrompt?: string; customComponents?: string[] } = {},
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const id = selectedConversation.id;
  const dimName = ui.editingDimensionName || "default";
  ui.setReprocessingId(id);

  try {
    await reprocessTarget(
      getAccessor(),
      id,
      PipelineStep.Identify,
      (ctx) => {
        const dims = ensureDimensions(ctx);
        if (!dims[dimName]) {
          dims[dimName] = createEmptyDimension(dimName);
        }
        if (options.customPrompt !== undefined) dims[dimName]!.prompt = options.customPrompt;
        if (options.customComponents !== undefined) dims[dimName]!.customComponents = options.customComponents;
      },
      { onAnalysisChunk: getOnAnalysisChunk() },
      [dimName],
    );
  } catch (error) {
    console.error("Failed to reprocess:", error);
    store.updateConversation(id, { status: "failed", step: undefined, error: "Component reprocessing failed" });
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function reprocessSegmentation(
  selectedConversation: PipelineState,
  selectedGroupFileIds: string[] | undefined,
  options: { customSegmentationPrompt?: string; segmentationThreshold?: number } = {},
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const id = selectedConversation.id;
  ui.setReprocessingId(id);

  try {
    await reprocessTarget(
      getAccessor(),
      id,
      PipelineStep.Segment,
      (ctx) => {
        ctx.customSegmentationPrompt = options.customSegmentationPrompt;
        ctx.segmentationThreshold = options.segmentationThreshold;
      },
      { onAnalysisChunk: getOnAnalysisChunk() },
    );
  } catch (error) {
    console.error("Failed to reprocess segmentation:", error);
    store.updateConversation(id, { status: "failed", step: undefined, error: "Segmentation reprocessing failed" });
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function reprocessSummary(
  selectedConversation: PipelineState,
  options: { customSummaryPrompt?: string } = {},
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const id = selectedConversation.id;
  ui.setReprocessingId(id);
  try {
    await rerunSummaryForTarget(getAccessor(), selectedConversation, options);
  } catch (error) {
    console.error("Failed to reprocess summary:", error);
    store.updateConversation(id, { status: "failed", step: undefined, error: "Summary reprocessing failed" });
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function generateAnalysis(
  id: string,
  selectedConversation: PipelineState | undefined,
  options: { customAnalysisPrompt?: string } = {},
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const group = store.getGroup(id);
  const conv = group ? selectedConversation : store.conversations.find((c) => c.id === id);
  if (!conv?.conversation) return;

  ui.setReprocessingId(id);
  try {
    await generateAnalysisForTarget(getAccessor(), id, conv, options);
  } catch (error) {
    console.error("Failed to generate analysis:", error);
    if (!group) store.updateConversation(id, { status: "failed", step: undefined, error: "Analysis generation failed" });
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function generateSummary(
  id: string,
  selectedConversation: PipelineState | undefined,
  options: { customSummaryPrompt?: string } = {},
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const group = store.getGroup(id);
  const conv = group ? selectedConversation : store.conversations.find((c) => c.id === id);
  if (!conv?.conversation) return;

  ui.setReprocessingId(id);
  try {
    await generateSummaryForTarget(getAccessor(), id, conv, options);
  } catch (error) {
    console.error("Failed to generate summary:", error);
    if (!group) store.updateConversation(id, { status: "failed", step: undefined, error: "Summary generation failed" });
  } finally {
    ui.setReprocessingId(null);
  }
}

// ---- Prompt editor openers ----

export function openPromptEditor(id: string, dimensionName?: string) {
  navigateToId(id);
  const store = useConversationStore.getState();
  const conv = store.conversations.find((c) => c.id === id);
  // For groups, read prompt from first member file
  const group = store.getGroup(id);
  const sourceConv = conv ?? (group
    ? store.conversations.find((c) => group.fileIds.includes(c.id) && c.dimensions)
    : undefined);
  const dimName = dimensionName || "default";
  const ui = useUIStore.getState();
  ui.setEditingDimensionName(dimName);

  const dimPrompt = sourceConv?.dimensions?.[dimName]?.prompt;
  const currentPrompt =
    dimPrompt ||
    ui.loadedPreset?.componentIdentificationPrompt ||
    getDefaultComponentIdentificationPrompt();
  ui.setEditingPrompt(currentPrompt);
  ui.setIsPromptDialogOpen(true);
}

export function openComponentsEditor(id: string, dimensionName?: string) {
  navigateToId(id);
  const store = useConversationStore.getState();
  const conv = store.conversations.find((c) => c.id === id);
  const group = store.getGroup(id);
  const sourceConv = conv ?? (group
    ? store.conversations.find((c) => group.fileIds.includes(c.id) && c.dimensions)
    : undefined);
  const dimName = dimensionName || "default";
  const ui = useUIStore.getState();
  ui.setEditingDimensionName(dimName);

  const currentComponents = sourceConv?.dimensions?.[dimName]?.discoveredComponents || [];
  ui.setEditingComponents([...new Set(currentComponents)].join("\n"));
  ui.setIsComponentsDialogOpen(true);
}

export function openSegmentationPromptEditor(id: string) {
  navigateToId(id);
  const conv = useConversationStore.getState().conversations.find((c) => c.id === id);
  const ui = useUIStore.getState();
  ui.setEditingSegmentationPrompt(conv?.customSegmentationPrompt || getDefaultSegmentationPrompt());
  ui.setEditingSegmentationThreshold(conv?.segmentationThreshold ?? DEFAULT_SEGMENTATION_THRESHOLD);
  ui.setIsSegmentationPromptDialogOpen(true);
}

export function openSummaryPromptEditor(id: string) {
  navigateToId(id);
  const conv = useConversationStore.getState().conversations.find((c) => c.id === id);
  const ui = useUIStore.getState();
  ui.setEditingSummaryPrompt(conv?.customSummaryPrompt || getDefaultSummaryPrompt());
  ui.setIsSummaryPromptDialogOpen(true);
}

export function openAnalysisPromptEditor(id: string) {
  navigateToId(id);
  const conv = useConversationStore.getState().conversations.find((c) => c.id === id);
  const ui = useUIStore.getState();
  ui.setEditingAnalysisPrompt(conv?.customAnalysisPrompt || getDefaultAnalysisPrompt());
  ui.setIsAnalysisPromptDialogOpen(true);
}

export function openColoringPromptEditor(id: string, dimensionName?: string) {
  navigateToId(id);
  const store = useConversationStore.getState();
  const conv = store.conversations.find((c) => c.id === id);
  const group = store.getGroup(id);
  const sourceConv = conv ?? (group
    ? store.conversations.find((c) => group.fileIds.includes(c.id) && c.dimensions)
    : undefined);
  const ui = useUIStore.getState();
  const dimName = dimensionName || ui.editingDimensionName || "default";
  ui.setEditingDimensionName(dimName);
  const dimPrompt = sourceConv?.dimensions?.[dimName]?.customColoringPrompt;
  ui.setEditingColoringPrompt(dimPrompt || getDefaultColoringPrompt());
  ui.setIsColoringPromptDialogOpen(true);
}

// ---- Prompt apply actions ----

export async function applyPrompt(selectedConversation: PipelineState | undefined) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  ui.setIsPromptDialogOpen(false);
  if (!selectedConversation?.conversation) return;

  const dimName = ui.editingDimensionName || "default";
  const id = selectedConversation.id;

  // For groups, update all member files; for single files, update just the one
  const group = store.getGroup(id);
  const idsToUpdate = group ? group.fileIds : [id];

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!idsToUpdate.includes(conv.id)) return conv;
      const dims = { ...(conv.dimensions || {}) };
      if (dims[dimName]) {
        dims[dimName] = { ...dims[dimName]!, prompt: ui.editingPrompt };
      } else {
        dims[dimName] = { ...createEmptyDimension(dimName), prompt: ui.editingPrompt };
      }
      return { ...conv, dimensions: dims };
    }),
  );

  ui.setReprocessingId(id);
  try {
    await reprocessTarget(
      getAccessor(),
      id,
      PipelineStep.Identify,
      (ctx) => {
        const dims = ensureDimensions(ctx);
        if (!dims[dimName]) {
          dims[dimName] = createEmptyDimension(dimName);
        }
        dims[dimName]!.prompt = ui.editingPrompt;
      },
      { onAnalysisChunk: getOnAnalysisChunk() },
      [dimName],
    );
  } catch (error) {
    console.error("Failed to reprocess dimension:", error);
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function applyComponents(selectedConversation: PipelineState | undefined) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  ui.setIsComponentsDialogOpen(false);
  if (!selectedConversation?.conversation) return;

  const components = ui.editingComponents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (components.length === 0) return;

  const dimName = ui.editingDimensionName || "default";
  const id = selectedConversation.id;

  const group = store.getGroup(id);
  const idsToUpdate = group ? group.fileIds : [id];

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!idsToUpdate.includes(conv.id)) return conv;
      const dims = { ...(conv.dimensions || {}) };
      if (dims[dimName]) {
        dims[dimName] = { ...dims[dimName]!, customComponents: components };
      }
      return { ...conv, dimensions: dims };
    }),
  );

  ui.setReprocessingId(id);
  try {
    await reprocessTarget(
      getAccessor(),
      id,
      PipelineStep.Identify,
      (ctx) => {
        const dims = ensureDimensions(ctx);
        if (dims[dimName]) dims[dimName]!.customComponents = components;
      },
      { onAnalysisChunk: getOnAnalysisChunk() },
      [dimName],
    );
  } catch (error) {
    console.error("Failed to reprocess dimension components:", error);
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function applySegmentationPrompt(
  selectedConversation: PipelineState | undefined,
  selectedGroupFileIds: string[] | undefined,
) {
  const ui = useUIStore.getState();
  ui.setIsSegmentationPromptDialogOpen(false);
  if (selectedConversation?.conversation) {
    await reprocessSegmentation(selectedConversation, selectedGroupFileIds, {
      customSegmentationPrompt: ui.editingSegmentationPrompt,
      segmentationThreshold: ui.editingSegmentationThreshold,
    });
  }
}

export async function applySummaryPrompt(selectedConversation: PipelineState | undefined) {
  const ui = useUIStore.getState();
  ui.setIsSummaryPromptDialogOpen(false);
  if (selectedConversation?.conversation) {
    await reprocessSummary(selectedConversation, { customSummaryPrompt: ui.editingSummaryPrompt });
  }
}

export async function applyAnalysisPrompt(selectedConversation: PipelineState | undefined) {
  const ui = useUIStore.getState();
  ui.setIsAnalysisPromptDialogOpen(false);
  if (selectedConversation?.conversation) {
    await generateAnalysis(selectedConversation.id, selectedConversation, {
      customAnalysisPrompt: ui.editingAnalysisPrompt,
    });
  }
}

export async function applyColoringPrompt(selectedConversation: PipelineState | undefined) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  ui.setIsColoringPromptDialogOpen(false);
  if (!selectedConversation?.conversation) return;

  const id = selectedConversation.id;
  const dimName = ui.editingDimensionName || "default";
  ui.setReprocessingId(id);

  const group = store.getGroup(id);
  const idsToUpdate = group ? group.fileIds : [id];

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!idsToUpdate.includes(conv.id)) return conv;
      const dims = { ...(conv.dimensions || {}) };
      if (dims[dimName]) {
        dims[dimName] = { ...dims[dimName]!, customColoringPrompt: ui.editingColoringPrompt };
      }
      return { ...conv, dimensions: dims };
    }),
  );

  try {
    await reprocessTarget(
      getAccessor(),
      id,
      PipelineStep.Color,
      (ctx) => {
        const dims = ensureDimensions(ctx);
        if (dims[dimName]) {
          dims[dimName]!.customColoringPrompt = ui.editingColoringPrompt;
        }
      },
      {},
      [dimName],
    );
  } catch (error) {
    console.error("Failed to reprocess coloring:", error);
    store.updateConversation(id, { status: "failed", step: undefined, error: "Coloring reprocessing failed" });
  } finally {
    ui.setReprocessingId(null);
  }
}

// ---- Dimension management ----

export function addDimension(selectedConversationId: string, name: string) {
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== selectedConversationId) return conv;
      const dims = { ...(conv.dimensions || {}) };
      dims[name] = createEmptyDimension(name);
      return { ...conv, dimensions: dims };
    }),
  );

  ui.setActiveDimensions(new Set([...ui.activeDimensions, name]));
  ui.setEditingDimensionName(name);
  ui.setEditingPrompt(getDefaultComponentIdentificationPrompt());
  ui.setIsPromptDialogOpen(true);
}

export function removeDimension(selectedConversationId: string, name: string) {
  if (name === "default") return;
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== selectedConversationId) return conv;
      const dims = { ...(conv.dimensions || {}) };
      delete dims[name];
      return { ...conv, dimensions: dims };
    }),
  );
  const next = new Set(ui.activeDimensions);
  next.delete(name);
  ui.setActiveDimensions(next);
}

export function renameDimension(selectedConversationId: string, oldName: string, newName: string) {
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (conv.id !== selectedConversationId) return conv;
      const dims = { ...(conv.dimensions || {}) };
      if (!dims[oldName]) return conv;
      dims[newName] = { ...dims[oldName]!, name: newName };
      delete dims[oldName];
      return { ...conv, dimensions: dims };
    }),
  );
  const next = new Set(ui.activeDimensions);
  if (next.has(oldName)) {
    next.delete(oldName);
    next.add(newName);
  }
  ui.setActiveDimensions(next);
}

// ---- Orchestration actions (called directly from UI) ----

export function applyPromptsToAllAction(sourceId: string) {
  return applyPromptsToAll(getAccessor(), sourceId);
}

export function resumePipelinesWithApiKeyAction() {
  resumePipelinesWithApiKey(getAccessor());
}

// ---- Export actions ----

export function exportSession() {
  const { conversations, groups } = useConversationStore.getState();
  downloadExport(buildSessionExport(conversations, groups));
}

export function exportPromptsAsPresetAction(sourceId: string) {
  const source = useConversationStore.getState().conversations.find((c) => c.id === sourceId);
  if (source) exportPromptsAsPreset(source);
}

// ---- Navigation wrappers ----

export function groupConversations(
  idsToGroup?: string[],
  groupName?: string,
  existingGroupId?: string,
  groupTitle?: string,
) {
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();
  const ids = idsToGroup || [...ui.selectedIds];
  if (ids.length < 2) return;
  if (!idsToGroup) ui.clearSelection();
  const groupId = store.groupConversations(ids, groupName, existingGroupId, groupTitle);
  if (groupId) navigateToId(groupId);
}

export function ungroupConversation(id: string) {
  const currentId = useUrlStore.getState().conversationId;
  useConversationStore.getState().removeGroup(id);
  if (currentId === id) navigateToId(null);
}

export function deleteConversation(id: string) {
  const currentId = useUrlStore.getState().conversationId;
  useConversationStore.getState().deleteConversation(id);
  if (currentId === id) navigateToId(null);
}

export function updateGroupSources(groupId: string, newSources: Array<{ id: string; filename: string; title?: string }>) {
  const newFileIds = newSources.map((s) => s.id);
  if (newFileIds.length <= 1) {
    ungroupConversation(groupId);
  } else {
    useConversationStore.getState().updateGroup(groupId, { fileIds: newFileIds });
  }
}

export { navigateToId };
