import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation, Message } from "./schema";
import { getPrompt } from "./prompts";

/**
 * Strip large binary data (images, files) from conversation before sending to AI
 * This reduces token count significantly while preserving structure for categorization
 */
function stripBinaryData(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message): Message => ({
      ...message,
      parts: message.parts.map((part) => {
        if (part.type === "image") {
          return {
            ...part,
            image: "[IMAGE_STRIPPED]",
          };
        }
        if (part.type === "file") {
          return {
            ...part,
            data: "[FILE_DATA_STRIPPED]",
          };
        }
        return part;
      }),
    } as Message)),
  };
}

/**
 * Configuration for AI model used in componentisation
 */
interface ComponentisationConfig {
  apiKey: string;
  model: string;
}

/**
 * Get componentisation configuration from environment variables
 */
export function getComponentisationConfig(): ComponentisationConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    console.log("[Componentisation] No API key configured, skipping componentisation");
    return null;
  }

  console.log(`[Componentisation] Config loaded: model=${model}`);
  return { apiKey, model };
}

/**
 * Identify components in a conversation using AI
 * Returns a list of component names
 */
export async function identifyComponents(
  conversation: Conversation,
  config: ComponentisationConfig,
  customPrompt?: string
): Promise<string[]> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  // Strip binary data to reduce token count
  const strippedConversation = stripBinaryData(conversation);
  const conversationJson = JSON.stringify(strippedConversation, null, 2);

  console.log(`[Componentisation] Calling AI to identify components (model: ${config.model})${customPrompt ? ' with custom prompt' : ''}`);

  const prompt = getPrompt("component-identification", { conversationJson, customPrompt });

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    console.log(`[Componentisation] AI response for components: ${result.text}`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) {
      console.log("[Componentisation] No JSON array found in response");
      return [];
    }

    const components = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(components)) {
      console.log("[Componentisation] Parsed result is not an array");
      return [];
    }

    console.log(`[Componentisation] Identified ${components.length} components:`, components);
    return components;
  } catch (error) {
    console.error("[Componentisation] Error calling AI for components:", error);
    return [];
  }
}

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

function extractPartsWithContext(conversation: Conversation): PartWithContext[] {
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
  config: ComponentisationConfig
): Promise<Record<string, string>> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  // Create a simplified conversation structure for just these parts
  const partsJson = JSON.stringify(parts, null, 2);
  const componentsJson = JSON.stringify(components, null, 2);

  const prompt = getPrompt("component-mapping", {
    conversationJson: partsJson,
    componentsJson
  });

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      console.log("[Componentisation] No JSON object found in batch response");
      return {};
    }

    const mapping = JSON.parse(jsonMatch[0]);

    if (typeof mapping !== "object" || mapping === null) {
      console.log("[Componentisation] Parsed batch result is not an object");
      return {};
    }

    return mapping;
  } catch (error) {
    console.error("[Componentisation] Error calling AI for batch mapping:", error);
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
  config: ComponentisationConfig
): Promise<Record<string, string>> {
  const BATCH_SIZE = 20;

  // Strip binary data and extract parts with context
  const strippedConversation = stripBinaryData(conversation);
  const allParts = extractPartsWithContext(strippedConversation);

  console.log(`[Componentisation] Mapping ${allParts.length} parts in batches of ${BATCH_SIZE} (model: ${config.model})`);

  // Split parts into batches
  const batches: PartWithContext[][] = [];
  for (let i = 0; i < allParts.length; i += BATCH_SIZE) {
    batches.push(allParts.slice(i, i + BATCH_SIZE));
  }

  console.log(`[Componentisation] Processing ${batches.length} batches in parallel`);

  // Process all batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, index) => {
      console.log(`[Componentisation] Starting batch ${index + 1}/${batches.length} (${batch.length} parts)`);
      return mapPartsBatch(batch, components, config);
    })
  );

  // Merge all batch results into a single mapping
  const mergedMapping: Record<string, string> = {};
  batchResults.forEach((batchMapping, index) => {
    const entriesCount = Object.keys(batchMapping).length;
    console.log(`[Componentisation] Batch ${index + 1} returned ${entriesCount} mappings`);
    Object.assign(mergedMapping, batchMapping);
  });

  console.log(`[Componentisation] Created merged mapping with ${Object.keys(mergedMapping).length} entries (from ${allParts.length} parts)`);
  return mergedMapping;
}

/**
 * Timeline snapshot representing component composition at a specific message
 */
export interface ComponentTimelineSnapshot {
  messageIndex: number;
  componentTokens: Record<string, number>; // component name → total tokens
  totalTokens: number; // cumulative tokens up to this message
}

