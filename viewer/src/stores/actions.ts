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
  saveSessionDimensions,
} from "context-analyzer";
import type { PipelineState, Stage, Interceptor } from "context-analyzer";
import { DEFAULT_SEGMENTATION_THRESHOLD } from "context-analyzer";
import { getAnalyzerConfig } from "@/lib/ai-config";
import { formatAnalyzerErrors } from "@/lib/analyzer-errors";
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
  const store = useConversationStore.getState();
  const id = conv.id;

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

    const state = result.states.find((candidate) => candidate.id === id);
    if (!state) throw new Error(`Analyzer session did not contain file ${id}`);
    store.updateConversation(id, {
      ...state,
      warnings: [...(state.warnings || []), ...formatAnalyzerErrors(result.errors)],
      status: "success",
      step: undefined,
      error: undefined,
    });
  } catch (error) {
    console.error("Reprocessing failed:", error);
    store.updateConversation(id, {
      status: "failed", step: undefined,
      error: error instanceof Error ? error.message : "Reprocessing failed",
    });
  }
}

function resolveTargets(
  selectedConversation: ViewerConversationState,
  selectedGroupFileIds?: string[],
): ViewerConversationState[] {
  const store = useConversationStore.getState();
  const fileIds = selectedGroupFileIds || store.getGroup(selectedConversation.id)?.fileIds;
  if (!fileIds) return [store.getConversation(selectedConversation.id) || selectedConversation];
  return fileIds
    .map((id) => store.getConversation(id))
    .filter((conv): conv is ViewerConversationState => !!conv?.conversation);
}

