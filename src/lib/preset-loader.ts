/**
 * Preset loader utilities for component analysis presets
 */

/**
 * Preset configuration structure
 *
 * The colors field maps component names to either:
 * - Color names (e.g., "blue", "teal") for Tailwind class lookup
 * - Hex values (e.g., "#60a5fa") for direct styling
 */
export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  componentIdentificationPrompt?: string;
  components: string[];
  colors: Record<string, string>;
  /** @deprecated No longer used - colors should be hex values or color names */
  colorPalette?: {
    colorNameToClasses: Record<string, string>;
    colorNameToBgClass: Record<string, string>;
    colorNameToHex: Record<string, string>;
    colorNameToTextHex: Record<string, string>;
  };
}

/**
 * Preset summary for the index
 */
export interface PresetSummary {
  id: string;
  name: string;
  description: string;
}

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
    const response = await fetch("/presets/index.json");
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
 */
export async function loadPreset(id: string): Promise<PresetConfig | null> {
  try {
    const response = await fetch(`/presets/${id}.json`);
    if (!response.ok) {
      console.error(`Failed to load preset ${id}: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Error loading preset ${id}:`, error);
    return null;
  }
}
