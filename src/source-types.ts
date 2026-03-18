/**
 * Source: the unified type for things you analyze.
 *
 * A Source is either a file (single conversation/document) or a group
 * (lightweight metadata referencing member files). Both appear in the
 * sidebar and share UI affordances: title, prompts, dimensions.
 *
 * Discriminated on `kind: "file" | "group"`.
 */

import type { Conversation } from "./schema";
import type { ConversationSummary } from "./conversation-summary";
import type { ConversationMetadata } from "./parser";
import type { DimensionData } from "./component-types";
import type { ComponentTimelineSnapshot } from "./aggregation";

type ConversationStatus = "pending" | "processing" | "success" | "failed" | "paused-for-api-key";
type ProcessingStep =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summary"
  | "finding-components"
  | "coloring"
  | "analysis";

/** Fields shared by both file and group sources. */
interface SourceBase {
  id: string;
  title?: string;
  dimensions?: Record<string, DimensionData>;
  // Prompts (user-editable)
  customPrompt?: string;
  customSegmentationPrompt?: string;
  customSummaryPrompt?: string;
  customAnalysisPrompt?: string;
  customColoringPrompt?: string;
  segmentationThreshold?: number;
  // AI outputs
  aiSummary?: string;
  analysis?: string;
}

/** A single file/conversation being analyzed. */
export interface FileSource extends SourceBase {
  kind: "file";
  filename: string;
  status?: ConversationStatus;
  step?: ProcessingStep;
  error?: string;
  // Execution inputs
  file?: File;
  config?: any;
  customComponents?: string[];
  regenerateAnalysis?: boolean;
  presetColors?: Record<string, string>;
  // Core data
  conversation?: Conversation;
  summary?: ConversationSummary;
  metadata?: ConversationMetadata;
  // Static component data (deterministic)
  staticComponents?: string[];
  staticMapping?: Record<string, string>;
  staticTimeline?: ComponentTimelineSnapshot[];
  // Tracking
  warnings?: string[];
  stepTimings?: Partial<Record<ProcessingStep, number>>;
  pausedAtStep?: ProcessingStep;
}

/** A group: lightweight metadata referencing member files by ID. */
export interface GroupSource extends SourceBase {
  kind: "group";
  name: string;
  fileIds: string[];
}

/** Discriminated union — the thing you loaded and are analyzing. */
export type Source = FileSource | GroupSource;
