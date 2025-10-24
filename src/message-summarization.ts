import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Conversation, Message } from "./schema";

/**
 * Configuration for AI model used in message summarization
 */
interface SummarizationConfig {
  apiKey: string;
  model: string;
}

/**
 * Summary of a message part
 */
export interface MessagePartSummary {
  id: string;
  summary: string;
}

/**
 * Get summarization configuration from environment variables
 */
export function getSummarizationConfig(): SummarizationConfig | null {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  const model = import.meta.env.VITE_AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    console.log("[Message Summarization] No API key configured, skipping summarization");
    return null;
  }

  console.log(`[Message Summarization] Config loaded: model=${model}`);
  return { apiKey, model };
}

/**
 * Extract all message parts with their IDs and text content
 */
function extractMessageParts(messages: Message[]): Array<{ id: string; text: string }> {
  const parts: Array<{ id: string; text: string }> = [];

  for (const message of messages) {
    for (const part of message.parts) {
      let text = "";

      if (part.type === "text" || part.type === "reasoning") {
        text = part.text;
      } else if (part.type === "tool-result") {
        text = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
      } else if (part.type === "tool-call") {
        text = `Tool call: ${part.toolName} with input ${JSON.stringify(part.input)}`;
      }

      if (text) {
        parts.push({ id: part.id, text });
      }
    }
  }

  return parts;
}

/**
 * Summarize a batch of messages (up to 10 messages)
 */
async function summarizeBatch(
  messages: Message[],
  config: SummarizationConfig
): Promise<MessagePartSummary[]> {
  const openai = createOpenAI({
    apiKey: config.apiKey,
  });

  const messageParts = extractMessageParts(messages);

  if (messageParts.length === 0) {
    return [];
  }

  const messagesJson = JSON.stringify(messageParts, null, 2);

  const prompt = `given the following json, give back an array of message-parts with just short-line summary of the message-part's text.
output just a json like this: {id: "42", summary: "text"}
messages: \`\`\`${messagesJson}\`\`\``;

  console.log(`[Message Summarization] Summarizing batch of ${messages.length} messages (${messageParts.length} parts)`);

  try {
    const result = await generateText({
      model: openai(config.model),
      prompt,
    });

    console.log(`[Message Summarization] AI response: ${result.text}`);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[Message Summarization] No JSON array found in response");
      return [];
    }

    const summaries = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(summaries)) {
      console.log("[Message Summarization] Parsed result is not an array");
      return [];
    }

    console.log(`[Message Summarization] Parsed ${summaries.length} summaries`);
    return summaries;
  } catch (error) {
    console.error("[Message Summarization] Error calling AI:", error);
    return [];
  }
}

/**
 * Summarize all messages in a conversation
 * Processes in batches of 10 messages, running batches in parallel
 */
export async function summarizeMessages(
  conversation: Conversation,
  onProgress?: (processed: number, total: number) => void
): Promise<Record<string, string>> {
  console.log("[Message Summarization] Starting message summarization");

  const config = getSummarizationConfig();

  if (!config) {
    console.log("[Message Summarization] No config, skipping summarization");
    return {};
  }

  const messages = conversation.messages;
  const batchSize = 10;
  const batches: Message[][] = [];

  // Split messages into batches of 10
  for (let i = 0; i < messages.length; i += batchSize) {
    batches.push(messages.slice(i, i + batchSize));
  }

  console.log(`[Message Summarization] Processing ${messages.length} messages in ${batches.length} batches`);

  // Process all batches in parallel
  let completed = 0;
  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const result = await summarizeBatch(batch, config);
      completed++;
      onProgress?.(completed, batches.length);
      return result;
    })
  );

  // Flatten results and convert to Record<id, summary>
  const summaries: Record<string, string> = {};
  for (const batchResult of batchResults) {
    for (const { id, summary } of batchResult) {
      summaries[id] = summary;
    }
  }

  console.log(`[Message Summarization] Completed with ${Object.keys(summaries).length} summaries`);
  return summaries;
}
