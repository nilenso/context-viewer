import type { Conversation } from "../schema";
import type { ConversationSummary } from "../conversation-summary";
import type { ConversationMetadata } from "../parser";
import type { DimensionData } from "../component-types";
import type { ComponentTimelineSnapshot } from "../aggregation";
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
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  segmentationThreshold?: number;
  regenerateAnalysis?: boolean;
  presetColors?: Record<string, string>;

  // Core data
  conversation?: Conversation;
  summary?: ConversationSummary;
  metadata?: ConversationMetadata;
  aiSummary?: string;
  analysis?: string;

  // Component data (all stored per-dimension)
  dimensions?: Record<string, DimensionData>;

  // Static component data (deterministic)
  staticComponents?: string[];
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];

  // Tracking
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep | string, number>>;
  pausedAtStep?: ProcessingStep;

}

/**
 * Lightweight group metadata.
 * Groups reference member files by ID — no concatenated conversation.
 */
export interface Group {
  id: string;
  name: string;
  title?: string;
  fileIds: string[];
  // Group-level prompts (summary/analysis run on virtual merged conversation)
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  // Group-level AI outputs (generated from concatenated member content)
  aiSummary?: string;
  analysis?: string;
}

export interface WorkflowBatchResult {
  workflowStates: WorkflowState[];
}

/**
 * Ordered pipeline steps for conversation processing.
 * runPipelineFrom(step) runs from that step through the end.
 */
export enum PipelineStep {
  Parse = 0,
  CountTokens = 1,
  Segment = 2,
  Identify = 3,
  Classify = 4,
  Color = 5,
}

/**
 * Callbacks for streaming updates
 */
export interface WorkflowCallbacks {
  onSummaryChunk?: (id: string, chunk: string) => void;
  onAnalysisChunk?: (id: string, chunk: string) => void;
}

/**
 * Data fields on WorkflowState that can be selectively written back.
 */
export type WorkflowDataField = Exclude<
  keyof WorkflowState,
  "id" | "filename" | "status" | "step" | "error" | "warnings" | "stepTimings" |
  "file" | "config" | "regenerateAnalysis" | "pausedAtStep"
>;

export interface WorkflowOptions {
  customComponents?: string[];
  presetColors?: Record<string, string>;
  customPrompt?: string;
  customSegmentationPrompt?: string;
}

// Re-export types that App.tsx needs from other modules
export type { ComponentTimelineSnapshot } from "../aggregation";
export type { DimensionData } from "../component-types";
export type { ConversationSummary } from "../conversation-summary";
export type { ConversationMetadata } from "../parser";
export type { ProcessingPhase } from "../workflow-logger";
