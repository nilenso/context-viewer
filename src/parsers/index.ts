import { parserRegistry } from "../parser";
import { ResponsesParser } from "./responses-parser";
import { CompletionsParser } from "./completions-parser";
import { ConversationsParser } from "./conversations-parser";
import { ClaudeTranscriptsParser } from "./claude-transcripts-parser";

// Register all parsers
parserRegistry.register(new ResponsesParser());
parserRegistry.register(new CompletionsParser());
parserRegistry.register(new ConversationsParser());
parserRegistry.register(new ClaudeTranscriptsParser());

export { ResponsesParser, CompletionsParser, ConversationsParser, ClaudeTranscriptsParser };
