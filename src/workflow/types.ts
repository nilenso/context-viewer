import type { Conversation, SourceInfo } from "../schema";
import type { ConversationSummary } from "../conversation-summary";
import type { ConversationMetadata } from "../parser";
import type { DimensionData, ComponentTimelineSnapshot } from "../componentisation";
import type { ProcessingPhase } from "../workflow-logger";

export type ConversationStatus = "pending" | "processing" | "success" | "failed" | "paused-for-api-key";
export type ProcessingStep =
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
 */
export interface WorkflowState {
  // Identity
  id: string;
  filename: string;
  title?: string;

  // UI/Workflow lifecycle
  status?: ConversationStatus;
  step?: ProcessingStep;
  error?: string;

  // Execution inputs
  file?: File;
  config?: any;
  customPrompt?: string;
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  customColoringPrompt?: string;
  segmentationThreshold?: number;
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

  // Multi-dimensional component data
  dimensions?: Record<string, DimensionData>;
  targetDimension?: string;

  // Static component data (deterministic)
  staticComponents?: string[];
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];

  // Tracking
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;
  pausedAtStep?: ProcessingStep;

  // Grouped conversation data
  isGrouped?: boolean;
  sourceConversations?: Array<{ id: string; filename: string; title?: string }>;
  messageSourceMap?: Record<string, SourceInfo>;
}

export interface WorkflowBatchResult {
  workflowStates: WorkflowState[];
}

/**
 * Event types that trigger workflow execution
 */
export enum WorkflowEvent {
  NewFile = "new-file",
  ComponentPromptChanged = "component-prompt-changed",
  SegmentationPromptChanged = "segmentation-prompt-changed",
  SummaryPromptChanged = "summary-prompt-changed",
  ColoringPromptChanged = "coloring-prompt-changed",
  GroupedConversation = "grouped-conversation",
  GenerateAnalysis = "generate-analysis",
  GenerateSummary = "generate-summary",
  ResumeFromApiKeyPause = "resume-from-api-key-pause",
}

/**
 * Callbacks for streaming updates
 */
export interface WorkflowCallbacks {
  onSummaryChunk?: (id: string, chunk: string) => void;
  onAnalysisChunk?: (id: string, chunk: string) => void;
}

/**
 * Generic activity signature
 */
export type Activity<TResult> = (ctx: Readonly<WorkflowState>) => Promise<TResult>;

/**
 * Data fields on WorkflowState that can be selectively written back.
 */
export type WorkflowDataField = Exclude<
  keyof WorkflowState,
  "id" | "filename" | "status" | "step" | "error" | "warnings" | "stepTimings" |
  "file" | "config" | "regenerateAnalysis" | "pausedAtStep" | "targetDimension"
>;

export interface WorkflowOptions {
  customComponents?: string[];
  presetColors?: Record<string, string>;
  customPrompt?: string;
  customSegmentationPrompt?: string;
}

// Re-export types that App.tsx needs from other modules
export type { ComponentTimelineSnapshot } from "../componentisation";
export type { DimensionData } from "../componentisation";
export type { ConversationSummary } from "../conversation-summary";
export type { ConversationMetadata } from "../parser";
export type { ProcessingPhase } from "../workflow-logger";
