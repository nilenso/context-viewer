/**
 * Build a workflow execution context from an existing conversation state.
 */

import type { WorkflowState } from "./types";
import { getAIConfig } from "../ai-config";

export function buildBaseContext(conv: WorkflowState): WorkflowState {
  return {
    id: conv.id,
    filename: conv.filename,
    conversation: conv.conversation,
    summary: conv.summary,
    metadata: conv.metadata,
    aiSummary: conv.aiSummary,
    analysis: conv.analysis,
    dimensions: conv.dimensions ? { ...conv.dimensions } : undefined,
    staticComponents: conv.staticComponents,
    staticMapping: conv.staticMapping,
    staticTimeline: conv.staticTimeline,
    customSummaryPrompt: conv.customSummaryPrompt,
    customSegmentationPrompt: conv.customSegmentationPrompt,
    customAnalysisPrompt: conv.customAnalysisPrompt,
    segmentationThreshold: conv.segmentationThreshold,
    config: conv.config || getAIConfig("Componentisation"),
    warnings: [],
    stepTimings: { ...conv.stepTimings },
  };
}