async function reprocessTargets(
  selectedConversation: ViewerConversationState,
  selectedGroupFileIds: string[] | undefined,
  options: Record<string, any>,
) {
  const ui = useUIStore.getState();
  ui.setReprocessingId(selectedConversation.id);
  try {
    await Promise.all(
      resolveTargets(selectedConversation, selectedGroupFileIds)
        .map((conv) => reprocessWithSession(conv, options)),
    );
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function reprocessComponents(
  selectedConversation: ViewerConversationState,
  selectedGroupFileIds: string[] | undefined,
  options: { customPrompt?: string; customComponents?: string[] } = {},
) {
  const dimName = useUIStore.getState().editingDimensionName || "default";
  await reprocessTargets(selectedConversation, selectedGroupFileIds, {
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
  selectedGroupFileIds: string[] | undefined,
  options: { customSegmentationPrompt?: string; segmentationThreshold?: number } = {},
) {
  await reprocessTargets(selectedConversation, selectedGroupFileIds, {
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
  await generateSummary(selectedConversation.id, selectedConversation, options);
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
    const update = {
      analysis: result.analysis,
      aiSummary: result.summary,
      customAnalysisPrompt: options.customAnalysisPrompt,
    };
    const group = store.getGroup(id);
    if (group) store.updateGroup(id, update);
    else store.updateConversation(id, { ...update, status: "success" });
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
    const update = {
      aiSummary: result.summary,
      customSummaryPrompt: options.customSummaryPrompt,
    };
    const group = store.getGroup(id);
    if (group) store.updateGroup(id, update);
    else store.updateConversation(id, { ...update, status: "success" });
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

  const dimPrompt = group?.dimensions?.[dimName]?.prompt
    || sourceConv?.dimensions?.[dimName]?.prompt;
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

  const currentComponents = group?.dimensions?.[dimName]?.customComponents
    || sourceConv?.dimensions?.[dimName]?.customComponents
    || sourceConv?.dimensions?.[dimName]?.discoveredComponents
    || [];
  ui.setEditingComponents([...new Set(currentComponents)].join("\n"));
  ui.setIsComponentsDialogOpen(true);
}

export function openSegmentationPromptEditor(id: string) {
  navigateToId(id);
  const store = useConversationStore.getState();
  const group = store.getGroup(id);
  const conv = store.getConversation(id) || (group ? store.getConversation(group.fileIds[0] || "") : undefined);
  const ui = useUIStore.getState();
  ui.setEditingSegmentationPrompt(conv?.customSegmentationPrompt || getDefaultSegmentationPrompt());
  ui.setEditingSegmentationThreshold(conv?.segmentationThreshold ?? DEFAULT_SEGMENTATION_THRESHOLD);
  ui.setIsSegmentationPromptDialogOpen(true);
}

export function openSummaryPromptEditor(id: string) {
  navigateToId(id);
  const store = useConversationStore.getState();
  const conv = store.getConversation(id);
  const group = store.getGroup(id);
  const ui = useUIStore.getState();
  ui.setEditingSummaryPrompt(conv?.customSummaryPrompt || group?.customSummaryPrompt || getDefaultSummaryPrompt());
  ui.setIsSummaryPromptDialogOpen(true);
}

export function openAnalysisPromptEditor(id: string) {
  navigateToId(id);
  const store = useConversationStore.getState();
  const conv = store.getConversation(id);
  const group = store.getGroup(id);
  const ui = useUIStore.getState();
  ui.setEditingAnalysisPrompt(conv?.customAnalysisPrompt || group?.customAnalysisPrompt || getDefaultAnalysisPrompt());
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
  const dimPrompt = group?.dimensions?.[dimName]?.customColoringPrompt
    || sourceConv?.dimensions?.[dimName]?.customColoringPrompt;
  ui.setEditingColoringPrompt(dimPrompt || getDefaultColoringPrompt());
  ui.setIsColoringPromptDialogOpen(true);
}

// ---- Prompt apply actions ----

function updateDimension(
  selectedConversationId: string,
  dimensionName: string,
  update: Partial<NonNullable<ViewerConversationState["dimensions"]>[string]>,
) {
  const store = useConversationStore.getState();
  const targetIds = new Set(dimensionTargets(selectedConversationId).map((conv) => conv.id));
  const group = store.getGroup(selectedConversationId);
  if (group) {
    store.updateGroup(group.id, {
      dimensions: {
        ...(group.dimensions || {}),
        [dimensionName]: { ...(group.dimensions?.[dimensionName] || {}), ...update },
      },
    });
  }
  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!targetIds.has(conv.id)) return conv;
      const dimension = conv.dimensions?.[dimensionName] || createEmptyDimension(dimensionName);
      return {
        ...conv,
        dimensions: {
          ...(conv.dimensions || {}),
          [dimensionName]: { ...dimension, ...update },
        },
      };
    }),
  );
  persistDimensions(targetIds);
}

export function savePrompt(selectedConversation: ViewerConversationState | undefined) {
  if (!selectedConversation?.conversation) return;
  const ui = useUIStore.getState();
  updateDimension(
    selectedConversation.id,
    ui.editingDimensionName || "default",
    { prompt: ui.editingPrompt },
  );
  ui.setIsPromptDialogOpen(false);
}

export function saveComponents(selectedConversation: ViewerConversationState | undefined) {
  if (!selectedConversation?.conversation) return;
  const ui = useUIStore.getState();
  const components = ui.editingComponents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (components.length === 0) return;
  updateDimension(
    selectedConversation.id,
    ui.editingDimensionName || "default",
    {
      customComponents: components,
      componentDescriptions: Object.fromEntries(components.map((component) => [component, component])),
    },
  );
  ui.setIsComponentsDialogOpen(false);
}

async function reprocessActiveDimensions(selectedConversation: ViewerConversationState) {
  const ui = useUIStore.getState();
  const group = useConversationStore.getState().getGroup(selectedConversation.id);
  const activeDimensions = new Set(group?.activeDimensions || ui.activeDimensions);
  ui.setReprocessingId(selectedConversation.id);
  try {
    await Promise.all(resolveTargets(selectedConversation).map((conversation) => {
      const reprocessDimensions = Object.keys(conversation.dimensions || {})
        .filter((name) => activeDimensions.has(name));
      return reprocessWithSession(conversation, { reprocessDimensions });
    }));
  } finally {
    ui.setReprocessingId(null);
  }
}

export async function applyPrompt(selectedConversation: ViewerConversationState | undefined) {
  if (!selectedConversation?.conversation) return;
  const ui = useUIStore.getState();
  updateDimension(
    selectedConversation.id,
    ui.editingDimensionName || "default",
    { prompt: ui.editingPrompt },
  );
  ui.setIsPromptDialogOpen(false);
  await reprocessActiveDimensions(selectedConversation);
}

export async function applyComponents(selectedConversation: ViewerConversationState | undefined) {
  if (!selectedConversation?.conversation) return;
  const ui = useUIStore.getState();
  const components = ui.editingComponents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (components.length === 0) return;

  updateDimension(
    selectedConversation.id,
    ui.editingDimensionName || "default",
    {
      customComponents: components,
      componentDescriptions: Object.fromEntries(components.map((component) => [component, component])),
    },
  );
  ui.setIsComponentsDialogOpen(false);
  await reprocessActiveDimensions(selectedConversation);
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
  ui.setIsColoringPromptDialogOpen(false);
  if (!selectedConversation?.conversation) return;

  const dimName = ui.editingDimensionName || "default";
  await reprocessTargets(selectedConversation, undefined, {
    dimensions: { [dimName]: { coloringPrompt: ui.editingColoringPrompt } },
  });
}

// ---- Dimension management ----

function dimensionTargets(selectedConversationId: string): ViewerConversationState[] {
  const store = useConversationStore.getState();
  const group = store.getGroup(selectedConversationId);
  const ids = group?.fileIds || [selectedConversationId];
  return ids
    .map((id) => store.getConversation(id))
    .filter((conv): conv is ViewerConversationState => !!conv?.conversation);
}

function persistDimensions(ids: Set<string>) {
  const store = useConversationStore.getState();
  for (const id of ids) {
    const conversation = store.getConversation(id);
    if (!conversation?.sessionId) continue;
    saveSessionDimensions(conversation.sessionId, id, conversation.dimensions || {});
  }
}

export function addDimension(selectedConversationId: string, name: string) {
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();
  const targetIds = new Set(dimensionTargets(selectedConversationId).map((conv) => conv.id));
  const group = store.getGroup(selectedConversationId);
  if (group) {
    store.updateGroup(group.id, {
      dimensions: { ...(group.dimensions || {}), [name]: {} },
      activeDimensions: [...new Set([...(group.activeDimensions || []), name])],
    });
  }

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!targetIds.has(conv.id) || conv.dimensions?.[name]) return conv;
      return {
        ...conv,
        dimensions: { ...(conv.dimensions || {}), [name]: createEmptyDimension(name) },
      };
    }),
  );
  persistDimensions(targetIds);

  ui.setActiveDimensions(new Set([...ui.activeDimensions, name]));
  ui.setEditingDimensionName(name);
  ui.setEditingPrompt(getDefaultComponentIdentificationPrompt());
  ui.setIsPromptDialogOpen(true);
}

