/**
 * Logging infrastructure for the analyzer.
 *
 * Three levels:
 *   silent — no output (default)
 *   info   — stage progress ("Parsing...", "Classifying...", durations)
 *   debug  — detailed internals (API payloads, intermediate results)
 *
 * The caller can provide a custom logger sink, or leave it to the
 * built-in console logger.
 */

export type LogLevel = "silent" | "info" | "debug";

export interface LogEntry {
  timestamp: Date;
  stage: string;
  level: "info" | "debug" | "warn" | "error";
  message: string;
  data?: unknown;
}

export type LogSink = (entry: LogEntry) => void;

/**
 * Logger instance used throughout the pipeline.
 * Caller configures via AnalyzerConfig.logLevel / AnalyzerConfig.logger.
 */
let _logLevel: LogLevel = "silent";
let _sink: LogSink | null = null;

export function configureLogger(level: LogLevel, sink?: LogSink): void {
  _logLevel = level;
  _sink = sink ?? null;
}

function shouldLog(entryLevel: "info" | "debug" | "warn" | "error"): boolean {
  if (_logLevel === "silent") return false;
  if (_logLevel === "info") return entryLevel !== "debug";
  return true; // debug — log everything
}

function defaultSink(entry: LogEntry): void {
  const prefix = `[${entry.stage}]`;
  const method =
    entry.level === "error" ? console.error
    : entry.level === "warn" ? console.warn
    : entry.level === "debug" ? console.debug
    : console.log;
  if (entry.data !== undefined) {
    method(prefix, entry.message, entry.data);
  } else {
    method(prefix, entry.message);
  }
}

export function log(stage: string, level: "info" | "debug" | "warn" | "error", message: string, data?: unknown): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = { timestamp: new Date(), stage, level, message, data };
  (_sink ?? defaultSink)(entry);
}

/** Create a logger bound to a specific stage name. */
export function stageLogger(stage: string) {
  return {
    info: (msg: string, data?: unknown) => log(stage, "info", msg, data),
    debug: (msg: string, data?: unknown) => log(stage, "debug", msg, data),
    warn: (msg: string, data?: unknown) => log(stage, "warn", msg, data),
    error: (msg: string, data?: unknown) => log(stage, "error", msg, data),
  };
}
