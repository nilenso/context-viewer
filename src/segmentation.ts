import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation, Message } from "./schema";
import { getPrompt } from "./prompts";

/**
 * Configuration for AI model used in segmentation
 */
interface SegmentationConfig {
  apiKey: string;
  model: string;
}

/**
 * Get segmentation configuration from environment variables
 */
export function getSegmentationConfig(): SegmentationConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    console.log("[Segmentation] No API key configured, skipping segmentation");
    return null;
  }

  console.log(`[Segmentation] Config loaded: model=${model}`);
  return { apiKey, model };
}

/**
 * Identify message parts that account for more than 10% of total token count
 */
function identifyLargeParts(conversation: Conversation): Array<{
  messageIndex: number;
  partIndex: number;
  part: Message["parts"][number];
}> {
  // Calculate total token count
  const totalTokens = conversation.messages.reduce((sum, message) => {
    return (
      sum +
      message.parts.reduce((partSum, part) => {
        return partSum + (("token_count" in part && part.token_count) || 0);
      }, 0)
    );
  }, 0);

  const threshold = totalTokens * 0.1;
  console.log(`[Segmentation] Total tokens: ${totalTokens}, threshold (10%): ${threshold}`);

  const largeParts: Array<{
    messageIndex: number;
    partIndex: number;
    part: Message["parts"][number];
  }> = [];

  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      const tokenCount = ("token_count" in part && part.token_count) || 0;
      if (tokenCount > threshold) {
        console.log(`[Segmentation] Found large part: message ${messageIndex}, part ${partIndex}, tokens: ${tokenCount}`);
        largeParts.push({ messageIndex, partIndex, part });
      }
    });
  });

  console.log(`[Segmentation] Found ${largeParts.length} large parts (>10% of total)`);
  return largeParts;
}

/**
 * Use AI to split a text part into semantic segments
 */
async function segmentTextWithAI(
  text: string,
  config: SegmentationConfig
): Promise<string[]> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  console.log(`[Segmentation] Calling AI to segment text (${text.length} chars, model: ${config.model})`);

  const prompt = getPrompt("segmentation", { text });

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    console.log(`[Segmentation] AI response: ${result.text}`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) {
      console.log("[Segmentation] No JSON array found in response");
      return [];
    }

    const substrings = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(substrings)) {
      console.log("[Segmentation] Parsed result is not an array");
      return [];
    }

    console.log(`[Segmentation] Parsed ${substrings.length} split patterns:`, substrings);
    return substrings;
  } catch (error) {
    console.error("[Segmentation] Error calling AI:", error);
    return [];
  }
}

/**
 * Split a text using an array of regex patterns or substrings
 * Returns the parts of the text separated by the patterns
 * Supports positive lookahead patterns like (?=<tag>)
 */
function splitTextBySubstrings(text: string, substrings: string[]): string[] {
  if (substrings.length === 0) {
    return [text];
  }

  try {
    // Combine all patterns into a single regex with alternation
    const combinedPattern = substrings.join('|');
    const regex = new RegExp(combinedPattern);

    // Split using the combined regex
    const parts = text.split(regex);

    // Filter out empty strings and trim whitespace
    return parts
      .map(part => part.trim())
      .filter(part => part.length > 0);
  } catch (error) {
    // Fallback: return the original text if regex fails
    return [text];
  }
}

/**
 * Generate a child ID based on parent ID and index
 */
function generateChildId(parentId: string, index: number): string {
  return `${parentId}.${index}`;
}

/**
 * Segment a single large message part
 */
