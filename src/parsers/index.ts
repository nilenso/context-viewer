import { parserRegistry } from "../parser";
import { ResponsesParser } from "./responses-parser";
import { CompletionsParser } from "./completions-parser";

// Register all parsers
parserRegistry.register(new ResponsesParser());
parserRegistry.register(new CompletionsParser());

export { ResponsesParser, CompletionsParser };
