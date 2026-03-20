/**
 * Component classification stage.
 *
 * Algorithm: map/classify each conversation part to a component using AI,
 * then build a component timeline.
 *
 * Workflow wrapper: runClassifyComponents orchestrates classification across
 * all dimensions.
 */

import { generateText } from "ai";
import type { Conversation } from "@/model/schema";
import type { WorkflowState, ComponentTimelineSnapshot } from "@/model/types";
import {
  getPrompt,
  getDefaultComponentIdentificationPrompt,
} from "./ai/prompts";
import {
  getAIConfig,
  getProviderOptions,
  createModel,
  type AIConfig,
} from "./ai/config";
import { stripLargeContent } from "./ai/strip-large-content";
import { createPhaseLogger } from "./ai/logger";
import { buildComponentTimeline as buildComponentTimelineCore } from "@/operations/aggregation";
import { timed } from "@/pipeline/notify";
import { ensureDimensions, getDimensionNames } from "@/model/dimensions";

// ---------------------------------------------------------------------------
// Loggers
// ---------------------------------------------------------------------------

const log = createPhaseLogger("classifying-components", "Classification");
const logError = createPhaseLogger(
  "classifying-components",
  "Classification",
  "error",
);

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

/**
 * Extract all parts from a conversation with their context
 */
interface PartWithContext {
  partId: string;
  messageIndex: number;
  role: string;
  partType: string;
  content: unknown;
}

function extractPartsWithContext(
  conversation: Conversation,
): PartWithContext[] {
  const parts: PartWithContext[] = [];

  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      let content: unknown;

      // Extract relevant content based on part type
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

      parts.push({
        partId: part.id,
        messageIndex,
        role: message.role,
        partType: part.type,
        content,
      });
    });
  });

  return parts;
}

/**
 * Map a batch of parts to components using AI
 */
async function mapPartsBatch(
  parts: PartWithContext[],
  components: string[],
  config: AIConfig,
  componentDescriptions?: string,
  conversationId?: string,
): Promise<Record<string, string>> {
  const model = createModel(config);

  // Create a simplified conversation structure for just these parts
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

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      log(conversationId, "No JSON object found in batch response");
      return {};
    }

    const rawMapping = JSON.parse(jsonMatch[0]);

    if (typeof rawMapping !== "object" || rawMapping === null) {
      log(conversationId, "Parsed batch result is not an object");
      return {};
    }

    // Normalize component names - strip leading "- " that AI might add
    const mapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMapping)) {
      if (typeof value === "string") {
        mapping[key] = value.replace(/^-\s*/, "");
      }
    }

    return mapping;
  } catch (error) {
    logError(conversationId, "Error calling AI for batch mapping", error);
    return {};
  }
}

/**
 * Map message IDs to components using AI
 * Processes parts in batches of 20 in parallel for better coverage
 * Returns an object mapping message part IDs to component names
 */
export async function mapComponentsToIds(
  conversation: Conversation,
  components: string[],
  config: AIConfig,
  componentDescriptions?: string,
  conversationId?: string,
): Promise<Record<string, string>> {
  const BATCH_SIZE = 20;

  // Strip binary data and extract parts with context
  const strippedConversation = stripLargeContent(conversation);
  const allParts = extractPartsWithContext(strippedConversation);

  log(
    conversationId,
    `Mapping ${allParts.length} parts in batches of ${BATCH_SIZE} (model: ${config.model})`,
  );

  // Split parts into batches
  const batches: PartWithContext[][] = [];
  for (let i = 0; i < allParts.length; i += BATCH_SIZE) {
    batches.push(allParts.slice(i, i + BATCH_SIZE));
  }

  log(conversationId, `Processing ${batches.length} batches in parallel`);

  // Process all batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, index) => {
      log(
        conversationId,
        `Starting batch ${index + 1}/${batches.length} (${batch.length} parts)`,
      );
      return mapPartsBatch(batch, components, config, componentDescriptions, conversationId);
    }),
  );

  // Merge all batch results into a single mapping
  const mergedMapping: Record<string, string> = {};
  batchResults.forEach((batchMapping, index) => {
    const entriesCount = Object.keys(batchMapping).length;
    log(conversationId, `Batch ${index + 1} returned ${entriesCount} mappings`);
    Object.assign(mergedMapping, batchMapping);
  });

  log(
    conversationId,
    `Created merged mapping with ${Object.keys(mergedMapping).length} entries (from ${allParts.length} parts)`,
  );
  return mergedMapping;
}

