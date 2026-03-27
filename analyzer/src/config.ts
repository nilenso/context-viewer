/**
 * AI configuration — caller-provided, no env vars.
 *
 * The library never reads environment variables. The caller passes
 * an AnalyzerConfig with all necessary settings.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { LogLevel, LogSink } from "./logger";

// ============================================================================
// Public config types
// ============================================================================

export type ReasoningEffort = "none" | "low" | "medium" | "high";
export type AIApiMode = "responses" | "chat";

export interface AnalyzerConfig {
  apiKey: string;
  model?: string;              // default: "gpt-4o-mini"
  baseURL?: string;
  apiMode?: AIApiMode;         // default: "responses"
  reasoningEffort?: ReasoningEffort;
  logLevel?: LogLevel;         // default: "silent"
  logger?: LogSink;            // custom log sink
}

// ============================================================================
// Internal AIConfig — resolved from AnalyzerConfig, threaded through stages
// ============================================================================

export interface AIConfig {
  apiKey: string;
  model: string;
  baseURL: string | undefined;
  apiMode: AIApiMode;
  reasoningEffort: ReasoningEffort | undefined;
}

export function resolveAIConfig(config: AnalyzerConfig): AIConfig {
  return {
    apiKey: config.apiKey,
    model: config.model || "gpt-4o-mini",
    baseURL: config.baseURL,
    apiMode: config.apiMode || "responses",
    reasoningEffort: config.reasoningEffort,
  };
}

/**
 * Build providerOptions for Vercel AI SDK calls based on config.
 */
export function getProviderOptions(config: AIConfig): Record<string, Record<string, string>> | undefined {
  if (!config.reasoningEffort) return undefined;
  return {
    openai: { reasoningEffort: config.reasoningEffort },
  };
}

/**
 * Create a LanguageModel from AIConfig.
 */
export function createModel(config: AIConfig): LanguageModel {
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  return config.apiMode === "chat"
    ? openai.chat(config.model)
    : openai(config.model);
}
