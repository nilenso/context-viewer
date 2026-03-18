/**
 * Shared AI configuration for all AI-powered features
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV2 } from "ai";

export type ReasoningEffort = "none" | "low" | "medium" | "high";
export type AIApiMode = "responses" | "chat";

export interface AIConfig {
  apiKey: string;
  model: string;
  baseURL: string | undefined;
  apiMode: AIApiMode;
  reasoningEffort: ReasoningEffort | undefined;
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
 * Build providerOptions for Vercel AI SDK calls based on config.
 * Returns undefined if no special options are needed.
 */
export function getProviderOptions(config: AIConfig): Record<string, Record<string, string>> | undefined {
  if (!config.reasoningEffort) return undefined;
  return {
    openai: { reasoningEffort: config.reasoningEffort },
  };
}

/**
 * Get AI configuration from environment variables or runtime key
 * @param label - Label for logging (e.g., "Segmentation", "Summary")
 */
export function getAIConfig(label?: string): AIConfig | null {
  const apiKey = runtimeApiKey || import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";
  const baseURL = import.meta.env.VITE_AI_BASE_URL || undefined;
  const apiModeEnv = (import.meta.env.VITE_AI_API_MODE || "").toLowerCase();
  const apiMode: AIApiMode = apiModeEnv === "chat" ? "chat" : "responses";
  const thinkingEnv = (import.meta.env.VITE_AI_THINKING || "").toLowerCase();
  const reasoningEffort = (["none", "low", "medium", "high"].includes(thinkingEnv) ? thinkingEnv : undefined) as ReasoningEffort | undefined;

  const prefix = label ? `[${label}]` : "[AI]";

  if (!apiKey) {
    console.log(`${prefix} No API key configured`);
    return null;
  }

  console.log(`${prefix} Config loaded: model=${model}${baseURL ? `, baseURL=${baseURL}` : ""}${apiMode !== "responses" ? `, apiMode=${apiMode}` : ""}${reasoningEffort ? `, reasoning=${reasoningEffort}` : ""}`);
  return { apiKey, model, baseURL, apiMode, reasoningEffort };
}

/**
 * Create a LanguageModelV2 from AIConfig, using the configured API mode.
 */
export function createModel(config: AIConfig): LanguageModelV2 {
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return config.apiMode === "chat"
    ? openai.chat(config.model)
    : openai(config.model);
}
