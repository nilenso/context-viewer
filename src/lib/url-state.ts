/**
 * URL State Management
 *
 * Handles URL parsing/serialization for the application state.
 *
 * URL Schema:
 * - /c/:id                    Single conversation
 * - /c/:id/:tab               With tab (conversation, components, chart)
 * - /g/:id                    Grouped conversation
 * - /g/:id/:tab               With tab (including comparison)
 *
 * Query Parameters:
 * - Global filters (persist across tabs):
 *   - msg=user:text,assistant:tool-call  Message type filters
 *   - comp=planning,execution            Component filters
 *   - insights=summary|analysis          Insights panel tab
 *
 * - Tab-specific (conversation tab):
 *   - q=search                           Search query
 *   - sort=time-asc|time-desc|tokens-asc|tokens-desc
 *
 * - Tab-specific (comparison tab):
 *   - view=tokens|workflow
 *   - legend=expanded|compact
 *   - sortBy=tokens|name|category
 *   - sortDir=asc|desc
 *   - cols=3
 *   - spr=20                             Squares per row
 */

// Valid tab names for different conversation types
export type ConversationTab = "conversation" | "components" | "chart";
export type GroupTab = ConversationTab | "comparison";
export type TabType = ConversationTab | GroupTab;

// Sort options for conversation tab
export type SortOption = "time-asc" | "time-desc" | "tokens-asc" | "tokens-desc";

// Sort options for comparison tab
export type ComparisonSortField = "tokens" | "name" | "category";
export type ComparisonSortDirection = "asc" | "desc";

// View mode for comparison tab
export type ComparisonViewMode = "tokens" | "workflow";

// Legend mode for comparison tab
export type ComparisonLegendMode = "expanded" | "compact";

// Insights panel tab
export type InsightsTab = "summary" | "analysis";

// Message filter type (role:type format)
export type MessageFilter =
  | "system:text"
  | "user:text"
  | "user:image"
  | "user:file"
  | "assistant:text"
  | "assistant:file"
  | "assistant:reasoning"
  | "assistant:tool-call"
  | "tool:tool-result";

export const ALL_MESSAGE_FILTERS: MessageFilter[] = [
  "system:text",
  "user:text",
  "user:image",
  "user:file",
  "assistant:text",
  "assistant:file",
  "assistant:reasoning",
  "assistant:tool-call",
  "tool:tool-result",
];

/**
 * URL State object - represents the state encoded in the URL
 */
export interface UrlState {
  // Path-based state
  conversationId: string | null;
  isGrouped: boolean;
  tab: TabType;

  // Global filters (persist across tabs)
  messageFilters: Set<MessageFilter>;
  componentFilters: Set<string>;
  insightsTab: InsightsTab;

  // Conversation tab specific
  searchQuery: string;
  sort: SortOption;

  // Comparison tab specific
  comparisonView: ComparisonViewMode;
  comparisonLegend: ComparisonLegendMode;
  comparisonSortBy: ComparisonSortField;
  comparisonSortDir: ComparisonSortDirection;
  comparisonCols: number;
  comparisonSquaresPerRow: number;
}

/**
 * Default URL state values
 */
export const DEFAULT_URL_STATE: UrlState = {
  conversationId: null,
  isGrouped: false,
  tab: "conversation",
  messageFilters: new Set(ALL_MESSAGE_FILTERS),
  componentFilters: new Set(),
  insightsTab: "summary",
  searchQuery: "",
  sort: "time-asc",
  comparisonView: "tokens",
  comparisonLegend: "expanded",
  comparisonSortBy: "tokens",
  comparisonSortDir: "desc",
  comparisonCols: 3,
  comparisonSquaresPerRow: 20,
};

/**
 * Get the base path for the application
 * In production (GitHub Pages), this is /context-viewer/
 * In development, this is /
 */
export function getBasePath(): string {
  return import.meta.env.BASE_URL || "/";
}

/**
 * Parse the URL into a state object
 */
