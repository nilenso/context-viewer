/**
 * Component classification stage.
 *
 * Map/classify each conversation part to a component using AI,
 * then build a component timeline.
 */

import type { Conversation } from "../model/schema";
import type { DimensionData, ComponentTimelineSnapshot } from "../model/types";
import { getStageModel, type AIConfig } from "../config";
import { getPrompt, getDefaultComponentIdentificationPrompt } from "./prompts";
import { generateWithMetrics } from "./generate-with-metrics";
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
  const partsJson = JSON.stringify(parts, null, 2);
  const componentsJson = JSON.stringify(components, null, 2);

  const prompt = getPrompt("component-classification", {
    conversationJson: partsJson,
    componentsJson,
    componentDescriptions: componentDescriptions || "",
  });

  try {
    const result = await generateWithMetrics("classifying-components", prompt, config);

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

const TYPESAFE_MODEL = "typesafe/jev-1.13";
const OPENROUTER_TYPESAFE_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function mapPartsBatchWithJev(
  parts: PartWithContext[],
  components: string[],
  descriptions: Record<string, string>,
  dimensionName: string,
  config: AIConfig,
): Promise<{ mapping: Record<string, string>; error?: StageError }> {
  const request = {
    state: {
      parts: parts.map(({ partId, ...part }) => ({ id: partId, ...part })),
    },
    model: TYPESAFE_MODEL,
    questions: Object.fromEntries(parts.map((part) => [
      part.partId,
      {
        type: "choice",
        instructions: `In the ${dimensionName} dimension, classify the object in \`state.parts\` whose \`id\` is \`${part.partId}\`. Classify its semantic content; use its role and partType only as context.`,
        criteria: Object.fromEntries(components.map((component) => [component, descriptions[component] || null])),
      },
    ])),
  };
  const startedAt = Date.now();
  let response: Response;
  let responseText: string;

  try {
    response = await fetch(OPENROUTER_TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    responseText = await response.text();
  } catch (error) {
    const endedAt = Date.now();
    config.recordCall?.("classifying-components", {
      model: TYPESAFE_MODEL,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      request: JSON.stringify(request, null, 2),
    });
    return { mapping: {}, error: upstreamError("classify", `OpenRouter Decisions API call failed: ${error instanceof Error ? error.message : String(error)}`) };
  }

  const endedAt = Date.now();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = undefined;
  }
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  config.recordCall?.("classifying-components", {
    model: TYPESAFE_MODEL,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    request: JSON.stringify(request, null, 2),
    response: responseText,
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
    outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    costUsd: typeof usage?.cost === "number" ? usage.cost : undefined,
  });

  if (!response.ok) {
    return { mapping: {}, error: upstreamError("classify", `OpenRouter Decisions API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ""}`.trim()) };
  }

  if (!payload) {
    return { mapping: {}, error: parseError("classify", "OpenRouter Decisions response was not valid JSON") };
  }

  const answers = isRecord(payload) && isRecord(payload.answers) ? payload.answers : undefined;
  if (!answers) return { mapping: {}, error: parseError("classify", "OpenRouter Decisions response contained no answers object") };

  const allowedChoices = new Set(components);
  const mapping: Record<string, string> = {};
  let malformed = false;
  parts.forEach((part) => {
    const answer = answers[part.partId];
    if (!isRecord(answer) || typeof answer.choice !== "string" || !allowedChoices.has(answer.choice)) {
      malformed = true;
      return;
    }
    mapping[part.partId] = answer.choice;
  });

  return {
    mapping,
    error: malformed ? parseError("classify", "OpenRouter Decisions response contained an invalid or missing Choice answer") : undefined,
  };
}

async function mapComponentsToIdsWithJev(
  conversation: Conversation,
  components: string[],
  descriptions: Record<string, string>,
  dimensionName: string,
  config: AIConfig,
): Promise<{ mapping: Record<string, string>; errors: StageError[] }> {
  const allParts = extractPartsWithContext(stripLargeContent(conversation));
  const batches: PartWithContext[][] = [];
  for (let index = 0; index < allParts.length; index += 20) batches.push(allParts.slice(index, index + 20));

  log.info(`Mapping ${allParts.length} parts with Jev in ${batches.length} parallel batches of 20`);
  const results = await Promise.all(
    batches.map((batch) => mapPartsBatchWithJev(batch, components, descriptions, dimensionName, config)),
  );
  const mapping: Record<string, string> = {};
  const errors: StageError[] = [];
  for (const result of results) {
    Object.assign(mapping, result.mapping);
    if (result.error) errors.push(result.error);
  }
  return { mapping, errors };
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

  log.info(`Mapping ${allParts.length} parts in batches of ${BATCH_SIZE} (model: ${getStageModel(config, "classifying-components")})`);

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

  const { mapping, errors } = getStageModel(config, "classifying-components") === TYPESAFE_MODEL
    ? await mapComponentsToIdsWithJev(
        conversation,
        dimData.discoveredComponents,
        dimData.componentDescriptions || {},
        dimData.name,
        config,
      )
    : await mapComponentsToIds(
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
