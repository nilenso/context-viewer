import { create } from "zustand";
import {
  parseUrl,
  serializeUrl,
  urlStatesEqual,
  DEFAULT_URL_STATE,
  type UrlState,
  type TabType,
  type SortOption,
  type MessageFilter,
  type InsightsTab,
  type ComparisonViewMode,
  type ComparisonLegendMode,
  type ComparisonSortField,
  type ComparisonSortDirection,
  ALL_MESSAGE_FILTERS,
} from "@/ui/lib/url-state";

// Re-export types for convenience
export type {
  TabType,
  SortOption,
  MessageFilter,
  InsightsTab,
  ComparisonViewMode,
  ComparisonLegendMode,
  ComparisonSortField,
  ComparisonSortDirection,
};
export { ALL_MESSAGE_FILTERS };

type HistoryMethod = "push" | "replace";

interface UrlStore {
  // ---- State (mirrors UrlState) ----
  conversationId: string | null;
  isGrouped: boolean;
  tab: TabType;
  messageFilters: Set<MessageFilter>;
  componentFilters: Set<string>;
  insightsTab: InsightsTab;
  sidebarCollapsed: boolean;
  insightsCollapsed: boolean;
  searchQuery: string;
  sort: SortOption;
  comparisonView: ComparisonViewMode;
  comparisonLegend: ComparisonLegendMode;
  comparisonSortBy: ComparisonSortField;
  comparisonSortDir: ComparisonSortDirection;
  comparisonCols: number;
  comparisonSquaresPerRow: number;
  importUrl: string | null;

  // ---- Internal ----
  _update: (updates: Partial<UrlState>, method?: HistoryMethod) => void;
  _syncFromUrl: () => void;

  // ---- Navigation (push to history) ----
  navigateToConversation: (id: string, isGrouped?: boolean) => void;
  navigateToTab: (tab: TabType) => void;
  navigateHome: () => void;

  // ---- Filter / settings (replace, no history) ----
  setMessageFilters: (filters: Set<MessageFilter>) => void;
  setComponentFilters: (filters: Set<string>) => void;
  setInsightsTab: (tab: InsightsTab) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setInsightsCollapsed: (collapsed: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSort: (sort: SortOption) => void;

  // ---- Comparison settings ----
  setComparisonView: (view: ComparisonViewMode) => void;
  setComparisonLegend: (legend: ComparisonLegendMode) => void;
  setComparisonSortBy: (sortBy: ComparisonSortField) => void;
  setComparisonSortDir: (sortDir: ComparisonSortDirection) => void;
  setComparisonCols: (cols: number) => void;
  setComparisonSquaresPerRow: (spr: number) => void;
}

function stateToUrlState(state: UrlStore): UrlState {
  return {
    conversationId: state.conversationId,
    isGrouped: state.isGrouped,
    tab: state.tab,
    messageFilters: state.messageFilters,
    componentFilters: state.componentFilters,
    insightsTab: state.insightsTab,
    sidebarCollapsed: state.sidebarCollapsed,
    insightsCollapsed: state.insightsCollapsed,
    searchQuery: state.searchQuery,
    sort: state.sort,
    comparisonView: state.comparisonView,
    comparisonLegend: state.comparisonLegend,
    comparisonSortBy: state.comparisonSortBy,
    comparisonSortDir: state.comparisonSortDir,
    comparisonCols: state.comparisonCols,
    comparisonSquaresPerRow: state.comparisonSquaresPerRow,
    importUrl: state.importUrl,
  };
}

const initialUrl = parseUrl();

export const useUrlStore = create<UrlStore>((set, get) => ({
  // Initialize from current URL
  ...initialUrl,

  _update: (updates, method = "replace") => {
    const current = stateToUrlState(get());
    const newState = { ...current, ...updates };

    if (!urlStatesEqual(current, newState)) {
      const url = serializeUrl(newState);
      if (method === "push") {
        window.history.pushState({ urlState: newState }, "", url);
      } else {
        window.history.replaceState({ urlState: newState }, "", url);
      }
    }

    set(updates as Partial<UrlStore>);
  },

  _syncFromUrl: () => {
    const parsed = parseUrl();
    set(parsed as Partial<UrlStore>);
  },

  // Navigation (push)
  navigateToConversation: (id, isGrouped = false) => {
    get()._update(
      { conversationId: id, isGrouped, tab: "conversation", searchQuery: "" },
      "push",
    );
  },

  navigateToTab: (tab) => {
    get()._update({ tab }, "push");
  },

  navigateHome: () => {
    get()._update(
      { conversationId: null, isGrouped: false, tab: "conversation" },
      "push",
    );
  },

  // Filters (replace)
  setMessageFilters: (filters) => get()._update({ messageFilters: filters }),
  setComponentFilters: (filters) => get()._update({ componentFilters: filters }),
  setInsightsTab: (tab) => get()._update({ insightsTab: tab }),
  setSidebarCollapsed: (collapsed) => get()._update({ sidebarCollapsed: collapsed }),
  setInsightsCollapsed: (collapsed) => get()._update({ insightsCollapsed: collapsed }),
  setSearchQuery: (query) => get()._update({ searchQuery: query }),
  setSort: (sort) => get()._update({ sort }),

  // Comparison
  setComparisonView: (view) => get()._update({ comparisonView: view }),
  setComparisonLegend: (legend) => get()._update({ comparisonLegend: legend }),
  setComparisonSortBy: (sortBy) => get()._update({ comparisonSortBy: sortBy }),
  setComparisonSortDir: (sortDir) => get()._update({ comparisonSortDir: sortDir }),
  setComparisonCols: (cols) => get()._update({ comparisonCols: cols }),
  setComparisonSquaresPerRow: (spr) => get()._update({ comparisonSquaresPerRow: spr }),
}));

// Listen to browser back/forward — keep store in sync
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    useUrlStore.getState()._syncFromUrl();
  });
}
