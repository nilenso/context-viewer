import { parserRegistry } from "../parser";
import { ContextViewerParser } from "./context-viewer-parser";
import { ResponsesParser } from "./responses-parser";
import { CompletionsParser } from "./completions-parser";
import { ConversationsParser } from "./conversations-parser";
import { ClaudeTranscriptsParser } from "./claude-transcripts-parser";
import { CodexTranscriptsParser } from "./codex-transcripts-parser";
import { OpenCodeTranscriptsParser } from "./opencode-transcripts-parser";
import { TrajectoryParser } from "./trajectory-parser";
import { SweAgentTrajectoryParser } from "./swe-agent-trajectory-parser";
import { PlainTextParser } from "./plain-text-parser";

// Register all parsers
// Note: ContextViewerParser is registered first (high priority for its format)
// Note: PlainTextParser is registered last as it's a catch-all for string data
parserRegistry.register(new ContextViewerParser());
parserRegistry.register(new ResponsesParser());
parserRegistry.register(new CompletionsParser());
parserRegistry.register(new ConversationsParser());
parserRegistry.register(new ClaudeTranscriptsParser());
parserRegistry.register(new CodexTranscriptsParser());
parserRegistry.register(new OpenCodeTranscriptsParser());
parserRegistry.register(new SweAgentTrajectoryParser());
parserRegistry.register(new TrajectoryParser());
parserRegistry.register(new PlainTextParser());

export { ContextViewerParser, ResponsesParser, CompletionsParser, ConversationsParser, ClaudeTranscriptsParser, CodexTranscriptsParser, OpenCodeTranscriptsParser, SweAgentTrajectoryParser, TrajectoryParser, PlainTextParser };
