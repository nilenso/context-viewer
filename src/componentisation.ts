import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation } from "./schema";
import { getPrompt } from "./prompts";
import { stripLargeContent } from "./strip-large-content";

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
  const strippedConversation = stripLargeContent(conversation);
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

    const rawMapping = JSON.parse(jsonMatch[0]);

    if (typeof rawMapping !== "object" || rawMapping === null) {
      console.log("[Componentisation] Parsed batch result is not an object");
      return {};
    }

    // Normalize component names - strip leading "- " that AI might add
    const mapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawMapping)) {
      if (typeof value === 'string') {
        mapping[key] = value.replace(/^-\s*/, '');
      }
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
  const strippedConversation = stripLargeContent(conversation);
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
  // TEMPORARY: Hardcoded color mapping to avoid AI call during development
  // TODO: Remove this and use the AI-based coloring below once we're happy with the component structure
  if (true) {
    const hardcodedColors: Record<string, string> = {
      "identity": "gray",
      "personality": "purple",
      "personality.guidelines": "purple",
      "personality.behavior": "purple",
      "personality.communication": "purple",
      "personality.autonomy": "purple",
      "personality.model_steering": "purple",
      "personality.examples": "purple",
      "environment": "slate",
      "environment.platform": "slate",
      "environment.security": "slate",
      "environment.sandboxing": "slate",
      "code_style": "indigo",
      "code_style.conventions": "indigo",
      "code_style.quality": "indigo",
      "code_style.examples": "indigo",
      "search": "blue",
      "search.tool_selection": "blue",
      "search.context_separation": "blue",
      "search.examples": "blue",
      "workflow": "emerald",
      "workflow.task_management": "emerald",
      "workflow.modes": "emerald",
      "workflow.git": "emerald",
      "workflow.git.commands": "emerald",
      "workflow.git.commits": "emerald",
      "workflow.examples": "emerald",
      "project_context": "orange",
      "project_context.config_files": "orange",
      "tools": "gray",
      "tools.policies": "gray",
      "tools.policies.guidelines": "gray",
      "tools.policies.model_steering": "gray",
      "tools.policies.examples": "gray",
      "tools.description": "gray",
      "tools.conditions": "gray",
      "tools.usage": "gray",
      "tools.schema": "gray",
      "tools.file": "gray",
      "tools.file.read": "gray",
      "tools.file.write": "gray",
      "tools.file.edit": "gray",
      "tools.file.search": "gray",
      "tools.file.directory": "gray",
      "tools.shell": "gray",
      "tools.shell.execution": "gray",
      "tools.shell.background": "gray",
      "tools.shell.restrictions": "gray",
      "tools.communication": "gray",
      "tools.communication.questions": "gray",
      "tools.communication.notifications": "gray",
      "tools.advanced": "gray",
      "tools.advanced.web": "gray",
      "tools.advanced.agents": "gray",
      "tools.advanced.notebooks": "gray",
      "tools.advanced.images": "gray",
      "tools.advanced.integrations": "gray",
    };

    // Return colors for the components that exist in the hardcoded mapping
    const colorMapping: Record<string, string> = {};
    for (const component of components) {
      colorMapping[component] = hardcodedColors[component] || "gray";
    }
    console.log(`[Componentisation] Using hardcoded colors for ${Object.keys(colorMapping).length} components`);
    return colorMapping;
  }

  // AI-based color assignment (currently disabled - see hardcoded mapping above)
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

    const rawColorMapping = JSON.parse(jsonMatch[0]);

    if (typeof rawColorMapping !== "object" || rawColorMapping === null) {
      console.log("[Componentisation] Parsed result is not an object");
      return {};
    }

    // Clean up keys - handle various AI response formats:
    // - Remove leading "- " that AI might add
    // - Extract component name from "name: description" format (some models include descriptions)
    const colorMapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawColorMapping)) {
      let cleanKey = key.replace(/^-\s*/, '');

      // If the key contains ": " followed by a description, extract just the component name
      // e.g., "identity: Establishes who the AI is..." -> "identity"
      // But preserve dots in component names like "personality.guidelines"
      const colonDescIndex = cleanKey.indexOf(': ');
      if (colonDescIndex > 0) {
        cleanKey = cleanKey.substring(0, colonDescIndex);
      }

      if (typeof value === 'string') {
        colorMapping[cleanKey] = value;
      }
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
    // Normalize custom components - strip leading "- " prefix
    components = customComponents.map(c => c.replace(/^-\s*/, ''));
    console.log(`[Componentisation] Using ${components.length} custom components (normalized)`);
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
