/**
 * Core domain types for the analyzer.
 *
 * model/ depends on nothing except zod (via ./schema).
 */

import type { Conversation } from "./schema";

// ---------------------------------------------------------------------------
// Processing phases & lifecycle
// ---------------------------------------------------------------------------

export type Stage =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "identifying-components"
  | "classifying-components"
  | "coloring"
  | "summarizing"
  | "analyzing";

// ---------------------------------------------------------------------------
// Aggregation types
// ---------------------------------------------------------------------------

export interface ComponentTimelineSnapshot {
  messageIndex: number;
  componentTokens: Record<string, number>;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Component dimension
// ---------------------------------------------------------------------------

export interface DimensionData {
  name: string;
  prompt?: string;
  discoveredComponents: string[];
  componentMapping: Record<string, string>;
  componentTimeline: ComponentTimelineSnapshot[];
  componentColors: Record<string, string>;
  customComponents?: string[];
  /** Descriptions for custom components — used by classifier for better accuracy */
  componentDescriptions?: Record<string, string>;
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

export interface ConversationMetadata {
  parserName: string;
  model?: string;
  provider?: string;
  agent?: string;
  title?: string;
  componentColors?: Record<string, string>;
  aiSummary?: string;
  analysis?: string;
  customPrompt?: string;
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  customColoringPrompt?: string;
  dimensions?: Record<string, { components: string[]; colors: Record<string, string>; prompt?: string; coloringPrompt?: string }>;
}

export interface ParseResult {
  conversation: Conversation;
  metadata: ConversationMetadata;
}

export interface Parser {
  name: string;
  parse(data: unknown): Conversation;
  extractMetadata?(data: unknown): Partial<ConversationMetadata>;
  canParse(data: unknown): boolean;
}

// ---------------------------------------------------------------------------
// Pipeline state — internal working object for the pipeline
// ---------------------------------------------------------------------------

export interface PipelineState {
  // Identity
  id: string;
  filename: string;
  title?: string;

  // Execution inputs
  rawContent?: string;
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  segmentationThreshold?: number;
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
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export interface Group {
  id: string;
  name: string;
  title?: string;
  fileIds: string[];
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  aiSummary?: string;
  analysis?: string;
}
