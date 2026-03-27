/**
 * Pipeline actions — consolidates multi-step handler functions.
 *
 * Uses the analyzer's analyze() with sessions for iteration.
 * Interceptors push state updates to the Zustand store.
 */
import { useConversationStore, type ViewerConversationState } from "@/stores/conversation-store";
import { useUIStore } from "@/stores/ui-store";
import { useUrlStore } from "@/stores/url-store";
import {
  analyze,
  summarize,
  analyzeContext,
  buildSessionExport,
  createEmptyDimension,
  getDefaultComponentIdentificationPrompt,
  getDefaultSegmentationPrompt,
  getDefaultSummaryPrompt,
  getDefaultAnalysisPrompt,
  getDefaultColoringPrompt,
} from "context-analyzer";
import type { PipelineState, Stage, Interceptor } from "context-analyzer";
import { DEFAULT_SEGMENTATION_THRESHOLD } from "context-analyzer";
import { getAnalyzerConfig } from "@/lib/ai-config";
import { downloadExport, exportPromptsAsPreset } from "@/ui/lib/export-download";
import { markStepStart, markStepEnd } from "@/lib/pipeline-logging";

// ---- Helpers ----

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

function buildInterceptors(): Interceptor[] {
  const stages: Stage[] = [
    "parsing", "counting-tokens", "segmenting",
    "identifying-components", "classifying-components", "coloring",
  ];
  const interceptors: Interceptor[] = [];
  const updateFn = (id: string, update: Partial<ViewerConversationState>) =>
    useConversationStore.getState().updateConversation(id, update);

  for (const stage of stages) {
    interceptors.push({
      stage, timing: "pre",
      fn: (ctx) => {
        markStepStart(ctx.id, stage);
        updateFn(ctx.id, { status: "processing", step: stage });
      },
    });
    interceptors.push({
      stage, timing: "post",
      fn: (ctx) => {
        markStepEnd(ctx.id, stage);
        updateFn(ctx.id, { ...ctx, status: "processing" });
      },
    });
  }
  return interceptors;
}

// ---- Reprocessing actions ----

