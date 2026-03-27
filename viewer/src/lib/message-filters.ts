/**
 * Shared message type filter logic.
 * Used by ComponentsView, StaticComponentsView, StackedBarChartView, and ConversationView.
 */

type MessageTypeFilter = string;

/**
 * Check if a message part passes the message type filter.
 * Returns true if no filters are active (undefined, empty, or "all" present).
 */
export function partPassesMessageTypeFilter(
  filters: Set<MessageTypeFilter> | undefined,
  partType: string,
  messageRole: string,
): boolean {
  if (!filters || filters.has("all")) return true;
  const filterKey = `${messageRole}:${partType}`;
  return filters.has(filterKey);
}

/**
 * Check if message type filters are actively filtering (i.e., not "show all").
 */
export function hasActiveMessageTypeFilters(
  filters: Set<MessageTypeFilter> | undefined,
): boolean {
  return !!filters && !filters.has("all") && filters.size > 0;
}
