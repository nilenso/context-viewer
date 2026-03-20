import type { Conversation, Message } from "@/model/schema";

/**
 * Truncate a string to a maximum length, adding an indicator if truncated
 */
function truncateContent(content: unknown, maxLength: number = 200): string {
  const str = typeof content === "string" ? content : JSON.stringify(content);
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength)}... [TRUNCATED, ${str.length - maxLength} chars stripped]`;
}

/**
 * Strip large data (images, files, tool outputs) from conversation before sending to AI
 * This reduces token count significantly while preserving structure for categorization
 */
export function stripLargeContent(conversation: Conversation): Conversation {
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
        if (part.type === "tool-result") {
          return {
            ...part,
            output: truncateContent(part.output),
          };
        }
        if (part.type === "tool-call") {
          return {
            ...part,
            input: truncateContent(part.input),
          };
        }
        return part;
      }),
    } as Message)),
  };
}
