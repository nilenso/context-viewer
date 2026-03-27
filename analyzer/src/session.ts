/**
 * Session — lightweight in-memory state for iterative analysis.
 *
 * A session holds PipelineState objects between calls so the caller can
 * iterate (change prompts, refine components) without re-parsing or
 * re-running unchanged stages. The pipeline's idempotency checks do the
 * actual skip-or-rerun decisions; the session layer handles input diffing
 * and clearing affected outputs so those checks see the right state.
 *
 * ## Session state schema
 *
 * Each PipelineState in the session carries both inputs and outputs.
 * The fields that matter for iteration:
 *
 * ### Inputs (set by caller, compared on iteration)
 *   - customSegmentationPrompt     — drives segmentation stage
 *   - segmentationThreshold        — drives segmentation stage
 *   - dimensions[name].prompt      — drives component identification
 *   - dimensions[name].customComponents — drives identification (skip AI)
 *   - dimensions[name].componentDescriptions — drives classification accuracy
 *   - dimensions[name].customColoringPrompt — drives color assignment
 *   - presetColors                 — drives color assignment (preset mode)
 *
 * ### Outputs (computed by stages, cleared when inputs change)
 *   - conversation                 — post-parse and post-segment text
 *   - staticComponents/Mapping/Timeline — deterministic role.type breakdown
 *   - dimensions[name].discoveredComponents — AI-identified component list
 *   - dimensions[name].componentMapping — part→component assignments
 *   - dimensions[name].componentTimeline — cumulative token distribution
 *   - dimensions[name].componentColors — hex colors per component
 */

import type { PipelineState, DimensionData } from "./model/types";
import { generateId } from "./id-generator";

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  states: PipelineState[];
}

