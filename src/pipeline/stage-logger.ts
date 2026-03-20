import { pipelineLog, type LogLevel } from "./logging";
import type { Stage } from "@/model/types";

type PhaseLogger = (
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) => void;

/**
 * Create a logger bound to a specific pipeline stage and console label.
 */
export function createPhaseLogger(
  phase: Stage,
  label: string,
  level: LogLevel = "info",
): PhaseLogger {
  return (conversationId, message, data) => {
    if (conversationId) {
      pipelineLog(conversationId, phase, level, message, data);
    } else {
      const method = level === "error" ? console.error : console.log;
      if (data !== undefined) {
        method(`[${label}] ${message}`, data);
      } else {
        method(`[${label}] ${message}`);
      }
    }
  };
}
