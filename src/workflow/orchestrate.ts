/**
 * Workflow orchestration functions extracted from the store.
 * These accept a store accessor to read/write state.
 */

import type { WorkflowState, WorkflowCallbacks, WorkflowOptions } from "./types";
import { PipelineStep } from "./types";
import type { Notify } from "./runner";
import { runPipelineFrom, resumeFromPause, runWorkflows } from "./pipeline";
import { getAIConfig } from "../ai-config";
import { generateId } from "../lib/id-generator";
import { buildBaseContext } from "./context";

/** Minimal store interface for orchestration functions. */
export interface StoreAccessor {
  getState: () => {
    conversations: WorkflowState[];
    pendingSessionImport: any;
  };
  updateConversation: (id: string, update: Partial<WorkflowState>) => void;
  appendSummaryChunk: (id: string, chunk: string) => void;
  appendAnalysisChunk: (id: string, chunk: string) => void;
  set: (update: any) => void;
}

/** Run workflows for dropped files, creating placeholders and processing. Returns first placeholder ID. */
export async function runWorkflowMutation(
  store: StoreAccessor,
  files: File[],
  presetIds: Map<number, string> | undefined,
  options?: WorkflowOptions,
): Promise<void> {
  const fileIds = new Map<number, string>();
  const placeholders: WorkflowState[] = files.map((file, index) => {
    const id = presetIds?.get(index) || generateId();
    fileIds.set(index, id);
    return { id, filename: file.name, status: "pending" };
  });

  store.set((state: any) => ({
    conversations: [...state.conversations, ...placeholders],
    fileIdsRef: fileIds,
  }));

  const onFileComplete = (completed: WorkflowState) => {
    store.set((state: any) => ({
      conversations: state.conversations.map((conv: WorkflowState) =>
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

  const onSummaryChunk = (id: string, chunk: string) => store.appendSummaryChunk(id, chunk);
  const onAnalysisChunk = (id: string, chunk: string) => store.appendAnalysisChunk(id, chunk);

  try {
    await runWorkflows(files, fileIds, onFileComplete, onSummaryChunk, onAnalysisChunk, options);
    if (!store.getState().pendingSessionImport) {
      store.set({ fileIdsRef: new Map() });
    }
  } catch {
    store.set({ fileIdsRef: new Map() });
  }
}

/** Reprocess a conversation from a given pipeline step. */
export async function reprocessWithRunner(
  store: StoreAccessor,
  conv: WorkflowState,
  startFrom: PipelineStep,
  contextModifier: (ctx: WorkflowState) => void,
  callbacks: WorkflowCallbacks,
): Promise<void> {
  const notify: Notify = (id, update) => store.updateConversation(id, update);
  const ctx = buildBaseContext(conv);
  contextModifier(ctx);
  await runPipelineFrom(startFrom, ctx, notify, callbacks);
}

/** Apply prompts, component list, and colors from one conversation to all others. */
export async function applyPromptsToAll(
  store: StoreAccessor,
  sourceId: string,
): Promise<void> {
  const { conversations } = store.getState();
  const source = conversations.find((c) => c.id === sourceId);
  if (!source) return;

  // Copy prompts
  const promptFields = {
    customPrompt: source.customPrompt,
    customSegmentationPrompt: source.customSegmentationPrompt,
    customSummaryPrompt: source.customSummaryPrompt,
    customAnalysisPrompt: source.customAnalysisPrompt,
    customColoringPrompt: source.customColoringPrompt,
    segmentationThreshold: source.segmentationThreshold,
  };

  // Also copy component list and colors from the default dimension
  const sourceDim = source.dimensions?.["default"];
  const customComponents = sourceDim?.components?.length ? sourceDim.components : undefined;
  const presetColors = sourceDim?.componentColors && Object.keys(sourceDim.componentColors).length > 0
    ? sourceDim.componentColors
    : undefined;

  const targets = conversations.filter(
    (c) => c.id !== sourceId && c.status === "success" && c.conversation,
  );

  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (conv) => {
      let startFrom: PipelineStep | null = null;
      if (
        promptFields.customSegmentationPrompt !== conv.customSegmentationPrompt ||
        promptFields.segmentationThreshold !== conv.segmentationThreshold
      ) {
        startFrom = PipelineStep.Segment;
      } else if (promptFields.customPrompt !== conv.customPrompt) {
        startFrom = PipelineStep.Identify;
      } else if (promptFields.customColoringPrompt !== conv.customColoringPrompt) {
        startFrom = PipelineStep.Color;
      }

      store.updateConversation(conv.id, promptFields);

      if (startFrom === null) return;

      const notify: Notify = (id, update) => store.updateConversation(id, update);
      const ctx = buildBaseContext(conv);
      Object.assign(ctx, promptFields);
      // Pass component list and colors so pipeline uses them directly
      if (customComponents) ctx.customComponents = customComponents;
      if (presetColors) ctx.presetColors = presetColors;

      await runPipelineFrom(startFrom, ctx, notify, {
        onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
      });
    }),
  );
}

/** Resume all paused workflows after API key is provided. */
export function resumeWorkflowsWithApiKey(store: StoreAccessor): void {
  const { conversations } = store.getState();
  const pausedWorkflows = conversations.filter((c) => c.status === "paused-for-api-key");

  for (const conv of pausedWorkflows) {
    if (!conv.conversation) continue;

    const notify: Notify = (id, update) => store.updateConversation(id, update);
    const ctx = buildBaseContext(conv);

    resumeFromPause(ctx, notify, {
      onSummaryChunk: (id, chunk) => store.appendSummaryChunk(id, chunk),
      onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
    });
  }
}
