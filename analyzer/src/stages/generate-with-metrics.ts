import { generateText } from "ai";
import type { AIConfig, AIStage } from "../config";
import { createModel, getProviderOptions, getStageModel } from "../config";

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
  const model = getStageModel(config, stage);
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: createModel({ ...config, model }),
      prompt,
      providerOptions: getProviderOptions(config),
    });
    const endedAt = Date.now();
    config.recordCall?.(stage, {
      model,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      costUsd: getCost(result),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      request: stage === "identifying-components" || stage === "classifying-components" ? prompt : undefined,
      response: stage === "identifying-components" || stage === "classifying-components" ? result.text : undefined,
    });
    return result;
  } catch (error) {
    const endedAt = Date.now();
    config.recordCall?.(stage, {
      model,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      request: stage === "identifying-components" || stage === "classifying-components" ? prompt : undefined,
    });
    throw error;
  }
}
