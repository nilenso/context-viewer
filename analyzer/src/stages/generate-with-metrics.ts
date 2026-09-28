import { generateText } from "ai";
import type { AIConfig, AIStage } from "../config";
import { createModel, getProviderOptions } from "../config";

function getCost(result: unknown): number | undefined {
  const value = result as {
    usage?: { cost?: unknown };
    providerMetadata?: {
      openrouter?: { cost?: unknown; usage?: { cost?: unknown } };
      openai?: { cost?: unknown; usage?: { cost?: unknown } };
    };
    response?: { body?: { usage?: { cost?: unknown } } };
  };
  const candidates = [
    value.usage?.cost,
    value.providerMetadata?.openrouter?.cost,
    value.providerMetadata?.openrouter?.usage?.cost,
    value.providerMetadata?.openai?.cost,
    value.providerMetadata?.openai?.usage?.cost,
    value.response?.body?.usage?.cost,
  ];
  return candidates.find((candidate): candidate is number =>
    typeof candidate === "number" && Number.isFinite(candidate),
  );
}

export async function generateWithMetrics(stage: AIStage, prompt: string, config: AIConfig) {
  const model = config.stageModels?.[stage] || config.model;
  try {
    const result = await generateText({
      model: createModel({ ...config, model }),
      prompt,
      providerOptions: getProviderOptions(config),
    });
    config.recordCall?.(stage, { costUsd: getCost(result), model });
    return result;
  } catch (error) {
    config.recordCall?.(stage, { model });
    throw error;
  }
}
