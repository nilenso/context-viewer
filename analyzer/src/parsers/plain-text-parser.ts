import type { Parser } from "../model/types";
import type { Conversation } from "../model/schema";

/**
 * Parser for plain text files.
 * Converts plain text content into a conversation with a single system message.
 */
export class PlainTextParser implements Parser {
  name = "Plain Text";

  /**
   * Check if data is plain text (a string that isn't structured data)
   */
  canParse(data: unknown): boolean {
    return typeof data === "string";
  }

  /**
   * Parse plain text into a conversation with a single system message
   */
  parse(data: unknown): Conversation {
    if (typeof data !== "string") {
      throw new Error("PlainTextParser expects a string input");
    }

    const text = data.trim();

    return {
      messages: [
        {
          id: "msg-1",
          role: "system",
          parts: [
            {
              id: "part-1",
              type: "text",
              text: text,
            },
          ],
        },
      ],
    };
  }
}
