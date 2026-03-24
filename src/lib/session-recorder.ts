/**
 * Session Recorder — capture function calls with inputs, outputs, and store snapshots.
 *
 * ## Usage (from browser console)
 *
 *   window.__session.start("my-session-name")
 *   // ... interact with the UI ...
 *   window.__session.stop()   // triggers download of session log JSON
 *
 * ## How it works
 *
 * Two instrumentation strategies that work with ES modules:
 *
 * 1. **Store interception**: The Zustand store is a mutable object. We wrap
 *    every method on it to record calls + before/after state snapshots.
 *    This captures all state mutations triggered by UI interactions.
 *
 * 2. **Explicit recording**: Pure functions (stages, operations, parsers) call
 *    `recordCall()` at their entry/exit points. The pipeline's `run()` wrapper
 *    already centralizes stage execution — we hook into it. For individual
 *    pure functions, we provide `withRecording()` to wrap them at the call site.
 *
 * 3. **`wrapModule()` for mutable objects**: For objects like `parserRegistry`,
 *    we can wrap methods in-place since they're on mutable objects.
 *
 * ## What gets captured
 *
 * - Function name, module, arguments (safely serialized)
 * - Return value or error
 * - Duration
 * - Store state before/after (for functions marked as having side effects)
 * - Call nesting (parent-child relationships via a call stack)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallEntry {
  /** Monotonic index within this session */
  index: number;
  /** ISO timestamp */
  timestamp: string;
  /** Module path, e.g. "stages/parse" */
  module: string;
  /** Function name, e.g. "parse" */
  functionName: string;
  /** Serialized arguments (best-effort) */
  args: unknown[];
  /** Serialized return value (best-effort) */
  result?: unknown;
  /** Error message if the call threw */
  error?: string;
  /** Duration in ms */
  durationMs: number;
  /** Index of the parent call (for nested calls) */
  parentIndex?: number;
  /** Store snapshot BEFORE the call */
  storeBefore?: StoreSnapshot;
  /** Store snapshot AFTER the call */
  storeAfter?: StoreSnapshot;
}

export interface StoreSnapshot {
  conversations: unknown[];
  groups: Record<string, unknown>;
}

export interface SessionLog {
  sessionName: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  entryCount: number;
  entries: CallEntry[];
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

/**
 * Safely serialize a value for logging. Handles circular refs, huge arrays,
 * File objects, functions, etc.
 */
export function safeSerialize(value: unknown, depth = 0, seen = new WeakSet()): unknown {
  if (depth > MAX_DEPTH) return "[max depth]";
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "number" || t === "boolean") return value;
  if (t === "string") {
    return (value as string).length > MAX_STRING_LENGTH
      ? (value as string).slice(0, MAX_STRING_LENGTH) + `...[truncated, ${(value as string).length} chars]`
      : value;
  }
  if (t === "function") return `[Function: ${(value as Function).name || "anonymous"}]`;
  if (t === "symbol") return `[Symbol: ${(value as symbol).toString()}]`;
  if (t === "bigint") return `[BigInt: ${value.toString()}]`;

