import { useState } from "react";
import { cn } from "@/lib/utils";
import { getComponentWaffleStyles } from "@/lib/component-colors";
import { ArrowUp, ArrowDown, LayoutGrid, Rows3 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

type SortField = "tokens" | "name" | "category";
type SortDirection = "asc" | "desc";

export interface ConversationComponentData {
  id: string;
  filename: string;
  title?: string; // Custom title, displays instead of filename when set
  componentTokens: Record<string, number>;
  totalTokens: number;
  turnCount: number; // Number of user messages (turns)
  messageCount: number; // Total messages
  durationMs?: number; // Duration in milliseconds (from first to last message)
  messageComponents?: string[]; // Component for each message in order (for workflow view)
  // Multi-dimensional data
  dimensionData?: Record<string, {
    componentTokens: Record<string, number>;
    messageComponents?: string[];
  }>;
}

/**
 * Format duration in a human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Extract the category (prefix before first dot) from a component name
 */
function getCategory(component: string): string {
  const dotIndex = component.indexOf(".");
  return dotIndex > 0 ? component.substring(0, dotIndex) : component;
}

/**
 * Sort components by category - groups components by their prefix,
 * sorts categories by total tokens, then sorts within each category by tokens
 */
function sortByCategory(
  componentTokens: Record<string, number>,
  direction: SortDirection
): Array<{ component: string; tokens: number; percentage: number; category: string }> {
  // Calculate total tokens
  const totalTokens = Object.values(componentTokens).reduce((sum, t) => sum + t, 0);

  // Build component data with category info
  const componentData = Object.entries(componentTokens).map(([component, tokens]) => ({
    component,
    tokens,
    percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
    category: getCategory(component),
  }));

  // Calculate category totals
  const categoryTotals: Record<string, number> = {};
  for (const { category, tokens } of componentData) {
    categoryTotals[category] = (categoryTotals[category] || 0) + tokens;
  }

  // Sort: first by category total, then by individual tokens within category
  const dir = direction === "asc" ? 1 : -1;
  return componentData.sort((a, b) => {
    const categoryCompare = ((categoryTotals[b.category] || 0) - (categoryTotals[a.category] || 0)) * dir;
    if (categoryCompare !== 0) return categoryCompare;
    // Within same category, sort by tokens in same direction
    return (b.tokens - a.tokens) * dir;
  });
}

// Export types for URL state integration
export type ViewMode = "tokens" | "workflow" | "tokens-absolute";
export type LegendMode = "expanded" | "compact";
export type { SortField, SortDirection };

interface ComponentComparisonViewProps {
  sourceConversations: ConversationComponentData[];
  componentColors?: Record<string, string>;
  hasActiveFilters?: boolean;
  groupTitle?: string;
  onConversationClick?: (id: string) => void;
  // Controlled state props (optional - falls back to local state if not provided)
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  legendMode?: LegendMode;
  onLegendModeChange?: (mode: LegendMode) => void;
  sortField?: SortField;
  onSortFieldChange?: (field: SortField) => void;
  sortDirection?: SortDirection;
  onSortDirectionChange?: (dir: SortDirection) => void;
  columnCount?: number;
  onColumnCountChange?: (cols: number) => void;
  squaresPerRow?: number;
  onSquaresPerRowChange?: (spr: number) => void;
}

/**
 * Compact legend - horizontal list of color squares with labels (no percentages)
 * Used for both workflow view and compact token view
 */
export function CompactLegend({
  components,
  componentColors,
}: {
  components: string[];
  componentColors?: Record<string, string>;
}) {
  // Get unique components preserving order
  const uniqueComponents = [...new Set(components)].filter(Boolean);

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {uniqueComponents.map((component) => {
        const colorStyles = getComponentWaffleStyles(component, componentColors);
        return (
          <div key={component} className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-3 h-3 flex-shrink-0",
                colorStyles.classes,
              )}
              style={colorStyles.style || undefined}
            />
            <span className="text-muted-foreground [font-variant:small-caps]">{component}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Message-based workflow waffle chart
 * Each square = one message, colored by its component, in conversation order
 */
export function MessageWorkflowChart({
  messageComponents,
  componentColors,
  squaresPerRow,
}: {
  messageComponents: string[];
  componentColors?: Record<string, string>;
  squaresPerRow: number;
}) {
  return (
    <div className="flex-shrink-0">
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${squaresPerRow}, minmax(0, 1fr))`,
        }}
      >
        {messageComponents.map((component, index) => {
          const colorStyles = component ? getComponentWaffleStyles(component, componentColors) : null;
          return (
            <div
              key={index}
              className={cn(
                "w-3 h-3",
                component ? colorStyles?.classes : "bg-gray-200",
              )}
              style={colorStyles?.style || undefined}
              title={`${index + 1}: ${component || "unknown"}`}
            />
          );
        })}
      </div>
    </div>
  );
}


/**
 * Mini waffle chart for comparison view - smaller 10x10 grid
 */
function MiniWaffleChart({
  componentTokens,
  totalTokens,
  componentColors,
  sortField,
  sortDirection,
}: {
  componentTokens: Record<string, number>;
  totalTokens: number;
  componentColors?: Record<string, string>;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  const GRID_SIZE = 100; // 10x10 grid for mini version

  // Calculate percentages and sort based on field and direction
  const componentData = sortField === "category"
    ? sortByCategory(componentTokens, sortDirection)
    : Object.entries(componentTokens)
        .map(([component, tokens]) => ({
          component,
          tokens,
          percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        }))
        .sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          if (sortField === "name") {
            return a.component.localeCompare(b.component) * dir;
          }
          return (b.percentage - a.percentage) * dir;
        });

  // Build the 100-square grid
  const squares: { component: string; index: number }[] = [];
  let squareIndex = 0;

  for (const { component, percentage } of componentData) {
    const squareCount = Math.max(
      percentage > 0 ? 1 : 0,
      Math.round(percentage)
    );

    for (let i = 0; i < squareCount && squareIndex < GRID_SIZE; i++) {
      squares.push({ component, index: squareIndex });
      squareIndex++;
    }
  }

  while (squares.length < GRID_SIZE) {
    squares.push({ component: "", index: squares.length });
  }
  squares.length = GRID_SIZE;

  return (
    <div className="flex-shrink-0 w-[138px] h-[138px]">
      <div className="grid grid-cols-[repeat(10,minmax(0,1fr))] gap-0.5">
        {squares.map(({ component, index }) => {
          const colorStyles = component ? getComponentWaffleStyles(component, componentColors) : null;
          return (
            <div
              key={index}
              className={cn(
                "w-3 h-3",
                component ? colorStyles?.classes : "bg-gray-200"
              )}
              style={colorStyles?.style || undefined}
              title={component || undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Format token count for labels (e.g., 1500 -> "1.5k", 250 -> "250")
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(tokens);
}

/**
 * Absolute waffle chart - each square = tokensPerSquare tokens
 * Height varies based on total tokens, enabling cross-conversation comparison
 */
function AbsoluteWaffleChart({
  componentTokens,
  totalTokens,
  componentColors,
  sortField,
  sortDirection,
  maxRows,
  tokensPerSquare,
  columns,
}: {
  componentTokens: Record<string, number>;
  totalTokens: number;
  componentColors?: Record<string, string>;
  sortField: SortField;
  sortDirection: SortDirection;
  maxRows: number;
  tokensPerSquare: number;
  columns: number;
}) {
  // Sort components
  const componentData = sortField === "category"
    ? sortByCategory(componentTokens, sortDirection)
    : Object.entries(componentTokens)
        .map(([component, tokens]) => ({
          component,
          tokens,
          percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        }))
        .sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          if (sortField === "name") {
            return a.component.localeCompare(b.component) * dir;
          }
          return (b.tokens - a.tokens) * dir;
        });

  // Build squares array - fill with components
  const squares: { component: string }[] = [];
  for (const { component, tokens } of componentData) {
    const count = Math.max(tokens > 0 ? 1 : 0, Math.round(tokens / tokensPerSquare));
    for (let i = 0; i < count; i++) {
      squares.push({ component });
    }
  }

  // Clamp and pad to exactly fill the grid (maxRows * columns)
  const totalCells = maxRows * columns;
  squares.length = Math.min(squares.length, totalCells);
  while (squares.length < totalCells) {
    squares.push({ component: "" });
  }

  // Reverse so filled squares are at the bottom (CSS grid fills top-to-bottom)
  // We want the chart to grow upward from the baseline
  const reversed = [...squares].reverse();

  return (
    <div className="flex flex-col items-center">
      <div className="text-xs text-muted-foreground mb-1 tabular-nums [font-variant:small-caps]">
        {formatTokenCount(totalTokens)}
      </div>
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${columns}, 12px)`,
          gridTemplateRows: `repeat(${maxRows}, 12px)`,
        }}
      >
        {reversed.map((sq, index) => {
          const colorStyles = sq.component
            ? getComponentWaffleStyles(sq.component, componentColors)
            : null;
          return (
            <div
              key={index}
              className={cn(
                "w-3 h-3",
                sq.component ? colorStyles?.classes : "",
              )}
              style={colorStyles?.style || undefined}
              title={sq.component || undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Legend with percentages for a single conversation
 */
function ComparisonLegend({
  componentTokens,
  totalTokens,
  componentColors,
  sortField,
  sortDirection,
}: {
  componentTokens: Record<string, number>;
  totalTokens: number;
  componentColors?: Record<string, string>;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  const componentData = sortField === "category"
    ? sortByCategory(componentTokens, sortDirection)
    : Object.entries(componentTokens)
        .map(([component, tokens]) => ({
          component,
          tokens,
          percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        }))
        .sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          if (sortField === "name") {
            return a.component.localeCompare(b.component) * dir;
          }
          return (b.percentage - a.percentage) * dir;
        });

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {componentData.map(({ component, percentage }) => {
        const colorStyles = getComponentWaffleStyles(component, componentColors);
        return (
          <div key={component} className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-2.5 h-2.5 flex-shrink-0",
                colorStyles.classes
              )}
              style={colorStyles.style || undefined}
            />
            <span className="flex-1 truncate text-muted-foreground [font-variant:small-caps]">
              {component}
            </span>
            <span className="text-muted-foreground tabular-nums [font-variant:small-caps]">
              {percentage.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Grid of waffle charts comparing component distribution across conversations
 */
export function ComponentComparisonView({
  sourceConversations,
  componentColors,
  hasActiveFilters,
  groupTitle,
  onConversationClick,
  // Controlled props
  viewMode: controlledViewMode,
  onViewModeChange,
  legendMode: controlledLegendMode,
  onLegendModeChange,
  sortField: controlledSortField,
  onSortFieldChange,
  sortDirection: controlledSortDirection,
  onSortDirectionChange,
  columnCount: controlledColumnCount,
  onColumnCountChange,
  squaresPerRow: controlledSquaresPerRow,
  onSquaresPerRowChange,
}: ComponentComparisonViewProps) {
  // Local state (used when props are not provided)
  const [localSortField, setLocalSortField] = useState<SortField>("tokens");
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>("desc");
  const [localColumnCount, setLocalColumnCount] = useState<number>(3);
  const [localViewMode, setLocalViewMode] = useState<ViewMode>("tokens");
  const [localSquaresPerRow, setLocalSquaresPerRow] = useState<number>(20);
  const [localLegendMode, setLocalLegendMode] = useState<LegendMode>("expanded");

  // Use controlled values if provided, otherwise use local state
  const viewMode = controlledViewMode ?? localViewMode;
  const legendMode = controlledLegendMode ?? localLegendMode;
  const sortField = controlledSortField ?? localSortField;
  const sortDirection = controlledSortDirection ?? localSortDirection;
  const columnCount = controlledColumnCount ?? localColumnCount;
  const squaresPerRow = controlledSquaresPerRow ?? localSquaresPerRow;

  // Setters that call both local state and callback
  const setViewMode = (mode: ViewMode) => {
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
  };
  const setLegendMode = (mode: LegendMode) => {
    setLocalLegendMode(mode);
    onLegendModeChange?.(mode);
  };
  const setSortField = (field: SortField) => {
    setLocalSortField(field);
    onSortFieldChange?.(field);
  };
  const setSortDirection = (dir: SortDirection) => {
    setLocalSortDirection(dir);
    onSortDirectionChange?.(dir);
  };
  const setColumnCount = (cols: number) => {
    setLocalColumnCount(cols);
    onColumnCountChange?.(cols);
  };
  const setSquaresPerRow = (spr: number) => {
    setLocalSquaresPerRow(spr);
    onSquaresPerRowChange?.(spr);
  };

  // Check if workflow view is available (any conversation has messageComponents)
  const hasWorkflowData = sourceConversations.some(
    (c) => c.messageComponents && c.messageComponents.length > 0,
  );

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking the same field
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      // Switch to new field with default direction
      setSortField(field);
      // Default: tokens/category descending (largest first), name ascending (A-Z)
      setSortDirection(field === "name" ? "asc" : "desc");
    }
  };

  if (sourceConversations.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No conversations to compare.</p>
      </div>
    );
  }

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === "desc"
      ? <ArrowDown className="h-3 w-3 ml-0.5" />
      : <ArrowUp className="h-3 w-3 ml-0.5" />;
  };

  return (
    <>
      {groupTitle && (
        <h2 className="text-lg font-semibold mb-3">{groupTitle}</h2>
      )}
      {/* Toolbar - matches ConversationView toolbar styling */}
      <div className="border rounded-lg p-3 mb-3 bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">View</span>
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              <button
                onClick={() => setViewMode("tokens")}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors",
                  viewMode === "tokens"
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "bg-white text-gray-600 hover:bg-gray-50",
                )}
              >
                Tokens
              </button>
              <button
                onClick={() => setViewMode("tokens-absolute")}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors border-l border-gray-200",
                  viewMode === "tokens-absolute"
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "bg-white text-gray-600 hover:bg-gray-50",
                )}
              >
                Tokens (abs)
              </button>
              {hasWorkflowData && (
                <button
                  onClick={() => setViewMode("workflow")}
                  className={cn(
                    "px-2.5 py-1 text-xs transition-colors border-l border-gray-200",
                    viewMode === "workflow"
                      ? "bg-gray-100 text-gray-900 font-medium"
                      : "bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  Workflow
                </button>
              )}
            </div>
          </div>
          <Separator orientation="vertical" className="h-6" />

          {/* Legend toggle - only for token view */}
          {viewMode === "tokens" && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground font-medium">Legend</span>
                <div className="flex rounded-md border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setLegendMode("expanded")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors",
                      legendMode === "expanded"
                        ? "bg-gray-100 text-gray-900 font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50",
                    )}
                  >
                    Expanded
                  </button>
                  <button
                    onClick={() => setLegendMode("compact")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors border-l border-gray-200",
                      legendMode === "compact"
                        ? "bg-gray-100 text-gray-900 font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50",
                    )}
                  >
                    Compact
                  </button>
                </div>
              </div>
              <Separator orientation="vertical" className="h-6" />
            </>
          )}

          {/* Sort controls - for token views */}
          {(viewMode === "tokens" || viewMode === "tokens-absolute") && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground font-medium">Sort</span>
                <div className="flex rounded-md border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => handleSortClick("tokens")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors flex items-center gap-0.5",
                      sortField === "tokens"
                        ? "bg-gray-100 text-gray-900 font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    Tokens
                    <SortArrow field="tokens" />
                  </button>
                  <button
                    onClick={() => handleSortClick("name")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors flex items-center gap-0.5 border-l border-gray-200",
                      sortField === "name"
                        ? "bg-gray-100 text-gray-900 font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    Name
                    <SortArrow field="name" />
                  </button>
                  <button
                    onClick={() => handleSortClick("category")}
                    className={cn(
                      "px-2.5 py-1 text-xs transition-colors flex items-center gap-0.5 border-l border-gray-200",
                      sortField === "category"
                        ? "bg-gray-100 text-gray-900 font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    Category
                    <SortArrow field="category" />
                  </button>
                </div>
              </div>
              <Separator orientation="vertical" className="h-6" />
            </>
          )}

          {/* Layout controls */}
          <div className="flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={columnCount}
              onChange={(e) => setColumnCount(Number(e.target.value))}
              className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-900 cursor-pointer hover:bg-gray-50"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>{n} col{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          {/* Squares per row - for workflow and tokens-absolute views */}
          {(viewMode === "workflow" || viewMode === "tokens-absolute") && (
            <div className="flex items-center gap-1.5">
              <Rows3 className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={viewMode === "tokens-absolute" ? Math.max(2, Math.min(10, squaresPerRow)) : squaresPerRow}
                onChange={(e) => setSquaresPerRow(Number(e.target.value))}
                className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-900 cursor-pointer hover:bg-gray-50"
              >
                {viewMode === "tokens-absolute"
                  ? [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <option key={n} value={n}>{n} wide</option>
                    ))
                  : [10, 15, 20, 25, 30, 40, 50].map((n) => (
                      <option key={n} value={n}>{n}/row</option>
                    ))
                }
              </select>
            </div>
          )}

          {/* Filter indicator - shown on right side */}
          {hasActiveFilters && (
            <div className="ml-auto text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
              Filtered
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="border rounded-lg bg-muted/30 p-4">
        {/* Shared compact legend - for workflow, tokens-absolute, or compact token view */}
      {(viewMode === "workflow" || viewMode === "tokens-absolute" || (viewMode === "tokens" && legendMode === "compact")) && sourceConversations.length > 0 && (
        <div className="mb-4">
          <CompactLegend
            components={
              viewMode === "workflow"
                ? sourceConversations.flatMap((c) => c.messageComponents || [])
                : sourceConversations.flatMap((c) => Object.keys(c.componentTokens))
            }
            componentColors={componentColors}
          />
        </div>
      )}

      {/* Grid of waffle charts */}
      {viewMode === "tokens-absolute" ? (() => {
        const absColumns = Math.max(2, Math.min(10, squaresPerRow)); // clamp to 2-10
        const MAX_SQUARES = 100; // largest conversation gets 100 squares
        const maxTokens = Math.max(...sourceConversations.map((c) => c.totalTokens));
        const tokensPerSquare = Math.ceil(maxTokens / MAX_SQUARES);
        const maxRows = Math.ceil(MAX_SQUARES / absColumns);

        return (
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
          >
              {sourceConversations.map((conv) => (
                <div key={conv.id} className="flex flex-col items-center">
                  <div className="mb-1 text-center">
                    <button
                      onClick={() => onConversationClick?.(conv.id)}
                      className="text-sm font-medium truncate max-w-[120px] block hover:underline text-left"
                      title={conv.title || conv.filename}
                    >
                      {conv.title || conv.filename}
                    </button>
                    <p className="text-[10px] text-muted-foreground [font-variant:small-caps]">
                      {conv.turnCount} turns · {conv.messageCount} msgs
                    </p>
                  </div>
                  <AbsoluteWaffleChart
                    componentTokens={conv.componentTokens}
                    totalTokens={conv.totalTokens}
                    componentColors={componentColors}
                    sortField={sortField}
                    sortDirection={sortDirection}
                    maxRows={maxRows}
                    tokensPerSquare={tokensPerSquare}
                    columns={absColumns}
                  />
                </div>
              ))}
          </div>
        );
      })() : (
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {sourceConversations.map((conv) => (
          <div key={conv.id} className={cn(
            "border rounded-lg bg-white",
            viewMode === "tokens" && legendMode === "compact" ? "p-2" : "p-4"
          )}>
            {/* Filename header */}
            <div className={viewMode === "tokens" && legendMode === "compact" ? "mb-2" : "mb-3"}>
              <button
                onClick={() => onConversationClick?.(conv.id)}
                className="text-sm font-medium truncate block hover:underline text-left"
                title={conv.title || conv.filename}
              >
                {conv.title || conv.filename}
              </button>
              <p className="text-xs text-muted-foreground [font-variant:small-caps]">
                {conv.totalTokens.toLocaleString()} tokens · {conv.turnCount} turns · {conv.messageCount} messages
                {conv.durationMs !== undefined && ` · ${formatDuration(conv.durationMs)}`}
              </p>
            </div>

            {/* Waffle chart and legend side by side */}
            <div className={viewMode === "tokens" && legendMode === "compact" ? "" : "flex gap-4"}>
              {viewMode === "tokens" ? (
                <>
                  <MiniWaffleChart
                    componentTokens={conv.componentTokens}
                    totalTokens={conv.totalTokens}
                    componentColors={componentColors}
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                  {legendMode === "expanded" && (
                    <div className="flex-1 min-w-0 max-h-[216px] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none]">
                      <ComparisonLegend
                        componentTokens={conv.componentTokens}
                        totalTokens={conv.totalTokens}
                        componentColors={componentColors}
                        sortField={sortField}
                        sortDirection={sortDirection}
                      />
                    </div>
                  )}
                </>
              ) : conv.messageComponents ? (
                <MessageWorkflowChart
                  messageComponents={conv.messageComponents}
                  componentColors={componentColors}
                  squaresPerRow={squaresPerRow}
                />
              ) : (
                <div className="text-xs text-muted-foreground">
                  No workflow data available
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
      </div>
    </>
  );
}
