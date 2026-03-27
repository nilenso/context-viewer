/**
 * Reprocessing helpers — viewer-side knowledge of how to iterate with the analyzer.
 *
 * ⚠️ REVIEW: This module encodes knowledge of which analyzer inputs trigger
 * which stage re-runs. If this logic proves stable, consider moving it into
 * the analyzer's session layer. Currently kept here because:
 * - The analyzer is stateless (sessions are opt-in)
 * - The viewer manages its own prompt editing state
 * - The mapping is simple enough to maintain viewer-side
 *
 * The viewer calls analyze() with a sessionId and changed options.
 * The analyzer's session layer handles diffing and clearing internally.
 * This module just builds the right AnalyzeOptions for each reprocessing scenario.
 */

import type { AnalyzeOptions } from "context-analyzer";
import type { PipelineState } from "context-analyzer";

/**
 * Build options for re-running component identification with a new prompt.
 */
export function buildComponentReprocessOptions(
  dimName: string,
  prompt: string,
): Partial<AnalyzeOptions> {
  return {
    dimensions: {
      [dimName]: { prompt },
    },
  };
}

/**
 * Build options for re-running with a custom component list.
 */
export function buildCustomComponentsOptions(
  dimName: string,
  components: Array<{ name: string; description: string }>,
): Partial<AnalyzeOptions> {
  return {
    dimensions: {
      [dimName]: { components },
    },
  };
}

/**
 * Build options for re-running segmentation with a new prompt/threshold.
 */
export function buildSegmentationReprocessOptions(
  segmentationPrompt?: string,
  segmentationThreshold?: number,
): Partial<AnalyzeOptions> {
  return {
    prompts: segmentationPrompt !== undefined ? { segmentation: segmentationPrompt } : undefined,
    segmentationThreshold,
  };
}

/**
 * Build options for re-running coloring with a new prompt.
 */
export function buildColoringReprocessOptions(
  dimName: string,
  coloringPrompt: string,
): Partial<AnalyzeOptions> {
  return {
    dimensions: {
      [dimName]: { coloringPrompt },
    },
  };
}