export function parseUrl(url: string = window.location.href): UrlState {
  const state = { ...DEFAULT_URL_STATE };
  const basePath = getBasePath();

  try {
    const urlObj = new URL(url, window.location.origin);
    let pathname = urlObj.pathname;

    // Remove base path prefix
    if (basePath !== "/" && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length - 1); // Keep leading slash
    }

    // Parse path: /c/:id/:tab or /g/:id/:tab
    const pathMatch = pathname.match(/^\/(c|g)\/([^\/]+)(?:\/([^\/]+))?/);
    if (pathMatch) {
      const [, type, id, tab] = pathMatch;
      state.conversationId = id ? decodeURIComponent(id) : null;
      state.isGrouped = type === "g";

      if (tab) {
        const validTabs: TabType[] = state.isGrouped
          ? ["conversation", "components", "chart", "comparison"]
          : ["conversation", "components", "chart"];
        if (validTabs.includes(tab as TabType)) {
          state.tab = tab as TabType;
        }
      }
    }

    const params = urlObj.searchParams;

    // Parse message filters
    const msgParam = params.get("msg");
    if (msgParam) {
      const filters = msgParam.split(",").filter(f =>
        ALL_MESSAGE_FILTERS.includes(f as MessageFilter)
      ) as MessageFilter[];
      if (filters.length > 0) {
        state.messageFilters = new Set(filters);
      }
    }

    // Parse component filters
    const compParam = params.get("comp");
    if (compParam) {
      const components = compParam.split(",").filter(c => c.trim());
      if (components.length > 0) {
        state.componentFilters = new Set(components);
      }
    }

    // Parse insights tab
    const insightsParam = params.get("insights");
    if (insightsParam === "summary" || insightsParam === "analysis") {
      state.insightsTab = insightsParam;
    }

    // Parse conversation tab params
    const searchParam = params.get("q");
    if (searchParam) {
      state.searchQuery = searchParam;
    }

    const sortParam = params.get("sort");
    if (sortParam && ["time-asc", "time-desc", "tokens-asc", "tokens-desc"].includes(sortParam)) {
      state.sort = sortParam as SortOption;
    }

    // Parse comparison tab params
    const viewParam = params.get("view");
    if (viewParam === "tokens" || viewParam === "workflow") {
      state.comparisonView = viewParam;
    }

    const legendParam = params.get("legend");
    if (legendParam === "expanded" || legendParam === "compact") {
      state.comparisonLegend = legendParam;
    }

    const sortByParam = params.get("sortBy");
    if (sortByParam && ["tokens", "name", "category"].includes(sortByParam)) {
      state.comparisonSortBy = sortByParam as ComparisonSortField;
    }

    const sortDirParam = params.get("sortDir");
    if (sortDirParam === "asc" || sortDirParam === "desc") {
      state.comparisonSortDir = sortDirParam;
    }

    const colsParam = params.get("cols");
    if (colsParam) {
      const cols = parseInt(colsParam, 10);
      if (!isNaN(cols) && cols >= 1 && cols <= 5) {
        state.comparisonCols = cols;
      }
    }

    const sprParam = params.get("spr");
    if (sprParam) {
      const spr = parseInt(sprParam, 10);
      if (!isNaN(spr) && [10, 15, 20, 25, 30, 40, 50].includes(spr)) {
        state.comparisonSquaresPerRow = spr;
      }
    }
  } catch (e) {
    console.warn("Failed to parse URL:", e);
  }

  return state;
}

/**
 * Check if message filters represent "all" (no filtering)
 */
function isAllMessageFilters(filters: Set<MessageFilter>): boolean {
  return filters.size === ALL_MESSAGE_FILTERS.length &&
    ALL_MESSAGE_FILTERS.every(f => filters.has(f));
}

/**
 * Serialize a state object to a URL string
 */
export function serializeUrl(state: Partial<UrlState>, currentState?: UrlState): string {
  const basePath = getBasePath();
  const merged = { ...DEFAULT_URL_STATE, ...currentState, ...state };

  // Build path
  let path = basePath;
  if (merged.conversationId) {
    const prefix = merged.isGrouped ? "g" : "c";
    path += `${prefix}/${encodeURIComponent(merged.conversationId)}`;
    if (merged.tab !== "conversation") {
      path += `/${merged.tab}`;
    }
  }

  // Build query params
  const params = new URLSearchParams();

  // Global filters - only add if not default
  if (!isAllMessageFilters(merged.messageFilters) && merged.messageFilters.size > 0) {
    params.set("msg", Array.from(merged.messageFilters).join(","));
  }

  if (merged.componentFilters.size > 0) {
    params.set("comp", Array.from(merged.componentFilters).join(","));
  }

  if (merged.insightsTab !== "summary") {
    params.set("insights", merged.insightsTab);
  }

  // Conversation tab params - only add if not default
  if (merged.searchQuery) {
    params.set("q", merged.searchQuery);
  }

  if (merged.sort !== "time-asc") {
    params.set("sort", merged.sort);
  }

  // Comparison tab params - only add if on comparison tab and not default
  if (merged.tab === "comparison") {
    if (merged.comparisonView !== "tokens") {
      params.set("view", merged.comparisonView);
    }

    if (merged.comparisonLegend !== "expanded") {
      params.set("legend", merged.comparisonLegend);
    }

    if (merged.comparisonSortBy !== "tokens") {
      params.set("sortBy", merged.comparisonSortBy);
    }

    if (merged.comparisonSortDir !== "desc") {
      params.set("sortDir", merged.comparisonSortDir);
    }

    if (merged.comparisonCols !== 3) {
      params.set("cols", String(merged.comparisonCols));
    }

    if (merged.comparisonSquaresPerRow !== 20) {
      params.set("spr", String(merged.comparisonSquaresPerRow));
    }
  }

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/**
 * Check if two URL states are equal (for the parts that matter)
 */
export function urlStatesEqual(a: UrlState, b: UrlState): boolean {
  if (a.conversationId !== b.conversationId) return false;
  if (a.isGrouped !== b.isGrouped) return false;
  if (a.tab !== b.tab) return false;
  if (a.insightsTab !== b.insightsTab) return false;
  if (a.searchQuery !== b.searchQuery) return false;
  if (a.sort !== b.sort) return false;
  if (a.comparisonView !== b.comparisonView) return false;
  if (a.comparisonLegend !== b.comparisonLegend) return false;
  if (a.comparisonSortBy !== b.comparisonSortBy) return false;
  if (a.comparisonSortDir !== b.comparisonSortDir) return false;
  if (a.comparisonCols !== b.comparisonCols) return false;
  if (a.comparisonSquaresPerRow !== b.comparisonSquaresPerRow) return false;

  // Compare sets
  if (a.messageFilters.size !== b.messageFilters.size) return false;
  for (const f of a.messageFilters) {
    if (!b.messageFilters.has(f)) return false;
  }

  if (a.componentFilters.size !== b.componentFilters.size) return false;
  for (const c of a.componentFilters) {
    if (!b.componentFilters.has(c)) return false;
  }

  return true;
}