  if (value instanceof File) {
    return { __type: "File", name: value.name, size: value.size, type: value.type };
  }
  if (value instanceof Blob) {
    return { __type: "Blob", size: value.size, type: value.type };
  }
  if (value instanceof Date) return { __type: "Date", iso: value.toISOString() };
  if (value instanceof RegExp) return { __type: "RegExp", source: value.source, flags: value.flags };
  if (value instanceof Error) return { __type: "Error", message: value.message };
  if (value instanceof Map) {
    const arr = Array.from(value.entries()).slice(0, MAX_ARRAY_ITEMS);
    return { __type: "Map", size: value.size, entries: safeSerialize(arr, depth + 1, seen) };
  }
  if (value instanceof Set) {
    const arr = Array.from(value.values()).slice(0, MAX_ARRAY_ITEMS);
    return { __type: "Set", size: value.size, values: safeSerialize(arr, depth + 1, seen) };
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);
  }

  if (Array.isArray(value)) {
    const truncated = value.length > MAX_ARRAY_ITEMS;
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => safeSerialize(v, depth + 1, seen));
    if (truncated) items.push(`...[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }

  // Plain object
  const result: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>);
  for (const key of keys.slice(0, 100)) {
    result[key] = safeSerialize((value as Record<string, unknown>)[key], depth + 1, seen);
  }
  if (keys.length > 100) result["__truncated"] = `${keys.length - 100} more keys`;
  return result;
}

// ---------------------------------------------------------------------------
// Store snapshot
// ---------------------------------------------------------------------------

let getStoreState: (() => { conversations: unknown[]; groups: Record<string, unknown> }) | null = null;

export function setStoreAccessor(accessor: typeof getStoreState) {
  getStoreState = accessor;
}

function captureStoreSnapshot(): StoreSnapshot | undefined {
  if (!getStoreState) return undefined;
  try {
    const state = getStoreState();
    return {
      conversations: safeSerialize(state.conversations) as unknown[],
      groups: safeSerialize(state.groups) as Record<string, unknown>,
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

let _isRecording = false;
let sessionName = "";
let sessionStartTime = 0;
let callIndex = 0;
let entries: CallEntry[] = [];
/** Stack of active call indices for tracking nesting */
let callStack: number[] = [];

// ---------------------------------------------------------------------------
// Core recording function — called explicitly by instrumented code
// ---------------------------------------------------------------------------

/**
 * Record a function call. Call this at the boundaries you want to capture.
 *
 * For sync functions:
 *   const result = recordCall("stages/parse", "parse", [ctx], () => originalParse(ctx));
 *
 * For async functions:
 *   const result = await recordCall("stages/parse", "parse", [ctx], () => originalParse(ctx));
 *
 * The `fn` callback is always called (even when not recording), so there's
 * zero overhead when recording is off — just one boolean check.
 */
export function recordCall<T>(
  module: string,
  functionName: string,
  args: unknown[],
  fn: () => T,
  options: { captureStore?: boolean } = {},
): T {
  if (!_isRecording) return fn();

  const myIndex = callIndex++;
  const parentIndex = callStack.length > 0 ? callStack[callStack.length - 1] : undefined;
  callStack.push(myIndex);

  const entry: CallEntry = {
    index: myIndex,
    timestamp: new Date().toISOString(),
    module,
    functionName,
    args: args.map((a) => safeSerialize(a)),
    durationMs: 0,
    parentIndex,
  };

  if (options.captureStore) {
    entry.storeBefore = captureStoreSnapshot();
  }

  const start = performance.now();

  let result: T;
  try {
    result = fn();
  } catch (err: any) {
    entry.durationMs = Math.round(performance.now() - start);
    entry.error = err?.message || String(err);
    if (options.captureStore) entry.storeAfter = captureStoreSnapshot();
    callStack.pop();
    entries.push(entry);
    throw err;
  }

  // Handle async results
  if (result && typeof result === "object" && typeof (result as any).then === "function") {
    return (result as any).then(
      (resolved: any) => {
        entry.durationMs = Math.round(performance.now() - start);
        entry.result = safeSerialize(resolved);
        if (options.captureStore) entry.storeAfter = captureStoreSnapshot();
        callStack.pop();
        entries.push(entry);
        return resolved;
      },
      (err: any) => {
        entry.durationMs = Math.round(performance.now() - start);
        entry.error = err?.message || String(err);
        if (options.captureStore) entry.storeAfter = captureStoreSnapshot();
        callStack.pop();
        entries.push(entry);
        throw err;
      },
    ) as T;
  }

  // Sync result
  entry.durationMs = Math.round(performance.now() - start);
  entry.result = safeSerialize(result);
  if (options.captureStore) entry.storeAfter = captureStoreSnapshot();
  callStack.pop();
  entries.push(entry);
  return result;
}

// ---------------------------------------------------------------------------
// Convenience: wrap a function for recording
// ---------------------------------------------------------------------------

/**
 * Create a recording wrapper around a function.
 * Use this to wrap functions on mutable objects (store methods, registry methods, etc.)
 */
export function wrapForRecording<F extends (...args: any[]) => any>(
  module: string,
  functionName: string,
  fn: F,
  options: { captureStore?: boolean } = {},
): F {
  const wrapped = function (this: unknown, ...args: any[]) {
    return recordCall(module, functionName, args, () => fn.apply(this, args), options);
  };
  Object.defineProperty(wrapped, "name", { value: functionName });
  return wrapped as unknown as F;
}

/**
 * Wrap all methods on a mutable object for recording.
 * Mutates the object in-place.
 */
export function wrapObjectMethods(
  module: string,
  obj: Record<string, unknown>,
  options: { captureStore?: boolean; exclude?: string[] } = {},
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "function" && !options.exclude?.includes(key)) {
      (obj as any)[key] = wrapForRecording(module, key, value as any, options);
    }
  }
}

// ---------------------------------------------------------------------------
// Session controller
// ---------------------------------------------------------------------------

export const sessionRecorder = {
  get isRecording() {
    return _isRecording;
  },

  start(name?: string) {
    sessionName = name || `session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    sessionStartTime = Date.now();
    callIndex = 0;
    entries = [];
    callStack = [];
    _isRecording = true;
    console.log(`%c🔴 Session recording started: "${sessionName}"`, "color: red; font-weight: bold");
    console.log(`   Interact with the UI, then call window.__session.stop() to download the log.`);
  },

  stop() {
    if (!_isRecording) {
      console.warn("No session is recording.");
      return null;
    }
    _isRecording = false;
    const endTime = Date.now();

    const log: SessionLog = {
      sessionName,
      startedAt: new Date(sessionStartTime).toISOString(),
      endedAt: new Date(endTime).toISOString(),
      durationMs: endTime - sessionStartTime,
      entryCount: entries.length,
      entries,
    };

    // Download as JSON
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sessionName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(
      `%c⬇️  Session "${sessionName}" saved (${entries.length} calls, ${Math.round(log.durationMs / 1000)}s)`,
      "color: green; font-weight: bold",
    );

    entries = [];
    callStack = [];
    return log;
  },

  /** Get current entries without stopping */
  peek() {
    return { isRecording: _isRecording, sessionName, entryCount: entries.length, entries: [...entries] };
  },
};

// ---------------------------------------------------------------------------
// Expose on window for console access
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  (window as any).__session = sessionRecorder;
}
