/**
 * Color assignment stage.
 * Assigns colors to identified components via preset mapping or AI.
 */

import { generateText } from "ai";
import type { DimensionData } from "../model/types";
import type { AIConfig } from "../config";
import { getPrompt } from "./prompts";
import { getProviderOptions, createModel } from "../config";
import { stageLogger } from "../logger";
import { upstreamError, parseError, type StageError } from "../errors";

const log = stageLogger("color");

export async function assignComponentColors(
  components: string[],
  config: AIConfig,
  presetColors?: Record<string, string>,
  customColoringPrompt?: string,
): Promise<{ colors: Record<string, string>; error?: StageError }> {
  // If preset colors are provided, use them directly
  if (presetColors) {
    const colorMapping: Record<string, string> = {};
    for (const component of components) {
      colorMapping[component] = presetColors[component] || "gray";
    }
    log.info(`Using preset colors for ${Object.keys(colorMapping).length} components`);
    return { colors: colorMapping };
  }

  // AI-based color assignment
  const model = createModel(config);
  const componentsJson = JSON.stringify(components, null, 2);

  log.info(`Calling AI to assign colors (model: ${config.model})`);

  const prompt = getPrompt("component-coloring", { componentsJson, customPrompt: customColoringPrompt });

  try {
    const result = await generateText({
      model,
      prompt,
      providerOptions: getProviderOptions(config),
    });

    log.debug(`AI response for colors: ${result.text}`);

    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      log.warn("No JSON object found in response");
      return { colors: {}, error: parseError("color", "AI response contained no JSON object") };
    }

    const rawColorMapping = JSON.parse(jsonMatch[0]);

    if (typeof rawColorMapping !== "object" || rawColorMapping === null) {
      log.warn("Parsed result is not an object");
      return { colors: {}, error: parseError("color", "AI response JSON was not an object") };
    }

    const colorMapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawColorMapping)) {
      let cleanKey = key.replace(/^-\s*/, "");
      const colonDescIndex = cleanKey.indexOf(": ");
      if (colonDescIndex > 0) {
        cleanKey = cleanKey.substring(0, colonDescIndex);
      }
      if (typeof value === "string") {
        colorMapping[cleanKey] = value;
      }
    }

    log.info(`Assigned colors to ${Object.keys(colorMapping).length} components`);
    return { colors: colorMapping };
  } catch (error) {
    log.error("Error calling AI for colors:", error);
    return {
      colors: {},
      error: upstreamError("color", `AI call failed: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * Assign colors for a single dimension.
 * Returns partial DimensionData to merge — does not mutate dimData.
 */
export async function colorForDimension(
  dimData: DimensionData,
  config: AIConfig,
  presetColors?: Record<string, string>,
): Promise<{ result: Partial<DimensionData>; error?: StageError }> {
  if (!dimData.discoveredComponents?.length) return { result: {} };

  // Idempotent: if componentColors already covers exactly the current components, skip
  const existingColorKeys = Object.keys(dimData.componentColors || {}).sort();
  const currentComponents = [...dimData.discoveredComponents].sort();
  if (existingColorKeys.length > 0 && JSON.stringify(existingColorKeys) === JSON.stringify(currentComponents)) {
    return { result: {} };
  }

  const { colors, error } = await assignComponentColors(
    dimData.discoveredComponents,
    config,
    presetColors,
    dimData.customColoringPrompt,
  );

  return { result: { componentColors: colors }, error };
}
