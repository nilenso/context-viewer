import type { Conversation } from "./schema";

export interface ConversationSummary {
  totalMessages: number;
  messagesByRole: Record<string, number>;
  textOnlyMessageCount: number;
  structuredContentMessageCount: number;
  partCounts: Record<string, number>;
}

export function summarizeConversation(
  conversation: Conversation
): ConversationSummary {
  const summary: ConversationSummary = {
    totalMessages: conversation.messages.length,
    messagesByRole: {},
    textOnlyMessageCount: 0,
    structuredContentMessageCount: 0,
    partCounts: {},
  };

  for (const message of conversation.messages) {
    summary.messagesByRole[message.role] =
      (summary.messagesByRole[message.role] || 0) + 1;

    const parts = message.parts;

    if (parts.length === 1) {
      const singlePart = parts[0];
      if (singlePart && singlePart.type === "text") {
        summary.textOnlyMessageCount += 1;
      } else {
        summary.structuredContentMessageCount += 1;
      }
    } else {
      summary.structuredContentMessageCount += 1;
    }

    for (const part of parts) {
      summary.partCounts[part.type] = (summary.partCounts[part.type] || 0) + 1;
    }
  }

  return summary;
}