export function removeDimension(selectedConversationId: string, name: string) {
  if (name === "default") return;
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();
  const targetIds = new Set(dimensionTargets(selectedConversationId).map((conv) => conv.id));
  if (![...targetIds].some((id) => store.getConversation(id)?.dimensions?.[name])) return;
  const group = store.getGroup(selectedConversationId);
  if (group) {
    const dimensions = { ...(group.dimensions || {}) };
    delete dimensions[name];
    store.updateGroup(group.id, {
      dimensions,
      activeDimensions: group.activeDimensions?.filter((dimension) => dimension !== name),
    });
  }

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!targetIds.has(conv.id) || !conv.dimensions?.[name]) return conv;
      const dimensions = { ...conv.dimensions };
      delete dimensions[name];
      return { ...conv, dimensions };
    }),
  );
  persistDimensions(targetIds);

  const next = new Set(ui.activeDimensions);
  next.delete(name);
  ui.setActiveDimensions(next);
}

export function renameDimension(selectedConversationId: string, oldName: string, newName: string) {
  if (oldName === newName) return;
  const store = useConversationStore.getState();
  const ui = useUIStore.getState();
  const targetIds = new Set(dimensionTargets(selectedConversationId).map((conv) => conv.id));
  if (![...targetIds].some((id) => store.getConversation(id)?.dimensions?.[oldName])) return;
  if ([...targetIds].some((id) => store.getConversation(id)?.dimensions?.[newName])) return;
  const group = store.getGroup(selectedConversationId);
  if (group) {
    const dimensions = { ...(group.dimensions || {}) };
    if (dimensions[oldName]) {
      dimensions[newName] = dimensions[oldName];
      delete dimensions[oldName];
    }
    store.updateGroup(group.id, {
      dimensions,
      activeDimensions: group.activeDimensions?.map((dimension) =>
        dimension === oldName ? newName : dimension,
      ),
    });
  }

  store.setConversations((prev) =>
    prev.map((conv) => {
      if (!targetIds.has(conv.id)) return conv;
      const dimension = conv.dimensions?.[oldName];
      if (!dimension) return conv;
      const dimensions = { ...conv.dimensions, [newName]: { ...dimension, name: newName } };
      delete dimensions[oldName];
      return { ...conv, dimensions };
    }),
  );
  persistDimensions(targetIds);

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

  // Apply to every other completed conversation (exclude source)
  const targets = store.conversations.filter(
    (c) => c.id !== sourceId && c.conversation && c.sessionId,
  );

  // Group by sessionId so we only call analyze() once per session
  const bySession = new Map<string, ViewerConversationState[]>();
  for (const conv of targets) {
    const group = bySession.get(conv.sessionId!) || [];
    group.push(conv);
    bySession.set(conv.sessionId!, group);
  }

  const interceptors = buildInterceptors();
  const config = getAnalyzerConfig();

  await Promise.all([...bySession.entries()].map(async ([sessionId, convs]) => {
    const targetIds = new Set(convs.map((c) => c.id));
    try {
      const result = await analyze(
        { sessionId, interceptors, ...options },
        config,
      );
      for (const state of result.states) {
        if (targetIds.has(state.id)) {
          store.updateConversation(state.id, {
            ...state,
            warnings: [...(state.warnings || []), ...formatAnalyzerErrors(result.errors)],
            status: "success",
            step: undefined,
            error: undefined,
          });
        }
      }
    } catch (error) {
      for (const conv of convs) {
        store.updateConversation(conv.id, {
          status: "failed", step: undefined,
          error: error instanceof Error ? error.message : "Apply prompts failed",
        });
      }
    }
  }));
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
