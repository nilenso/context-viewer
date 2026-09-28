import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("../../config", async (importOriginal) => {
  const config = await importOriginal<typeof import("../../config")>();
  return { ...config, createModel: () => ({}) };
});

import { generateText } from "ai";
import { generateWithMetrics } from "../../stages/generate-with-metrics";
import type { AIConfig, AICallMetric } from "../../config";

const baseConfig: AIConfig = {
  apiKey: "key",
  model: "model",
  apiMode: "chat",
  baseURL: "https://openrouter.ai/api/v1",
  reasoningEffort: undefined,
};

describe("generateWithMetrics", () => {
  it("records cost returned in OpenRouter usage", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok", usage: { cost: 0.00123 } } as any);
    const calls: Array<{ stage: string; metric: AICallMetric }> = [];

    await generateWithMetrics("segmenting", "prompt", {
      ...baseConfig,
      stageModels: { segmenting: "segment-model" },
      recordCall: (stage, metric) => calls.push({ stage, metric }),
    });

    expect(calls).toEqual([{ stage: "segmenting", metric: { costUsd: 0.00123, model: "segment-model" } }]);
  });

  it("records unknown cost when response omits it", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "ok" } as any);
    const calls: AICallMetric[] = [];

    await generateWithMetrics("segmenting", "prompt", {
      ...baseConfig,
      recordCall: (_stage, metric) => calls.push(metric),
    });

    expect(calls).toEqual([{ model: "model" }]);
  });
});
