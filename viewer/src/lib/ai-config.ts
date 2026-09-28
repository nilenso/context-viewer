/** Viewer-local OpenRouter configuration. */

import type { AIStage } from "context-analyzer";

export type { AIApiMode, AIStage, ReasoningEffort } from "context-analyzer";

export const DEFAULT_MODEL = "openai/gpt-6-luna";
export const STAGE_MODEL_OPTIONS: Record<AIStage, Array<{ value: string; label: string }>> = {
  segmenting: [
    { value: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI: GPT-5.4 Mini" },
    { value: "~google/gemini-flash-latest", label: "Google: Gemini Flash Latest" },
  ],
  "identifying-components": [
    { value: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI: GPT-5.4 Mini" },
    { value: "~google/gemini-flash-latest", label: "Google: Gemini Flash Latest" },
  ],
  "classifying-components": [
    { value: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI: GPT-5.4 Mini" },
    { value: "~google/gemini-flash-latest", label: "Google: Gemini Flash Latest" },
    { value: "typesafe/jev-1.13", label: "TypeSafe: Jev 1.13" },
  ],
  coloring: [
    { value: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI: GPT-5.4 Mini" },
    { value: "~google/gemini-flash-latest", label: "Google: Gemini Flash Latest" },
  ],
  summarizing: [{ value: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna" }],
  analyzing: [{ value: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna" }],
};

let runtimeApiKey: string | null = null;
let runtimeStageModels: Partial<Record<AIStage, string>> = {};

export function getModelLabel(model: string): string {
  return Object.values(STAGE_MODEL_OPTIONS).flat().find((option) => option.value === model)?.label || model;
}

export function setRuntimeApiKey(key: string | null): void {
  runtimeApiKey = key;
}

export function getRuntimeApiKey(): string | null {
  return runtimeApiKey;
}

export function setRuntimeStageModel(stage: AIStage, model: string): void {
  runtimeStageModels = { ...runtimeStageModels, [stage]: model };
}

export function getRuntimeStageModels(): Partial<Record<AIStage, string>> {
  return runtimeStageModels;
}

export function hasApiKey(): boolean {
  return !!(runtimeApiKey || import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.VITE_AI_API_KEY);
}

export function isApiKeyFromEnv(): boolean {
  return !!(import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.VITE_AI_API_KEY);
}

export function getAnalyzerConfig() {
  const apiKey = runtimeApiKey || import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.VITE_AI_API_KEY || "";
  const thinkingEnv = (import.meta.env.VITE_AI_THINKING || "").toLowerCase();
  const reasoningEffort = (["none", "low", "medium", "high"].includes(thinkingEnv) ? thinkingEnv : undefined) as
    | "none" | "low" | "medium" | "high" | undefined;

  return {
    apiKey,
    model: import.meta.env.VITE_AI_MODEL || DEFAULT_MODEL,
    stageModels: runtimeStageModels,
    baseURL: import.meta.env.VITE_AI_BASE_URL || "https://openrouter.ai/api/v1",
    apiMode: "chat" as const,
    reasoningEffort,
  };
}
