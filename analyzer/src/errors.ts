/**
 * Structured error types for the analyzer pipeline.
 *
 * Errors are data, not exceptions. The pipeline completes partially —
 * parsing succeeded but segmentation failed? You get parse results + an error entry.
 *
 * Four categories:
 *   upstream — AI provider errors (timeouts, rate limits, auth). Retryable.
 *   parse    — AI responded but output was unparsable. Retryable.
 *   input    — Caller mistake (bad file, missing key). Not retryable.
 *   internal — Bug in the library. Not retryable.
 */

export type ErrorCategory = "upstream" | "parse" | "input" | "internal";

export interface StageError {
  /** Which pipeline stage produced this error */
  stage: string;
  /** Error category — determines whether retrying makes sense */
  category: ErrorCategory;
  /** Human-readable error message */
  message: string;
  /** Whether the caller could retry this operation */
  retryable: boolean;
  /** Which file this error relates to (if applicable) */
  file?: string;
}

export function upstreamError(stage: string, message: string, file?: string): StageError {
  return { stage, category: "upstream", message, retryable: true, file };
}

export function parseError(stage: string, message: string, file?: string): StageError {
  return { stage, category: "parse", message, retryable: true, file };
}

export function inputError(stage: string, message: string, file?: string): StageError {
  return { stage, category: "input", message, retryable: false, file };
}

export function internalError(stage: string, message: string, file?: string): StageError {
  return { stage, category: "internal", message, retryable: false, file };
}
