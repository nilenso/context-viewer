/**
 * Core domain types for Context Viewer.
 *
 * Merged from: component-types.ts, pipeline/types.ts, conversation-summary.ts
 * (interface only), parser.ts (interface only), aggregation.ts (interface only),
 * pipeline/logging.ts (Stage only).
 *
 * model/ depends on nothing except zod (via ./schema).
 */

import type { Conversation } from "./schema";

// ---------------------------------------------------------------------------
// Processing phases & lifecycle
// ---------------------------------------------------------------------------

/**
 * Stage — the individual execution units of the processing pipeline.
 * Each corresponds to a file in stages/.
 *
 * Used for logging, timing, and tracking progress.
 */
export type Stage =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "identifying-components"
  | "classifying-components"
  | "coloring"
  | "summarizing"
  | "analyzing";

/**
 * StageGroup — coarser pipeline checkpoints shown in the UI.
 * "finding-components" groups identify + classify + color.
 * Used for status reporting to the user.
 */
export type StageGroup =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summarizing"
  | "finding-components"
  | "coloring"
  | "analyzing";

/** Map from Stage to its StageGroup for UI display */
export const STAGE_TO_GROUP: Record<Stage, StageGroup> = {
  "parsing": "parsing",
  "counting-tokens": "counting-tokens",
  "segmenting": "segmenting",
  "identifying-components": "finding-components",
  "classifying-components": "finding-components",
  "coloring": "coloring",
  "summarizing": "summarizing",
  "analyzing": "analyzing",
};

export type ConversationStatus = "pending" | "processing" | "success" | "failed" | "paused-for-api-key";

// ---------------------------------------------------------------------------
// Aggregation types
// ---------------------------------------------------------------------------

/** Timeline snapshot representing component composition at a specific message */
export interface ComponentTimelineSnapshot {
  messageIndex: number;
  componentTokens: Record<string, number>; // component name → total tokens
  totalTokens: number; // cumulative tokens up to this message
}

// ---------------------------------------------------------------------------
// Component dimension
// ---------------------------------------------------------------------------

/**
 * Represents one dimension of component analysis.
 * Each dimension has its own prompt, components, mapping, colors, and timeline.
 */
export interface DimensionData {
  name: string;
  prompt?: string; // custom identification prompt
  discoveredComponents: string[];
  componentMapping: Record<string, string>; // partId -> componentName
  componentTimeline: ComponentTimelineSnapshot[];
  componentColors: Record<string, string>; // componentName -> color
  customComponents?: string[];
  customColoringPrompt?: string;
}

// ---------------------------------------------------------------------------
// Conversation summary
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  totalMessages: number;
  messagesByRole: Record<string, number>;
  textOnlyMessageCount: number;
  structuredContentMessageCount: number;
  partCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Parser metadata
// ---------------------------------------------------------------------------

/**
 * Metadata about the parsed conversation
 */
export interface ConversationMetadata {
  /** Name of the parser/format that was used */
  parserName: string;
  /** Model used in the conversation (if available) */
  model?: string;
  /** Provider name (if available) */
  provider?: string;
  /** Agent configuration (OpenCode only) */
  agent?: string;
  /** Custom display title (from Context Viewer exports) */
  title?: string;
  // Pre-computed data (from Context Viewer exports)
  /** Component to color mapping (hex colors) */
  componentColors?: Record<string, string>;
  /** AI-generated summary */
  aiSummary?: string;
  /** AI-generated context analysis */
  analysis?: string;
  // Custom prompts (from Context Viewer exports)
  /** Custom component identification prompt */
  customPrompt?: string;
  /** Custom segmentation prompt */
  customSegmentationPrompt?: string;
  /** Custom summary prompt */
  customSummaryPrompt?: string;
  /** Custom analysis prompt */
  customAnalysisPrompt?: string;
  /** Custom coloring prompt */
  customColoringPrompt?: string;
  /** Multi-dimension export data (from Context Viewer exports) */
  dimensions?: Record<string, { components: string[]; colors: Record<string, string>; prompt?: string; coloringPrompt?: string }>;
}

/**
 * Result of parsing a conversation
 */
export interface ParseResult {
  conversation: Conversation;
  metadata: ConversationMetadata;
}

/**
 * Parser interface for converting different API formats to our standard message structure
 */
export interface Parser {
  /** Human-readable name of this parser */
  name: string;

  /**
   * Parse the input data into our standard Conversation format
   * @param data - The raw API response data
   * @returns Parsed conversation following our schema
   */
  parse(data: unknown): Conversation;

  /**
   * Extract metadata from the input data (model, provider, etc.)
   * @param data - The raw API response data
   * @returns Metadata about the conversation
   */
  extractMetadata?(data: unknown): Partial<ConversationMetadata>;

  /**
   * Check if this parser can handle the given data format
   * @param data - The raw data to check
   * @returns true if this parser can handle the data
   */
  canParse(data: unknown): boolean;
}

// ---------------------------------------------------------------------------
// Pipeline state
// ---------------------------------------------------------------------------

/**
 * Represents pipeline state for processing a conversation file.
 * Used both for React state management (persisting UI state) and during pipeline execution (tracking progress).
 */
export interface PipelineState {
  // Identity
  id: string;
  filename: string;
  title?: string;

  // UI/Pipeline lifecycle
  status?: ConversationStatus;
  step?: StageGroup;
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
  stepTimings?: Partial<Record<Stage | string, number>>;
  pausedAtStep?: StageGroup;
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

export interface PipelineBatchResult {
  pipelineStates: PipelineState[];
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
export interface PipelineCallbacks {
  onSummaryChunk?: (id: string, chunk: string) => void;
  onAnalysisChunk?: (id: string, chunk: string) => void;
}

/**
 * Data fields on PipelineState that can be selectively written back to the store.
 */
export type PipelineDataField = Exclude<
  keyof PipelineState,
  "id" | "filename" | "status" | "step" | "error" | "warnings" | "stepTimings" |
  "file" | "config" | "regenerateAnalysis" | "pausedAtStep"
>;

export interface PipelineOptions {
  customComponents?: string[];
  presetColors?: Record<string, string>;
  customPrompt?: string;
  customSegmentationPrompt?: string;
}
