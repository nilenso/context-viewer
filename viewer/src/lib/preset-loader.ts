/**
 * Preset loader utilities for component analysis presets.
 * Viewer-only concern — uses fetch() to load preset JSON from public/.
 */

/**
 * Preset configuration structure
 */
export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  componentIdentificationPrompt?: string;
  segmentationPrompt?: string;
  components: string[];
  colors: Record<string, string>;
}

/**
 * Preset summary for the index
 */
export interface PresetSummary {
  id: string;
  name: string;
  description: string;
}

interface PresetIndex {
  presets: PresetSummary[];
}

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
