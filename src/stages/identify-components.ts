import { generateText } from "ai";
import type { Conversation } from "@/model/schema";
import type { WorkflowState } from "@/model/types";
import { timed } from "@/pipeline/notify";
import { getPrompt } from "./ai/prompts";
import { getAIConfig, getProviderOptions, createModel, type AIConfig } from "./ai/config";
import { stripLargeContent } from "./ai/strip-large-content";
import { createPhaseLogger } from "./ai/logger";
import { ensureDimensions, getDimensionNames } from "@/model/dimensions";

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

// --- Workflow runner ---

export async function runIdentifyComponents(ctx: WorkflowState, onlyDims?: string[]): Promise<{ timing: number }> {
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = onlyDims ?? getDimensionNames(ctx);

    const config = getAIConfig("Componentisation");
    const errors: string[] = [];

    await Promise.all(
      dimNames.map(async (dimName) => {
        const dimData = dims[dimName];
        const prompt = dimData?.prompt;
        const customComponents = dimData?.customComponents;

        let components: string[];

        if (customComponents && customComponents.length > 0) {
          const cleaned = customComponents.map((c) => c.replace(/^-\s*/, ""));
          // Idempotent: if components already match customComponents, skip
          if (dimData?.components?.length && JSON.stringify(cleaned) === JSON.stringify(dimData.components)) {
            return;
          }
          components = cleaned;
        } else if (config) {
          try {
            components = await identifyComponents(ctx.conversation!, config, prompt, ctx.id);
          } catch (e: any) {
            errors.push(`[${dimName}] ${e.message}`);
            components = [];
          }
        } else {
          errors.push(`[${dimName}] No API key configured`);
          components = [];
        }

        dims[dimName] = {
          ...(dims[dimName] || { name: dimName }),
          name: dimName,
          prompt,
          components,
          componentMapping: dims[dimName]?.componentMapping || {},
          componentTimeline: dims[dimName]?.componentTimeline || [],
          componentColors: dims[dimName]?.componentColors || {},
          customComponents,
        };
      }),
    );

    return { dimensions: dims, errors };
  });

  ctx.dimensions = result.dimensions;
  if (result.errors.length > 0) ctx.warnings!.push(result.errors.join("; "));

  return { timing };
}

export { buildComponentTimeline } from "./classify-components";