/**
 * Build a timeline of component composition for each message in the conversation
 * This allows scrubbing through the conversation to see how components evolve
 */
export function buildComponentTimeline(
  conversation: Conversation,
  componentMapping: Record<string, string>
): ComponentTimelineSnapshot[] {
  console.log("[Componentisation] Building component timeline");

  // Build a map of part ID to its message index and token count
  const partInfo = new Map<string, { messageIndex: number; tokenCount: number }>();
  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      const tokenCount = ("token_count" in part && part.token_count) || 0;
      partInfo.set(part.id, { messageIndex, tokenCount });
    });
  });

  // Log mapping coverage for debugging
  const mappedCount = Object.keys(componentMapping).length;
  const totalParts = partInfo.size;
  console.log(`[Componentisation] Mapping coverage: ${mappedCount}/${totalParts} parts (${Math.round(mappedCount/totalParts*100)}%)`);

  // Build timeline snapshots
  const timeline: ComponentTimelineSnapshot[] = [];

  for (let msgIndex = 0; msgIndex < conversation.messages.length; msgIndex++) {
    const componentTokens: Record<string, number> = {};
    let totalTokens = 0;

    // Accumulate tokens for ALL parts up to and including this message
    // Use mapping if available, otherwise assign to "other"
    partInfo.forEach((info, partId) => {
      if (info.messageIndex <= msgIndex) {
        const component = componentMapping[partId] || "other";
        componentTokens[component] = (componentTokens[component] || 0) + info.tokenCount;
        totalTokens += info.tokenCount;
      }
    });

    timeline.push({
      messageIndex: msgIndex,
      componentTokens,
      totalTokens,
    });
  }

  console.log(`[Componentisation] Built timeline with ${timeline.length} snapshots`);
  return timeline;
}

/**
 * Assign colors to components based on similarity using AI
 * Returns an object mapping component names to color names
 */
export async function assignComponentColors(
  components: string[],
  config: ComponentisationConfig
): Promise<Record<string, string>> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  const componentsJson = JSON.stringify(components, null, 2);

  console.log(`[Componentisation] Calling AI to assign colors (model: ${config.model})`);

  const prompt = getPrompt("component-coloring", { componentsJson });

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    console.log(`[Componentisation] AI response for colors: ${result.text}`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      console.log("[Componentisation] No JSON object found in response");
      return {};
    }

    const colorMapping = JSON.parse(jsonMatch[0]);

    if (typeof colorMapping !== "object" || colorMapping === null) {
      console.log("[Componentisation] Parsed result is not an object");
      return {};
    }

    console.log(`[Componentisation] Assigned colors to ${Object.keys(colorMapping).length} components`);
    return colorMapping;
  } catch (error) {
    console.error("[Componentisation] Error calling AI for colors:", error);
    return {};
  }
}

/**
 * Componentise a conversation: identify components and map them to message IDs
 * Returns the list of components, the mapping, timeline data, and error info
 */
export async function componentiseConversation(
  conversation: Conversation,
  onProgress?: (step: "identifying" | "mapping") => void,
  customPrompt?: string,
  customComponents?: string[]
): Promise<{
  components: string[];
  mapping: Record<string, string>;
  timeline: ComponentTimelineSnapshot[];
  error?: string;
}> {
  console.log("[Componentisation] Starting componentisation process");

  const config = getComponentisationConfig();

  if (!config) {
    console.log("[Componentisation] No config, skipping componentisation");
    return { components: [], mapping: {}, timeline: [], error: "Componentisation: No API key configured" };
  }

  // Step 1: Identify components (or use custom components if provided)
  let components: string[];
  if (customComponents && customComponents.length > 0) {
    console.log(`[Componentisation] Using ${customComponents.length} custom components`);
    components = customComponents;
  } else {
    onProgress?.("identifying");
    components = await identifyComponents(conversation, config, customPrompt);

    if (components.length === 0) {
      console.log("[Componentisation] No components identified");
      return { components: [], mapping: {}, timeline: [], error: "Componentisation: Failed to identify components (API error)" };
    }
  }

  // Step 2: Map components to IDs
  onProgress?.("mapping");
  const mapping = await mapComponentsToIds(conversation, components, config);

  // Check if there are unmapped parts and add "other" component if needed
  const totalParts = conversation.messages.reduce((sum, msg) => sum + msg.parts.length, 0);
  const mappedParts = Object.keys(mapping).length;
  const finalComponents = mappedParts < totalParts && !components.includes("other")
    ? [...components, "other"]
    : components;

  // Step 3: Build timeline
  const timeline = buildComponentTimeline(conversation, mapping);

  console.log("[Componentisation] Completed componentisation");
  return { components: finalComponents, mapping, timeline };
}
