import type { Conversation } from "./schema";

export interface ConversationSummary {
  totalMessages: number;
  messagesByRole: Record<string, number>;
  stringContentCount: number;
  multipartContentCount: number;
  partCounts: Record<string, number>;
}

export function summarizeConversation(
  conversation: Conversation
): ConversationSummary {
  const summary: ConversationSummary = {
    totalMessages: conversation.messages.length,
    messagesByRole: {},
    stringContentCount: 0,
    multipartContentCount: 0,
    partCounts: {},
  };

  for (const message of conversation.messages) {
    summary.messagesByRole[message.role] =
      (summary.messagesByRole[message.role] || 0) + 1;

    if (typeof message.content === "string") {
      summary.stringContentCount += 1;
      continue;
    }

    summary.multipartContentCount += 1;
    for (const part of message.content) {
      summary.partCounts[part.type] = (summary.partCounts[part.type] || 0) + 1;
    }
  }

  return summary;
}
