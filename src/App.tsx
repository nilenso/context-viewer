import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { parserRegistry, type ConversationMetadata } from "./parser";
import "./parsers";
import type { Conversation, SourceInfo, Message } from "./schema";
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
  buildComponentTimeline,
  type ComponentTimelineSnapshot,
} from "./componentisation";
import { staticComponentise } from "./static-componentisation";
import {
  generateConversationSummary,
  generateContextAnalysis,
  type ConversationStats,
} from "./ai-summary";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import type { ConversationComponentData } from "./components/ComponentComparisonView";
import { AISummary } from "./components/AISummary";
import { Card } from "./components/ui/card";
import { PromptEditorDialog } from "./components/PromptEditorDialog";
import { Clock, Loader2, Upload, AlertCircle } from "lucide-react";
import { cn } from "./lib/utils";
import {
  getDefaultComponentIdentificationPrompt,
  getDefaultSegmentationPrompt,
  getDefaultSummaryPrompt,
  getDefaultAnalysisPrompt,
} from "./prompts";
import {
  createConversationLogger,
  markStepStart,
  markStepEnd,
  type ProcessingPhase,
} from "./workflow-logger";
import {
  loadPresetIndex,
  loadPreset,
  type PresetConfig,
  type PresetSummary,
} from "./lib/preset-loader";
import { PresetSelector } from "./components/PresetSelector";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}`;

type ConversationStatus = "pending" | "processing" | "success" | "failed";
type ProcessingStep =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summary"
  | "finding-components"
  | "coloring"
  | "analysis";

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
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  customComponents?: string[];
  regenerateAnalysis?: boolean;
  presetColors?: Record<string, string>;

  // Core data
  conversation?: Conversation;
  summary?: ConversationSummary;
  metadata?: ConversationMetadata;
  aiSummary?: string;
  analysis?: string;

  // Component data (automatic - AI-based)
  components?: string[];
  componentMapping?: Record<string, string>;
  componentTimeline?: ComponentTimelineSnapshot[];
  componentColors?: Record<string, string>;

  // Static component data (deterministic - role.partType)
  staticComponents?: string[];
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];

  // Tracking
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;

  // Grouped conversation data
  isGrouped?: boolean;
  sourceConversations?: Array<{ id: string; filename: string }>;
  messageSourceMap?: Record<string, SourceInfo>; // messageId -> source info
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
  NewFile = "new-file",
  ComponentPromptChanged = "component-prompt-changed",
  SegmentationPromptChanged = "segmentation-prompt-changed",
  SummaryPromptChanged = "summary-prompt-changed",
  GroupedConversation = "grouped-conversation",
  GenerateAnalysis = "generate-analysis",
  GenerateSummary = "generate-summary",
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
 * Parse file content - handles JSON, JSONL, and plain text formats
 */
const parseFileContent = (text: string, filename: string): unknown => {
  // Check if it's a plain text file (not JSON/JSONL)
  if (filename.endsWith(".txt")) {
    // Return raw text - PlainTextParser will handle it
    return text;
  }

  // Check if it's a JSONL file (by extension or content)
  const isJsonl =
    filename.endsWith(".jsonl") ||
    (text.trim().startsWith("{") && text.includes("\n{"));

  if (isJsonl) {
    // Parse JSONL: split by newlines and parse each line
    const lines = text.trim().split("\n");
    return lines
      .filter((line) => line.trim()) // Skip empty lines
      .map((line) => JSON.parse(line));
  }

  // Regular JSON
  return JSON.parse(text);
};

/**
 * Parse activity: Parse file into conversation and generate summary
 */
const parseActivity: Activity<{
  conversation: Conversation;
  summary: ConversationSummary;
  metadata: ConversationMetadata;
}> = async (ctx) => {
  const text = await ctx.file!.text();
  const data = parseFileContent(text, ctx.file!.name);
  const { conversation, metadata } = parserRegistry.parseWithMetadata(data);
  const summary = summarizeConversation(conversation);
  return { conversation, summary, metadata };
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
 * Static componentisation activity: Deterministic component identification
 * based on role.partType (e.g., "user.text", "assistant.tool-call")
 */
const staticComponentsActivity: Activity<{
  staticComponents: string[];
  staticMapping: Record<string, string>;
  staticTimeline: ComponentTimelineSnapshot[];
}> = async (ctx) => {
  const result = staticComponentise(ctx.conversation!);
  return {
    staticComponents: result.components,
    staticMapping: result.mapping,
    staticTimeline: result.timeline,
  };
};

/**
 * Segmentation activity: Segment large parts in conversation
 */
const segmentActivity: Activity<{
  conversation: Conversation;
  error?: string;
}> = async (ctx) => {
  const result = await segmentConversation(
    ctx.conversation!,
    undefined,
    ctx.customSegmentationPrompt,
    ctx.id, // Pass conversationId for logging
  );
  const conversation = await addTokenCounts(result.conversation);
  return {
    conversation,
    error: result.error,
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
    ctx.customPrompt,
    ctx.customComponents,
    ctx.id, // Pass conversationId for logging
  );

  return {
    components: result.components,
    mapping: result.mapping,
    timeline: result.timeline,
    error: result.error,
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

  const colors = await assignComponentColors(
    ctx.components,
    ctx.config,
    ctx.id,
    ctx.presetColors,
  );
  return { colors };
};

/**
 * Calculate conversation stats for the summary prompt
 */
function calculateConversationStats(conversation: {
  messages: Array<{ role: string; timestamp?: string }>;
}): ConversationStats {
  const messages = conversation.messages;
  const messageCount = messages.length;
  const turnCount = messages.filter((m) => m.role === "user").length;

  let durationMs: number | undefined;
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;

  for (const message of messages) {
    if (message.timestamp) {
      const ts = new Date(message.timestamp);
      if (!isNaN(ts.getTime())) {
        if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
        if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
      }
    }
  }

  if (firstTimestamp && lastTimestamp) {
    durationMs = lastTimestamp.getTime() - firstTimestamp.getTime();
  }

  return { messageCount, turnCount, durationMs };
}

/**
 * Factory: Create summary generation activity with streaming callback
 */
const createSummaryActivity = (
  onChunk?: (id: string, chunk: string) => void,
): Activity<{ summary: string; error?: string }> => {
  return async (ctx) => {
    const stats = calculateConversationStats(ctx.conversation!);
    const result = await generateConversationSummary(
      ctx.conversation!,
      (chunk) => onChunk?.(ctx.id, chunk),
      ctx.customSummaryPrompt,
      ctx.metadata,
      stats,
      ctx.id, // Pass conversationId for logging
    );

    return {
      summary: result.summary,
      error: result.error,
    };
  };
};

/**
 * Factory: Create analysis generation activity with streaming callback
 */
const createAnalysisActivity = (
  onChunk?: (id: string, chunk: string) => void,
): Activity<{ analysis: string; error?: string }> => {
  return async (ctx) => {
    if (
      !ctx.aiSummary ||
      !ctx.components?.length ||
      !ctx.componentTimeline?.length
    ) {
      return { analysis: "" };
    }

    const result = await generateContextAnalysis(
      ctx.conversation!,
      ctx.componentTimeline!,
      ctx.components,
      ctx.aiSummary,
      (chunk) => onChunk?.(ctx.id, chunk),
      ctx.customAnalysisPrompt,
      ctx.id, // Pass conversationId for logging
    );

    return {
      analysis: result.analysis,
      error: result.error,
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
    private setState: (id: string, update: Partial<WorkflowState>) => void,
  ) {}

  /**
   * Run an activity with timing tracking and logging
   */
  async runActivity<T>(
    ctx: Readonly<WorkflowState>,
    activity: Activity<T>,
    step?: ProcessingStep,
  ): Promise<{ result: T; timing: number }> {
    const start = Date.now();
    const result = await activity(ctx);
    const timing = Math.round((Date.now() - start) / 1000);

    // Mark step end in the logging system if step is provided
    if (step) {
      markStepEnd(ctx.id, step as ProcessingPhase);
    }

    return { result, timing };
  }

  /**
   * Update state to mark a step as starting
   */
  startStep(ctx: WorkflowState, step: ProcessingStep) {
    // Mark step start in the logging system
    markStepStart(ctx.id, step as ProcessingPhase);

    this.setState(ctx.id, {
      status: "processing",
      step,
      conversation: ctx.conversation,
      summary: ctx.summary,
      metadata: ctx.metadata,
      customSummaryPrompt: ctx.customSummaryPrompt,
      componentMapping: ctx.componentMapping,
      componentTimeline: ctx.componentTimeline,
      componentColors: ctx.componentColors,
      components: ctx.components,
      staticComponents: ctx.staticComponents,
      staticMapping: ctx.staticMapping,
      staticTimeline: ctx.staticTimeline,
      analysis: ctx.analysis,
      aiSummary: ctx.aiSummary,
      warnings:
        ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
    });
  }

  /**
   * Update state with current context (intermediate update, keeps status as 'success')
   */
  updateState(ctx: WorkflowState, nextStep?: ProcessingStep) {
    this.setState(ctx.id, {
      conversation: ctx.conversation,
      summary: ctx.summary,
      metadata: ctx.metadata,
      aiSummary: ctx.aiSummary,
      customSummaryPrompt: ctx.customSummaryPrompt,
      components: ctx.components,
      componentMapping: ctx.componentMapping,
      componentTimeline: ctx.componentTimeline,
      componentColors: ctx.componentColors,
      staticComponents: ctx.staticComponents,
      staticMapping: ctx.staticMapping,
      staticTimeline: ctx.staticTimeline,
      analysis: ctx.analysis,
      warnings:
        ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: "success",
      step: nextStep,
    });
  }

  /**
   * Mark workflow as complete
   */
  markComplete(ctx: WorkflowState) {
    this.setState(ctx.id, {
      conversation: ctx.conversation,
      summary: ctx.summary,
      metadata: ctx.metadata,
      aiSummary: ctx.aiSummary,
      customSummaryPrompt: ctx.customSummaryPrompt,
      components: ctx.components,
      componentMapping: ctx.componentMapping,
      componentTimeline: ctx.componentTimeline,
      componentColors: ctx.componentColors,
      staticComponents: ctx.staticComponents,
      staticMapping: ctx.staticMapping,
      staticTimeline: ctx.staticTimeline,
      analysis: ctx.analysis,
      warnings:
        ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
      stepTimings: ctx.stepTimings,
      status: "success",
      step: undefined,
    });
  }

  /**
   * Mark workflow as failed
   */
  markFailed(id: string, error: string) {
    this.setState(id, { status: "failed", step: undefined, error });
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
  callbacks: WorkflowCallbacks,
): Promise<void> {
  try {
    if (event === WorkflowEvent.SummaryPromptChanged) {
      ctx.aiSummary = "";
      runner.startStep(ctx, "summary");
      const { result: summaryResult, timing: summaryTiming } =
        await runner.runActivity(
          ctx,
          createSummaryActivity(callbacks.onSummaryChunk),
          "summary",
        );
      ctx.aiSummary = summaryResult.summary;
      if (summaryResult.error) ctx.warnings!.push(summaryResult.error);
      ctx.stepTimings!.summary = summaryTiming;

      if (ctx.regenerateAnalysis) {
        ctx.analysis = "";
        runner.startStep(ctx, "analysis");
        const { result: analysisResult, timing: analysisTiming } =
          await runner.runActivity(
            ctx,
            createAnalysisActivity(callbacks.onAnalysisChunk),
            "analysis",
          );
        ctx.analysis = analysisResult.analysis;
        if (analysisResult.error) ctx.warnings!.push(analysisResult.error);
        ctx.stepTimings!.analysis = analysisTiming;
      }

      runner.markComplete(ctx);
      return;
    }

    // Step 1: Parse (only for new files)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, "parsing");
      const { result, timing } = await runner.runActivity(
        ctx,
        parseActivity,
        "parsing",
      );
      ctx.conversation = result.conversation;
      ctx.summary = result.summary;
      ctx.metadata = result.metadata;
      ctx.stepTimings!.parsing = timing;
      runner.updateState(ctx, "counting-tokens");
    }

    // Step 2: Count tokens (only for new files - skip for grouped, they already have token counts)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, "counting-tokens");
      const { result, timing } = await runner.runActivity(
        ctx,
        countTokensActivity,
        "counting-tokens",
      );
      ctx.conversation = result.conversation;
      ctx.stepTimings!["counting-tokens"] = timing;

      // Run static componentisation immediately after token counting (instant, no AI)
      const staticResult = await runner.runActivity(
        ctx,
        staticComponentsActivity,
      );
      ctx.staticComponents = staticResult.result.staticComponents;
      ctx.staticMapping = staticResult.result.staticMapping;
      ctx.staticTimeline = staticResult.result.staticTimeline;

      runner.updateState(ctx, "segmenting");
    }

    // Step 3: Segment (only for new files - skip for grouped)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, "segmenting");
      const { result: segmentResult, timing: segmentTiming } =
        await runner.runActivity(ctx, segmentActivity, "segmenting");

      ctx.conversation = segmentResult.conversation;
      if (segmentResult.error) ctx.warnings!.push(segmentResult.error);
      ctx.stepTimings!.segmenting = segmentTiming;

      runner.updateState(ctx, "finding-components");
    }

    // For grouped conversations, skip segmenting, finding-components, and coloring
    // The merged component data is already in ctx from handleGroupConversations
    // Mark complete without running summary/analysis (user can trigger manually)
    if (event === WorkflowEvent.GroupedConversation) {
      runner.markComplete(ctx);
      return;
    }

    // Generate summary on demand
    if (event === WorkflowEvent.GenerateSummary) {
      runner.startStep(ctx, "summary");
      const { result: summaryResult, timing: summaryTiming } =
        await runner.runActivity(
          ctx,
          createSummaryActivity(callbacks.onSummaryChunk),
          "summary",
        );
      ctx.aiSummary = summaryResult.summary;
      if (summaryResult.error) ctx.warnings!.push(summaryResult.error);
      ctx.stepTimings!.summary = summaryTiming;
      runner.markComplete(ctx);
      return;
    }

    // For segmentation prompt changed, start from segmenting step
    if (event === WorkflowEvent.SegmentationPromptChanged) {
      runner.startStep(ctx, "segmenting");
      const { result: segmentResult, timing: segmentTiming } =
        await runner.runActivity(ctx, segmentActivity, "segmenting");

      ctx.conversation = segmentResult.conversation;
      if (segmentResult.error) ctx.warnings!.push(segmentResult.error);
      ctx.stepTimings!.segmenting = segmentTiming;

      runner.updateState(ctx, "finding-components");
    }

    // Step 4: Find components (skip for grouped conversations and analysis-only)
    if (
      event !== WorkflowEvent.GroupedConversation &&
      event !== WorkflowEvent.GenerateAnalysis
    ) {
      runner.startStep(ctx, "finding-components");
      const { result: componentResult, timing: componentTiming } =
        await runner.runActivity(
          ctx,
          findComponentsActivity,
          "finding-components",
        );
      ctx.components = componentResult.components;
      ctx.componentMapping = componentResult.mapping;
      ctx.componentTimeline = componentResult.timeline;
      if (componentResult.error) ctx.warnings!.push(componentResult.error);
      ctx.stepTimings!["finding-components"] = componentTiming;
      runner.updateState(ctx, "coloring");

      // Step 5: Assign colors (skip for grouped conversations - colors already merged)
      runner.startStep(ctx, "coloring");
      const { result: colorResult, timing: colorTiming } =
        await runner.runActivity(ctx, assignColorsActivity, "coloring");
      ctx.componentColors = colorResult.colors;
      ctx.stepTimings!.coloring = colorTiming;

      // For new files, mark complete without analysis (user can trigger it manually)
      if (event === WorkflowEvent.NewFile) {
        runner.markComplete(ctx);
        return;
      }

      runner.updateState(ctx, "analysis");
    }

    // Step 6: Generate analysis (only for explicit analysis generation or reprocessing)
    // Run for: GenerateAnalysis, ComponentPromptChanged, SegmentationPromptChanged
    if (
      event === WorkflowEvent.GenerateAnalysis ||
      event === WorkflowEvent.ComponentPromptChanged ||
      event === WorkflowEvent.SegmentationPromptChanged
    ) {
      // Clear old analysis if reprocessing
      if (
        event === WorkflowEvent.ComponentPromptChanged ||
        event === WorkflowEvent.SegmentationPromptChanged
      ) {
        ctx.analysis = "";
        runner.updateState(ctx, "analysis");
      }

      runner.startStep(ctx, "analysis");
      const { result: analysisResult, timing: analysisTiming } =
        await runner.runActivity(
          ctx,
          createAnalysisActivity(callbacks.onAnalysisChunk),
          "analysis",
        );
      ctx.analysis = analysisResult.analysis;
      if (analysisResult.error) ctx.warnings!.push(analysisResult.error);
      ctx.stepTimings!.analysis = analysisTiming;
    }

    runner.markComplete(ctx);
  } catch (error: any) {
    runner.markFailed(ctx.id, error.message);
  }
}

// ============================================================================
// Batch workflow orchestration
// ============================================================================

interface WorkflowOptions {
  customComponents?: string[];
  presetColors?: Record<string, string>;
  customPrompt?: string;
}

async function runWorkflows(
  files: File[],
  fileIds: Map<number, string>,
  onStepUpdate?: (id: string, step: ProcessingStep) => void,
  onFileComplete?: (conversation: WorkflowState) => void,
  onAISummaryChunk?: (id: string, chunk: string) => void,
  onAnalysisChunk?: (id: string, chunk: string) => void,
  options?: WorkflowOptions,
): Promise<WorkflowBatchResult> {
  // Give React a chance to render the placeholders before we start processing
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Process all files in parallel
  const workflowStates = await Promise.all(
    files.map(async (file, i) => {
      if (!file) return null;

      const id = fileIds.get(i) || generateId();

      // Create workflow runner for this file
      const runner = new WorkflowRunner((id, update) => {
        onFileComplete?.({
          id,
          filename: file.name,
          ...update,
        } as WorkflowState);
      });

      // Initialize workflow context
      const ctx: WorkflowState = {
        id,
        filename: file.name,
        file,
        conversation: null as any, // Will be set by parse activity
        warnings: [],
        stepTimings: {},
        config: getComponentisationConfig(),
        customComponents: options?.customComponents,
        presetColors: options?.presetColors,
        customPrompt: options?.customPrompt,
      };

      // Run workflow with NewFile event
      await processConversationWorkflow(WorkflowEvent.NewFile, ctx, runner, {
        onSummaryChunk: onAISummaryChunk,
        onAnalysisChunk: onAnalysisChunk,
      });

      // Return final parsed conversation
      return {
        id,
        filename: file.name,
        status: ctx.conversation ? "success" : "failed",
        conversation: ctx.conversation,
        summary: ctx.summary,
        metadata: ctx.metadata,
        aiSummary: ctx.aiSummary,
        components: ctx.components,
        componentMapping: ctx.componentMapping,
        componentTimeline: ctx.componentTimeline,
        componentColors: ctx.componentColors,
        staticComponents: ctx.staticComponents,
        staticMapping: ctx.staticMapping,
        staticTimeline: ctx.staticTimeline,
        analysis: ctx.analysis,
        warnings:
          ctx.warnings && ctx.warnings.length > 0 ? ctx.warnings : undefined,
        stepTimings: ctx.stepTimings,
      } as WorkflowState;
    }),
  );

  // Filter out any null values from skipped files
  return {
    workflowStates: workflowStates.filter(
      (c): c is WorkflowState => c !== null,
    ),
  };
}

export default function App() {
  const [conversations, setConversations] = useState<WorkflowState[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [insightsTab, setInsightsTab] = useState<string>("summary");

  // Sidebar collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Insights panel collapse state
  const [isInsightsPanelCollapsed, setIsInsightsPanelCollapsed] =
    useState(false);

  // Prompt editor dialog state
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(
    getDefaultComponentIdentificationPrompt(),
  );

  // Components editor dialog state
  const [isComponentsDialogOpen, setIsComponentsDialogOpen] = useState(false);
  const [editingComponents, setEditingComponents] = useState("");

  // Segmentation prompt editor dialog state
  const [isSegmentationPromptDialogOpen, setIsSegmentationPromptDialogOpen] =
    useState(false);
  const [editingSegmentationPrompt, setEditingSegmentationPrompt] = useState(
    getDefaultSegmentationPrompt(),
  );

  // Summary prompt editor dialog state
  const [isSummaryPromptDialogOpen, setIsSummaryPromptDialogOpen] =
    useState(false);
  const [editingSummaryPrompt, setEditingSummaryPrompt] = useState(
    getDefaultSummaryPrompt(),
  );

  // Analysis prompt editor dialog state
  const [isAnalysisPromptDialogOpen, setIsAnalysisPromptDialogOpen] =
    useState(false);
  const [editingAnalysisPrompt, setEditingAnalysisPrompt] = useState(
    getDefaultAnalysisPrompt(),
  );

  // Preset state
  const [availablePresets, setAvailablePresets] = useState<PresetSummary[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [loadedPreset, setLoadedPreset] = useState<PresetConfig | null>(null);
  const [isPresetLoading, setIsPresetLoading] = useState(false);

  const fileIdsRef = useRef<Map<number, string>>(new Map());

  // Load preset index on mount
  useEffect(() => {
    loadPresetIndex().then(setAvailablePresets);
  }, []);

  // Load full preset when selection changes
  useEffect(() => {
    if (selectedPresetId) {
      setIsPresetLoading(true);
      loadPreset(selectedPresetId).then((preset) => {
        setLoadedPreset(preset);
        setIsPresetLoading(false);
      });
    } else {
      setLoadedPreset(null);
    }
  }, [selectedPresetId]);

  const workflowMutation = useMutation({
    mutationFn: (files: File[]) => {
      // Build options from loaded preset
      const options: WorkflowOptions | undefined = loadedPreset
        ? {
            customComponents: loadedPreset.components,
            presetColors: loadedPreset.colors,
            customPrompt: loadedPreset.componentIdentificationPrompt,
          }
        : undefined;

      return runWorkflows(
        files,
        fileIdsRef.current,
        (id, step) => {
          // Update step
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, status: "processing" as const, step }
                : conv,
            ),
          );
        },
        (completed) => {
          // Update the conversation in place as each file completes
          // Preserve aiSummary and analysis if they're being streamed in parallel
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === completed.id
                ? {
                    ...completed,
                    aiSummary: completed.aiSummary || conv.aiSummary,
                    analysis: completed.analysis || conv.analysis,
                  }
                : conv,
            ),
          );
        },
        (id, chunk) => {
          // Update AI summary as chunks arrive (streaming)
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, aiSummary: (conv.aiSummary || "") + chunk }
                : conv,
            ),
          );
        },
        (id, chunk) => {
          // Update analysis as chunks arrive (streaming)
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, analysis: (conv.analysis || "") + chunk }
                : conv,
            ),
          );
        },
        options,
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
      conversations.find((conv) => conv.id === selectedId) ?? conversations[0]
    );
  }, [conversations, selectedId]);

  // Build source conversation component data for grouped conversation comparison view
  const sourceConversationComponents = useMemo(():
    | ConversationComponentData[]
    | undefined => {
    if (
      !selectedConversation?.isGrouped ||
      !selectedConversation.sourceConversations
    ) {
      return undefined;
    }

    return selectedConversation.sourceConversations
      .map((source) => {
        const conv = conversations.find((c) => c.id === source.id);
        if (!conv?.conversation || !conv.componentMapping) {
          return null;
        }

        // Calculate component tokens for this conversation
        const componentTokens: Record<string, number> = {};
        let totalTokens = 0;
        let turnCount = 0;
        let firstTimestamp: Date | undefined;
        let lastTimestamp: Date | undefined;
        const messageComponents: string[] = [];

        for (const message of conv.conversation.messages) {
          // Count user messages as turns
          if (message.role === "user") {
            turnCount++;
          }

          // Track timestamps for duration calculation
          if (message.timestamp) {
            const ts = new Date(message.timestamp);
            if (!isNaN(ts.getTime())) {
              if (!firstTimestamp || ts < firstTimestamp) {
                firstTimestamp = ts;
              }
              if (!lastTimestamp || ts > lastTimestamp) {
                lastTimestamp = ts;
              }
            }
          }

          // Get the primary component for this message (from first part with a component)
          let messageComponent = "other";
          for (const part of message.parts) {
            const component = conv.componentMapping[part.id];
            const tokenCount = ("token_count" in part && part.token_count) || 0;
            totalTokens += tokenCount;

            if (component) {
              componentTokens[component] =
                (componentTokens[component] || 0) + tokenCount;
              // Use the first component found as the message's component
              if (messageComponent === "other") {
                messageComponent = component;
              }
            } else {
              componentTokens["other"] =
                (componentTokens["other"] || 0) + tokenCount;
            }
          }
          messageComponents.push(messageComponent);
        }

        // Calculate duration if we have both timestamps
        const durationMs =
          firstTimestamp && lastTimestamp
            ? lastTimestamp.getTime() - firstTimestamp.getTime()
            : undefined;

        return {
          id: source.id,
          filename: source.filename,
          componentTokens,
          totalTokens,
          turnCount,
          messageCount: conv.conversation.messages.length,
          durationMs,
          messageComponents,
        };
      })
      .filter((data): data is ConversationComponentData => data !== null);
  }, [selectedConversation, conversations]);

  // Build source workflow states for filtered comparison view
  const sourceWorkflowStates = useMemo(() => {
    if (
      !selectedConversation?.isGrouped ||
      !selectedConversation.sourceConversations
    ) {
      return undefined;
    }

    return selectedConversation.sourceConversations
      .map((source) => {
        const conv = conversations.find((c) => c.id === source.id);
        if (!conv?.conversation || !conv.componentMapping) {
          return null;
        }
        return {
          id: source.id,
          filename: source.filename,
          conversation: conv.conversation,
          componentMapping: conv.componentMapping,
        };
      })
      .filter((state): state is NonNullable<typeof state> => state !== null);
  }, [selectedConversation, conversations]);

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
    if (
      selectedConversation?.status === "processing" &&
      selectedConversation.step === "analysis"
    ) {
      setInsightsTab("analysis");
    }
  }, [selectedConversation?.status, selectedConversation?.step]);

  // Debug: Expose current conversation to window for console exploration
  useEffect(() => {
    if (import.meta.env.DEV && selectedConversation?.conversation) {
      // Build conversation with component embedded in each part
      const conversationWithComponents = {
        ...selectedConversation.conversation,
        messages: selectedConversation.conversation.messages.map((msg) => ({
          ...msg,
          parts: msg.parts.map((part) => ({
            ...part,
            component: selectedConversation.componentMapping?.[part.id],
          })),
        })),
      };

      (window as any).__debug = {
        conversation: conversationWithComponents,
        summary: selectedConversation.summary,
        msg: (index: number) => conversationWithComponents.messages[index],
        part: (msgIndex: number, partIndex: number) =>
          conversationWithComponents.messages[msgIndex]?.parts[partIndex],
        // Component comparison data (same data used for waffle charts)
        componentComparison: sourceConversationComponents,
        // Component colors mapping
        componentColors: selectedConversation.componentColors,
      };
    }
  }, [selectedConversation, sourceConversationComponents]);

  // Reprocess components with a custom prompt using workflow
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  // Handle opening the prompt editor
  const handleOpenPromptEditor = () => {
    // Get the prompt: conversation custom > preset > default
    const currentPrompt =
      selectedConversation?.customPrompt ||
      loadedPreset?.componentIdentificationPrompt ||
      getDefaultComponentIdentificationPrompt();
    setEditingPrompt(currentPrompt);
    setIsPromptDialogOpen(true);
  };

  // Handle applying the edited prompt
  const handleApplyPrompt = async () => {
    setIsPromptDialogOpen(false);
    if (selectedConversation && selectedConversation.conversation) {
      await handleReprocessComponents({ customPrompt: editingPrompt });
    }
  };

  // Handle opening the components editor
  const handleOpenComponentsEditor = () => {
    // Get the components from the selected conversation if it exists
    const currentComponents = selectedConversation?.components || [];
    setEditingComponents(currentComponents.join("\n"));
    setIsComponentsDialogOpen(true);
  };

  // Handle applying the edited components
  const handleApplyComponents = async () => {
    setIsComponentsDialogOpen(false);
    if (selectedConversation && selectedConversation.conversation) {
      // Parse components from the text (one per line, trimmed, non-empty)
      const components = editingComponents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (components.length > 0) {
        await handleReprocessComponents({ customComponents: components });
      }
    }
  };

  // Handle opening the segmentation prompt editor
  const handleOpenSegmentationPromptEditor = () => {
    // Get the prompt from the selected conversation if it exists, otherwise use default
    const currentPrompt =
      selectedConversation?.customSegmentationPrompt ||
      getDefaultSegmentationPrompt();
    setEditingSegmentationPrompt(currentPrompt);
    setIsSegmentationPromptDialogOpen(true);
  };

  // Handle applying the edited segmentation prompt
  const handleApplySegmentationPrompt = async () => {
    setIsSegmentationPromptDialogOpen(false);
    if (selectedConversation && selectedConversation.conversation) {
      await handleReprocessSegmentation({
        customSegmentationPrompt: editingSegmentationPrompt,
      });
    }
  };

  // Handle opening the summary prompt editor
  const handleOpenSummaryPromptEditor = () => {
    // Get the prompt from the selected conversation if it exists, otherwise use default
    const currentPrompt =
      selectedConversation?.customSummaryPrompt || getDefaultSummaryPrompt();
    setEditingSummaryPrompt(currentPrompt);
    setIsSummaryPromptDialogOpen(true);
  };

  // Handle applying the edited summary prompt
  const handleApplySummaryPrompt = async () => {
    setIsSummaryPromptDialogOpen(false);
    if (selectedConversation && selectedConversation.conversation) {
      await handleReprocessSummary({
        customSummaryPrompt: editingSummaryPrompt,
      });
    }
  };

  // Handle opening the analysis prompt editor
  const handleOpenAnalysisPromptEditor = () => {
    const currentPrompt =
      selectedConversation?.customAnalysisPrompt || getDefaultAnalysisPrompt();
    setEditingAnalysisPrompt(currentPrompt);
    setIsAnalysisPromptDialogOpen(true);
  };

  // Handle applying the edited analysis prompt
  const handleApplyAnalysisPrompt = async () => {
    setIsAnalysisPromptDialogOpen(false);
    if (selectedConversation && selectedConversation.conversation) {
      await handleGenerateAnalysis(selectedConversation.id, {
        customAnalysisPrompt: editingAnalysisPrompt,
      });
    }
  };

  // Sidebar toggle handlers
  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  // Insights panel toggle handler
  const handleToggleInsightsPanel = () => {
    setIsInsightsPanelCollapsed((prev) => !prev);
  };

  // Helper: Build base context from selected conversation
  const buildBaseContext = (conv: WorkflowState): WorkflowState => ({
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
    staticComponents: conv.staticComponents,
    staticMapping: conv.staticMapping,
    staticTimeline: conv.staticTimeline,
    customSummaryPrompt: conv.customSummaryPrompt,
    customSegmentationPrompt: conv.customSegmentationPrompt,
    customAnalysisPrompt: conv.customAnalysisPrompt,
    customPrompt: conv.customPrompt,
    config: conv.config || getComponentisationConfig(),
    warnings: [],
    stepTimings: { ...conv.stepTimings },
  });

  // Helper: Standard analysis chunk callback
  const onAnalysisChunk = (id: string, chunk: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === id
          ? { ...conv, analysis: (conv.analysis || "") + chunk }
          : conv,
      ),
    );
  };

  // Helper: Standard summary chunk callback
  const onSummaryChunk = (id: string, chunk: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === id
          ? { ...conv, aiSummary: (conv.aiSummary || "") + chunk }
          : conv,
      ),
    );
  };

  // Factory: Create a reprocess handler
  const createReprocessHandler = <T extends Record<string, unknown>>(
    event: WorkflowEvent,
    contextModifier: (ctx: WorkflowState, options: T) => void,
    callbacks: WorkflowCallbacks,
    errorMessage: string,
  ) => {
    return async (options: T = {} as T) => {
      if (!selectedConversation?.conversation) return;

      const id = selectedConversation.id;
      setReprocessingId(id);

      try {
        const runner = new WorkflowRunner((id, update) => {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id ? { ...conv, ...update } : conv,
            ),
          );
        });

        const ctx = buildBaseContext(selectedConversation);
        contextModifier(ctx, options);

        await processConversationWorkflow(event, ctx, runner, callbacks);
      } catch (error) {
        console.error(`Failed to reprocess: ${errorMessage}`, error);
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === id
              ? {
                  ...conv,
                  status: "failed",
                  step: undefined,
                  error: errorMessage,
                }
              : conv,
          ),
        );
      } finally {
        setReprocessingId(null);
      }
    };
  };

  // Reprocess handlers using the factory
  const handleReprocessComponents = createReprocessHandler<{
    customPrompt?: string;
    customComponents?: string[];
  }>(
    WorkflowEvent.ComponentPromptChanged,
    (ctx, options) => {
      ctx.customPrompt = options.customPrompt;
      ctx.customComponents = options.customComponents;
    },
    { onAnalysisChunk },
    "Component reprocessing failed",
  );

  const handleReprocessSegmentation = createReprocessHandler<{
    customSegmentationPrompt?: string;
  }>(
    WorkflowEvent.SegmentationPromptChanged,
    (ctx, options) => {
      ctx.customSegmentationPrompt = options.customSegmentationPrompt;
    },
    { onAnalysisChunk },
    "Segmentation reprocessing failed",
  );

  // Summary handler has special logic for regenerating analysis
  const handleReprocessSummary = async (
    options: { customSummaryPrompt?: string } = {},
  ) => {
    if (!selectedConversation?.conversation) return;

    const id = selectedConversation.id;
    const shouldRegenerateAnalysis =
      !!selectedConversation.analysis ||
      selectedConversation.stepTimings?.analysis !== undefined;

    setReprocessingId(id);

    try {
      const runner = new WorkflowRunner((id, update) => {
        setConversations((prev) =>
          prev.map((conv) => (conv.id === id ? { ...conv, ...update } : conv)),
        );
      });

      const ctx = buildBaseContext(selectedConversation);
      ctx.aiSummary = "";
      ctx.analysis = shouldRegenerateAnalysis ? "" : ctx.analysis;
      ctx.customSummaryPrompt = options.customSummaryPrompt;
      ctx.regenerateAnalysis = shouldRegenerateAnalysis;
      ctx.stepTimings = {
        ...ctx.stepTimings,
        summary: undefined,
        ...(shouldRegenerateAnalysis ? { analysis: undefined } : {}),
      };

      await processConversationWorkflow(
        WorkflowEvent.SummaryPromptChanged,
        ctx,
        runner,
        {
          onSummaryChunk,
          onAnalysisChunk: shouldRegenerateAnalysis
            ? onAnalysisChunk
            : undefined,
        },
      );
    } catch (error) {
      console.error("Failed to reprocess summary:", error);
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === id
            ? {
                ...conv,
                status: "failed",
                step: undefined,
                error: "Summary reprocessing failed",
              }
            : conv,
        ),
      );
    } finally {
      setReprocessingId(null);
    }
  };

  // Generate analysis on demand (analysis is optional and not run automatically)
  const handleGenerateAnalysis = async (
    id: string,
    options: { customAnalysisPrompt?: string } = {},
  ) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv?.conversation) return;

    setReprocessingId(id);

    try {
      // Create workflow runner
      const runner = new WorkflowRunner((id, update) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...update } : c)),
        );
      });

      // Initialize workflow context from existing conversation
      const ctx: WorkflowState = {
        id,
        filename: conv.filename,
        conversation: conv.conversation,
        summary: conv.summary,
        metadata: conv.metadata,
        aiSummary: conv.aiSummary,
        components: conv.components,
        componentMapping: conv.componentMapping,
        componentTimeline: conv.componentTimeline,
        componentColors: conv.componentColors,
        staticMapping: conv.staticMapping,
        staticTimeline: conv.staticTimeline,
        staticComponents: conv.staticComponents,
        analysis: "", // Clear existing analysis
        customSummaryPrompt: conv.customSummaryPrompt,
        customAnalysisPrompt:
          options.customAnalysisPrompt || conv.customAnalysisPrompt,
        config: conv.config || getComponentisationConfig(),
        warnings: conv.warnings || [],
        stepTimings: { ...conv.stepTimings },
        isGrouped: conv.isGrouped,
        sourceConversations: conv.sourceConversations,
        messageSourceMap: conv.messageSourceMap,
      };

      // Run workflow with GenerateAnalysis event
      await processConversationWorkflow(
        WorkflowEvent.GenerateAnalysis,
        ctx,
        runner,
        {
          onAnalysisChunk: (id, chunk) => {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id
                  ? { ...c, analysis: (c.analysis || "") + chunk }
                  : c,
              ),
            );
          },
        },
      );
    } catch (error) {
      console.error("Failed to generate analysis:", error);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "failed",
                step: undefined,
                error: "Analysis generation failed",
              }
            : c,
        ),
      );
    } finally {
      setReprocessingId(null);
    }
  };

  // Generate summary on demand (summary is optional and not run automatically)
  const handleGenerateSummary = async (
    id: string,
    options: { customSummaryPrompt?: string } = {},
  ) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv?.conversation) return;

    setReprocessingId(id);

    try {
      // Create workflow runner
      const runner = new WorkflowRunner((id, update) => {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...update } : c)),
        );
      });

      // Initialize workflow context from existing conversation
      const ctx: WorkflowState = {
        id,
        filename: conv.filename,
        conversation: conv.conversation,
        summary: conv.summary,
        metadata: conv.metadata,
        aiSummary: "", // Clear existing summary
        components: conv.components,
        componentMapping: conv.componentMapping,
        componentTimeline: conv.componentTimeline,
        componentColors: conv.componentColors,
        staticMapping: conv.staticMapping,
        staticTimeline: conv.staticTimeline,
        staticComponents: conv.staticComponents,
        analysis: conv.analysis,
        customSummaryPrompt:
          options.customSummaryPrompt || conv.customSummaryPrompt,
        customAnalysisPrompt: conv.customAnalysisPrompt,
        config: conv.config || getComponentisationConfig(),
        warnings: conv.warnings || [],
        stepTimings: { ...conv.stepTimings },
        isGrouped: conv.isGrouped,
        sourceConversations: conv.sourceConversations,
        messageSourceMap: conv.messageSourceMap,
      };

      // Run workflow with GenerateSummary event
      await processConversationWorkflow(
        WorkflowEvent.GenerateSummary,
        ctx,
        runner,
        {
          onSummaryChunk: (id, chunk) => {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id
                  ? { ...c, aiSummary: (c.aiSummary || "") + chunk }
                  : c,
              ),
            );
          },
        },
      );
    } catch (error) {
      console.error("Failed to generate summary:", error);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "failed",
                step: undefined,
                error: "Summary generation failed",
              }
            : c,
        ),
      );
    } finally {
      setReprocessingId(null);
    }
  };

  // Handle multi-selection toggle
  const handleToggleSelection = (id: string, isSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isSelected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  // Clear multi-selection
  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Select all conversations
  const handleSelectAll = (ids: string[]) => {
    setSelectedIds(new Set(ids));
  };

  // Create a grouped conversation from selected conversations
  const handleGroupConversations = async () => {
    if (selectedIds.size < 2) return;

    // Get the selected conversations (only fully processed ones)
    const selectedConvs = conversations.filter(
      (conv) =>
        selectedIds.has(conv.id) &&
        conv.conversation &&
        conv.status === "success",
    );

    if (selectedConvs.length < 2) return;

    // Generate new ID for grouped conversation
    const groupId = generateId();

    // Create concatenated conversation with source info tracking
    // We need to generate new unique IDs to avoid collisions between files
    const messageSourceMap: Record<string, SourceInfo> = {};
    const allMessages: Message[] = [];

    for (const conv of selectedConvs) {
      if (!conv.conversation) continue;
      for (const msg of conv.conversation.messages) {
        // Generate new unique ID for this message to avoid collisions
        const newMsgId = `${conv.id}-${msg.id}`;

        // Create new parts with unique IDs
        const newParts = msg.parts.map((part) => {
          const newPartId = `${conv.id}-${part.id}`;
          // Track source info for this part
          messageSourceMap[newPartId] = {
            conversationId: conv.id,
            filename: conv.filename,
          };
          return { ...part, id: newPartId };
        });

        // Track source info for this message
        messageSourceMap[newMsgId] = {
          conversationId: conv.id,
          filename: conv.filename,
        };

        // Create new message with new ID and new parts
        const newMsg = { ...msg, id: newMsgId, parts: newParts } as Message;
        allMessages.push(newMsg);
      }
    }

    const groupedConversation: Conversation = {
      messages: allMessages,
    };

    // Merge component data from all selected conversations
    // Components: unique set of all components
    const mergedComponentsSet = new Set<string>();
    const mergedComponentMapping: Record<string, string> = {};
    const mergedComponentColors: Record<string, string> = {};

    // Static components
    const mergedStaticComponentsSet = new Set<string>();
    const mergedStaticMapping: Record<string, string> = {};

    for (const conv of selectedConvs) {
      // Merge AI components
      if (conv.components) {
        conv.components.forEach((c) => mergedComponentsSet.add(c));
      }
      if (conv.componentMapping) {
        // Remap part IDs to new prefixed IDs
        for (const [partId, component] of Object.entries(
          conv.componentMapping,
        )) {
          const newPartId = `${conv.id}-${partId}`;
          mergedComponentMapping[newPartId] = component;
        }
      }
      if (conv.componentColors) {
        Object.assign(mergedComponentColors, conv.componentColors);
      }

      // Merge static components
      if (conv.staticComponents) {
        conv.staticComponents.forEach((c) => mergedStaticComponentsSet.add(c));
      }
      if (conv.staticMapping) {
        // Remap part IDs to new prefixed IDs
        for (const [partId, component] of Object.entries(conv.staticMapping)) {
          const newPartId = `${conv.id}-${partId}`;
          mergedStaticMapping[newPartId] = component;
        }
      }
    }

    const mergedComponents = Array.from(mergedComponentsSet);
    const mergedStaticComponents = Array.from(mergedStaticComponentsSet);

    // Rebuild timelines from merged data
    const mergedComponentTimeline = buildComponentTimeline(
      groupedConversation,
      mergedComponentMapping,
    );
    const mergedStaticTimeline = buildComponentTimeline(
      groupedConversation,
      mergedStaticMapping,
    );

    // Create source conversations list
    const sourceConversations = selectedConvs.map((conv) => ({
      id: conv.id,
      filename: conv.filename,
    }));

    // Create grouped name
    const groupedFilename = `Grouped: ${sourceConversations.map((s) => s.filename).join(", ")}`;

    // Create placeholder with merged component data
    const placeholder: WorkflowState = {
      id: groupId,
      filename: groupedFilename,
      status: "pending",
      isGrouped: true,
      sourceConversations,
      messageSourceMap,
      // Include merged component data
      components: mergedComponents,
      componentMapping: mergedComponentMapping,
      componentTimeline: mergedComponentTimeline,
      componentColors: mergedComponentColors,
      staticComponents: mergedStaticComponents,
      staticMapping: mergedStaticMapping,
      staticTimeline: mergedStaticTimeline,
    };

    // Add placeholder immediately
    setConversations((prev) => [...prev, placeholder]);
    setSelectedId(groupId);
    handleClearSelection();

    // Create workflow runner
    const runner = new WorkflowRunner((id, update) => {
      setConversations((prev) =>
        prev.map((conv) => (conv.id === id ? { ...conv, ...update } : conv)),
      );
    });

    // Initialize workflow context with merged component data
    const ctx: WorkflowState = {
      id: groupId,
      filename: groupedFilename,
      conversation: groupedConversation,
      summary: summarizeConversation(groupedConversation),
      isGrouped: true,
      sourceConversations,
      messageSourceMap,
      warnings: [],
      stepTimings: {},
      config: getComponentisationConfig(),
      // Include merged component data - workflow will skip finding-components step
      components: mergedComponents,
      componentMapping: mergedComponentMapping,
      componentTimeline: mergedComponentTimeline,
      componentColors: mergedComponentColors,
      staticComponents: mergedStaticComponents,
      staticMapping: mergedStaticMapping,
      staticTimeline: mergedStaticTimeline,
    };

    // Run workflow with GroupedConversation event
    await processConversationWorkflow(
      WorkflowEvent.GroupedConversation,
      ctx,
      runner,
      {
        onSummaryChunk: (id, chunk) => {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, aiSummary: (conv.aiSummary || "") + chunk }
                : conv,
            ),
          );
        },
        onAnalysisChunk: (id, chunk) => {
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, analysis: (conv.analysis || "") + chunk }
                : conv,
            ),
          );
        },
      },
    );
  };

  // Handle ungrouping a grouped conversation
  const handleUngroupConversation = (id: string) => {
    // Remove the grouped conversation from the list
    setConversations((prev) => prev.filter((conv) => conv.id !== id));
    // Clear selection if the ungrouped conversation was selected
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  // Handle deleting a conversation (only if not part of any grouped conversation)
  const handleDeleteConversation = (id: string) => {
    // Check if this conversation is part of any grouped conversation
    const isPartOfGroup = conversations.some(
      (conv) =>
        conv.isGrouped && conv.sourceConversations?.some((s) => s.id === id),
    );

    if (isPartOfGroup) {
      console.warn(
        "Cannot delete conversation that is part of a grouped conversation",
      );
      return;
    }

    // Remove the conversation from the list
    setConversations((prev) => prev.filter((conv) => conv.id !== id));
    // Also remove from fileIdsRef
    fileIdsRef.current = fileIdsRef.current.filter((fid) => fid !== id);
    // Clear selection if the deleted conversation was selected
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files: File[]) => workflowMutation.mutate(files),
    validator: (file) => {
      const acceptedExtensions = [".json", ".jsonl", ".txt"];
      const ext = file.name
        ? "." + (file.name.split(".").pop()?.toLowerCase() || "")
        : "";
      if (!acceptedExtensions.includes(ext)) {
        return {
          code: "file-invalid-type",
          message: `File type not supported. Accepted: ${acceptedExtensions.join(", ")}`,
        };
      }
      return null;
    },
    multiple: true,
    noClick: conversations.length > 0, // Only enable click when empty
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header Banner */}
      <header className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 px-6 py-4 mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2 text-slate-700">
          <img src="/nilenso-logo.svg" alt="Nilenso" className="h-5 w-auto" />
          <span className="font-normal text-slate-400">/</span>
          <span>context-viewer</span>
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload conversation logs to analyze their structure and token usage
        </p>
      </header>

      <div className="space-y-6 px-6">
        {conversations.length === 0 ? (
          /* Empty State - Preset Selector + Full Page Drop Zone */
          <div className="flex flex-col">
            {/* Preset Selector */}
            <PresetSelector
              presets={availablePresets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              isLoading={isPresetLoading}
            />

            {/* Drop Zone */}
            <div
              {...getRootProps()}
              className={cn(
                "min-h-[calc(100vh-18rem)] border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors",
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-accent/50",
              )}
            >
              <input {...getInputProps()} />
              <div className="text-center p-12">
                <Upload className="h-20 w-20 mx-auto mb-6 text-muted-foreground/50" />
                <h2 className="text-2xl font-semibold text-muted-foreground mb-3">
                  {isDragActive
                    ? "Drop files here"
                    : "Drop conversation files here"}
                </h2>
                <p className="text-muted-foreground mb-2">or click to browse</p>
                <p className="text-sm text-muted-foreground">
                  Accepts .json, .jsonl, and .txt files
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Main Content */
          <div
            className={cn(
              "grid gap-6 transition-all duration-300",
              // Grid columns based on sidebar and insights panel collapse state
              isSidebarCollapsed && isInsightsPanelCollapsed
                ? "grid-cols-[48px_1fr_48px]"
                : isSidebarCollapsed && !isInsightsPanelCollapsed
                  ? "grid-cols-[48px_minmax(600px,1fr)_minmax(480px,32%)]"
                  : !isSidebarCollapsed && isInsightsPanelCollapsed
                    ? "grid-cols-[260px_1fr_48px]"
                    : "grid-cols-[260px_minmax(500px,1fr)_minmax(420px,30%)]",
            )}
          >
            {/* Sidebar: Conversation List */}
            <aside className="relative">
              <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
                selectedIds={selectedIds}
                onToggleSelection={handleToggleSelection}
                onGroupConversations={handleGroupConversations}
                onClearSelection={handleClearSelection}
                onSelectAll={handleSelectAll}
                onUngroupConversation={handleUngroupConversation}
                onDeleteConversation={handleDeleteConversation}
                onGenerateAnalysis={handleGenerateAnalysis}
                onFilesSelected={(files) => workflowMutation.mutate(files)}
                onEditPrompt={handleOpenPromptEditor}
                onEditComponents={handleOpenComponentsEditor}
                onEditSegmentationPrompt={handleOpenSegmentationPromptEditor}
                onEditSummaryPrompt={handleOpenSummaryPromptEditor}
                onEditAnalysisPrompt={handleOpenAnalysisPromptEditor}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={handleToggleSidebar}
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
                    staticMapping={selectedConversation.staticMapping}
                    staticTimeline={selectedConversation.staticTimeline}
                    warnings={selectedConversation.warnings}
                    onReprocessComponents={handleReprocessComponents}
                    isReprocessing={reprocessingId === selectedConversation.id}
                    messageSourceMap={selectedConversation.messageSourceMap}
                    isGrouped={selectedConversation.isGrouped}
                    sourceConversationComponents={sourceConversationComponents}
                    sourceWorkflowStates={sourceWorkflowStates}
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
              {selectedConversation ? (
                <AISummary
                  summary={selectedConversation.aiSummary}
                  analysis={selectedConversation.analysis}
                  isSummaryStreaming={
                    selectedConversation.status === "processing" &&
                    selectedConversation.step === "summary"
                  }
                  isAnalysisStreaming={
                    selectedConversation.status === "processing" &&
                    selectedConversation.step === "analysis"
                  }
                  activeTab={insightsTab}
                  onTabChange={setInsightsTab}
                  isCollapsed={isInsightsPanelCollapsed}
                  onToggleCollapse={handleToggleInsightsPanel}
                  metadata={selectedConversation.metadata}
                  conversation={selectedConversation.conversation}
                  onGenerateSummary={() =>
                    handleGenerateSummary(selectedConversation.id)
                  }
                  canGenerateSummary={
                    selectedConversation.status === "success" &&
                    !!selectedConversation.conversation &&
                    !selectedConversation.aiSummary
                  }
                  onGenerateAnalysis={() =>
                    handleGenerateAnalysis(selectedConversation.id)
                  }
                  canGenerateAnalysis={
                    selectedConversation.status === "success" &&
                    !!selectedConversation.components?.length &&
                    !selectedConversation.analysis
                  }
                />
              ) : (
                <AISummary
                  isCollapsed={isInsightsPanelCollapsed}
                  onToggleCollapse={handleToggleInsightsPanel}
                />
              )}
            </aside>
          </div>
        )}
      </div>

      {/* Prompt Editor Dialogs */}
      <PromptEditorDialog
        open={isPromptDialogOpen}
        onOpenChange={setIsPromptDialogOpen}
        title="Edit Component Identification Prompt"
        description="Customize the prompt used to identify components in the conversation. The AI will use this prompt to analyze the conversation and identify logical components."
        value={editingPrompt}
        onChange={setEditingPrompt}
        onApply={handleApplyPrompt}
        placeholder="Enter your componentisation prompt..."
        warningText="This will re-run componentisation, visualization, and analysis"
      />

      <PromptEditorDialog
        open={isComponentsDialogOpen}
        onOpenChange={setIsComponentsDialogOpen}
        title="Edit Components"
        description="Edit the list of components used for mapping. One component per line. These components will be used instead of AI-identified components."
        value={editingComponents}
        onChange={setEditingComponents}
        onApply={handleApplyComponents}
        placeholder="Enter components (one per line)..."
        warningText="This will re-run component mapping, visualization, and analysis (skipping component identification)"
      />

      <PromptEditorDialog
        open={isSegmentationPromptDialogOpen}
        onOpenChange={setIsSegmentationPromptDialogOpen}
        title="Edit Segmentation Prompt"
        description="Customize the prompt used to segment large text parts into smaller semantic chunks. The AI will use this prompt to identify where to split long content."
        value={editingSegmentationPrompt}
        onChange={setEditingSegmentationPrompt}
        onApply={handleApplySegmentationPrompt}
        placeholder="Enter your segmentation prompt..."
        warningText="This will re-run segmentation, componentisation, visualization, and analysis"
      />

      <PromptEditorDialog
        open={isSummaryPromptDialogOpen}
        onOpenChange={setIsSummaryPromptDialogOpen}
        title="Edit Summary Prompt"
        description="Customize the prompt used to generate the AI summary. The summary feeds into context analysis."
        value={editingSummaryPrompt}
        onChange={setEditingSummaryPrompt}
        onApply={handleApplySummaryPrompt}
        placeholder="Enter your summary prompt..."
        warningText="This will re-run the AI summary and any dependent analysis"
      />

      <PromptEditorDialog
        open={isAnalysisPromptDialogOpen}
        onOpenChange={setIsAnalysisPromptDialogOpen}
        title="Edit Analysis Prompt"
        description="Customize the prompt used to generate context analysis. The analysis identifies patterns, redundancy, and optimization opportunities."
        value={editingAnalysisPrompt}
        onChange={setEditingAnalysisPrompt}
        onApply={handleApplyAnalysisPrompt}
        placeholder="Enter your analysis prompt..."
        warningText="This will re-run the context analysis"
      />
    </div>
  );
}
