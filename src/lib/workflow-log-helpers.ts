import { workflowLog, type ProcessingPhase, type LogLevel } from "../workflow-logger";

type PhaseLogger = (
  conversationId: string | undefined,
  message: string,
  data?: unknown,
) => void;

/**
 * Create a logger bound to a specific workflow phase and console label.
 */
export function createPhaseLogger(
  phase: ProcessingPhase,
  label: string,
  level: LogLevel = "info",
): PhaseLogger {
  return (conversationId, message, data) => {
    if (conversationId) {
      workflowLog(conversationId, phase, level, message, data);
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
