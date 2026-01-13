import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { parserRegistry } from "./parser";
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
  type ComponentTimelineSnapshot
} from "./componentisation";
import { staticComponentise } from "./static-componentisation";
import { generateConversationSummary, generateContextAnalysis } from "./ai-summary";
import { ConversationList } from "./components/ConversationList";
import { ConversationView } from "./components/ConversationView";
import type { ConversationComponentData } from "./components/ComponentComparisonView";
import { AISummary } from "./components/AISummary";
import { Card } from "./components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Textarea } from "./components/ui/textarea";
import { Button as UIButton } from "./components/ui/button";
import { Clock, Loader2, AlertCircle, Upload } from "lucide-react";
import { cn } from "./lib/utils";
import { getDefaultComponentIdentificationPrompt, getDefaultSegmentationPrompt } from "./prompts";

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
  customSegmentationPrompt?: string;
  customComponents?: string[];

  // Core data
  conversation?: Conversation;
  summary?: ConversationSummary;
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
  NewFile = 'new-file',
  ComponentPromptChanged = 'component-prompt-changed',
  SegmentationPromptChanged = 'segmentation-prompt-changed',
  GroupedConversation = 'grouped-conversation'
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
  if (filename.endsWith('.txt')) {
    // Return raw text - PlainTextParser will handle it
    return text;
  }

  // Check if it's a JSONL file (by extension or content)
  const isJsonl = filename.endsWith('.jsonl') ||
    (text.trim().startsWith('{') && text.includes('\n{'));

  if (isJsonl) {
    // Parse JSONL: split by newlines and parse each line
    const lines = text.trim().split('\n');
    return lines
      .filter(line => line.trim()) // Skip empty lines
      .map(line => JSON.parse(line));
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
}> = async (ctx) => {
  const text = await ctx.file!.text();
  const data = parseFileContent(text, ctx.file!.name);
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
  const result = await segmentConversation(ctx.conversation!, undefined, ctx.customSegmentationPrompt);
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
    ctx.customPrompt,
    ctx.customComponents
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
      staticComponents: ctx.staticComponents,
      staticMapping: ctx.staticMapping,
      staticTimeline: ctx.staticTimeline,
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
      staticComponents: ctx.staticComponents,
      staticMapping: ctx.staticMapping,
      staticTimeline: ctx.staticTimeline,
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
      staticComponents: ctx.staticComponents,
      staticMapping: ctx.staticMapping,
      staticTimeline: ctx.staticTimeline,
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

    // Step 2: Count tokens (only for new files - skip for grouped, they already have token counts)
    if (event === WorkflowEvent.NewFile) {
      runner.startStep(ctx, 'counting-tokens');
      const { result, timing } = await runner.runActivity(ctx, countTokensActivity);
      ctx.conversation = result.conversation;
      ctx.stepTimings!['counting-tokens'] = timing;

      // Run static componentisation immediately after token counting (instant, no AI)
      const staticResult = await runner.runActivity(ctx, staticComponentsActivity);
      ctx.staticComponents = staticResult.result.staticComponents;
      ctx.staticMapping = staticResult.result.staticMapping;
      ctx.staticTimeline = staticResult.result.staticTimeline;

      runner.updateState(ctx, 'segmenting');
    }

    // Step 3: Segment + Summary in parallel (only for new files - skip for grouped)
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

    // For grouped conversations, skip segmenting, finding-components, and coloring
    // The merged component data is already in ctx from handleGroupConversations
    // Just generate AI summary in parallel and go directly to analysis
    if (event === WorkflowEvent.GroupedConversation) {
      runner.updateState(ctx, 'analysis');
      // Generate AI summary in parallel with next steps (fire and forget)
      createSummaryActivity(callbacks.onSummaryChunk)(ctx).then(summaryResult => {
        ctx.aiSummary = summaryResult.summary;
        if (summaryResult.error) ctx.warnings!.push(summaryResult.error);
      });
    }

    // For segmentation prompt changed, start from segmenting step
    if (event === WorkflowEvent.SegmentationPromptChanged) {
      runner.startStep(ctx, 'segmenting');
      const { result: segmentResult, timing: segmentTiming } =
        await runner.runActivity(ctx, segmentActivity);

      ctx.conversation = segmentResult.conversation;
      if (segmentResult.error) ctx.warnings!.push(segmentResult.error);
      ctx.stepTimings!.segmenting = segmentTiming;

      runner.updateState(ctx, 'finding-components');
    }

    // Step 4: Find components (skip for grouped conversations - data already merged)
    if (event !== WorkflowEvent.GroupedConversation) {
      runner.startStep(ctx, 'finding-components');
      const { result: componentResult, timing: componentTiming } =
        await runner.runActivity(ctx, findComponentsActivity);
      ctx.components = componentResult.components;
      ctx.componentMapping = componentResult.mapping;
      ctx.componentTimeline = componentResult.timeline;
      if (componentResult.error) ctx.warnings!.push(componentResult.error);
      ctx.stepTimings!['finding-components'] = componentTiming;
      runner.updateState(ctx, 'coloring');

      // Step 5: Assign colors (skip for grouped conversations - colors already merged)
      runner.startStep(ctx, 'coloring');
      const { result: colorResult, timing: colorTiming } =
        await runner.runActivity(ctx, assignColorsActivity);
      ctx.componentColors = colorResult.colors;
      ctx.stepTimings!.coloring = colorTiming;
      runner.updateState(ctx, 'analysis');
    }

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
        staticComponents: ctx.staticComponents,
        staticMapping: ctx.staticMapping,
        staticTimeline: ctx.staticTimeline,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [insightsTab, setInsightsTab] = useState<string>("summary");

  // Sidebar collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarLocked, setIsSidebarLocked] = useState(false);

  // Insights panel collapse state
  const [isInsightsPanelCollapsed, setIsInsightsPanelCollapsed] = useState(false);

  // Prompt editor dialog state
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(getDefaultComponentIdentificationPrompt());

  // Components editor dialog state
  const [isComponentsDialogOpen, setIsComponentsDialogOpen] = useState(false);
  const [editingComponents, setEditingComponents] = useState("");

  // Segmentation prompt editor dialog state
  const [isSegmentationPromptDialogOpen, setIsSegmentationPromptDialogOpen] = useState(false);
  const [editingSegmentationPrompt, setEditingSegmentationPrompt] = useState(getDefaultSegmentationPrompt());

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

  // Build source conversation component data for grouped conversation comparison view
  const sourceConversationComponents = useMemo((): ConversationComponentData[] | undefined => {
    if (!selectedConversation?.isGrouped || !selectedConversation.sourceConversations) {
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

          for (const part of message.parts) {
            const component = conv.componentMapping[part.id];
            const tokenCount = ("token_count" in part && part.token_count) || 0;
            totalTokens += tokenCount;

            if (component) {
              componentTokens[component] = (componentTokens[component] || 0) + tokenCount;
            } else {
              componentTokens["other"] = (componentTokens["other"] || 0) + tokenCount;
            }
          }
        }

        // Calculate duration if we have both timestamps
        const durationMs = firstTimestamp && lastTimestamp
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
        };
      })
      .filter((data): data is ConversationComponentData => data !== null);
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

  // Handle opening the prompt editor
  const handleOpenPromptEditor = () => {
    // Get the prompt from the selected conversation if it exists, otherwise use default
    const currentPrompt = selectedConversation?.customPrompt || getDefaultComponentIdentificationPrompt();
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
        .map(line => line.trim())
        .filter(line => line.length > 0);
      if (components.length > 0) {
        await handleReprocessComponents({ customComponents: components });
      }
    }
  };

  // Handle opening the segmentation prompt editor
  const handleOpenSegmentationPromptEditor = () => {
    // Get the prompt from the selected conversation if it exists, otherwise use default
    const currentPrompt = selectedConversation?.customSegmentationPrompt || getDefaultSegmentationPrompt();
    setEditingSegmentationPrompt(currentPrompt);
    setIsSegmentationPromptDialogOpen(true);
  };

  // Handle applying the edited segmentation prompt
  const handleApplySegmentationPrompt = async () => {
    setIsSegmentationPromptDialogOpen(false);
    if (selectedConversation && selectedConversation.conversation) {
      await handleReprocessSegmentation({ customSegmentationPrompt: editingSegmentationPrompt });
    }
  };

  // Sidebar toggle handlers
  const handleToggleSidebar = () => {
    if (isSidebarCollapsed) {
      // Expanding: unlock and expand
      setIsSidebarLocked(false);
      setIsSidebarCollapsed(false);
      setIsSidebarHovered(false);
    } else {
      // Collapsing
      setIsSidebarCollapsed(true);
      setIsSidebarLocked(false);
      setIsSidebarHovered(false);
    }
  };

  const handleLockSidebar = () => {
    // Lock sidebar open: expand it and keep it locked
    setIsSidebarCollapsed(false);
    setIsSidebarLocked(true);
    setIsSidebarHovered(false);
  };

  const handleSidebarMouseEnter = () => {
    if (isSidebarCollapsed && !isSidebarLocked) {
      setIsSidebarHovered(true);
    }
  };

  const handleSidebarMouseLeave = () => {
    if (isSidebarCollapsed && !isSidebarLocked) {
      setIsSidebarHovered(false);
    }
  };

  // Insights panel toggle handler
  const handleToggleInsightsPanel = () => {
    setIsInsightsPanelCollapsed(prev => !prev);
  };

  const handleReprocessComponents = async (options: { customPrompt?: string; customComponents?: string[] } = {}) => {
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
        customPrompt: options.customPrompt,
        customComponents: options.customComponents,
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

  // Reprocess segmentation with a custom prompt using workflow
  const handleReprocessSegmentation = async (options: { customSegmentationPrompt?: string } = {}) => {
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
      // We need to use the original (un-segmented) conversation for re-segmentation
      // For now, we'll use the current conversation - in a more advanced implementation,
      // we'd want to store the original pre-segmentation conversation
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
        customSegmentationPrompt: options.customSegmentationPrompt,
        config: getComponentisationConfig(),
        warnings: [],
        stepTimings: { ...selectedConversation.stepTimings }
      };

      // Run workflow with SegmentationPromptChanged event
      await processConversationWorkflow(
        WorkflowEvent.SegmentationPromptChanged,
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
      console.error("Failed to reprocess segmentation:", error);
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

  // Handle multi-selection toggle
  const handleToggleSelection = (id: string, isSelected: boolean) => {
    setSelectedIds(prev => {
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

  // Create a grouped conversation from selected conversations
  const handleGroupConversations = async () => {
    if (selectedIds.size < 2) return;

    // Get the selected conversations (only fully processed ones)
    const selectedConvs = conversations.filter(
      conv => selectedIds.has(conv.id) && conv.conversation && conv.status === 'success'
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
        const newParts = msg.parts.map(part => {
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
        conv.components.forEach(c => mergedComponentsSet.add(c));
      }
      if (conv.componentMapping) {
        // Remap part IDs to new prefixed IDs
        for (const [partId, component] of Object.entries(conv.componentMapping)) {
          const newPartId = `${conv.id}-${partId}`;
          mergedComponentMapping[newPartId] = component;
        }
      }
      if (conv.componentColors) {
        Object.assign(mergedComponentColors, conv.componentColors);
      }

      // Merge static components
      if (conv.staticComponents) {
        conv.staticComponents.forEach(c => mergedStaticComponentsSet.add(c));
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
    const mergedComponentTimeline = buildComponentTimeline(groupedConversation, mergedComponentMapping);
    const mergedStaticTimeline = buildComponentTimeline(groupedConversation, mergedStaticMapping);

    // Create source conversations list
    const sourceConversations = selectedConvs.map(conv => ({
      id: conv.id,
      filename: conv.filename,
    }));

    // Create grouped name
    const groupedFilename = `Grouped: ${sourceConversations.map(s => s.filename).join(', ')}`;

    // Create placeholder with merged component data
    const placeholder: WorkflowState = {
      id: groupId,
      filename: groupedFilename,
      status: 'pending',
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
    setConversations(prev => [...prev, placeholder]);
    setSelectedId(groupId);
    handleClearSelection();

    // Create workflow runner
    const runner = new WorkflowRunner((id, update) => {
      setConversations(prev =>
        prev.map(conv => conv.id === id ? { ...conv, ...update } : conv)
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
          setConversations(prev =>
            prev.map(conv =>
              conv.id === id
                ? { ...conv, aiSummary: (conv.aiSummary || '') + chunk }
                : conv
            )
          );
        },
        onAnalysisChunk: (id, chunk) => {
          setConversations(prev =>
            prev.map(conv =>
              conv.id === id
                ? { ...conv, analysis: (conv.analysis || '') + chunk }
                : conv
            )
          );
        },
      }
    );
  };

  // Handle ungrouping a grouped conversation
  const handleUngroupConversation = (id: string) => {
    // Remove the grouped conversation from the list
    setConversations(prev => prev.filter(conv => conv.id !== id));
    // Clear selection if the ungrouped conversation was selected
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files: File[]) => workflowMutation.mutate(files),
    validator: (file) => {
      const acceptedExtensions = ['.json', '.jsonl', '.txt'];
      const ext = file.name ? '.' + (file.name.split('.').pop()?.toLowerCase() || '') : '';
      if (!acceptedExtensions.includes(ext)) {
        return {
          code: 'file-invalid-type',
          message: `File type not supported. Accepted: ${acceptedExtensions.join(', ')}`,
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
                Accepts .json, .jsonl, and .txt files
              </p>
            </div>
          </div>
        ) : (
          /* Main Content */
          <div className={cn(
            "grid gap-6 transition-all duration-300",
            // Grid columns based on sidebar and insights panel collapse state
            isSidebarCollapsed && isInsightsPanelCollapsed
              ? "grid-cols-[48px_1fr_48px]"
              : isSidebarCollapsed && !isInsightsPanelCollapsed
              ? "grid-cols-[48px_minmax(600px,1fr)_minmax(480px,32%)]"
              : !isSidebarCollapsed && isInsightsPanelCollapsed
              ? "grid-cols-[260px_1fr_48px]"
              : "grid-cols-[260px_minmax(500px,1fr)_minmax(420px,30%)]"
          )}>
          {/* Sidebar: Conversation List */}
          <aside
            className="relative"
            onMouseEnter={handleSidebarMouseEnter}
            onMouseLeave={handleSidebarMouseLeave}
          >
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              selectedIds={selectedIds}
              onToggleSelection={handleToggleSelection}
              onGroupConversations={handleGroupConversations}
              onClearSelection={handleClearSelection}
              onUngroupConversation={handleUngroupConversation}
              onFilesSelected={(files) => workflowMutation.mutate(files)}
              onEditPrompt={handleOpenPromptEditor}
              onEditComponents={handleOpenComponentsEditor}
              onEditSegmentationPrompt={handleOpenSegmentationPromptEditor}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={handleToggleSidebar}
              onLockSidebar={handleLockSidebar}
              isHovered={isSidebarHovered}
              isLocked={isSidebarLocked}
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
                isCollapsed={isInsightsPanelCollapsed}
                onToggleCollapse={handleToggleInsightsPanel}
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

      {/* Prompt Editor Dialog */}
      <Dialog open={isPromptDialogOpen} onOpenChange={setIsPromptDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Component Identification Prompt</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            <p className="text-sm text-muted-foreground">
              Customize the prompt used to identify components in the conversation. The AI will use this prompt to analyze the conversation and identify logical components.
            </p>
            <Textarea
              value={editingPrompt}
              onChange={(e) => setEditingPrompt(e.target.value)}
              placeholder="Enter your componentisation prompt..."
              className="min-h-[300px] font-mono text-sm resize-none border-2 focus-visible:ring-0"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>This will re-run componentisation, visualization, and analysis</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <UIButton
              variant="outline"
              onClick={() => setIsPromptDialogOpen(false)}
            >
              Cancel
            </UIButton>
            <UIButton
              onClick={handleApplyPrompt}
              disabled={!editingPrompt.trim()}
            >
              Apply & Reprocess
            </UIButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Components Editor Dialog */}
      <Dialog open={isComponentsDialogOpen} onOpenChange={setIsComponentsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Components</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            <p className="text-sm text-muted-foreground">
              Edit the list of components used for mapping. One component per line. These components will be used instead of AI-identified components.
            </p>
            <Textarea
              value={editingComponents}
              onChange={(e) => setEditingComponents(e.target.value)}
              placeholder="Enter components (one per line)..."
              className="min-h-[300px] font-mono text-sm resize-none border-2 focus-visible:ring-0"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>This will re-run component mapping, visualization, and analysis (skipping component identification)</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <UIButton
              variant="outline"
              onClick={() => setIsComponentsDialogOpen(false)}
            >
              Cancel
            </UIButton>
            <UIButton
              onClick={handleApplyComponents}
              disabled={!editingComponents.trim()}
            >
              Apply & Reprocess
            </UIButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Segmentation Prompt Editor Dialog */}
      <Dialog open={isSegmentationPromptDialogOpen} onOpenChange={setIsSegmentationPromptDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Segmentation Prompt</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            <p className="text-sm text-muted-foreground">
              Customize the prompt used to segment large text parts into smaller semantic chunks. The AI will use this prompt to identify where to split long content.
            </p>
            <Textarea
              value={editingSegmentationPrompt}
              onChange={(e) => setEditingSegmentationPrompt(e.target.value)}
              placeholder="Enter your segmentation prompt..."
              className="min-h-[300px] font-mono text-sm resize-none border-2 focus-visible:ring-0"
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>This will re-run segmentation, componentisation, visualization, and analysis</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <UIButton
              variant="outline"
              onClick={() => setIsSegmentationPromptDialogOpen(false)}
            >
              Cancel
            </UIButton>
            <UIButton
              onClick={handleApplySegmentationPrompt}
              disabled={!editingSegmentationPrompt.trim()}
            >
              Apply & Reprocess
            </UIButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
