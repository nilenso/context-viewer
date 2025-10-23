import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation } from "./schema";

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
  config: ComponentisationConfig
): Promise<string[]> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  const conversationJson = JSON.stringify(conversation, null, 2);

  console.log(`[Componentisation] Calling AI to identify components (model: ${config.model})`);

    const prompt = `given this conversation, give me a list of all its components for a summary view
each component can be 3 to 4 words in length
just give me a list in a json array like this example:
["abc_document", "xyz_structure", "foo_context", "task", "sources", "breakdown", "reflection", "files_about_bar", "files_about_baz", "tool_calls_about_quix", "xyz blocks", "pqr list"]


<conversation>${conversationJson}</conversation>`;

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
 * Map message IDs to components using AI
 * Returns an object mapping message part IDs to component names
 */
export async function mapComponentsToIds(
  conversation: Conversation,
  components: string[],
  config: ComponentisationConfig
): Promise<Record<string, string>> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  const conversationJson = JSON.stringify(conversation, null, 2);
  const componentsJson = JSON.stringify(components, null, 2);

  console.log(`[Componentisation] Calling AI to map components to IDs (model: ${config.model})`);

  const prompt = `given this conversation and the list of components, give me a mapping
of message part ids in the conversation, to a component from the list, for all the message parts
just give me a simple json object {id: component}

<conversation>${conversationJson}</conversation>
<components>${componentsJson}</components>`;

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    console.log(`[Componentisation] AI response for mapping: ${result.text}`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[^]*\}/s);
    if (!jsonMatch) {
      console.log("[Componentisation] No JSON object found in response");
      return {};
    }

    const mapping = JSON.parse(jsonMatch[0]);

    if (typeof mapping !== "object" || mapping === null) {
      console.log("[Componentisation] Parsed result is not an object");
      return {};
    }

    console.log(`[Componentisation] Created mapping with ${Object.keys(mapping).length} entries`);
    return mapping;
  } catch (error) {
    console.error("[Componentisation] Error calling AI for mapping:", error);
    return {};
  }
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

  // Build timeline snapshots
  const timeline: ComponentTimelineSnapshot[] = [];

  for (let msgIndex = 0; msgIndex < conversation.messages.length; msgIndex++) {
    const componentTokens: Record<string, number> = {};
    let totalTokens = 0;

    // Accumulate tokens for all parts up to and including this message
    Object.entries(componentMapping).forEach(([partId, component]) => {
      const info = partInfo.get(partId);
      if (info && info.messageIndex <= msgIndex) {
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
 * Componentise a conversation: identify components and map them to message IDs
 * Returns the list of components, the mapping, and timeline data
 */
export async function componentiseConversation(
  conversation: Conversation,
  onProgress?: (step: "identifying" | "mapping") => void
): Promise<{
  components: string[];
  mapping: Record<string, string>;
  timeline: ComponentTimelineSnapshot[];
}> {
  console.log("[Componentisation] Starting componentisation process");

  const config = getComponentisationConfig();

  if (!config) {
    console.log("[Componentisation] No config, skipping componentisation");
    return { components: [], mapping: {}, timeline: [] };
  }

  // Step 1: Identify components
  onProgress?.("identifying");
  const components = await identifyComponents(conversation, config);

  if (components.length === 0) {
    console.log("[Componentisation] No components identified");
    return { components: [], mapping: {}, timeline: [] };
  }

  // Step 2: Map components to IDs
  onProgress?.("mapping");
  const mapping = await mapComponentsToIds(conversation, components, config);

  // Step 3: Build timeline
  const timeline = buildComponentTimeline(conversation, mapping);

  console.log("[Componentisation] Completed componentisation");
  return { components, mapping, timeline };
}
