/**
 * Pipeline logging for the viewer — stage timing display.
 *
 * The analyzer handles its own logging internally.
 * This module provides formatting utilities for the viewer's
 * WorkflowDetailModal to display step timings and log entries.
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  timestamp: Date;
  phase: string;
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
  stepTimings: Partial<Record<string, StepTiming>>;
}

// In-memory store for viewer-side logs (populated by interceptors)
const conversationLogsStore = new Map<string, ConversationLogs>();

type LogSubscriber = (conversationId: string, logs: ConversationLogs) => void;
const subscribers = new Set<LogSubscriber>();

export function subscribeToLogs(callback: LogSubscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notifySubscribers(conversationId: string, logs: ConversationLogs) {
  subscribers.forEach((callback) => callback(conversationId, logs));
}

export function getConversationLogs(conversationId: string): ConversationLogs {
  let logs = conversationLogsStore.get(conversationId);
  if (!logs) {
    logs = { conversationId, entries: [], stepTimings: {} };
    conversationLogsStore.set(conversationId, logs);
  }
  return logs;
}

export function clearConversationLogs(conversationId: string): void {
  conversationLogsStore.delete(conversationId);
}

export function pipelineLog(
  conversationId: string,
  phase: string,
  level: LogLevel,
  message: string,
  data?: unknown,
): void {
  const logs = getConversationLogs(conversationId);
  logs.entries.push({ timestamp: new Date(), phase, level, message, data });
  notifySubscribers(conversationId, logs);
}

export function markStepStart(conversationId: string, phase: string): void {
  const logs = getConversationLogs(conversationId);
  logs.stepTimings[phase] = { startTime: new Date() };
  pipelineLog(conversationId, phase, "info", `Starting ${phase}...`);
}

export function markStepEnd(conversationId: string, phase: string): void {
  const logs = getConversationLogs(conversationId);
  const timing = logs.stepTimings[phase];
  if (timing?.startTime) {
    timing.endTime = new Date();
    timing.durationMs = timing.endTime.getTime() - timing.startTime.getTime();
    pipelineLog(conversationId, phase, "info", `Completed ${phase} in ${formatDuration(timing.durationMs)}`);
  }
  notifySubscribers(conversationId, logs);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function createConversationLogger(conversationId: string) {
  return {
    info: (phase: string, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "info", message, data),
    warn: (phase: string, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "warn", message, data),
    error: (phase: string, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "error", message, data),
    debug: (phase: string, message: string, data?: unknown) =>
      pipelineLog(conversationId, phase, "debug", message, data),
    startStep: (phase: string) => markStepStart(conversationId, phase),
    endStep: (phase: string) => markStepEnd(conversationId, phase),
    getLogs: () => getConversationLogs(conversationId),
    clear: () => clearConversationLogs(conversationId),
  };
}
