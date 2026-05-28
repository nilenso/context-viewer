/**
 * Viewer-local API key management.
 *
 * The analyzer takes config as input and has no runtime state.
 * The viewer manages the API key lifecycle (env var, user input, persistence).
 */

export type { AIApiMode, ReasoningEffort } from "context-analyzer";

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
 * Build an AnalyzerConfig from the current environment + runtime key.
 */
export function getAnalyzerConfig() {
  const apiKey = runtimeApiKey || import.meta.env.VITE_AI_API_KEY || "";
  const model = import.meta.env.VITE_AI_MODEL || "gpt-5.4-mini";
  const baseURL = import.meta.env.VITE_AI_BASE_URL || undefined;
  const apiModeEnv = (import.meta.env.VITE_AI_API_MODE || "").toLowerCase();
  const apiMode = apiModeEnv === "chat" ? "chat" as const : "responses" as const;
  const thinkingEnv = (import.meta.env.VITE_AI_THINKING || "").toLowerCase();
  const reasoningEffort = (["none", "low", "medium", "high"].includes(thinkingEnv) ? thinkingEnv : undefined) as
    | "none" | "low" | "medium" | "high" | undefined;

  return { apiKey, model, baseURL, apiMode, reasoningEffort };
}
