/**
 * Shared statistical / aggregation functions for token counting and
 * component analysis. Pure functions only — no React, no AI/API calls.
 */
import type { Conversation, Message } from "@/model/schema";
import type { ComponentTimelineSnapshot } from "@/model/types";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

/** Result of aggregating component tokens */
export interface ComponentAggregation {
  componentTokens: Record<string, number>;
  totalTokens: number;
}

/** A component with its percentage of the total */
export interface ComponentPercentage {
  component: string;
  tokens: number;
  percentage: number;
}

/** Separator used in tuple keys (e.g. "default:comp1 · relevance:comp2") */
export const TUPLE_SEPARATOR = " · ";

// ---------------------------------------------------------------------------
// 1. getPartTokenCount
// ---------------------------------------------------------------------------

/** Extract token count from a part, returning 0 when absent. */
export function getPartTokenCount(part: Record<string, unknown>): number {
  return (typeof part.token_count === "number" && part.token_count) || 0;
}

// ---------------------------------------------------------------------------
// 2. getMessageTokenCount
// ---------------------------------------------------------------------------

/** Sum token counts across all parts of a message. */
export function getMessageTokenCount(message: Message): number {
  return message.parts.reduce((sum, part) => sum + getPartTokenCount(part), 0);
}

// ---------------------------------------------------------------------------
// 3. aggregateComponentTokens
// ---------------------------------------------------------------------------

export interface AggregateOptions {
  /** Stop after this message index (inclusive). */
  maxMessageIndex?: number;
  /** Only include parts whose type+role pass this predicate. */
  partFilter?: (part: { type: string }, msgRole: string) => boolean;
  /** Only include parts whose id is in this set. */
  filteredPartIds?: Set<string> | null;
  /** Label for unmapped parts. Pass `null` to skip unmapped parts entirely. */
  unmappedLabel?: string | null;
}

/**
 * Core building block: iterate a conversation's parts, look up each part in
 * `componentMapping`, and accumulate tokens per component.
 */
export function aggregateComponentTokens(
  conversation: Conversation,
  componentMapping: Record<string, string>,
  options?: AggregateOptions,
): ComponentAggregation {
  const componentTokens: Record<string, number> = {};
  let totalTokens = 0;
  const unmappedLabel = options?.unmappedLabel !== undefined ? options.unmappedLabel : "other";

  for (let msgIdx = 0; msgIdx < conversation.messages.length; msgIdx++) {
    if (options?.maxMessageIndex !== undefined && msgIdx > options.maxMessageIndex) break;
    const message = conversation.messages[msgIdx]!;
    for (const part of message.parts) {
      if (options?.partFilter && !options.partFilter(part, message.role)) continue;
      if (options?.filteredPartIds && !options.filteredPartIds.has(part.id)) continue;

      const tokenCount = getPartTokenCount(part);
      const component = componentMapping[part.id];

      if (component) {
        componentTokens[component] = (componentTokens[component] || 0) + tokenCount;
        totalTokens += tokenCount;
      } else if (unmappedLabel !== null) {
        componentTokens[unmappedLabel] = (componentTokens[unmappedLabel] || 0) + tokenCount;
        totalTokens += tokenCount;
      }
    }
  }

  return { componentTokens, totalTokens };
}

// ---------------------------------------------------------------------------
// 4. buildComponentTimeline
// ---------------------------------------------------------------------------

/**
 * Build a timeline of cumulative component token distribution at each message.
 * Unifies the former `buildComponentTimeline` (componentisation.ts) and
 * `buildStaticComponentTimeline` (static-componentisation.ts).
 *
 * @param options.partFilter — when provided, only matching parts contribute.
 * @param options.unmappedLabel — label for unmapped parts (default "other",
 *   pass `null` to skip them entirely).
 */