const sessions = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function createSession(states: PipelineState[]): Session {
  const id = `session-${generateId()}`;
  const session: Session = { id, states };
  sessions.set(id, session);
  return session;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

// ---------------------------------------------------------------------------
// Input diffing and output clearing
// ---------------------------------------------------------------------------

/**
 * Tracked inputs extracted from a PipelineState.
 * Used to detect what changed between iterations.
 */
interface TrackedInputs {
  segmentationPrompt: string | undefined;
  segmentationThreshold: number | undefined;
  presetColors: Record<string, string> | undefined;
  dimensions: Record<string, {
    prompt: string | undefined;
    customComponents: string[] | undefined;
    componentDescriptions: Record<string, string> | undefined;
    coloringPrompt: string | undefined;
  }>;
}

function extractInputs(ctx: PipelineState): TrackedInputs {
  const dimensions: TrackedInputs["dimensions"] = {};
  if (ctx.dimensions) {
    for (const [name, dim] of Object.entries(ctx.dimensions)) {
      dimensions[name] = {
        prompt: dim.prompt,
        customComponents: dim.customComponents,
        componentDescriptions: dim.componentDescriptions,
        coloringPrompt: dim.customColoringPrompt,
      };
    }
  }
  return {
    segmentationPrompt: ctx.customSegmentationPrompt,
    segmentationThreshold: ctx.segmentationThreshold,
    presetColors: ctx.presetColors,
    dimensions,
  };
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Clear dimension outputs that need recomputing.
 * - identification: clear discoveredComponents, mapping, timeline, colors
 * - coloring only: clear componentColors
 */
function clearDimensionIdentification(dim: DimensionData): void {
  dim.discoveredComponents = [];
  dim.componentMapping = {};
  dim.componentTimeline = [];
  dim.componentColors = {};
}

function clearDimensionColors(dim: DimensionData): void {
  dim.componentColors = {};
}

/**
 * Apply new options to a session's PipelineStates, clearing outputs
 * affected by changed inputs. Returns the list of dimension names
 * that were affected (for targeted re-runs).
 *
 * Input→output clearing rules:
 *   segmentationPrompt changed   → re-segment → re-identify/classify/color all dims
 *   segmentationThreshold changed → same as above
 *   dimension.prompt changed      → clear that dim's identification + downstream
 *   dimension.customComponents changed → clear that dim's identification + downstream
 *   dimension.componentDescriptions changed → clear that dim's classification + downstream
 *   dimension.coloringPrompt changed → clear that dim's colors only
 *   presetColors changed          → clear all dims' colors
 */
export function applyIterationInputs(
  states: PipelineState[],
  newOptions: {
    segmentationPrompt?: string;
    segmentationThreshold?: number;
    presetColors?: Record<string, string>;
    dimensions?: Record<string, {
      prompt?: string;
      customComponents?: string[];
      componentDescriptions?: Record<string, string>;
      coloringPrompt?: string;
    }>;
  },
): { affectedDimNames: string[] } {
  const affectedDims = new Set<string>();

  for (const ctx of states) {
    const before = extractInputs(ctx);

    // --- Segmentation changes ---
    const segChanged =
      (newOptions.segmentationPrompt !== undefined && newOptions.segmentationPrompt !== before.segmentationPrompt) ||
      (newOptions.segmentationThreshold !== undefined && newOptions.segmentationThreshold !== before.segmentationThreshold);

    if (segChanged) {
      if (newOptions.segmentationPrompt !== undefined) ctx.customSegmentationPrompt = newOptions.segmentationPrompt;
      if (newOptions.segmentationThreshold !== undefined) ctx.segmentationThreshold = newOptions.segmentationThreshold;
      // Re-segmenting invalidates all downstream: clear all dimension outputs
      if (ctx.dimensions) {
        for (const [name, dim] of Object.entries(ctx.dimensions)) {
          clearDimensionIdentification(dim);
          affectedDims.add(name);
        }
      }
    }

    // --- Preset colors changes ---
    if (newOptions.presetColors !== undefined && !jsonEq(newOptions.presetColors, before.presetColors)) {
      ctx.presetColors = newOptions.presetColors;
      if (ctx.dimensions) {
        for (const [name, dim] of Object.entries(ctx.dimensions)) {
          clearDimensionColors(dim);
          affectedDims.add(name);
        }
      }
    }

    // --- Per-dimension changes ---
    if (newOptions.dimensions) {
      if (!ctx.dimensions) ctx.dimensions = {};

      for (const [dimName, newDim] of Object.entries(newOptions.dimensions)) {
        const beforeDim = before.dimensions[dimName];
        let dim = ctx.dimensions[dimName];
        if (!dim) {
          dim = {
            name: dimName, discoveredComponents: [], componentMapping: {},
            componentTimeline: [], componentColors: {},
          };
          ctx.dimensions[dimName] = dim;
        }

        // Prompt changed → re-identify
        if (newDim.prompt !== undefined && newDim.prompt !== beforeDim?.prompt) {
          dim.prompt = newDim.prompt;
          clearDimensionIdentification(dim);
          affectedDims.add(dimName);
        }

        // Custom components changed → re-identify (uses custom list, no AI)
        if (newDim.customComponents !== undefined && !jsonEq(newDim.customComponents, beforeDim?.customComponents)) {
          dim.customComponents = newDim.customComponents;
          clearDimensionIdentification(dim);
          affectedDims.add(dimName);
        }

        // Component descriptions changed → re-classify (descriptions affect classifier)
        if (newDim.componentDescriptions !== undefined && !jsonEq(newDim.componentDescriptions, beforeDim?.componentDescriptions)) {
          dim.componentDescriptions = newDim.componentDescriptions;
          // Clear mapping and timeline but keep discovered components
          dim.componentMapping = {};
          dim.componentTimeline = [];
          affectedDims.add(dimName);
        }

        // Coloring prompt changed → re-color only
        if (newDim.coloringPrompt !== undefined && newDim.coloringPrompt !== beforeDim?.coloringPrompt) {
          dim.customColoringPrompt = newDim.coloringPrompt;
          clearDimensionColors(dim);
          affectedDims.add(dimName);
        }
      }
    }
  }

  return { affectedDimNames: [...affectedDims] };
}
