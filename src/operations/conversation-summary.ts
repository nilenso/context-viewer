import type { Conversation } from "@/model/schema";
import type { ConversationSummary } from "@/model/types";

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
