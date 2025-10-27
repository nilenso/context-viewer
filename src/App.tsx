import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { parserRegistry } from "./parser";
import "./parsers";
import type { Conversation } from "./schema";
import {
  summarizeConversation,
  type ConversationSummary,
} from "./conversation-summary";
import { addTokenCounts } from "./add-token-counts";
import { segmentConversation } from "./segmentation";
import {
  componentiseConversation,
  assignComponentColors,
  getComponentisationConfig,
  type ComponentTimelineSnapshot
} from "./componentisation";
import { generateConversationSummary, generateContextAnalysis } from "./ai-summary";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import { AISummary } from "./components/AISummary";
import { Card } from "./components/ui/card";
import { Clock, Loader2, AlertCircle, Upload } from "lucide-react";
import { cn } from "./lib/utils";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`;

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep = "parsing" | "counting-tokens" | "segmenting" | "finding-components" | "coloring" | "analysis";

/**
 * Represents workflow state for processing a conversation file.
 * Used both for React state management (persisting UI state) and during workflow execution (tracking progress).
 *
 * React uses: status, step, error, conversation, components, etc.
 * Workflow uses: file, config, customPrompt, plus all data fields
 */
interface WorkflowState {
  // Identity
  id: string;
  filename: string;

  // UI/Workflow lifecycle (used by React)
  status?: ConversationStatus;
  step?: ProcessingStep;
  error?: string;

  // Execution inputs (used during workflow execution)
  file?: File;
  config?: any;
  customPrompt?: string;

  // Core data
  conversation?: Conversation;
  summary?: ConversationSummary;
  aiSummary?: string;
  analysis?: string;

  // Component data
  components?: string[];
  componentMapping?: Record<string, string>;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;

  // Tracking
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;
}

interface WorkflowBatchResult {
  workflowStates: WorkflowState[];
}

// ============================================================================
// Workflow Abstractions
// ============================================================================

/**
 * Event types that trigger workflow execution
 */
enum WorkflowEvent {
  NewFile = 'new-file',
  ComponentPromptChanged = 'component-prompt-changed'
}

/**
 * Callbacks for streaming updates
 */
interface WorkflowCallbacks {
  onSummaryChunk?: (id: string, chunk: string) => void;
  onAnalysisChunk?: (id: string, chunk: string) => void;
}

/**
 * Generic activity signature: takes readonly context, returns typed result
 */
type Activity<TResult> = (ctx: Readonly<WorkflowState>) => Promise<TResult>;

// ============================================================================
// Activity Definitions
// ============================================================================

/**
 * Parse activity: Parse file into conversation and generate summary
 */
const parseActivity: Activity<{
  conversation: Conversation;
  summary: ConversationSummary;
}> = async (ctx) => {
  const text = await ctx.file!.text();
  const data = JSON.parse(text);
  const conversation = parserRegistry.parse(data);
  const summary = summarizeConversation(conversation);
  return { conversation, summary };
};

/**
 * Token counting activity: Add token counts to conversation
 */
const countTokensActivity: Activity<{
  conversation: Conversation;
}> = async (ctx) => {
  const conversation = await addTokenCounts(ctx.conversation!);
  return { conversation };
};

/**
 * Segmentation activity: Segment large parts in conversation
 */
const segmentActivity: Activity<{
  conversation: Conversation;
  error?: string;
}> = async (ctx) => {
  const result = await segmentConversation(ctx.conversation!);
  const conversation = await addTokenCounts(result.conversation);
  return {
    conversation,
    error: result.error
  };
};

/**
 * Component identification activity: Identify components in conversation
 */
const findComponentsActivity: Activity<{
  components: string[];
  mapping: Record<string, string>;
  timeline: ComponentTimelineSnapshot[];
  error?: string;
}> = async (ctx) => {
  const result = await componentiseConversation(
    ctx.conversation!,
    undefined,
    ctx.customPrompt
  );

  return {
    components: result.components,
    mapping: result.mapping,
    timeline: result.timeline,
    error: result.error
  };
};

/**
 * Color assignment activity: Assign colors to components
 */
const assignColorsActivity: Activity<{
  colors: Record<string, string>;
}> = async (ctx) => {
  if (!ctx.config || !ctx.components?.length) {
    return { colors: {} };
  }

  const colors = await assignComponentColors(ctx.components, ctx.config);
  return { colors };
};

/**
 * Factory: Create summary generation activity with streaming callback
 */
const createSummaryActivity = (
  onChunk?: (id: string, chunk: string) => void
): Activity<{ summary: string; error?: string }> => {
  return async (ctx) => {
    const result = await generateConversationSummary(
      ctx.conversation!,
      (chunk) => onChunk?.(ctx.id, chunk)
    );

    return {
      summary: result.summary,
      error: result.error
    };
  };
};

/**
 * Factory: Create analysis generation activity with streaming callback
 */
const createAnalysisActivity = (
  onChunk?: (id: string, chunk: string) => void
): Activity<{ analysis: string; error?: string }> => {
  return async (ctx) => {
    if (!ctx.aiSummary || !ctx.components?.length || !ctx.componentTimeline?.length) {
      return { analysis: '' };
    }

    const result = await generateContextAnalysis(
      ctx.conversation!,
      ctx.componentTimeline!,
      ctx.components,
      ctx.aiSummary,
      (chunk) => onChunk?.(ctx.id, chunk)
    );

    return {
      analysis: result.analysis,
      error: result.error
    };
  };
};

// ============================================================================
// Workflow Runner
// ============================================================================

/**
 * WorkflowRunner: Manages state updates and timing for workflow execution
 */
class WorkflowRunner {
  constructor(
    private setState: (id: string, update: Partial<WorkflowState>) => void
  ) {}

  /**
   * Run an activity with timing tracking (pure helper, doesn't update state)
   */
  async runActivity<T>(
    ctx: Readonly<WorkflowState>,
    activity: Activity<T>
  ): Promise<{ result: T; timing: number }> {
    const start = Date.now();
    const result = await activity(ctx);
    const timing = Math.round((Date.now() - start) / 1000);

    return { result, timing };
  }

  /**
   * Update state to mark a step as starting
   */
  startStep(ctx: WorkflowState, step: ProcessingStep) {
    this.setState(ctx.id, {
      status: 'processing',
      step,
      conversation: ctx.conversation,
      summary: ctx.summary,
      componentMapping: ctx.componentMapping,
      componentTimeline: ctx.componentTimeline,
      componentColors: ctx.componentColors,
      components: ctx.components,
      analysis: ctx.analysis,
      aiSummary: ctx.aiSummary,
      warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings
    });
  }

  /**
   * Update state with current context (intermediate update, keeps status as 'success')
   */
  updateState(ctx: WorkflowState, nextStep?: ProcessingStep) {
    this.setState(ctx.id, {
      conversation: ctx.conversation,
      summary: ctx.summary,
      aiSummary: ctx.aiSummary,
      components: ctx.components,
      componentMapping: ctx.componentMapping,
      componentTimeline: ctx.componentTimeline,
      componentColors: ctx.componentColors,
      analysis: ctx.analysis,
      warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: 'success',
      step: nextStep
    });
  }

  /**
   * Mark workflow as complete
   */
  markComplete(ctx: WorkflowState) {
    this.setState(ctx.id, {
      conversation: ctx.conversation,
      summary: ctx.summary,
      aiSummary: ctx.aiSummary,
      components: ctx.components,
      componentMapping: ctx.componentMapping,
      componentTimeline: ctx.componentTimeline,
      componentColors: ctx.componentColors,
      analysis: ctx.analysis,
      warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: 'success',
      step: undefined
    });
  }

  /**
   * Mark workflow as failed
   */
  markFailed(id: string, error: string) {
    this.setState(id, { status: 'failed', step: undefined, error });
  }
}

// ============================================================================
// Main Workflow
// ============================================================================

/**
 * Process conversation workflow: Single linear workflow with conditional step skipping
 */
async function processConversationWorkflow(
  event: WorkflowEvent,
  ctx: WorkflowState,
  runner: WorkflowRunner,
  callbacks: WorkflowCallbacks
): Promise<void> {

  try {
    // Step 1: Parse (only for new files)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, 'parsing');
      const { result, timing } = await runner.runActivity(ctx, parseActivity);
      ctx.conversation = result.conversation;
      ctx.summary = result.summary;
      ctx.stepTimings!.parsing = timing;
      runner.updateState(ctx, 'counting-tokens');
    }

    // Step 2: Count tokens (only for new files)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, 'counting-tokens');
      const { result, timing } = await runner.runActivity(ctx, countTokensActivity);
      ctx.conversation = result.conversation;
      ctx.stepTimings!['counting-tokens'] = timing;
      runner.updateState(ctx, 'segmenting');
    }

    // Step 3: Segment + Summary in parallel (only for new files)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, 'segmenting');
      const { result: segmentResult, timing: segmentTiming } =
        await runner.runActivity(ctx, segmentActivity);

      ctx.conversation = segmentResult.conversation;
      if (segmentResult.error) ctx.warnings!.push(segmentResult.error);
      ctx.stepTimings!.segmenting = segmentTiming;

      // Generate AI summary in parallel with next steps (fire and forget)
      createSummaryActivity(callbacks.onSummaryChunk)(ctx).then(summaryResult => {
        ctx.aiSummary = summaryResult.summary;
        if (summaryResult.error) ctx.warnings!.push(summaryResult.error);
      });

      runner.updateState(ctx, 'finding-components');
    }

    // Step 4: Find components (always run)
    runner.startStep(ctx, 'finding-components');
    const { result: componentResult, timing: componentTiming } =
      await runner.runActivity(ctx, findComponentsActivity);
    ctx.components = componentResult.components;
    ctx.componentMapping = componentResult.mapping;
    ctx.componentTimeline = componentResult.timeline;
    if (componentResult.error) ctx.warnings!.push(componentResult.error);
    ctx.stepTimings!['finding-components'] = componentTiming;
    runner.updateState(ctx, 'coloring');

    // Step 5: Assign colors (always run)
    runner.startStep(ctx, 'coloring');
    const { result: colorResult, timing: colorTiming } =
      await runner.runActivity(ctx, assignColorsActivity);
    ctx.componentColors = colorResult.colors;
    ctx.stepTimings!.coloring = colorTiming;
    runner.updateState(ctx, 'analysis');

    // Step 6: Generate analysis (always run)
    // Clear old analysis if reprocessing
    if (event === WorkflowEvent.ComponentPromptChanged) {
      ctx.analysis = '';
      runner.updateState(ctx, 'analysis');
    }

    runner.startStep(ctx, 'analysis');
    const { result: analysisResult, timing: analysisTiming } =
      await runner.runActivity(
        ctx,
        createAnalysisActivity(callbacks.onAnalysisChunk)
      );
    ctx.analysis = analysisResult.analysis;
    if (analysisResult.error) ctx.warnings!.push(analysisResult.error);
    ctx.stepTimings!.analysis = analysisTiming;
    runner.markComplete(ctx);

  } catch (error: any) {
    runner.markFailed(ctx.id, error.message);
  }
}

// ============================================================================
// Batch workflow orchestration
// ============================================================================

async function runWorkflows(
  files: File[],
  fileIds: Map<number, string>,
  onStepUpdate?: (id: string, step: ProcessingStep) => void,
  onFileComplete?: (conversation: WorkflowState) => void,
  onAISummaryChunk?: (id: string, chunk: string) => void,
  onAnalysisChunk?: (id: string, chunk: string) => void
): Promise<WorkflowBatchResult> {
  // Give React a chance to render the placeholders before we start processing
  await new Promise(resolve => setTimeout(resolve, 0));

  // Process all files in parallel
  const workflowStates = await Promise.all(
    files.map(async (file, i) => {
      if (!file) return null;

      const id = fileIds.get(i) || generateId();

      // Create workflow runner for this file
      const runner = new WorkflowRunner((id, update) => {
        onFileComplete?.({ id, filename: file.name, ...update } as WorkflowState);
      });

      // Initialize workflow context
      const ctx: WorkflowState = {
        id,
        filename: file.name,
        file,
        conversation: null as any, // Will be set by parse activity
        warnings: [],
        stepTimings: {},
        config: getComponentisationConfig()
      };

      // Run workflow with NewFile event
      await processConversationWorkflow(
        WorkflowEvent.NewFile,
        ctx,
        runner,
        {
          onSummaryChunk: onAISummaryChunk,
          onAnalysisChunk: onAnalysisChunk
        }
      );

      // Return final parsed conversation
      return {
        id,
        filename: file.name,
        status: ctx.conversation ? 'success' : 'failed',
        conversation: ctx.conversation,
        summary: ctx.summary,
        aiSummary: ctx.aiSummary,
        components: ctx.components,
        componentMapping: ctx.componentMapping,
        componentTimeline: ctx.componentTimeline,
        componentColors: ctx.componentColors,
        analysis: ctx.analysis,
        warnings: ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
        stepTimings: ctx.stepTimings
      } as WorkflowState;
    })
  );

  // Filter out any null values from skipped files
  return { workflowStates: workflowStates.filter((c): c is WorkflowState => c !== null) };
}

export default function App() {
  const [conversations, setConversations] = useState<
    WorkflowState[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [insightsTab, setInsightsTab] = useState<string>("summary");
  const fileIdsRef = useRef<Map<number, string>>(new Map());

  const workflowMutation = useMutation({
    mutationFn: (files: File[]) => {
      return runWorkflows(
        files,
        fileIdsRef.current,
        (id, step) => {
          // Update step
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, status: "processing" as const, step }
                : conv
            )
          );
        },
        (completed) => {
          // Update the conversation in place as each file completes
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === completed.id ? completed : conv
            )
          );
        },
        (id, chunk) => {
          // Update AI summary as chunks arrive (streaming)
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, aiSummary: (conv.aiSummary || "") + chunk }
                : conv
            )
          );
        },
        (id, chunk) => {
          // Update analysis as chunks arrive (streaming)
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, analysis: (conv.analysis || "") + chunk }
                : conv
            )
          );
        }
      );
    },
    onMutate: (files: File[]) => {
      // Create placeholder entries immediately
      const fileIds = new Map<number, string>();
      const placeholders: WorkflowState[] = files.map((file, index) => {
        const id = generateId();
        fileIds.set(index, id);
        return {
          id,
          filename: file.name,
          status: "pending",
        };
      });

      fileIdsRef.current = fileIds;
      setConversations((prev) => [...prev, ...placeholders]);

      // Auto-select first file if nothing selected
      if (!selectedId && placeholders[0]) {
        setSelectedId(placeholders[0].id);
      }
    },
    onSuccess: () => {
      fileIdsRef.current = new Map();
    },
    onError: () => {
      fileIdsRef.current = new Map();
    },
  });

  const selectedConversation = useMemo(() => {
    if (conversations.length === 0) return undefined;
    return (
      conversations.find((conv) => conv.id === selectedId) ??
      conversations[0]
    );
  }, [conversations, selectedId]);

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedId(null);
      return;
    }

    const [firstConversation] = conversations;
    if (!firstConversation) {
      setSelectedId(null);
      return;
    }

    if (!selectedId) {
      setSelectedId(firstConversation.id);
      return;
    }

    if (!conversations.some((conv) => conv.id === selectedId)) {
      setSelectedId(firstConversation.id);
    }
  }, [conversations, selectedId]);

  // Switch to analysis tab when analysis starts streaming
  useEffect(() => {
    if (selectedConversation?.status === "processing" &&
        selectedConversation.step === "analysis") {
      setInsightsTab("analysis");
    }
  }, [selectedConversation?.status, selectedConversation?.step]);

  // Debug: Expose current conversation to window for console exploration
  useEffect(() => {
    if (import.meta.env.DEV && selectedConversation?.conversation) {
      (window as any).__debug = {
        conversation: selectedConversation.conversation,
        summary: selectedConversation.summary,
        msg: (index: number) => selectedConversation.conversation!.messages[index],
        part: (msgIndex: number, partIndex: number) =>
          selectedConversation.conversation!.messages[msgIndex]?.parts[partIndex],
      };
    }
  }, [selectedConversation]);

  // Reprocess components with a custom prompt using workflow
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const handleReprocessComponents = async (customPrompt: string) => {
    if (!selectedConversation?.conversation) return;

    const id = selectedConversation.id;
    setReprocessingId(id);

    try {
      // Create workflow runner
      const runner = new WorkflowRunner((id, update) => {
        setConversations(prev =>
          prev.map(conv => conv.id === id ? { ...conv, ...update } : conv)
        );
      });

      // Initialize workflow context from existing conversation
      // Preserve existing component data until new ones are generated
      const ctx: WorkflowState = {
        id,
        filename: selectedConversation.filename,
        conversation: selectedConversation.conversation,
        summary: selectedConversation.summary,
        aiSummary: selectedConversation.aiSummary,
        components: selectedConversation.components,
        componentMapping: selectedConversation.componentMapping,
        componentTimeline: selectedConversation.componentTimeline,
        componentColors: selectedConversation.componentColors,
        analysis: selectedConversation.analysis,
        customPrompt,
        config: getComponentisationConfig(),
        warnings: [],
        stepTimings: { ...selectedConversation.stepTimings }
      };

      // Run workflow with ComponentPromptChanged event
      await processConversationWorkflow(
        WorkflowEvent.ComponentPromptChanged,
        ctx,
        runner,
        {
          onAnalysisChunk: (id, chunk) => {
            setConversations(prev =>
              prev.map(conv =>
                conv.id === id
                  ? { ...conv, analysis: (conv.analysis || '') + chunk }
                  : conv
              )
            );
          }
        }
      );
    } catch (error) {
      console.error("Failed to reprocess components:", error);
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === id
            ? { ...conv, status: "failed", step: undefined, error: "Reprocessing failed" }
            : conv
        )
      );
    } finally {
      setReprocessingId(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files: File[]) => workflowMutation.mutate(files),
    accept: {
      "text/plain": [".txt"],
      "application/json": [".json"],
    },
    multiple: true,
    noClick: conversations.length > 0, // Only enable click when empty
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header Banner */}
      <header className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 px-6 py-4 mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2 text-slate-700">
          <img
            src="/nilenso-logo.svg"
            alt="Nilenso"
            className="h-5 w-auto"
          />
          <span className="font-normal text-slate-400">/</span>
          <span>context-viewer</span>
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload conversation logs to analyze their structure and token usage
        </p>
      </header>

      <div className="space-y-6 px-6">
        {conversations.length === 0 ? (
          /* Empty State - Full Page Drop Zone */
          <div
            {...getRootProps()}
            className={cn(
              "min-h-[calc(100vh-12rem)] border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors",
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/50"
            )}
          >
            <input {...getInputProps()} />
            <div className="text-center p-12">
              <Upload className="h-20 w-20 mx-auto mb-6 text-muted-foreground/50" />
              <h2 className="text-2xl font-semibold text-muted-foreground mb-3">
                {isDragActive ? "Drop files here" : "Drop conversation files here"}
              </h2>
              <p className="text-muted-foreground mb-2">
                or click to browse
              </p>
              <p className="text-sm text-muted-foreground">
                Accepts .json and .txt files
              </p>
            </div>
          </div>
        ) : (
          /* Main Content */
          <div className="grid grid-cols-[260px_minmax(500px,1fr)_minmax(420px,30%)] gap-6">
          {/* Sidebar: Conversation List */}
          <aside className="space-y-4">
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onFilesSelected={(files) => workflowMutation.mutate(files)}
            />
          </aside>

          {/* Main Panel: Conversation View */}
          <main>
            {selectedConversation ? (
              selectedConversation.conversation ? (
                // Show conversation as soon as it's available (even if still processing tokens/summary)
                <ConversationView
                  conversation={selectedConversation.conversation}
                  componentMapping={selectedConversation.componentMapping}
                  componentTimeline={selectedConversation.componentTimeline}
                  componentColors={selectedConversation.componentColors}
                  components={selectedConversation.components}
                  warnings={selectedConversation.warnings}
                  onReprocessComponents={handleReprocessComponents}
                  isReprocessing={reprocessingId === selectedConversation.id}
                />
              ) : selectedConversation.status === "pending" ? (
                <Card className="p-12 text-center">
                  <Clock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                    Waiting to process
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedConversation.filename} will be processed soon
                  </p>
                </Card>
              ) : selectedConversation.status === "processing" ? (
                <Card className="p-12 text-center">
                  <Loader2 className="h-12 w-12 mx-auto mb-4 text-blue-600 animate-spin" />
                  <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                    Processing...
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedConversation.filename}
                  </p>
                </Card>
              ) : selectedConversation.status === "failed" ? (
                <Card className="p-12 text-center border-red-200 bg-red-50">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-600" />
                  <h2 className="text-xl font-semibold text-red-900 mb-2">
                    Failed to parse
                  </h2>
                  <p className="text-sm text-red-800 mb-4">
                    {selectedConversation.filename}
                  </p>
                  <p className="text-sm text-red-700 font-mono bg-red-100 p-4 rounded">
                    {selectedConversation.error || "Unknown error"}
                  </p>
                </Card>
              ) : null
            ) : (
              <Card className="p-12 text-center">
                <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                  No conversation selected
                </h2>
                <p className="text-sm text-muted-foreground">
                  Upload files to see their parsed conversations
                </p>
              </Card>
            )}
          </main>

          {/* Right Sidebar: AI Summary & Analysis */}
          <aside>
            {selectedConversation && (
              <AISummary
                summary={selectedConversation.aiSummary}
                analysis={selectedConversation.analysis}
                isSummaryStreaming={
                  selectedConversation.status === "processing" &&
                  selectedConversation.step !== "analysis" &&
                  !!selectedConversation.conversation &&
                  !selectedConversation.componentColors
                }
                isAnalysisStreaming={
                  selectedConversation.status === "processing" &&
                  selectedConversation.step === "analysis"
                }
                activeTab={insightsTab}
                onTabChange={setInsightsTab}
              />
            )}
          </aside>
        </div>
        )}
      </div>
    </div>
  );
}