/**
 * Build a component timeline with workflow logging.
 * Thin wrapper around the pure function in aggregation.ts.
 */
export function buildComponentTimeline(
  conversation: Conversation,
  componentMapping: Record<string, string>,
  conversationId?: string,
): ComponentTimelineSnapshot[] {
  log(conversationId, "Building component timeline");

  // Log mapping coverage for debugging
  const totalParts = conversation.messages.reduce((s, m) => s + m.parts.length, 0);
  const mappedCount = Object.keys(componentMapping).length;
  log(
    conversationId,
    `Mapping coverage: ${mappedCount}/${totalParts} parts (${Math.round((mappedCount / totalParts) * 100)}%)`,
  );

  const timeline = buildComponentTimelineCore(conversation, componentMapping);

  log(conversationId, `Built timeline with ${timeline.length} snapshots`);
  return timeline;
}

// ---------------------------------------------------------------------------
// Workflow wrapper
// ---------------------------------------------------------------------------

export async function runClassifyComponents(ctx: WorkflowState, onlyDims?: string[]): Promise<{ timing: number }> {
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = onlyDims ?? getDimensionNames(ctx);

    const config = getAIConfig("Componentisation");
    const errors: string[] = [];

    await Promise.all(
      dimNames.map(async (dimName) => {
        const dimData = dims[dimName];
        if (!dimData || !config || !dimData.components?.length) return;

        // Idempotent: if mapping already covers all parts and maps to current components, skip
        const mapping = dimData.componentMapping;
        if (mapping && Object.keys(mapping).length > 0) {
          const allPartIds = ctx.conversation!.messages.flatMap(m => m.parts.map(p => p.id));
          const partIdSet = new Set(allPartIds);
          const componentSet = new Set(dimData.components);
          const hasOther = componentSet.has("other");
          // Mapping keys must reference current part IDs (not stale from a previous segmentation)
          const mappingKeysValid = Object.keys(mapping).every(id => partIdSet.has(id));
          const allClassified = allPartIds.every(id => id in mapping || hasOther);
          const allMappedToCurrentComponents = Object.values(mapping).every(comp => componentSet.has(comp));
          if (mappingKeysValid && allClassified && allMappedToCurrentComponents) {
            return;
          }
        }

        const prompt = dimData.prompt;
        const componentDescriptions = prompt || getDefaultComponentIdentificationPrompt();

        try {
          const mapping = await mapComponentsToIds(
            ctx.conversation!,
            dimData.components,
            config,
            componentDescriptions,
            ctx.id,
          );

          const totalParts = ctx.conversation!.messages.reduce(
            (sum, msg) => sum + msg.parts.length, 0,
          );
          const mappedParts = Object.keys(mapping).length;
          const finalComponents =
            mappedParts < totalParts && !dimData.components.includes("other")
              ? [...dimData.components, "other"]
              : dimData.components;

          const timeline = buildComponentTimeline(ctx.conversation!, mapping);

          // Mutate in place — classify and color run in parallel on the same dimData,
          // so replacing the object would race with runAssignColors.
          dimData.components = finalComponents;
          dimData.componentMapping = mapping;
          dimData.componentTimeline = timeline;
        } catch (e: any) {
          errors.push(`[${dimName}] Classification failed: ${e.message}`);
        }
      }),
    );

    return { dimensions: dims, errors };
  });

  ctx.dimensions = result.dimensions;
  if (result.errors.length > 0) ctx.warnings!.push(result.errors.join("; "));

  return { timing };
}