export function buildComponentTimeline(
  conversation: Conversation,
  componentMapping: Record<string, string>,
  options?: {
    partFilter?: (part: { type: string }, msgRole: string) => boolean;
    unmappedLabel?: string | null;
  },
): ComponentTimelineSnapshot[] {
  // Build a map of part ID → { messageIndex, tokenCount }
  const partInfo = new Map<string, { messageIndex: number; tokenCount: number }>();
  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      const tokenCount = getPartTokenCount(part);
      partInfo.set(part.id, { messageIndex, tokenCount });
    });
  });

  const unmappedLabel = options?.unmappedLabel !== undefined ? options.unmappedLabel : "other";

  // Optionally filter parts by partFilter
  const shouldInclude = (partId: string): boolean => {
    if (!options?.partFilter) return true;
    // To apply partFilter we need the part and message role — look them up
    for (const message of conversation.messages) {
      for (const part of message.parts) {
        if (part.id === partId) {
          return options.partFilter(part, message.role);
        }
      }
    }
    return false;
  };

  // Pre-filter part IDs for efficiency
  const eligiblePartIds = new Set<string>();
  for (const [partId] of partInfo) {
    if (shouldInclude(partId)) {
      eligiblePartIds.add(partId);
    }
  }

  const timeline: ComponentTimelineSnapshot[] = [];

  for (let msgIndex = 0; msgIndex < conversation.messages.length; msgIndex++) {
    const componentTokens: Record<string, number> = {};
    let totalTokens = 0;

    // Accumulate tokens for ALL parts up to and including this message
    for (const [partId, info] of partInfo) {
      if (info.messageIndex <= msgIndex && eligiblePartIds.has(partId)) {
        const component = componentMapping[partId];
        if (component) {
          componentTokens[component] = (componentTokens[component] || 0) + info.tokenCount;
          totalTokens += info.tokenCount;
        } else if (unmappedLabel !== null) {
          componentTokens[unmappedLabel] = (componentTokens[unmappedLabel] || 0) + info.tokenCount;
          totalTokens += info.tokenCount;
        }
      }
    }

    timeline.push({ messageIndex: msgIndex, componentTokens, totalTokens });
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// 5. computeTupleTokens
// ---------------------------------------------------------------------------

/**
 * Compute tuple-based token aggregation across multiple dimensions.
 * Each tuple key is a combination like "default:explore.search-files · relevance:relevant".
 */
export function computeTupleTokens(
  conversation: Conversation,
  dimensions: Record<string, { componentMapping: Record<string, string> }>,
  activeDimNames?: string[],
  options?: {
    maxMessageIndex?: number;
    filteredPartIds?: Set<string> | null;
    partFilter?: (part: { type: string }, msgRole: string) => boolean;
  },
): { tupleTokens: Record<string, number>; total: number } {
  const dimNames = activeDimNames || Object.keys(dimensions).sort();
  const tupleTokens: Record<string, number> = {};
  let total = 0;

  for (let msgIdx = 0; msgIdx < conversation.messages.length; msgIdx++) {
    if (options?.maxMessageIndex !== undefined && msgIdx > options.maxMessageIndex) break;
    const message = conversation.messages[msgIdx]!;
    for (const part of message.parts) {
      const tokenCount = getPartTokenCount(part);
      if (options?.partFilter && !options.partFilter(part, message.role)) continue;
      if (options?.filteredPartIds && !options.filteredPartIds.has(part.id)) continue;

      const segments: string[] = [];
      for (const dimName of dimNames) {
        const comp = dimensions[dimName]?.componentMapping[part.id];
        if (comp) segments.push(`${dimName}:${comp}`);
      }
      if (segments.length === 0) continue;
      const tupleKey = segments.join(TUPLE_SEPARATOR);
      tupleTokens[tupleKey] = (tupleTokens[tupleKey] || 0) + tokenCount;
      total += tokenCount;
    }
  }

  return { tupleTokens, total };
}

// ---------------------------------------------------------------------------
// 6. computePercentages
// ---------------------------------------------------------------------------

/**
 * Convert a componentTokens map into a sorted array of ComponentPercentage.
 * If `totalTokens` is not supplied it is computed from the map values.
 */
export function computePercentages(
  componentTokens: Record<string, number>,
  totalTokens?: number,
): ComponentPercentage[] {
  const total = totalTokens ?? Object.values(componentTokens).reduce((s, t) => s + t, 0);
  return Object.entries(componentTokens)
    .map(([component, tokens]) => ({
      component,
      tokens,
      percentage: total > 0 ? (tokens / total) * 100 : 0,
    }));
}

// ---------------------------------------------------------------------------
// 7. generateComponentCSV
// ---------------------------------------------------------------------------

/**
 * Generate CSV data from a component timeline for AI analysis.
 */
export function generateComponentCSV(
  componentTimeline: ComponentTimelineSnapshot[],
  components: string[],
): string {
  const header = ["Message", "Total Tokens", ...components].join(",");

  const rows = componentTimeline.map((snapshot, idx) => {
    const row = [
      `Msg ${idx + 1}`,
      snapshot.totalTokens.toString(),
      ...components.map((component) => {
        const tokens = snapshot.componentTokens[component] || 0;
        const percentage =
          snapshot.totalTokens > 0
            ? ((tokens / snapshot.totalTokens) * 100).toFixed(1)
            : "0.0";
        return `${tokens} (${percentage}%)`;
      }),
    ];
    return row.join(",");
  });

  return [header, ...rows].join("\n");
}
