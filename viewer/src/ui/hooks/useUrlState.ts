import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * History behavior for URL updates
 * - push: Creates a new history entry (back button returns to previous)
 * - replace: Updates current entry (no history entry created)
 */
type HistoryMethod = "push" | "replace";

/**
 * Hook return type for URL state management
 */
interface UseUrlStateReturn {
  // Current state values
  state: UrlState;

  // Navigation actions (create history entries)
  navigateToConversation: (id: string, isGrouped?: boolean) => void;
  navigateToTab: (tab: TabType) => void;
  navigateHome: () => void;

  // Filter/settings updates (replace current entry, no history)
  setMessageFilters: (filters: Set<MessageFilter>) => void;
  setComponentFilters: (filters: Set<string>) => void;
  setInsightsTab: (tab: InsightsTab) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setInsightsCollapsed: (collapsed: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSort: (sort: SortOption) => void;

  // Comparison tab settings (replace current entry)
  setComparisonView: (view: ComparisonViewMode) => void;
  setComparisonLegend: (legend: ComparisonLegendMode) => void;
  setComparisonSortBy: (sortBy: ComparisonSortField) => void;
  setComparisonSortDir: (sortDir: ComparisonSortDirection) => void;
  setComparisonCols: (cols: number) => void;
  setComparisonSquaresPerRow: (spr: number) => void;

  // Batch update for multiple comparison settings
  updateComparisonSettings: (settings: Partial<{
    view: ComparisonViewMode;
    legend: ComparisonLegendMode;
    sortBy: ComparisonSortField;
    sortDir: ComparisonSortDirection;
    cols: number;
    squaresPerRow: number;
  }>) => void;
}

/**
 * Custom hook for bidirectional URL state synchronization
 *
 * Features:
 * - Initializes from current URL on mount
 * - Listens to popstate for browser back/forward
 * - pushState for navigation (creates history entry)
 * - replaceState for filter changes (no new history entry)
 */
export function useUrlState(): UseUrlStateReturn {
  // Initialize state from current URL
  const [state, setState] = useState<UrlState>(() => parseUrl());

  // Track if we're handling a popstate event to prevent loops
  const isHandlingPopstate = useRef(false);

  // Update URL in browser
  const updateUrl = useCallback((newState: UrlState, method: HistoryMethod) => {
    const url = serializeUrl(newState);

    if (method === "push") {
      window.history.pushState({ urlState: newState }, "", url);
    } else {
      window.history.replaceState({ urlState: newState }, "", url);
    }
  }, []);

  // Generic update function
  const updateState = useCallback((
    updates: Partial<UrlState>,
    method: HistoryMethod = "replace"
  ) => {
    setState(current => {
      const newState = { ...current, ...updates };

      // Only update URL if state actually changed
      if (!urlStatesEqual(current, newState)) {
        updateUrl(newState, method);
      }

      return newState;
    });
  }, [updateUrl]);

  // Listen to browser back/forward navigation
  useEffect(() => {
    const handlePopstate = () => {
      isHandlingPopstate.current = true;
      const newState = parseUrl();
      setState(newState);
      // Reset flag after a tick to allow normal updates
      requestAnimationFrame(() => {
        isHandlingPopstate.current = false;
      });
    };

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  // Navigation actions (push to history)
  const navigateToConversation = useCallback((id: string, isGrouped = false) => {
    updateState({
      conversationId: id,
      isGrouped,
      // Reset to default tab when navigating to new conversation
      tab: "conversation",
      // Clear search when changing conversations
      searchQuery: "",
    }, "push");
  }, [updateState]);

  const navigateToTab = useCallback((tab: TabType) => {
    updateState({ tab }, "push");
  }, [updateState]);

  const navigateHome = useCallback(() => {
    updateState({
      conversationId: null,
      isGrouped: false,
      tab: "conversation",
    }, "push");
  }, [updateState]);

  // Filter/settings updates (replace, no history)
  const setMessageFilters = useCallback((filters: Set<MessageFilter>) => {
    updateState({ messageFilters: filters });
  }, [updateState]);

  const setComponentFilters = useCallback((filters: Set<string>) => {
    updateState({ componentFilters: filters });
  }, [updateState]);

  const setInsightsTab = useCallback((tab: InsightsTab) => {
    updateState({ insightsTab: tab });
  }, [updateState]);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    updateState({ sidebarCollapsed: collapsed });
  }, [updateState]);

  const setInsightsCollapsed = useCallback((collapsed: boolean) => {
    updateState({ insightsCollapsed: collapsed });
  }, [updateState]);

  const setSearchQuery = useCallback((query: string) => {
    updateState({ searchQuery: query });
  }, [updateState]);

  const setSort = useCallback((sort: SortOption) => {
    updateState({ sort });
  }, [updateState]);

  // Comparison tab settings
  const setComparisonView = useCallback((view: ComparisonViewMode) => {
    updateState({ comparisonView: view });
  }, [updateState]);

  const setComparisonLegend = useCallback((legend: ComparisonLegendMode) => {
    updateState({ comparisonLegend: legend });
  }, [updateState]);

  const setComparisonSortBy = useCallback((sortBy: ComparisonSortField) => {
    updateState({ comparisonSortBy: sortBy });
  }, [updateState]);

  const setComparisonSortDir = useCallback((sortDir: ComparisonSortDirection) => {
    updateState({ comparisonSortDir: sortDir });
  }, [updateState]);

  const setComparisonCols = useCallback((cols: number) => {
    updateState({ comparisonCols: cols });
  }, [updateState]);

  const setComparisonSquaresPerRow = useCallback((spr: number) => {
    updateState({ comparisonSquaresPerRow: spr });
  }, [updateState]);

  const updateComparisonSettings = useCallback((settings: Partial<{
    view: ComparisonViewMode;
    legend: ComparisonLegendMode;
    sortBy: ComparisonSortField;
    sortDir: ComparisonSortDirection;
    cols: number;
    squaresPerRow: number;
  }>) => {
    const updates: Partial<UrlState> = {};
    if (settings.view !== undefined) updates.comparisonView = settings.view;
    if (settings.legend !== undefined) updates.comparisonLegend = settings.legend;
    if (settings.sortBy !== undefined) updates.comparisonSortBy = settings.sortBy;
    if (settings.sortDir !== undefined) updates.comparisonSortDir = settings.sortDir;
    if (settings.cols !== undefined) updates.comparisonCols = settings.cols;
    if (settings.squaresPerRow !== undefined) updates.comparisonSquaresPerRow = settings.squaresPerRow;
    updateState(updates);
  }, [updateState]);

  return {
    state,
    navigateToConversation,
    navigateToTab,
    navigateHome,
    setMessageFilters,
    setComponentFilters,
    setInsightsTab,
    setSidebarCollapsed,
    setInsightsCollapsed,
    setSearchQuery,
    setSort,
    setComparisonView,
    setComparisonLegend,
    setComparisonSortBy,
    setComparisonSortDir,
    setComparisonCols,
    setComparisonSquaresPerRow,
    updateComparisonSettings,
  };
}

/**
 * Helper hook to get message filters with "all" state detection
 */
export function useMessageFiltersWithAll(filters: Set<MessageFilter>): {
  filters: Set<MessageFilter | "all">;
  hasAll: boolean;
  toggle: (filter: MessageFilter | "all", setFilters: (f: Set<MessageFilter>) => void) => void;
} {
  const hasAll = useMemo(() => {
    return filters.size === ALL_MESSAGE_FILTERS.length &&
      ALL_MESSAGE_FILTERS.every(f => filters.has(f));
  }, [filters]);

  const filtersWithAll = useMemo(() => {
    const result = new Set<MessageFilter | "all">(filters);
    if (hasAll) {
      result.add("all");
    }
    return result;
  }, [filters, hasAll]);

  const toggle = useCallback((
    filter: MessageFilter | "all",
    setFilters: (f: Set<MessageFilter>) => void
  ) => {
    if (filter === "all") {
      // Toggle all on/off
      if (hasAll) {
        setFilters(new Set());
      } else {
        setFilters(new Set(ALL_MESSAGE_FILTERS));
      }
    } else {
      // Toggle individual filter
      const newSet = new Set(filters);
      if (newSet.has(filter)) {
        newSet.delete(filter);
      } else {
        newSet.add(filter);
      }
      setFilters(newSet);
    }
  }, [filters, hasAll]);

  return { filters: filtersWithAll, hasAll, toggle };
}
