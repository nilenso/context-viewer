import type { Conversation } from "@/model/schema";
import type { ConversationMetadata, ParseResult, Parser } from "@/model/types";

/**
 * Registry for managing multiple parser implementations
 */
export class ParserRegistry {
  private parsers: Parser[] = [];

  /**
   * Register a new parser
   */
  register(parser: Parser): void {
    this.parsers.push(parser);
  }

  /**
   * Find and use the appropriate parser for the given data
   * @param data - The raw data to parse
   * @returns Parsed conversation (for backwards compatibility)
   * @throws Error if no suitable parser is found
   */
  parse(data: unknown): Conversation {
    const result = this.parseWithMetadata(data);
    return result.conversation;
  }

  /**
   * Find and use the appropriate parser for the given data, returning metadata
   * @param data - The raw data to parse
   * @returns ParseResult with conversation and metadata
   * @throws Error if no suitable parser is found
   */
  parseWithMetadata(data: unknown): ParseResult {
    const parser = this.parsers.find((p) => p.canParse(data));
    if (!parser) {
      throw new Error("No suitable parser found for the given data format");
    }

    const conversation = parser.parse(data);
    const extractedMetadata = parser.extractMetadata?.(data) ?? {};

    const metadata: ConversationMetadata = {
      parserName: parser.name,
      ...extractedMetadata,
    };

    return { conversation, metadata };
  }
}

// Global registry instance
export const parserRegistry = new ParserRegistry();
