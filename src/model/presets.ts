/**
 * Preset type definitions for component analysis presets.
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
  segmentationPrompt?: string;
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
