/**
 * Workflow Logger - Per-conversation logging system
 *
 * Replaces console.log for workflow phases with structured, timestamped logs
 * that can be displayed in the UI.
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

export type ProcessingPhase =
  | "parsing"
  | "counting-tokens"
  | "segmenting"
  | "summary"
  | "finding-components"
  | "coloring"
  | "analysis";

export interface LogEntry {
  timestamp: Date;
  phase: ProcessingPhase;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export interface StepTiming {
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

export interface ConversationLogs {
  conversationId: string;
  entries: LogEntry[];
  stepTimings: Partial<Record<ProcessingPhase, StepTiming>>;
}

// Global store for conversation logs
const conversationLogsStore = new Map<string, ConversationLogs>();

// Subscribers for real-time updates
type LogSubscriber = (conversationId: string, logs: ConversationLogs) => void;
const subscribers = new Set<LogSubscriber>();

/**
 * Subscribe to log updates
 */
export function subscribeToLogs(callback: LogSubscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * Notify all subscribers of a log update
 */
function notifySubscribers(conversationId: string, logs: ConversationLogs) {
  subscribers.forEach((callback) => callback(conversationId, logs));
}

/**
 * Get or create logs for a conversation
 */
export function getConversationLogs(conversationId: string): ConversationLogs {
  let logs = conversationLogsStore.get(conversationId);
  if (!logs) {
    logs = {
      conversationId,
      entries: [],
      stepTimings: {},
    };
    conversationLogsStore.set(conversationId, logs);
  }
  return logs;
}

/**
 * Clear logs for a conversation
 */
export function clearConversationLogs(conversationId: string): void {
  conversationLogsStore.delete(conversationId);
}

/**
 * Clear all logs
 */
export function clearAllLogs(): void {
  conversationLogsStore.clear();
}

/**
 * Log a message for a specific conversation and phase
 */
export function workflowLog(
  conversationId: string,
  phase: ProcessingPhase,
  level: LogLevel,
  message: string,
  data?: unknown,
): void {
  const logs = getConversationLogs(conversationId);

  const entry: LogEntry = {
    timestamp: new Date(),
    phase,
    level,
    message,
    data,
  };

  logs.entries.push(entry);

  // Also log to console in dev mode for debugging
  if (import.meta.env.DEV) {
    const prefix = `[${phase}]`;
    const consoleMethod =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug"
            ? console.debug
            : console.log;

    if (data !== undefined) {
      consoleMethod(prefix, message, data);
    } else {
      consoleMethod(prefix, message);
    }
  }

  notifySubscribers(conversationId, logs);
}

/**
 * Mark the start of a processing step
 */
export function markStepStart(
  conversationId: string,
  phase: ProcessingPhase,
): void {
  const logs = getConversationLogs(conversationId);

  logs.stepTimings[phase] = {
    startTime: new Date(),
  };

  workflowLog(conversationId, phase, "info", `Starting ${phase}...`);
  notifySubscribers(conversationId, logs);
}

/**
 * Mark the end of a processing step
 */
export function markStepEnd(
  conversationId: string,
  phase: ProcessingPhase,
): void {
  const logs = getConversationLogs(conversationId);
  const timing = logs.stepTimings[phase];

  if (timing && timing.startTime) {
    timing.endTime = new Date();
    timing.durationMs = timing.endTime.getTime() - timing.startTime.getTime();

    workflowLog(
      conversationId,
      phase,
      "info",
      `Completed ${phase} in ${formatDuration(timing.durationMs)}`,
    );
  }

  notifySubscribers(conversationId, logs);
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Get logs for a specific phase
 */
export function getLogsForPhase(
  conversationId: string,
  phase: ProcessingPhase,
): LogEntry[] {
  const logs = getConversationLogs(conversationId);
  return logs.entries.filter((entry) => entry.phase === phase);
}

/**
 * Create a logger bound to a specific conversation
 */
export function createConversationLogger(conversationId: string) {
  return {
    info: (phase: ProcessingPhase, message: string, data?: unknown) =>
      workflowLog(conversationId, phase, "info", message, data),
    warn: (phase: ProcessingPhase, message: string, data?: unknown) =>
      workflowLog(conversationId, phase, "warn", message, data),
    error: (phase: ProcessingPhase, message: string, data?: unknown) =>
      workflowLog(conversationId, phase, "error", message, data),
    debug: (phase: ProcessingPhase, message: string, data?: unknown) =>
      workflowLog(conversationId, phase, "debug", message, data),
    startStep: (phase: ProcessingPhase) => markStepStart(conversationId, phase),
    endStep: (phase: ProcessingPhase) => markStepEnd(conversationId, phase),
    getLogs: () => getConversationLogs(conversationId),
    getLogsForPhase: (phase: ProcessingPhase) =>
      getLogsForPhase(conversationId, phase),
    clear: () => clearConversationLogs(conversationId),
  };
}

/**
 * React hook for subscribing to conversation logs
 */
export function useConversationLogs(conversationId: string | null) {
  // This will be imported from React in the component that uses it
  // For now, just export the subscribe function
  return {
    subscribe: subscribeToLogs,
    getLogs: () =>
      conversationId ? getConversationLogs(conversationId) : null,
  };
}
