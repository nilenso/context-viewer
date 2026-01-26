import type { Conversation } from "./schema";

/**
 * Metadata about the parsed conversation
 */
export interface ConversationMetadata {
  /** Name of the parser/format that was used */
  parserName: string;
  /** Model used in the conversation (if available) */
  model?: string;
  /** Provider name (if available) */
  provider?: string;
  /** Agent configuration (OpenCode only) */
  agent?: string;
}

/**
 * Result of parsing a conversation
 */
export interface ParseResult {
  conversation: Conversation;
  metadata: ConversationMetadata;
}

/**
 * Parser interface for converting different API formats to our standard message structure
 */
export interface Parser {
  /** Human-readable name of this parser */
  name: string;

  /**
   * Parse the input data into our standard Conversation format
   * @param data - The raw API response data
   * @returns Parsed conversation following our schema
   */
  parse(data: unknown): Conversation;

  /**
   * Extract metadata from the input data (model, provider, etc.)
   * @param data - The raw API response data
   * @returns Metadata about the conversation
   */
  extractMetadata?(data: unknown): Partial<ConversationMetadata>;

  /**
   * Check if this parser can handle the given data format
   * @param data - The raw data to check
   * @returns true if this parser can handle the data
   */
  canParse(data: unknown): boolean;
}

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
