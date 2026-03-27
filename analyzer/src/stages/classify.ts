/**
 * Component classification stage.
 *
 * Map/classify each conversation part to a component using AI,
 * then build a component timeline.
 */

import { generateText } from "ai";
import type { Conversation } from "../model/schema";
import type { DimensionData, ComponentTimelineSnapshot } from "../model/types";
import type { AIConfig } from "../config";
import { getPrompt, getDefaultComponentIdentificationPrompt } from "./prompts";
import { getProviderOptions, createModel } from "../config";
import { stripLargeContent } from "./strip-large-content";
import { stageLogger } from "../logger";
import { buildComponentTimeline as buildComponentTimelineCore } from "../operations/aggregation";
import { upstreamError, parseError, type StageError } from "../errors";

const log = stageLogger("classify");

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

interface PartWithContext {
  partId: string;
  messageIndex: number;
  role: string;
  partType: string;
  content: unknown;
}

function extractPartsWithContext(conversation: Conversation): PartWithContext[] {
  const parts: PartWithContext[] = [];

  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      let content: unknown;

      if (part.type === "text" || part.type === "reasoning") {
        content = part.text;
      } else if (part.type === "tool-call") {
        content = { toolName: part.toolName, input: part.input };
      } else if (part.type === "tool-result") {
        content = { toolName: part.toolName, output: part.output };
      } else if (part.type === "image") {
        content = "[IMAGE]";
      } else if (part.type === "file") {
        content = "[FILE]";
      }

      parts.push({ partId: part.id, messageIndex, role: message.role, partType: part.type, content });
    });
  });

  return parts;
}

async function mapPartsBatch(
  parts: PartWithContext[],
  components: string[],
  config: AIConfig,
  componentDescriptions?: string,
): Promise<{ mapping: Record<string, string>; error?: StageError }> {
  const model = createModel(config);

  const partsJson = JSON.stringify(parts, null, 2);
  const componentsJson = JSON.stringify(components, null, 2);

  const prompt = getPrompt("component-classification", {
    conversationJson: partsJson,
    componentsJson,
    componentDescriptions: componentDescriptions || "",
  });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      log.warn("No JSON object found in batch response");
      return { mapping: {}, error: parseError("classify", "AI response contained no JSON object") };
    }

    const rawMapping = JSON.parse(jsonMatch[0]);

    if (typeof rawMapping !== "object" || rawMapping === null) {
      log.warn("Parsed batch result is not an object");
      return { mapping: {}, error: parseError("classify", "AI response JSON was not an object") };
    }

    const mapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMapping)) {
      if (typeof value === "string") {
        mapping[key] = value.replace(/^-\s*/, "");
      }
    }

    return { mapping };
  } catch (error) {
    log.error("Error calling AI for batch mapping", error);
    return {
      mapping: {},
      error: upstreamError("classify", `AI call failed: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

export async function mapComponentsToIds(
  conversation: Conversation,
  components: string[],
  config: AIConfig,
  componentDescriptions?: string,
): Promise<{ mapping: Record<string, string>; errors: StageError[] }> {
  const BATCH_SIZE = 20;
  const errors: StageError[] = [];

  const strippedConversation = stripLargeContent(conversation);
  const allParts = extractPartsWithContext(strippedConversation);

  log.info(`Mapping ${allParts.length} parts in batches of ${BATCH_SIZE} (model: ${config.model})`);

  const batches: PartWithContext[][] = [];
  for (let i = 0; i < allParts.length; i += BATCH_SIZE) {
    batches.push(allParts.slice(i, i + BATCH_SIZE));
  }

  log.info(`Processing ${batches.length} batches in parallel`);

  const batchResults = await Promise.all(
    batches.map((batch, index) => {
      log.debug(`Starting batch ${index + 1}/${batches.length} (${batch.length} parts)`);
      return mapPartsBatch(batch, components, config, componentDescriptions);
    }),
  );

  const mergedMapping: Record<string, string> = {};
  batchResults.forEach((result, index) => {
    const entriesCount = Object.keys(result.mapping).length;
    log.debug(`Batch ${index + 1} returned ${entriesCount} mappings`);
    Object.assign(mergedMapping, result.mapping);
    if (result.error) errors.push(result.error);
  });

  log.info(`Created merged mapping with ${Object.keys(mergedMapping).length} entries (from ${allParts.length} parts)`);
  return { mapping: mergedMapping, errors };
}

/**
 * Build a component timeline with logging.
 * Thin wrapper around the pure function in aggregation.ts.
 */
export function buildComponentTimeline(
  conversation: Conversation,
  componentMapping: Record<string, string>,
): ComponentTimelineSnapshot[] {
  log.debug("Building component timeline");

  const totalParts = conversation.messages.reduce((s, m) => s + m.parts.length, 0);
  const mappedCount = Object.keys(componentMapping).length;
  log.debug(`Mapping coverage: ${mappedCount}/${totalParts} parts (${Math.round((mappedCount / totalParts) * 100)}%)`);

  const timeline = buildComponentTimelineCore(conversation, componentMapping);

  log.debug(`Built timeline with ${timeline.length} snapshots`);
  return timeline;
}

// ---------------------------------------------------------------------------
// Pure single-dimension stage
// ---------------------------------------------------------------------------

export async function classifyForDimension(
  conversation: Conversation,
  dimData: DimensionData,
  config: AIConfig,
): Promise<{ result: Partial<DimensionData>; error?: StageError }> {
  if (!dimData.discoveredComponents?.length) return { result: {} };

  // Idempotent: if mapping already covers all parts and maps to current components, skip
  const existingMapping = dimData.componentMapping;
  if (existingMapping && Object.keys(existingMapping).length > 0) {
    const allPartIds = conversation.messages.flatMap(m => m.parts.map(p => p.id));
    const partIdSet = new Set(allPartIds);
    const componentSet = new Set(dimData.discoveredComponents);
    const hasOther = componentSet.has("other");
    const mappingKeysValid = Object.keys(existingMapping).every(id => partIdSet.has(id));
    const allClassified = allPartIds.every(id => id in existingMapping || hasOther);
    const allMappedToCurrentComponents = Object.values(existingMapping).every(comp => componentSet.has(comp));
    if (mappingKeysValid && allClassified && allMappedToCurrentComponents) {
      return { result: {} };
    }
  }

  // Use component descriptions if available, otherwise fall back to prompt
  let componentDescriptions: string;
  if (dimData.componentDescriptions && Object.keys(dimData.componentDescriptions).length > 0) {
    componentDescriptions = Object.entries(dimData.componentDescriptions)
      .map(([name, desc]) => `- ${name}: ${desc}`)
      .join("\n");
  } else {
    componentDescriptions = dimData.prompt || getDefaultComponentIdentificationPrompt();
  }

  const { mapping, errors } = await mapComponentsToIds(
    conversation,
    dimData.discoveredComponents,
    config,
    componentDescriptions,
  );

  const totalParts = conversation.messages.reduce((sum, msg) => sum + msg.parts.length, 0);
  const mappedParts = Object.keys(mapping).length;
  const finalComponents =
    mappedParts < totalParts && !dimData.discoveredComponents.includes("other")
      ? [...dimData.discoveredComponents, "other"]
      : dimData.discoveredComponents;

  const timeline = buildComponentTimeline(conversation, mapping);

  return {
    result: {
      discoveredComponents: finalComponents,
      componentMapping: mapping,
      componentTimeline: timeline,
    },
    error: errors.length > 0 ? errors[0] : undefined,
  };
}
