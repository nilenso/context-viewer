/**
 * Preset loader utilities for component analysis presets.
 *
 * NOTE: This module performs HTTP fetches (I/O) to load preset JSON files.
 * It lives in stages/ai/ because presets configure AI stage behavior, but
 * the I/O aspect is a concern — if stricter layering is needed, the fetch
 * logic should move to the store or UI layer, with this module accepting
 * preset data as input instead.
 */

import type { PresetConfig, PresetSummary } from "@/model/presets";

// Re-export types from model for convenience
export type { PresetConfig, PresetSummary } from "@/model/presets";

/**
 * Preset index structure
 */
interface PresetIndex {
  presets: PresetSummary[];
}

/**
 * Load the preset index (list of available presets)
 */
export async function loadPresetIndex(): Promise<PresetSummary[]> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}presets/index.json`);
    if (!response.ok) {
      console.error(`Failed to load preset index: ${response.status}`);
      return [];
    }
    const index: PresetIndex = await response.json();
    return index.presets;
  } catch (error) {
    console.error("Error loading preset index:", error);
    return [];
  }
}

/**
 * Load a specific preset by ID
 * Throws an error if the preset cannot be loaded or parsed
 */
export async function loadPreset(id: string): Promise<PresetConfig> {
  const url = `${import.meta.env.BASE_URL}presets/${id}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load preset "${id}": HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = error as SyntaxError;
    throw new Error(`Invalid JSON in preset "${id}": ${parseError.message}`);
  }
}
