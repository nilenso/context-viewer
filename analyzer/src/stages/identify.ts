import { generateText } from "ai";
import type { Conversation } from "../model/schema";
import type { DimensionData } from "../model/types";
import type { AIConfig } from "../config";
import { getPrompt } from "./prompts";
import { getProviderOptions, createModel } from "../config";
import { stripLargeContent } from "./strip-large-content";
import { stageLogger } from "../logger";
import { upstreamError, parseError, inputError, type StageError } from "../errors";

const log = stageLogger("identify");

/**
 * Identify components in a conversation using AI.
 * Returns a list of component names.
 */
export async function identifyComponents(
  conversation: Conversation,
  config: AIConfig,
  customPrompt?: string,
): Promise<{ components: string[]; error?: StageError }> {
  const model = createModel(config);

  const strippedConversation = stripLargeContent(conversation);
  const conversationJson = JSON.stringify(strippedConversation, null, 2);

  log.info(`Calling AI to identify components (model: ${config.model})${customPrompt ? " with custom prompt" : ""}`);

  const prompt = getPrompt("component-identification", {
    conversationJson,
    customPrompt,
  });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    log.debug(`AI response for components: ${result.text.substring(0, 200)}...`);

    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) {
      log.warn("No JSON array found in response");
      return { components: [], error: parseError("identify", "AI response contained no JSON array") };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) {
      log.warn("Parsed result is not an array");
      return { components: [], error: parseError("identify", "AI response JSON was not an array") };
    }

    const components = [...new Set(parsed.filter((c): c is string => typeof c === "string"))];
    log.info(`Identified ${components.length} components`, components);
    return { components };
  } catch (error) {
    log.error("Error calling AI for components", error);
    return {
      components: [],
      error: upstreamError("identify", `AI call failed: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * Identify components for a single dimension.
 * Returns partial DimensionData to merge — does not mutate dimData.
 */
export async function identifyForDimension(
  conversation: Conversation,
  dimData: DimensionData,
  config: AIConfig | null,
): Promise<{ result: Partial<DimensionData>; error?: StageError }> {
  const customComponents = dimData.customComponents;

  let components: string[];

  if (customComponents && customComponents.length > 0) {
    const cleaned = customComponents.map((c) => c.replace(/^-\s*/, ""));
    // Idempotent: if components already match customComponents, skip
    if (dimData.discoveredComponents?.length && JSON.stringify(cleaned) === JSON.stringify(dimData.discoveredComponents)) {
      return { result: {} };
    }
    components = cleaned;
  } else if (config) {
    const { components: discovered, error } = await identifyComponents(conversation, config, dimData.prompt);
    if (error) {
      return { result: {}, error };
    }
    components = discovered;
  } else {
    return { result: {}, error: inputError("identify", "No API key configured") };
  }

  return {
    result: {
      discoveredComponents: components,
    },
  };
}
