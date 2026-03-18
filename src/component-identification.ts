import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation } from "./schema";
import { getPrompt, getDefaultComponentIdentificationPrompt } from "./prompts";
import { stripLargeContent } from "./strip-large-content";
import type { AIConfig } from "./ai-config";
import { createPhaseLogger } from "./lib/workflow-log-helpers";

const log = createPhaseLogger("finding-components", "Identification");
const logError = createPhaseLogger("finding-components", "Identification", "error");

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
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

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
      model: openai(config.model),
      prompt,
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
