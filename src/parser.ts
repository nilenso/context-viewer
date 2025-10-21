import type { Conversation } from "./schema";

/**
 * Parser interface for converting different API formats to our standard message structure
 */
export interface Parser {
  /**
   * Parse the input data into our standard Conversation format
   * @param data - The raw API response data
   * @returns Parsed conversation following our schema
   */
  parse(data: unknown): Conversation;

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
   * @returns Parsed conversation
   * @throws Error if no suitable parser is found
   */
  parse(data: unknown): Conversation {
    const parser = this.parsers.find((p) => p.canParse(data));
    if (!parser) {
      throw new Error("No suitable parser found for the given data format");
    }
    return parser.parse(data);
  }
}

// Global registry instance
export const parserRegistry = new ParserRegistry();