async function reprocessWithSession(
  conv: ViewerConversationState,
  options: Record<string, any>,
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const id = conv.id;
  ui.setReprocessingId(id);

  try {
    if (!conv.sessionId) {
      console.warn("No session ID for reprocessing — cannot iterate");
      return;
    }

    const result = await analyze(
      {
        sessionId: conv.sessionId,
        interceptors: buildInterceptors(),
        ...options,
      },
      getAnalyzerConfig(),
    );

    // Update with final state
    const state = result.states.find((s) => s.id === conv.id) || result.states[0];
    if (state) {
      store.updateConversation(id, { ...state, id, status: "success", step: undefined });
    }
  } catch (error) {
    console.error("Reprocessing failed:", error);
    store.updateConversation(id, {
      status: "failed", step: undefined,
      error: error instanceof Error ? error.message : "Reprocessing failed",
    });
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function reprocessComponents(
  selectedConversation: ViewerConversationState,
  _selectedGroupFileIds: string[] | undefined,
  options: { customPrompt?: string; customComponents?: string[] } = {},
) {
  const dimName = useUIStore.getState().editingDimensionName || "default";
  await reprocessWithSession(selectedConversation, {
    dimensions: {
      [dimName]: {
        prompt: options.customPrompt,
        components: options.customComponents?.map((c) => ({ name: c, description: c })),
      },
    },
  });
}

export async function reprocessSegmentation(
  selectedConversation: ViewerConversationState,
  _selectedGroupFileIds: string[] | undefined,
  options: { customSegmentationPrompt?: string; segmentationThreshold?: number } = {},
) {
  await reprocessWithSession(selectedConversation, {
    prompts: options.customSegmentationPrompt !== undefined
      ? { segmentation: options.customSegmentationPrompt }
      : undefined,
    segmentationThreshold: options.segmentationThreshold,
  });
}

export async function reprocessSummary(
  selectedConversation: ViewerConversationState,
  options: { customSummaryPrompt?: string } = {},
) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  const id = selectedConversation.id;
  ui.setReprocessingId(id);

  try {
    const result = await summarize(
      { sessionId: "", format: "", analytics: [], states: [selectedConversation], errors: [], warnings: [] },
      getAnalyzerConfig(),
      { prompt: options.customSummaryPrompt },
    );
    store.updateConversation(id, {
      aiSummary: result.summary,
      customSummaryPrompt: options.customSummaryPrompt,
      status: "success",
    });
  } catch (error) {
    console.error("Summary failed:", error);
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function generateAnalysis(
  id: string,
  selectedConversation: ViewerConversationState | undefined,
  options: { customAnalysisPrompt?: string } = {},
) {
  if (!selectedConversation?.conversation) return;
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  ui.setReprocessingId(id);

  try {
    const result = await analyzeContext(
      { sessionId: "", format: "", analytics: [], states: [selectedConversation], errors: [], warnings: [] },
      getAnalyzerConfig(),
      { prompt: options.customAnalysisPrompt },
    );
    store.updateConversation(id, {
      analysis: result.analysis,
      aiSummary: result.summary,
      customAnalysisPrompt: options.customAnalysisPrompt,
      status: "success",
    });
  } catch (error) {
    console.error("Analysis failed:", error);
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function generateSummary(
  id: string,
  selectedConversation: ViewerConversationState | undefined,
  options: { customSummaryPrompt?: string } = {},
) {
  if (!selectedConversation?.conversation) return;
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  ui.setReprocessingId(id);

  try {
    const result = await summarize(
      { sessionId: "", format: "", analytics: [], states: [selectedConversation], errors: [], warnings: [] },
      getAnalyzerConfig(),
      { prompt: options.customSummaryPrompt },
    );
    store.updateConversation(id, {
      aiSummary: result.summary,
      customSummaryPrompt: options.customSummaryPrompt,
      status: "success",
    });
  } catch (error) {
    console.error("Summary failed:", error);
  } finally {
    ui.setReprocessingId(null);
  }
}

// ---- Prompt editor openers ----

export function openPromptEditor(id: string, dimensionName?: string) {
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

export async function applyPrompt(selectedConversation: ViewerConversationState | undefined) {
  const ui = useUIStore.getState();
  ui.setIsPromptDialogOpen(false);
  if (!selectedConversation?.conversation) return;
  const dimName = ui.editingDimensionName || "default";
  await reprocessComponents(selectedConversation, undefined, { customPrompt: ui.editingPrompt });
}

export async function applyComponents(selectedConversation: ViewerConversationState | undefined) {
  const ui = useUIStore.getState();
  ui.setIsComponentsDialogOpen(false);
  if (!selectedConversation?.conversation) return;

  const components = ui.editingComponents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (components.length === 0) return;

  await reprocessComponents(selectedConversation, undefined, { customComponents: components });
}

export async function applySegmentationPrompt(
  selectedConversation: ViewerConversationState | undefined,
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

export async function applySummaryPrompt(selectedConversation: ViewerConversationState | undefined) {
  const ui = useUIStore.getState();
  ui.setIsSummaryPromptDialogOpen(false);
  if (selectedConversation?.conversation) {
    await reprocessSummary(selectedConversation, { customSummaryPrompt: ui.editingSummaryPrompt });
  }
}

export async function applyAnalysisPrompt(selectedConversation: ViewerConversationState | undefined) {
  const ui = useUIStore.getState();
  ui.setIsAnalysisPromptDialogOpen(false);
  if (selectedConversation?.conversation) {
    await generateAnalysis(selectedConversation.id, selectedConversation, {
      customAnalysisPrompt: ui.editingAnalysisPrompt,
    });
  }
}

export async function applyColoringPrompt(selectedConversation: ViewerConversationState | undefined) {
  const ui = useUIStore.getState();
  const store = useConversationStore.getState();
  ui.setIsColoringPromptDialogOpen(false);
  if (!selectedConversation?.conversation) return;

  const dimName = ui.editingDimensionName || "default";
  await reprocessWithSession(selectedConversation, {
    dimensions: { [dimName]: { coloringPrompt: ui.editingColoringPrompt } },
  });
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

// ---- Orchestration actions ----

export async function applyPromptsToAllAction(sourceId: string) {
  const store = useConversationStore.getState();
  const source = store.conversations.find((c) => c.id === sourceId);
  if (!source?.dimensions) return;

  // Extract prompts & components from the source conversation
  const dimensions: Record<string, {
    prompt?: string;
    components?: Array<{ name: string; description: string }>;
    coloringPrompt?: string;
  }> = {};

  for (const [dimName, dim] of Object.entries(source.dimensions)) {
    dimensions[dimName] = {
      prompt: dim.prompt,
      coloringPrompt: dim.customColoringPrompt,
    };
    if (dim.customComponents?.length) {
      dimensions[dimName].components = dim.customComponents.map((name) => ({
        name,
        description: dim.componentDescriptions?.[name] || name,
      }));
    }
  }

  const options: Record<string, any> = { dimensions };
  if (source.customSegmentationPrompt) {
    options.prompts = { segmentation: source.customSegmentationPrompt };
  }
  if (source.segmentationThreshold != null) {
    options.segmentationThreshold = source.segmentationThreshold;
  }

  // Apply to every other completed conversation
  const targets = store.conversations.filter(
    (c) => c.id !== sourceId && c.conversation && c.sessionId,
  );

  await Promise.all(targets.map((conv) => reprocessWithSession(conv, options)));
}

export async function resumePipelinesWithApiKeyAction() {
  const store = useConversationStore.getState();
  const paused = store.conversations.filter((c) => c.status === "paused-for-api-key" && c.sessionId);

  // Re-run each paused conversation through the pipeline (no option changes, just resumed)
  await Promise.all(paused.map((conv) => reprocessWithSession(conv, {})));
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
