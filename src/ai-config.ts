/**
 * Shared AI configuration for all AI-powered features
 */

export interface AIConfig {
  apiKey: string;
  model: string;
}

// Module-level runtime API key (lost on tab close)
let runtimeApiKey: string | null = null;

export function setRuntimeApiKey(key: string | null): void {
  runtimeApiKey = key;
}

export function getRuntimeApiKey(): string | null {
  return runtimeApiKey;
}

export function hasApiKey(): boolean {
  return !!(runtimeApiKey || import.meta.env.VITE_AI_API_KEY);
}

export function isApiKeyFromEnv(): boolean {
  return !!import.meta.env.VITE_AI_API_KEY;
}

/**
 * Get AI configuration from environment variables or runtime key
 * @param label - Label for logging (e.g., "Segmentation", "Summary")
 */
export function getAIConfig(label?: string): AIConfig | null {
  const apiKey = runtimeApiKey || import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";

  const prefix = label ? `[${label}]` : "[AI]";

  if (!apiKey) {
    console.log(`${prefix} No API key configured`);
    return null;
  }

  console.log(`${prefix} Config loaded: model=${model}`);
  return { apiKey, model };
}
