/**
 * Browser I/O functions for exporting data as file downloads.
 * Separated from operations/export-builder.ts (pure data transforms)
 * because these use DOM APIs (Blob, createElement, click).
 */

import type { SessionExport } from "@/model/export-schema";
import type { PipelineState, DimensionData } from "@/model/types";

/**
 * Download export data as a JSON file
 */
export function downloadExport(data: SessionExport): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `context-viewer-export-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export a conversation's prompts as a reusable preset file.
 */
export function exportPromptsAsPreset(source: PipelineState): void {
  const defaultDim = source.dimensions?.["default"];
  const defaultName = source.title || source.filename.replace(/\.[^.]+$/, "");
  const name = window.prompt("Preset name:", defaultName);
  if (!name) return;

  const preset: Record<string, unknown> = {
    id: `custom-${Date.now()}`,
    name,
    description: `Exported prompts from "${name}"`,
    components: defaultDim?.discoveredComponents || [],
    colors: defaultDim?.componentColors || {},
  };

  if (source.customSegmentationPrompt) preset.segmentationPrompt = source.customSegmentationPrompt;
  if (source.segmentationThreshold != null) preset.segmentationThreshold = source.segmentationThreshold;
  if (defaultDim?.prompt) preset.componentIdentificationPrompt = defaultDim.prompt;
  if (defaultDim?.customColoringPrompt) preset.coloringPrompt = defaultDim.customColoringPrompt;
  if (source.customSummaryPrompt) preset.summaryPrompt = source.customSummaryPrompt;
  if (source.customAnalysisPrompt) preset.analysisPrompt = source.customAnalysisPrompt;

  if (source.dimensions && Object.keys(source.dimensions).length > 1) {
    const dimPrompts: Record<string, { prompt?: string; coloringPrompt?: string; components: string[] }> = {};
    for (const [dimName, dim] of Object.entries(source.dimensions)) {
      dimPrompts[dimName] = {
        prompt: dim.prompt,
        coloringPrompt: dim.customColoringPrompt,
        components: dim.discoveredComponents,
      };
    }
    preset.dimensions = dimPrompts;
  }

  const json = JSON.stringify(preset, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-preset.json`;
  a.click();
  URL.revokeObjectURL(url);
}
