import type { ComponentTimelineSnapshot } from "./aggregation";

/**
 * Represents one dimension of component analysis.
 * Each dimension has its own prompt, components, mapping, colors, and timeline.
 */
export interface DimensionData {
  name: string;
  prompt?: string; // custom identification prompt
  components: string[];
  componentMapping: Record<string, string>; // partId -> componentName
  componentTimeline: ComponentTimelineSnapshot[];
  componentColors: Record<string, string>; // componentName -> color
  customComponents?: string[];
  customColoringPrompt?: string;
}
