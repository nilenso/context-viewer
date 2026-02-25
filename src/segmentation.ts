import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation, Message } from "./schema";
import { getPrompt } from "./prompts";
import { getAIConfig, type AIConfig } from "./ai-config";
import { workflowLog, type ProcessingPhase } from "./workflow-logger";

// Helper to log with optional conversation context
function log(
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) {
  if (conversationId) {
    workflowLog(
      conversationId,
      "segmenting" as ProcessingPhase,
      "info",
      message,
      data,
    );
  } else {
    if (data !== undefined) {
      console.log(`[Segmentation] ${message}`, data);
    } else {
      console.log(`[Segmentation] ${message}`);
    }
  }
}

function logError(
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) {
  if (conversationId) {
    workflowLog(
      conversationId,
      "segmenting" as ProcessingPhase,
      "error",
      message,
      data,
    );
  } else {
    console.error(`[Segmentation] ${message}`, data);
  }
}

const DEFAULT_SEGMENTATION_THRESHOLD = 500;

/**
 * Identify message parts that are greater than the token threshold
 */
function identifyLargeParts(
  conversation: Conversation,
  conversationId?: string,
  threshold: number = DEFAULT_SEGMENTATION_THRESHOLD,
): Array<{
  messageIndex: number;
  partIndex: number;
  part: Message["parts"][number];
}> {
  log(conversationId, `Using threshold: ${threshold} tokens`);

  const largeParts: Array<{
    messageIndex: number;
    partIndex: number;
    part: Message["parts"][number];
  }> = [];

  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      const tokenCount = ("token_count" in part && part.token_count) || 0;
      if (tokenCount > threshold) {
        log(
          conversationId,
          `Found large part: message ${messageIndex}, part ${partIndex}, tokens: ${tokenCount}`,
        );
        largeParts.push({ messageIndex, partIndex, part });
      }
    });
  });

  log(
    conversationId,
    `Found ${largeParts.length} large parts (>${threshold} tokens)`,
  );
  return largeParts;
}

/**
 * Use AI to split a text part into semantic segments
 */
async function segmentTextWithAI(
  text: string,
  config: AIConfig,
  customPrompt?: string,
  conversationId?: string,
): Promise<string[]> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  log(
    conversationId,
    `Calling AI to segment text (${text.length} chars, model: ${config.model})${customPrompt ? " with custom prompt" : ""}`,
  );

  const prompt = getPrompt("segmentation", { text, customPrompt });

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    log(conversationId, `AI response: ${result.text.substring(0, 200)}...`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\[.*\]/s);
    if (!jsonMatch) {
      log(conversationId, "No JSON array found in response");
      return [];
    }

    const substrings = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(substrings)) {
      log(conversationId, "Parsed result is not an array");
      return [];
    }

    log(
      conversationId,
      `Parsed ${substrings.length} split patterns`,
      substrings,
    );
    return substrings;
  } catch (error) {
    logError(conversationId, "Error calling AI", error);
    return [];
  }
}

/**
 * Preprocess regex patterns to make them work correctly with split()
 * Removes ^ and $ anchors from inside lookaheads since they don't work correctly
 * when used with String.split()
 */
function preprocessPattern(pattern: string): string {
  // Remove ^ anchor (start of line) from inside lookaheads
  // (?=^...) -> (?=...)
  let processed = pattern.replace(/\(\?=\^/g, "(?=");

  // Remove $ anchor (end of line) from inside lookaheads
  // ...\\s*$) -> ...\\s*)
  processed = processed.replace(/\$\)/g, ")");

  // Also handle \s*$ patterns
  processed = processed.replace(/\\s\*\$/g, "\\s*");

  return processed;
}

/**
 * Split a text using an array of regex patterns or substrings
 * Returns the parts of the text separated by the patterns
 * Supports positive lookahead patterns like (?=<tag>)
 */
