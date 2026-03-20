/**
 * Pipeline Logger - Per-conversation logging system
 *
 * Replaces console.log for pipeline stages with structured, timestamped logs
 * that can be displayed in the UI.
 */

import type { Stage } from "@/model/types";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  timestamp: Date;
  phase: Stage;
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
  stepTimings: Partial<Record<Stage, StepTiming>>;
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
 * Log a message for a specific conversation and phase
 */
export function pipelineLog(
  conversationId: string,
  phase: Stage,
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
  phase: Stage,
): void {
  const logs = getConversationLogs(conversationId);

  logs.stepTimings[phase] = {
    startTime: new Date(),
  };

  pipelineLog(conversationId, phase, "info", `Starting ${phase}...`);
  notifySubscribers(conversationId, logs);
}

/**
 * Mark the end of a processing step
 */
export function markStepEnd(
  conversationId: string,
  phase: Stage,
): void {
  const logs = getConversationLogs(conversationId);
  const timing = logs.stepTimings[phase];

  if (timing && timing.startTime) {
    timing.endTime = new Date();
    timing.durationMs = timing.endTime.getTime() - timing.startTime.getTime();

    pipelineLog(
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
function getLogsForPhase(
  conversationId: string,
  phase: Stage,
): LogEntry[] {
  const logs = getConversationLogs(conversationId);
  return logs.entries.filter((entry) => entry.phase === phase);
}

/**
 * Create a logger bound to a specific conversation
 */
export function createConversationLogger(conversationId: string) {
  return {
    info: (phase: Stage, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "info", message, data),
    warn: (phase: Stage, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "warn", message, data),
    error: (phase: Stage, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "error", message, data),
    debug: (phase: Stage, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "debug", message, data),
    startStep: (phase: Stage) => markStepStart(conversationId, phase),
    endStep: (phase: Stage) => markStepEnd(conversationId, phase),
    getLogs: () => getConversationLogs(conversationId),
    getLogsForPhase: (phase: Stage) =>
      getLogsForPhase(conversationId, phase),
    clear: () => clearConversationLogs(conversationId),
  };
}
