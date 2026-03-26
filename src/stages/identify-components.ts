import { generateText } from "ai";
import type { Conversation } from "@/model/schema";
import type { DimensionData } from "@/model/types";
import { getPrompt } from "./ai/prompts";
import { getAIConfig, getProviderOptions, createModel, type AIConfig } from "./ai/config";
import { stripLargeContent } from "./ai/strip-large-content";
import { createPhaseLogger } from "@/pipeline/stage-logger";
import { recordCall } from "@/lib/session-recorder";

const log = createPhaseLogger("identifying-components", "Identification");
const logError = createPhaseLogger("identifying-components", "Identification", "error");

/**
 * Identify components in a conversation using AI
 * Returns a list of component names
 */
export async function identifyComponents(
  conversation: Conversation,
  config: AIConfig,
  customPrompt?: string,
  conversationId?: string,
): Promise<string[]> {
  return recordCall("stages/identify-components", "identifyComponents", [{ messageCount: conversation.messages.length, model: config.model, hasCustomPrompt: !!customPrompt }], () => _identifyComponents(conversation, config, customPrompt, conversationId));
}

async function _identifyComponents(
  conversation: Conversation,
  config: AIConfig,
  customPrompt?: string,
  conversationId?: string,
): Promise<string[]> {
  const model = createModel(config);

  // Strip binary data to reduce token count
  const strippedConversation = stripLargeContent(conversation);
  const conversationJson = JSON.stringify(strippedConversation, null, 2);

  log(
    conversationId,
    `Calling AI to identify components (model: ${config.model})${customPrompt ? " with custom prompt" : ""}`,
  );

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

    log(
      conversationId,
      `AI response for components: ${result.text.substring(0, 200)}...`,
    );

    // Parse the JSON response
    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) {
      log(conversationId, "No JSON array found in response");
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) {
      log(conversationId, "Parsed result is not an array");
      return [];
    }

    // Deduplicate - AI may return duplicates
    const components = [...new Set(parsed.filter((c): c is string => typeof c === "string"))];

    log(
      conversationId,
      `Identified ${components.length} components`,
      components,
    );
    return components;
  } catch (error) {
    logError(conversationId, "Error calling AI for components", error);
    return [];
  }
}

// --- Pure single-dimension stage ---

/**
 * Identify components for a single dimension.
 * Returns partial DimensionData to merge — does not mutate dimData.
 */
export async function identifyForDimension(
  conversation: Conversation,
  dimData: DimensionData,
  config: AIConfig | null,
  conversationId?: string,
): Promise<{ result: Partial<DimensionData>; error?: string }> {
  return recordCall("stages/identify-components", "identifyForDimension", [{ dimName: dimData.name, componentCount: dimData.discoveredComponents?.length, hasCustomComponents: !!dimData.customComponents?.length }], () => _identifyForDimension(conversation, dimData, config, conversationId));
}

async function _identifyForDimension(
  conversation: Conversation,
  dimData: DimensionData,
  config: AIConfig | null,
  conversationId?: string,
): Promise<{ result: Partial<DimensionData>; error?: string }> {
  const prompt = dimData.prompt;
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
    try {
      components = await identifyComponents(conversation, config, prompt, conversationId);
    } catch (e: any) {
      return { result: {}, error: e.message };
    }
  } else {
    return { result: {}, error: "No API key configured" };
  }

  return {
    result: {
      discoveredComponents: components,
    },
  };
}
