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
  dimNames?: string[],
): Promise<void> {
  const notify: Notify = (id, update) => store.updateConversation(id, update);
  const ctx = buildBaseContext(conv);
  contextModifier(ctx);
  await runPipelineFrom(startFrom, ctx, notify, callbacks, dimNames);
}

/** Apply prompts, component list, and colors from one conversation to all others. */
export async function applyPromptsToAll(
  store: StoreAccessor,
  sourceId: string,
): Promise<void> {
  const { conversations } = store.getState();
  const source = conversations.find((c) => c.id === sourceId);
  if (!source) return;

  // Conversation-level prompt fields
  const convPrompts = {
    customSegmentationPrompt: source.customSegmentationPrompt,
    customSummaryPrompt: source.customSummaryPrompt,
    customAnalysisPrompt: source.customAnalysisPrompt,
    segmentationThreshold: source.segmentationThreshold,
  };

  const targets = conversations.filter(
    (c) => c.id !== sourceId && c.status === "success" && c.conversation,
  );

  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (conv) => {
      // Check if segmentation changed (conversation-level)
      const segChanged =
        convPrompts.customSegmentationPrompt !== conv.customSegmentationPrompt ||
        convPrompts.segmentationThreshold !== conv.segmentationThreshold;

      // Copy conversation-level prompts
      store.updateConversation(conv.id, convPrompts);

      if (segChanged) {
        // Segmentation changed — reprocess all dimensions from Segment
        const notify: Notify = (id, update) => store.updateConversation(id, update);
        const ctx = buildBaseContext(conv);
        Object.assign(ctx, convPrompts);
        // Copy source dimensions into ctx so they carry the new prompts
        if (source.dimensions) {
          const dims = ctx.dimensions || {};
          for (const [dimName, sourceDim] of Object.entries(source.dimensions)) {
            dims[dimName] = {
              ...(dims[dimName] || { name: dimName, components: [], componentMapping: {}, componentTimeline: [], componentColors: {} }),
              prompt: sourceDim.prompt,
              customColoringPrompt: sourceDim.customColoringPrompt,
              customComponents: sourceDim.customComponents,
            };
          }
          ctx.dimensions = dims;
        }
        await runPipelineFrom(PipelineStep.Segment, ctx, notify, {
          onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
        });
        return;
      }

      // No segmentation change — diff per-dimension and reprocess only what changed
      if (!source.dimensions) return;

      const notify: Notify = (id, update) => store.updateConversation(id, update);
      const ctx = buildBaseContext(conv);
      const dims = ctx.dimensions || {};

      // Track which dims need reprocessing at which step
      const identifyDims: string[] = [];
      const colorDims: string[] = [];

      for (const [dimName, sourceDim] of Object.entries(source.dimensions)) {
        const targetDim = dims[dimName];

        // Copy source dimension prompts/components into target
        dims[dimName] = {
          ...(targetDim || { name: dimName, components: [], componentMapping: {}, componentTimeline: [], componentColors: {} }),
          prompt: sourceDim.prompt,
          customColoringPrompt: sourceDim.customColoringPrompt,
          customComponents: sourceDim.customComponents,
        };

        if (sourceDim.prompt !== targetDim?.prompt ||
            JSON.stringify(sourceDim.customComponents) !== JSON.stringify(targetDim?.customComponents)) {
          identifyDims.push(dimName);
        } else if (sourceDim.customColoringPrompt !== targetDim?.customColoringPrompt) {
          colorDims.push(dimName);
        }
      }

      ctx.dimensions = dims;

      // Copy component lists as presets for dims being reprocessed
      for (const dimName of identifyDims) {
        const sourceDim = source.dimensions![dimName];
        if (!sourceDim) continue;
        if (sourceDim.components?.length) {
          dims[dimName]!.customComponents = sourceDim.components;
        }
      }

      // Run identify+classify+color for dims with prompt changes
      if (identifyDims.length > 0) {
        await runPipelineFrom(PipelineStep.Identify, ctx, notify, {
          onAnalysisChunk: (id, chunk) => store.appendAnalysisChunk(id, chunk),
        }, identifyDims);
      }

      // Run color-only for dims with only coloring prompt changes
      if (colorDims.length > 0) {
        await runPipelineFrom(PipelineStep.Color, ctx, notify, undefined, colorDims);
      }
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
