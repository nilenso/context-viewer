import type { Conversation, Message } from "./schema";
import { encoding_for_model } from "tiktoken";

/**
 * Count tokens in a text string using GPT-4 encoding
 * @param text The text to count tokens for
 * @returns The number of tokens
 */
function countTokens(text: string): number {
  const enc = encoding_for_model("gpt-4o");
  const count = enc.encode(text).length;
  enc.free();
  return count;
}

/**
 * Add token counts to all parts in a conversation
 * This is a post-processing step that should be called after parsing
 * @param conversation The parsed conversation without token counts
 * @returns The same conversation with token counts added to all parts
 */
export function addTokenCounts(conversation: Conversation): Conversation {
  return {
    messages: conversation.messages.map((msg) => addTokenCountsToMessage(msg)),
  };
}

function addTokenCountsToMessage(message: Message): Message {
  const contentWithCounts = message.content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          ...part,
          token_count: countTokens(part.text),
        };

      case "reasoning":
        return {
          ...part,
          token_count: countTokens(part.text),
        };

      case "tool-call": {
        // Concatenate tool name and arguments for counting
        const textForCounting = `${part.toolName}${JSON.stringify(part.input)}`;
        return {
          ...part,
          token_count: countTokens(textForCounting),
        };
      }

      case "tool-result": {
        // Concatenate tool name and output for counting
        const textForCounting = `${part.toolName}${JSON.stringify(part.output)}`;
        return {
          ...part,
          token_count: countTokens(textForCounting),
        };
      }

      case "image":
      case "file":
        // Skip images and files as requested
        return part;

      default:
        return part;
    }
  });

  return {
    ...message,
    content: contentWithCounts as Message["content"],
  };
}
