/**
 * Centralized part-type display configuration (labels and emoji).
 */

export const PART_TYPE_LABEL: Record<string, string> = {
  text: "Text",
  reasoning: "Reasoning",
  "tool-call": "Tool Call",
  "tool-result": "Tool Result",
  image: "Image",
  file: "File",
};

export const PART_TYPE_EMOJI: Record<string, string> = {
  text: "💬",
  reasoning: "💭",
  "tool-call": "📤",
  "tool-result": "📥",
  image: "🖼️",
  file: "📄",
};

export function getPartLabel(type: string): string {
  return PART_TYPE_LABEL[type] ?? "Unknown";
}

export function getPartEmoji(type: string): string {
  return PART_TYPE_EMOJI[type] ?? "❓";
}
