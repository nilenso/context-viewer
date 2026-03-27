/**
 * Shared statistical / aggregation functions for token counting and
 * component analysis. Pure functions only — no AI/API calls.
 */
import type { Conversation, Message } from "../model/schema";
import type { ComponentTimelineSnapshot } from "../model/types";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export interface ComponentAggregation {
  componentTokens: Record<string, number>;
  totalTokens: number;
}

export interface ComponentPercentage {
  component: string;
  tokens: number;
  percentage: number;
}

export const TUPLE_SEPARATOR = " · ";

// ---------------------------------------------------------------------------
// 1. getPartTokenCount
// ---------------------------------------------------------------------------

export function getPartTokenCount(part: Record<string, unknown>): number {
  return (typeof part.token_count === "number" && part.token_count) || 0;
}

// ---------------------------------------------------------------------------
// 2. getMessageTokenCount
// ---------------------------------------------------------------------------

export function getMessageTokenCount(message: Message): number {
  return message.parts.reduce((sum, part) => sum + getPartTokenCount(part), 0);
}

// ---------------------------------------------------------------------------
// 3. aggregateComponentTokens
// ---------------------------------------------------------------------------

export interface AggregateOptions {
  maxMessageIndex?: number;
  partFilter?: (part: { type: string }, msgRole: string) => boolean;
  filteredPartIds?: Set<string> | null;
  unmappedLabel?: string | null;
}

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

export function buildComponentTimeline(
  conversation: Conversation,
  componentMapping: Record<string, string>,
  options?: {
    partFilter?: (part: { type: string }, msgRole: string) => boolean;
    unmappedLabel?: string | null;
  },
): ComponentTimelineSnapshot[] {
  const partInfo = new Map<string, { messageIndex: number; tokenCount: number }>();
  conversation.messages.forEach((message, messageIndex) => {
    message.parts.forEach((part) => {
      const tokenCount = getPartTokenCount(part);
      partInfo.set(part.id, { messageIndex, tokenCount });
    });
  });

  const unmappedLabel = options?.unmappedLabel !== undefined ? options.unmappedLabel : "other";

  const shouldInclude = (partId: string): boolean => {
    if (!options?.partFilter) return true;
    for (const message of conversation.messages) {
      for (const part of message.parts) {
        if (part.id === partId) {
          return options.partFilter(part, message.role);
        }
      }
    }
    return false;
  };

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
