/**
 * Component classification: map/classify each conversation part to a component.
 *
 * Takes the component list from identification and assigns each part to one.
 * Also builds the component timeline.
 */

import type { WorkflowState } from "./types";
import { mapComponentsToIds, buildComponentTimeline } from "../component-classification";
import { getAIConfig } from "../ai-config";
import { getDefaultComponentIdentificationPrompt } from "../prompts";
import { timed } from "./notify";
import { ensureDimensions, getDimensionNames } from "./dimensions";

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