async function segmentMessagePart(
  part: Message["parts"][number],
  config: SegmentationConfig
): Promise<Message["parts"] | null> {
  // Get text content from different part types
  let text: string;

  if (part.type === "text" || part.type === "reasoning") {
    text = part.text;
  } else if (part.type === "tool-result") {
    // For tool results, use the output as text
    text = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
  } else {
    console.log(`[Segmentation] Skipping part ${part.id}, type: ${part.type}`);
    return null;
  }

  console.log(`[Segmentation] Processing part ${part.id}, type: ${part.type}, text length: ${text.length}`);
  const substrings = await segmentTextWithAI(text, config);

  if (substrings.length === 0) {
    console.log(`[Segmentation] No substrings returned for part ${part.id}`);
    return null;
  }

  const segments = splitTextBySubstrings(text, substrings);

  if (segments.length <= 1) {
    console.log(`[Segmentation] Split resulted in ${segments.length} segment(s), not segmenting`);
    return null;
  }

  console.log(`[Segmentation] Successfully split part ${part.id} into ${segments.length} segments`);

  // Create new parts with child IDs
  const newParts = segments.map((segment, index) => {
    const basePart = {
      ...part,
      id: generateChildId(part.id, index + 1),
      token_count: undefined, // Will be recalculated
    };

    // Handle different part types
    if (part.type === "text" || part.type === "reasoning") {
      return {
        ...basePart,
        text: segment,
      };
    } else if (part.type === "tool-result") {
      return {
        ...basePart,
        output: segment, // Put segmented text back into output
      };
    }

    return basePart;
  });

  return newParts as Message["parts"];
}

/**
 * Process conversation segmentation with parallel processing of large parts
 * Returns a new conversation with segmented parts
 */
export async function segmentConversation(
  conversation: Conversation,
  onProgress?: (processed: number, total: number) => void
): Promise<Conversation> {
  console.log("[Segmentation] Starting segmentation process");

  const config = getSegmentationConfig();

  if (!config) {
    console.log("[Segmentation] No config, returning original conversation");
    return conversation;
  }

  const largeParts = identifyLargeParts(conversation);

  if (largeParts.length === 0) {
    console.log("[Segmentation] No large parts to segment, returning original conversation");
    return conversation;
  }

  // Process all large parts in parallel
  const segmentationPromises = largeParts.map(
    async ({ messageIndex, partIndex, part }) => {
      const segments = await segmentMessagePart(part, config);
      return { messageIndex, partIndex, segments };
    }
  );

  // Track progress
  let completed = 0;
  const results = await Promise.all(
    segmentationPromises.map(async (promise) => {
      const result = await promise;
      completed++;
      onProgress?.(completed, largeParts.length);
      return result;
    })
  );

  // Build a map of replacements
  const replacements = new Map<string, Array<{ partIndex: number; segments: Message["parts"] }>>();

  for (const result of results) {
    if (!result.segments) continue;

    const key = result.messageIndex.toString();
    if (!replacements.has(key)) {
      replacements.set(key, []);
    }
    replacements.get(key)!.push({
      partIndex: result.partIndex,
      segments: result.segments,
    });
  }

  // Apply replacements to create a new conversation
  const newMessages = conversation.messages.map((message, messageIndex) => {
    const messageReplacements = replacements.get(messageIndex.toString());

    if (!messageReplacements || messageReplacements.length === 0) {
      return message;
    }

    // Sort replacements by partIndex in descending order
    // This ensures we replace from the end first, keeping indices valid
    messageReplacements.sort((a, b) => b.partIndex - a.partIndex);

    const newParts = [...message.parts];

    for (const { partIndex, segments } of messageReplacements) {
      // Replace the part at partIndex with the segments
      newParts.splice(partIndex, 1, ...segments);
    }

    // Create a new message with the updated parts
    // We need to maintain the correct type based on role
    if (message.role === "system") {
      return {
        ...message,
        parts: newParts as typeof message.parts,
      };
    } else if (message.role === "user") {
      return {
        ...message,
        parts: newParts as typeof message.parts,
      };
    } else if (message.role === "assistant") {
      return {
        ...message,
        parts: newParts as typeof message.parts,
      };
    } else {
      // tool message
      return {
        ...message,
        parts: newParts as typeof message.parts,
      };
    }
  });

  return {
    messages: newMessages as Message[],
  };
}
