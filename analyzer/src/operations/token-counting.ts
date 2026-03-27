import type { Conversation, Message } from "../model/schema";
import { encoding_for_model, type Tiktoken } from "tiktoken";

let encoderInstance: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoderInstance) {
    encoderInstance = encoding_for_model("gpt-4o");
  }
  return encoderInstance;
}

function countTokens(text: string): number {
  const enc = getEncoder();
  return enc.encode(text).length;
}

export async function addTokenCounts(
  conversation: Conversation
): Promise<Conversation> {
  const messages: Message[] = [];

  for (const msg of conversation.messages) {
    messages.push(addTokenCountsToMessage(msg));
    if (messages.length % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { messages };
}

function addTokenCountsToMessage(message: Message): Message {
  const contentWithCounts = message.parts.map((part) => {
    switch (part.type) {
      case "text":
        return { ...part, token_count: countTokens(part.text) };
      case "reasoning":
        return { ...part, token_count: countTokens(part.text) };
      case "tool-call": {
        const textForCounting = `${part.toolName}${JSON.stringify(part.input)}`;
        return { ...part, token_count: countTokens(textForCounting) };
      }
      case "tool-result": {
        const textForCounting = `${part.toolName}${JSON.stringify(part.output)}`;
        return { ...part, token_count: countTokens(textForCounting) };
      }
      case "image":
      case "file":
        return part;
      default:
        return part;
    }
  });

  return {
    ...message,
    parts: contentWithCounts as typeof message.parts,
  } as Message;
}