function splitTextBySubstrings(
  text: string,
  substrings: string[],
  conversationId?: string,
): string[] {
  if (substrings.length === 0) {
    return [text];
  }

  try {
    // Preprocess patterns to remove anchors that don't work with split()
    const processedPatterns = substrings.map(preprocessPattern);

    // Combine all patterns into a single regex with alternation
    const combinedPattern = processedPatterns.join("|");
    const regex = new RegExp(combinedPattern);

    // Split using the combined regex
    const parts = text.split(regex);

    // Filter out empty strings and trim whitespace
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  } catch (error) {
    logError(conversationId, "Regex error", error);
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

type SegmentResult =
  | { success: true; parts: Message["parts"] }
  | { success: false; skipped: true }
  | { success: false; error: true };

/**
 * Segment a single large message part
 */
async function segmentMessagePart(
  part: Message["parts"][number],
  config: AIConfig,
  customPrompt?: string,
  conversationId?: string,
): Promise<SegmentResult> {
  // Get text content from different part types
  // Only segment text and reasoning parts - skip tool results as they're usually structured output
  let text: string;

  if (part.type === "text" || part.type === "reasoning") {
    text = part.text;
  } else {
    log(conversationId, `Skipping part ${part.id}, type: ${part.type}`);
    return { success: false, skipped: true };
  }

  log(
    conversationId,
    `Processing part ${part.id}, type: ${part.type}, text length: ${text.length}`,
  );
  const substrings = await segmentTextWithAI(
    text,
    config,
    customPrompt,
    conversationId,
  );

  if (substrings.length === 0) {
    log(conversationId, `No substrings returned for part ${part.id}`);
    return { success: false, error: true };
  }

  const segments = splitTextBySubstrings(text, substrings, conversationId);

  if (segments.length <= 1) {
    log(
      conversationId,
      `Split resulted in ${segments.length} segment(s), not segmenting`,
    );
    return { success: false, skipped: true };
  }

  log(
    conversationId,
    `Successfully split part ${part.id} into ${segments.length} segments`,
  );

  // Create new parts with child IDs
  const newParts = segments.map((segment, index) => {
    const basePart = {
      ...part,
      id: generateChildId(part.id, index + 1),
      token_count: undefined, // Will be recalculated
    };

    // Only text and reasoning parts are segmented
    return {
      ...basePart,
      text: segment,
    };
  });

  return { success: true, parts: newParts as Message["parts"] };
}

/**
 * Process conversation segmentation with parallel processing of large parts
 * Returns a new conversation with segmented parts and error info
 */
export { DEFAULT_SEGMENTATION_THRESHOLD };

export async function segmentConversation(
  conversation: Conversation,
  onProgress?: (processed: number, total: number) => void,
  customPrompt?: string,
  conversationId?: string,
  segmentationThreshold?: number,
): Promise<{ conversation: Conversation; error?: string }> {
  log(conversationId, "Starting segmentation process");

  const config = getAIConfig("Segmentation");

  if (!config) {
    return { conversation, error: "Segmentation: No API key configured" };
  }

  const largeParts = identifyLargeParts(conversation, conversationId, segmentationThreshold);

  if (largeParts.length === 0) {
    log(
      conversationId,
      "No large parts to segment, returning original conversation",
    );
    return { conversation };
  }

  // Process all large parts in parallel
  const segmentationPromises = largeParts.map(
    async ({ messageIndex, partIndex, part }) => {
      const result = await segmentMessagePart(
        part,
        config,
        customPrompt,
        conversationId,
      );
      return { messageIndex, partIndex, result };
    },
  );

  // Track progress and collect actual failures (not skips)
  let completed = 0;
  let errorCount = 0;
  let processedCount = 0;
  const results = await Promise.all(
    segmentationPromises.map(async (promise) => {
      const { messageIndex, partIndex, result } = await promise;
      if (!result.success && "error" in result && result.error) {
        errorCount++;
      }
      if (result.success) {
        processedCount++;
      }
      completed++;
      onProgress?.(completed, largeParts.length);
      return { messageIndex, partIndex, result };
    }),
  );

  // Build a map of replacements
  const replacements = new Map<
    string,
    Array<{ partIndex: number; segments: Message["parts"] }>
  >();

  for (const { messageIndex, partIndex, result } of results) {
    if (!result.success) continue;

    const key = messageIndex.toString();
    if (!replacements.has(key)) {
      replacements.set(key, []);
    }
    replacements.get(key)!.push({
      partIndex,
      segments: result.parts,
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

  const newConversation = {
    messages: newMessages as Message[],
  };

  // Return with error info if any segmentations had actual errors (not skips)
  if (errorCount > 0) {
    return {
      conversation: newConversation,
      error: `Segmentation: Failed to segment ${errorCount} of ${processedCount} parts (API error)`,
    };
  }

  return { conversation: newConversation };
}
