import { parserRegistry } from "../parser";
import { ResponsesParser } from "./responses-parser";
import { CompletionsParser } from "./completions-parser";
import { ConversationsParser } from "./conversations-parser";
import { ClaudeTranscriptsParser } from "./claude-transcripts-parser";
import { CodexTranscriptsParser } from "./codex-transcripts-parser";
import { OpenCodeTranscriptsParser } from "./opencode-transcripts-parser";
import { PlainTextParser } from "./plain-text-parser";

// Register all parsers
// Note: PlainTextParser is registered last as it's a catch-all for string data
parserRegistry.register(new ResponsesParser());
parserRegistry.register(new CompletionsParser());
parserRegistry.register(new ConversationsParser());
parserRegistry.register(new ClaudeTranscriptsParser());
parserRegistry.register(new CodexTranscriptsParser());
parserRegistry.register(new OpenCodeTranscriptsParser());
parserRegistry.register(new PlainTextParser());

export { ResponsesParser, CompletionsParser, ConversationsParser, ClaudeTranscriptsParser, CodexTranscriptsParser, OpenCodeTranscriptsParser, PlainTextParser };
