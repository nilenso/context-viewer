/**
 * Color assignment stage.
 *
 * Algorithm: assign colors to identified components via preset mapping or AI.
 *
 * Workflow wrapper: runAssignColors orchestrates color assignment across
 * all dimensions.
 */

import { generateText } from "ai";
import type { WorkflowState } from "@/model/types";
import { getPrompt } from "./ai/prompts";
import { getProviderOptions, createModel, type AIConfig } from "./ai/config";
import { createPhaseLogger } from "./ai/logger";
import { type Notify, startStep, endStep, timed } from "@/pipeline/notify";
import { ensureDimensions, getDimensionNames } from "@/model/dimensions";

// ---------------------------------------------------------------------------
// Loggers
// ---------------------------------------------------------------------------

const logColoring = createPhaseLogger("coloring", "Coloring");

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

/**
 * Assign colors to components based on preset or AI
 * Returns an object mapping component names to color names
 */
export async function assignComponentColors(
  components: string[],
  config: AIConfig,
  conversationId?: string,
  presetColors?: Record<string, string>,
  customColoringPrompt?: string,
): Promise<Record<string, string>> {
  // If preset colors are provided, use them directly
  if (presetColors) {
    const colorMapping: Record<string, string> = {};
    for (const component of components) {
      colorMapping[component] = presetColors[component] || "gray";
    }
    logColoring(
      conversationId,
      `Using preset colors for ${Object.keys(colorMapping).length} components`,
    );
    return colorMapping;
  }

  // AI-based color assignment
  const model = createModel(config);

  const componentsJson = JSON.stringify(components, null, 2);

  logColoring(
    conversationId,
    `Calling AI to assign colors (model: ${config.model})`,
  );

  const prompt = getPrompt("component-coloring", { componentsJson, customPrompt: customColoringPrompt });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    logColoring(conversationId, `AI response for colors: ${result.text}`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      logColoring(conversationId, "No JSON object found in response");
      return {};
    }

    const rawColorMapping = JSON.parse(jsonMatch[0]);

    if (typeof rawColorMapping !== "object" || rawColorMapping === null) {
      logColoring(conversationId, "Parsed result is not an object");
      return {};
    }

    // Clean up keys - handle various AI response formats:
    // - Remove leading "- " that AI might add
    // - Extract component name from "name: description" format (some models include descriptions)
    const colorMapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawColorMapping)) {
      let cleanKey = key.replace(/^-\s*/, "");

      // If the key contains ": " followed by a description, extract just the component name
      // e.g., "identity: Establishes who the AI is..." -> "identity"
      // But preserve dots in component names like "personality.guidelines"
      const colonDescIndex = cleanKey.indexOf(": ");
      if (colonDescIndex > 0) {
        cleanKey = cleanKey.substring(0, colonDescIndex);
      }

      if (typeof value === "string") {
        colorMapping[cleanKey] = value;
      }
    }

    logColoring(
      conversationId,
      `Assigned colors to ${Object.keys(colorMapping).length} components`,
    );
    return colorMapping;
  } catch (error) {
    logColoring(conversationId, "Error calling AI for colors:", error);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Workflow wrapper
// ---------------------------------------------------------------------------

export async function runAssignColors(ctx: WorkflowState, notify: Notify, onlyDims?: string[]) {
  startStep(notify, ctx, "coloring");
  const { result, timing } = await timed(async () => {
    const dims = ensureDimensions(ctx);
    const dimNames = onlyDims ?? getDimensionNames(ctx);

    await Promise.all(
      dimNames.map(async (dimName) => {
        const dimData = dims[dimName];
        if (!dimData || !ctx.config || !dimData.components?.length) return;

        // Idempotent: if componentColors already covers exactly the current components, skip
        const existingColorKeys = Object.keys(dimData.componentColors || {}).sort();
        const currentComponents = [...dimData.components].sort();
        if (existingColorKeys.length > 0 && JSON.stringify(existingColorKeys) === JSON.stringify(currentComponents)) {
          return;
        }

        const colors = await assignComponentColors(
          dimData.components,
          ctx.config,
          ctx.id,
          ctx.presetColors,
          dimData.customColoringPrompt,
        );
        // Mutate in place — color and classify run in parallel on the same dimData,
        // so replacing the object would race with runClassifyComponents.
        dimData.componentColors = colors;
      }),
    );

    return { dimensions: dims };
  });
  endStep(ctx, "coloring");

  ctx.dimensions = result.dimensions;
  ctx.stepTimings!.coloring = timing;
}
