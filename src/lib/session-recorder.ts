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
 * - Call nesting (parent-child relationships derived from time containment)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallEntry {
  /** Monotonic index within this session (assigned at call start) */
  index: number;
  /** ISO timestamp of call start */
  timestamp: string;
  /** High-resolution start time (ms, relative to session start) */
  startMs: number;
  /** High-resolution end time (ms, relative to session start) */
  endMs: number;
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
  /** Index of the parent call (computed from time containment at session end) */
  parentIndex?: number;
  /** Store diff: what changed during this call (only for captureStore calls) */
  storeDiff?: StoreDiff;
}

// ---------------------------------------------------------------------------
// Store diff types
// ---------------------------------------------------------------------------

/** Compact summary of a conversation for diffing (small fields in full, large fields by shape) */
export interface ConversationCompact {
  id: string;
  filename: string;
  status?: string;
  step?: string;
  error?: string;
  title?: string;
  messageCount: number;
  totalParts: number;
  summary?: unknown;
  parserName?: string;
  aiSummaryLength: number;
  analysisLength: number;
  dimensions?: Record<string, DimensionCompact>;
  staticComponents?: string[];
  staticMappingCount: number;
  staticTimelineLength: number;
  stepTimings?: unknown;
  warnings?: string[];
  customSegmentationPrompt?: boolean;
  customSummaryPrompt?: boolean;
  customAnalysisPrompt?: boolean;
}

export interface DimensionCompact {
  discoveredComponents: string[];
  customComponents?: string[];
  componentColors: Record<string, string>;
  mappingCount: number;
  timelineLength: number;
  hasPrompt: boolean;
  hasCustomColoringPrompt: boolean;
}

