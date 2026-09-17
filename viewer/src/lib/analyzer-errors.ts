import type { StageError } from "context-analyzer";

export function formatAnalyzerErrors(errors: StageError[]): string[] {
  return errors.map((error) => `${error.stage}: ${error.message}`);
}
