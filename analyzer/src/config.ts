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
export type AIStage =
  | "segmenting"
  | "identifying-components"
  | "classifying-components"
  | "coloring"
  | "summarizing"
  | "analyzing";

export interface AnalyzerConfig {
  apiKey: string;
  model?: string;              // default: "openai/gpt-6-luna"
  stageModels?: Partial<Record<AIStage, string>>;
  baseURL?: string;
  apiMode?: AIApiMode;         // default: "responses"
  reasoningEffort?: ReasoningEffort;
  logLevel?: LogLevel;         // default: "silent"
  logger?: LogSink;            // custom log sink
}

// ============================================================================
// Internal AIConfig — resolved from AnalyzerConfig, threaded through stages
// ============================================================================

export interface AICallMetric {
  costUsd?: number;
  model: string;
}

export interface AIConfig {
  apiKey: string;
  model: string;
  stageModels?: Partial<Record<AIStage, string>>;
  baseURL: string | undefined;
  apiMode: AIApiMode;
  reasoningEffort: ReasoningEffort | undefined;
  recordCall?: (stage: string, metric: AICallMetric) => void;
}

export function resolveAIConfig(config: AnalyzerConfig): AIConfig {
  return {
    apiKey: config.apiKey,
    model: config.model || "openai/gpt-6-luna",
    stageModels: config.stageModels || {},
    baseURL: config.baseURL,
    apiMode: config.apiMode || "responses",
    reasoningEffort: config.reasoningEffort,
  };
}

/**
 * Build providerOptions for Vercel AI SDK calls based on config.
 */
export function getStageModel(config: AIConfig, stage: AIStage): string {
  return config.stageModels?.[stage] || config.model;
}

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
