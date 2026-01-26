/**
 * Shared AI configuration for all AI-powered features
 */

export interface AIConfig {
  apiKey: string;
  model: string;
}

/**
 * Get AI configuration from environment variables
 * @param label - Label for logging (e.g., "Segmentation", "Summary")
 */
export function getAIConfig(label?: string): AIConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";

  const prefix = label ? `[${label}]` : "[AI]";

  if (!apiKey) {
    console.log(`${prefix} No API key configured`);
    return null;
  }

  console.log(`${prefix} Config loaded: model=${model}`);
  return { apiKey, model };
}
