/** Viewer-local OpenRouter configuration. */

import type { AIStage } from "context-analyzer";

export type { AIApiMode, AIStage, ReasoningEffort } from "context-analyzer";

export const DEFAULT_MODEL = "openai/gpt-6-luna";
export const STAGE_MODEL_OPTIONS: Record<AIStage, Array<{ value: string; label: string }>> = {
  segmenting: [
    { value: "openai/gpt-6-luna", label: "Luna 6" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI Mini" },
    { value: "~google/gemini-flash-latest", label: "Google Flash" },
  ],
  "identifying-components": [
    { value: "openai/gpt-6-luna", label: "Luna 6" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI Mini" },
    { value: "~google/gemini-flash-latest", label: "Google Flash" },
  ],
  "classifying-components": [
    { value: "openai/gpt-6-luna", label: "Luna 6" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI Mini" },
    { value: "~google/gemini-flash-latest", label: "Google Flash" },
    { value: "typesafe/jev-router", label: "Jev" },
  ],
  coloring: [
    { value: "openai/gpt-6-luna", label: "Luna 6" },
    { value: "openai/gpt-5.4-mini", label: "OpenAI Mini" },
    { value: "~google/gemini-flash-latest", label: "Google Flash" },
  ],
  summarizing: [{ value: "openai/gpt-6-luna", label: "Luna 6" }],
  analyzing: [{ value: "openai/gpt-6-luna", label: "Luna 6" }],
};

const configurableStages: AIStage[] = [
  "segmenting",
  "identifying-components",
  "classifying-components",
  "coloring",
];

let runtimeApiKey: string | null = null;
let runtimeStageModels: Partial<Record<AIStage, string>> = Object.fromEntries(
  configurableStages.map((stage) => [stage, import.meta.env.VITE_AI_MODEL || DEFAULT_MODEL]),
);

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