export interface StoreDiff {
  conversations: {
    added?: ConversationCompact[];
    removed?: string[];
    /** id → { field: [oldValue, newValue] } */
    changed?: Record<string, Record<string, [unknown, unknown]>>;
  };
  groups: {
    added?: Record<string, unknown>;
    removed?: string[];
    changed?: Record<string, Record<string, [unknown, unknown]>>;
  };
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
// Store diffing
// ---------------------------------------------------------------------------

let getStoreState: (() => { conversations: any[]; groups: Record<string, any> }) | null = null;

export function setStoreAccessor(accessor: typeof getStoreState) {
  getStoreState = accessor;
}

/** Raw store snapshot — kept in memory only, never serialized directly */
interface RawSnapshot {
  conversations: Map<string, any>; // id → raw conversation object
  groups: Map<string, any>;        // id → raw group object
  /** Pre-computed compact summaries for diffing */
  convCompact: Map<string, ConversationCompact>;
  groupCompact: Map<string, Record<string, unknown>>;
}

function compactConversation(conv: any): ConversationCompact {
  const dims = conv.dimensions
    ? Object.fromEntries(
        Object.entries(conv.dimensions).map(([k, d]: [string, any]) => [k, {
          discoveredComponents: d.discoveredComponents || [],
          customComponents: d.customComponents,
          componentColors: d.componentColors || {},
          mappingCount: Object.keys(d.componentMapping || {}).length,
          timelineLength: d.componentTimeline?.length ?? 0,
          hasPrompt: !!d.prompt,
          hasCustomColoringPrompt: !!d.customColoringPrompt,
        } as DimensionCompact]),
      )
    : undefined;

  return {
    id: conv.id,
    filename: conv.filename,
    status: conv.status,
    step: conv.step,
    error: conv.error,
    title: conv.title,
    messageCount: conv.conversation?.messages?.length ?? 0,
    totalParts: conv.conversation?.messages?.reduce((s: number, m: any) => s + (m.parts?.length ?? 0), 0) ?? 0,
    summary: conv.summary,
    parserName: conv.metadata?.parserName,
    aiSummaryLength: conv.aiSummary?.length ?? 0,
    analysisLength: conv.analysis?.length ?? 0,
    dimensions: dims,
    staticComponents: conv.staticComponents,
    staticMappingCount: conv.staticMapping ? Object.keys(conv.staticMapping).length : 0,
    staticTimelineLength: conv.staticTimeline?.length ?? 0,
    stepTimings: conv.stepTimings,
    warnings: conv.warnings,
    customSegmentationPrompt: conv.customSegmentationPrompt ? true : undefined,
    customSummaryPrompt: conv.customSummaryPrompt ? true : undefined,
    customAnalysisPrompt: conv.customAnalysisPrompt ? true : undefined,
  };
}

function compactGroup(group: any): Record<string, unknown> {
  return {
    id: group.id,
    name: group.name,
    title: group.title,
    fileIds: group.fileIds,
    aiSummaryLength: group.aiSummary?.length ?? 0,
    analysisLength: group.analysis?.length ?? 0,
    customSummaryPrompt: group.customSummaryPrompt ? true : undefined,
    customAnalysisPrompt: group.customAnalysisPrompt ? true : undefined,
  };
}

function captureRawSnapshot(): RawSnapshot | null {
  if (!getStoreState) return null;
  try {
    const state = getStoreState();
    const convCompact = new Map<string, ConversationCompact>();
    const conversations = new Map<string, any>();
    for (const conv of state.conversations) {
      if (conv && conv.id) {
        conversations.set(conv.id, conv);
        convCompact.set(conv.id, compactConversation(conv));
      }
    }
    const groupCompact = new Map<string, Record<string, unknown>>();
    const groups = new Map<string, any>();
    for (const [id, group] of Object.entries(state.groups)) {
      groups.set(id, group);
      groupCompact.set(id, compactGroup(group));
    }
    return { conversations, groups, convCompact, groupCompact };
  } catch {
    return null;
  }
}

/** Shallow diff two plain objects, returning { field: [old, new] } for changed fields */
function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> | null {
  const changes: Record<string, [unknown, unknown]> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const bVal = before[key];
    const aVal = after[key];
    // Fast reference check, then JSON comparison for value equality
    if (bVal !== aVal && JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      changes[key] = [bVal, aVal];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function computeStoreDiff(before: RawSnapshot | null, after: RawSnapshot | null): StoreDiff | undefined {
  if (!before || !after) return undefined;

  const diff: StoreDiff = { conversations: {}, groups: {} };
  let hasChanges = false;

  // --- Conversations ---
  const added: ConversationCompact[] = [];
  const removed: string[] = [];
  const changed: Record<string, Record<string, [unknown, unknown]>> = {};

  for (const [id, compact] of after.convCompact) {
    if (!before.convCompact.has(id)) {
      added.push(compact);
      hasChanges = true;
    } else {
      const fieldDiff = diffObjects(
        before.convCompact.get(id)! as unknown as Record<string, unknown>,
        compact as unknown as Record<string, unknown>,
      );
      if (fieldDiff) {
        changed[id] = fieldDiff;
        hasChanges = true;
      }
    }
  }
  for (const id of before.convCompact.keys()) {
    if (!after.convCompact.has(id)) {
      removed.push(id);
      hasChanges = true;
    }
  }

  if (added.length > 0) diff.conversations.added = added;
  if (removed.length > 0) diff.conversations.removed = removed;
  if (Object.keys(changed).length > 0) diff.conversations.changed = changed;

  // --- Groups ---
  const gAdded: Record<string, unknown> = {};
  const gRemoved: string[] = [];
  const gChanged: Record<string, Record<string, [unknown, unknown]>> = {};

  for (const [id, compact] of after.groupCompact) {
    if (!before.groupCompact.has(id)) {
      gAdded[id] = compact;
      hasChanges = true;
    } else {
      const fieldDiff = diffObjects(
        before.groupCompact.get(id)! as Record<string, unknown>,
        compact as Record<string, unknown>,
      );
      if (fieldDiff) {
        gChanged[id] = fieldDiff;
        hasChanges = true;
      }
    }
  }
  for (const id of before.groupCompact.keys()) {
    if (!after.groupCompact.has(id)) {
      gRemoved.push(id);
      hasChanges = true;
    }
  }

  if (Object.keys(gAdded).length > 0) diff.groups.added = gAdded;
  if (gRemoved.length > 0) diff.groups.removed = gRemoved;
  if (Object.keys(gChanged).length > 0) diff.groups.changed = gChanged;

  return hasChanges ? diff : undefined;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

let _isRecording = false;
let sessionName = "";
let sessionStartTime = 0;
/** performance.now() baseline for relative timestamps */
let perfBaseline = 0;
let callIndex = 0;
let entries: CallEntry[] = [];

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
 *
 * Parent-child relationships are NOT tracked via a call stack (which breaks
 * with concurrent async calls). Instead, each entry records its startMs/endMs
 * and parentIndex is computed from time containment at session end.
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
  const start = performance.now();

  const entry: CallEntry = {
    index: myIndex,
    timestamp: new Date().toISOString(),
    startMs: Math.round(start - perfBaseline),
    endMs: 0, // filled on completion
    module,
    functionName,
    args: args.map((a) => safeSerialize(a)),
    durationMs: 0,
  };

  const snapshotBefore = options.captureStore ? captureRawSnapshot() : null;

  function finalize(result?: unknown, err?: any) {
    const end = performance.now();
    entry.endMs = Math.round(end - perfBaseline);
    entry.durationMs = Math.round(end - start);
    if (err) {
      entry.error = err?.message || String(err);
    } else {
      entry.result = safeSerialize(result);
    }
    if (options.captureStore) {
      const snapshotAfter = captureRawSnapshot();
      entry.storeDiff = computeStoreDiff(snapshotBefore, snapshotAfter);
    }
    entries.push(entry);
  }

  let result: T;
  try {
    result = fn();
  } catch (err: any) {
    finalize(undefined, err);
    throw err;
  }

  // Handle async results
  if (result && typeof result === "object" && typeof (result as any).then === "function") {
    return (result as any).then(
      (resolved: any) => {
        finalize(resolved);
        return resolved;
      },
      (err: any) => {
        finalize(undefined, err);
        throw err;
      },
    ) as T;
  }

  // Sync result
  finalize(result);
  return result;
}

// ---------------------------------------------------------------------------
// Parent computation from time containment
// ---------------------------------------------------------------------------

/**
 * Compute parentIndex for each entry based on time containment.
 *
 * Entry B is a child of entry A if:
 *   A.startMs <= B.startMs AND B.endMs <= A.endMs  (B is fully contained in A)
 *
 * Among all such candidates, the parent is the one with the LATEST startMs
 * (i.e., the tightest containing interval — the most immediate parent).
 */
function computeParentIndices(entries: CallEntry[]): void {
  // Sort by startMs for efficient processing
  const sorted = [...entries].sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);

  // Build index map: entry.index → entry reference
  const byIndex = new Map<number, CallEntry>();
  for (const e of entries) byIndex.set(e.index, e);

  // For each entry, find its tightest containing parent
  for (const child of sorted) {
    let bestParent: CallEntry | undefined;
    for (const candidate of sorted) {
      if (candidate.index === child.index) continue;
      // candidate contains child?
      if (candidate.startMs <= child.startMs && child.endMs <= candidate.endMs) {
        // Tightest = latest startMs (or shortest duration if same start)
        if (!bestParent ||
            candidate.startMs > bestParent.startMs ||
            (candidate.startMs === bestParent.startMs && candidate.durationMs < bestParent.durationMs)) {
          bestParent = candidate;
        }
      }
    }
    child.parentIndex = bestParent?.index;
  }
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
    perfBaseline = performance.now();
    callIndex = 0;
    entries = [];
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

    // Compute parent-child relationships from time containment
    computeParentIndices(entries);

    // Sort entries by start time (they arrive in completion order due to async)
    entries.sort((a, b) => a.startMs - b.startMs || a.index - b.index);

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
